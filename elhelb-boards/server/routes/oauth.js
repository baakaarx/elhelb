const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { get, all, run, transaction, getSetting, setSetting } = require('../db');
const {
  JWT_SECRET,
  COOKIE_NAME,
  signUserToken,
  loadUserById,
  writeAudit,
} = require('../rbac');
const {
  getGmailConfig,
  isDeliverableEmail,
  verifyGmailCredentials,
  sendEmailVerificationCode,
} = require('../mailer');
const authRoutes = require('./auth');

const router = express.Router();

// Internal Map used ONLY by Node integration tests (never exposed over HTTP)
const _lastTestOtpByEmail = new Map();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات تحقق كثيرة جداً، يرجى الانتظار قليلاً والمحاولة مرة أخرى' },
});

function getGoogleCredentials() {
  const googleClientId =
    process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id', '');
  const googleClientSecret =
    process.env.GOOGLE_CLIENT_SECRET || getSetting('google_client_secret', '');

  return {
    googleClientId: googleClientId.trim(),
    googleClientSecret: googleClientSecret.trim(),
  };
}

function getBaseOrigin(req) {
  const proto = String(
    req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
  )
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function generateUniqueUsername(emailOrName, provider = 'emp') {
  const base = String(emailOrName || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '')
    .slice(0, 24);
  const root = base.length >= 3 ? base : `${provider}_user`;
  let candidate = root;
  let suffix = 1;
  while (get(`SELECT 1 AS ok FROM users WHERE LOWER(username) = LOWER(?)`, [candidate])) {
    suffix += 1;
    candidate = `${root}_${suffix}`;
  }
  return candidate;
}

function findOrCreateVerifiedEmployee({
  provider = 'email',
  oauthId = null,
  fullName,
  email,
  avatarUrl = null,
  preferredDepartmentId = null,
  req = null,
}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(fullName || '').trim();

  let existing = null;
  if (oauthId) {
    existing = get(
      `SELECT * FROM users WHERE auth_provider = ? AND oauth_id = ?`,
      [provider, String(oauthId)]
    );
  }
  if (!existing && cleanEmail) {
    existing = get(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
  }

  if (existing) {
    if (!existing.is_active) {
      const err = new Error('هذا الحساب موقوف حالياً من الإدارة');
      err.statusCode = 403;
      throw err;
    }
    run(
      `UPDATE users
       SET email_verified = 1,
           avatar_url = COALESCE(?, avatar_url),
           oauth_id = COALESCE(oauth_id, ?)
       WHERE id = ?`,
      [avatarUrl || null, oauthId ? String(oauthId) : null, existing.id]
    );
    const loaded = loadUserById(existing.id);
    writeAudit({
      user: loaded,
      action: provider === 'google' ? 'تسجيل دخول موثق عبر Google' : 'تأكيد البريد الإلكتروني بنجاح',
      status: 'ALLOWED',
      req,
      details: cleanEmail || loaded.username,
    });
    return { user: loaded, isNewUser: false };
  }

  let pendingRole = get(`SELECT id FROM roles WHERE slug = 'pending_onboarding'`);
  if (!pendingRole) {
    const rId = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected)
       VALUES ('pending_onboarding', 'بانتظار التسكين في قسم', 'بانتظار إضافة رئيس القسم', '#94a3b8', 0, 1)`
    ).lastInsertRowid;
    pendingRole = { id: rId };
  }

  let validPrefDept = null;
  if (preferredDepartmentId) {
    validPrefDept = get(`SELECT * FROM departments WHERE id = ?`, [
      Number(preferredDepartmentId),
    ]);
  }

  const username = generateUniqueUsername(cleanEmail || cleanName, provider);
  const avatarColor = '#15803d';
  const deptConfirmed = validPrefDept ? 1 : 0;

  const newUserId = transaction(() =>
    run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title,
        avatar_color, avatar_url, auth_provider, oauth_id,
        email_verified, has_custom_credentials, department_confirmed,
        onboarding_status, preferred_department_id, role_id, department_id
      ) VALUES (?, ?, '', ?, '', ?, ?, ?, ?, 1, 0, ?, 'pending', ?, ?, NULL)`,
      [
        username,
        cleanEmail,
        cleanName,
        avatarColor,
        avatarUrl || null,
        provider,
        oauthId ? String(oauthId) : `${provider}-${crypto.randomUUID()}`,
        deptConfirmed,
        validPrefDept ? validPrefDept.id : null,
        pendingRole.id,
      ]
    ).lastInsertRowid
  );

  const loaded = loadUserById(newUserId);
  writeAudit({
    user: loaded,
    action: 'تسجيل موظف جديد بعد تأكيد البريد الإلكتروني',
    status: 'ALLOWED',
    req,
    details: `${cleanName} (${cleanEmail}) — بانتظار إنشاء بيانات الدخول وتسكين رئيس القسم`,
  });

  return { user: loaded, isNewUser: true };
}

// Public metadata for registration & departments
router.get('/oauth/providers', (req, res) => {
  const creds = getGoogleCredentials();
  const gmailCfg = getGmailConfig();
  const origin = getBaseOrigin(req);
  const departments = all(`SELECT id, name, color FROM departments ORDER BY id ASC`);

  res.json({
    googleConfigured: Boolean(creds.googleClientId && creds.googleClientSecret),
    gmailConfigured: Boolean(gmailCfg.configured && gmailCfg.enabled),
    defaultGmailUser: gmailCfg.gmailUser || 'mb9836504@gmail.com',
    googleCallbackUrl: `${origin}/api/auth/oauth/google/callback`,
    departments,
  });
});

// ==========================================
// 0. INLINE 1-STEP ADMIN GMAIL ACTIVATOR (بدون مغادرة شاشة التسجيل)
// ==========================================
router.post('/quick-setup-gmail', otpLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const adminPassword = String(body.adminPassword || '');
    const gmailUser = String(body.gmailUser || '').trim().toLowerCase();
    const gmailAppPassword = String(body.gmailAppPassword || '').replace(/\s+/g, '');
    const pendingEmail = String(body.pendingEmail || '').trim().toLowerCase();
    const pendingFullName = String(body.pendingFullName || '').trim();

    if (!adminPassword) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة مرور حساب المسؤول (admin)' });
    }

    const adminRow = get(
      `SELECT u.*
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.username) = 'admin' AND r.slug = 'chairman' AND u.is_active = 1`
    );
    if (!adminRow || !adminRow.password_hash) {
      return res.status(401).json({ error: 'تعذر التحقق من حساب المسؤول' });
    }

    const passOk = await bcrypt.compare(adminPassword, adminRow.password_hash);
    if (!passOk) {
      writeAudit({
        actorName: 'admin',
        action: 'محاولة فاشلة لتفعيل بريد Gmail السريع',
        status: 'DENIED',
        req,
        details: 'كلمة مرور admin غير صحيحة',
      });
      return res.status(401).json({ error: 'كلمة مرور المسؤول (admin) غير صحيحة' });
    }

    const { cleanUser, cleanPass } = await verifyGmailCredentials({
      gmailUser,
      gmailAppPassword,
    });

    setSetting('gmail_user', cleanUser);
    setSetting('gmail_app_password', cleanPass);
    setSetting('gmail_admin_cc', cleanUser);
    setSetting('gmail_enabled', '1');

    const adminLoaded = loadUserById(adminRow.id);
    writeAudit({
      user: adminLoaded,
      action: 'تفعيل ربط إشعارات Gmail المباشر',
      status: 'ALLOWED',
      req,
      details: cleanUser,
    });

    // If the user was right in the middle of sending a verification code, send it immediately!
    let codeSent = false;
    if (isDeliverableEmail(pendingEmail) && pendingFullName.length >= 3) {
      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = bcrypt.hashSync(code, 8);
      run(
        `INSERT INTO email_verifications (email, full_name, code_hash, attempts, expires_at)
         VALUES (?, ?, ?, 0, datetime('now', '+10 minutes'))`,
        [pendingEmail, pendingFullName, codeHash]
      );
      if (process.env.ELHELB_TEST_MODE === '1') {
        _lastTestOtpByEmail.set(pendingEmail, code);
      }
      const mailRes = await sendEmailVerificationCode({
        toEmail: pendingEmail,
        fullName: pendingFullName,
        code,
      });
      codeSent = Boolean(mailRes.sent || process.env.ELHELB_TEST_MODE === '1');
    }

    return res.json({
      ok: true,
      gmailConfigured: true,
      gmailUser: cleanUser,
      codeSent,
      message: codeSent
        ? `تم تفعيل بريد (${cleanUser}) وإرسال كود التأكيد المكون من 6 أرقام إلى (${pendingEmail}) بنجاح!`
        : `تم تفعيل وربط بريد (${cleanUser}) بنجاح!`,
    });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'تعذر تفعيل إعدادات Gmail' });
  }
});

// ==========================================
// 1. EMAIL VERIFICATION (6-DIGIT OTP CODE)
// ==========================================
router.post('/email/send-code', otpLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (fullName.length < 3) {
      return res.status(400).json({
        error: 'يرجى كتابة الاسم الكامل للموظف (3 أحرف على الأقل)',
      });
    }
    if (!isDeliverableEmail(email)) {
      return res.status(400).json({
        error: 'يرجى إدخال بريد إلكتروني صحيح لاستلام كود التأكيد',
      });
    }

    // Block re-registration if an active account already completed setup with this email
    const existingActive = get(
      `SELECT id, has_custom_credentials, is_active FROM users WHERE LOWER(email) = LOWER(?)`,
      [email]
    );
    if (existingActive && !existingActive.is_active) {
      return res.status(403).json({
        error: 'هذا الحساب موقوف حالياً من الإدارة',
      });
    }
    if (existingActive && existingActive.has_custom_credentials) {
      return res.status(409).json({
        error: 'هذا البريد الإلكتروني مسجل بالفعل — يرجى تسجيل الدخول مباشرة باسم المستخدم أو البريد وكلمة المرور',
      });
    }

    // Per-email rate cap: max 5 codes within 15 minutes
    const recentCount = get(
      `SELECT COUNT(*) AS cnt FROM email_verifications
       WHERE email = ? AND datetime(created_at) > datetime('now', '-15 minutes')`,
      [email]
    );
    if (recentCount && recentCount.cnt >= 5) {
      return res.status(429).json({
        error: 'تم إرسال عدة أكواد لهذا البريد مؤخراً — يرجى مراجعة صندوق الوارد أو الانتظار بضع دقائق',
      });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = bcrypt.hashSync(code, 8);

    run(
      `INSERT INTO email_verifications (email, full_name, code_hash, attempts, expires_at)
       VALUES (?, ?, ?, 0, datetime('now', '+10 minutes'))`,
      [email, fullName, codeHash]
    );

    if (process.env.ELHELB_TEST_MODE === '1') {
      _lastTestOtpByEmail.set(email, code);
    }

    const mailRes = await sendEmailVerificationCode({
      toEmail: email,
      fullName,
      code,
    });

    if (!mailRes.sent && process.env.ELHELB_TEST_MODE !== '1') {
      if (mailRes.reason === 'NOT_CONFIGURED') {
        return res.status(503).json({
          error:
            'خدمة إرسال البريد (Gmail) غير مفعلة بعد — يرجى من مسؤول النظام (admin) ربط بريد الشركة من تبويب إشعارات البريد أولاً.',
          code: 'GMAIL_NOT_CONFIGURED',
        });
      }
      return res.status(502).json({
        error:
          'تعذر إرسال كود التأكيد عبر البريد الإلكتروني حالياً — يرجى التأكد من صحة إعدادات Gmail App Password في لوحة الإدارة.',
      });
    }

    return res.json({
      ok: true,
      email,
      expiresInMinutes: 10,
      message: `تم إرسال كود التأكيد المكون من 6 أرقام إلى ${email}`,
    });
  } catch (err) {
    console.error('send-code error:', err);
    return res.status(500).json({ error: 'تعذر إرسال كود التأكيد للبريد الإلكتروني' });
  }
});

router.post('/email/verify-code', otpLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').replace(/\s+/g, '').trim();
    const fallbackName = String(body.fullName || '').trim();

    if (!isDeliverableEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'يرجى إدخال البريد الإلكتروني وكود التأكيد المكون من 6 أرقام بشكل صحيح',
      });
    }

    const record = get(
      `SELECT * FROM email_verifications
       WHERE email = ? AND verified_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [email]
    );

    if (!record) {
      return res.status(400).json({
        error: 'لا يوجد كود تأكيد نشط لهذا البريد — يرجى طلب إرسال كود جديد',
      });
    }

    const notExpired = get(
      `SELECT 1 AS ok FROM email_verifications
       WHERE id = ? AND datetime(expires_at) > datetime('now')`,
      [record.id]
    );
    if (!notExpired) {
      return res.status(400).json({
        error: 'انتهت صلاحية كود التأكيد (10 دقائق) — يرجى الضغط على إعادة إرسال الكود',
      });
    }

    if (record.attempts >= 5) {
      return res.status(429).json({
        error: 'تم تجاوز الحد الأقصى لمحاولات إدخال الكود — يرجى طلب كود جديد',
      });
    }

    const isMatch = bcrypt.compareSync(code, record.code_hash);
    if (!isMatch) {
      run(`UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?`, [
        record.id,
      ]);
      writeAudit({
        actorName: email,
        action: 'إدخال كود تأكيد بريد خاطئ',
        status: 'DENIED',
        req,
        details: `المحاولة رقم ${record.attempts + 1}`,
      });
      return res.status(400).json({
        error: 'كود التأكيد غير صحيح — يرجى مراجعة الرسالة المرسلة إلى بريدك الإلكتروني',
      });
    }

    run(`UPDATE email_verifications SET verified_at = datetime('now') WHERE id = ?`, [
      record.id,
    ]);

    const { user, isNewUser } = findOrCreateVerifiedEmployee({
      provider: 'email',
      fullName: record.full_name || fallbackName || email.split('@')[0],
      email,
      req,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    const token = signUserToken(rawRow);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    return res.json({
      ok: true,
      token,
      isNewUser,
      user: authRoutes.serializeCurrentUser(user),
    });
  } catch (err) {
    console.error('verify-code error:', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'تعذر التحقق من الكود' });
  }
});

// ==========================================
// 2. REAL GOOGLE OAUTH 2.0 FLOW (OPTIONAL)
// ==========================================
router.get('/oauth/google/start', (req, res) => {
  const { googleClientId, googleClientSecret } = getGoogleCredentials();
  if (!googleClientId || !googleClientSecret) {
    return res.redirect('/?oauth_error=google_not_configured');
  }
  const redirectUri = `${getBaseOrigin(req)}/api/auth/oauth/google/callback`;
  const prefDept = req.query.dept ? Number(req.query.dept) : null;
  const state = jwt.sign({ p: 'google', d: prefDept }, JWT_SECRET, { expiresIn: '15m' });

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/oauth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/?oauth_error=cancelled');

    const decodedState = jwt.verify(String(state), JWT_SECRET);
    const { googleClientId, googleClientSecret } = getGoogleCredentials();
    const redirectUri = `${getBaseOrigin(req)}/api/auth/oauth/google/callback`;

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson.access_token) {
      return res.redirect('/?oauth_error=google_token_failed');
    }

    const profileResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = await profileResp.json();
    if (!profileResp.ok || !profile.sub || !profile.email || profile.email_verified === false) {
      return res.redirect('/?oauth_error=google_profile_failed');
    }

    const { user } = findOrCreateVerifiedEmployee({
      provider: 'google',
      oauthId: profile.sub,
      fullName: profile.name || profile.email || 'موظف Google',
      email: profile.email,
      avatarUrl: profile.picture || null,
      preferredDepartmentId: decodedState.d || null,
      req,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    const token = signUserToken(rawRow);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    return res.redirect(`/?oauth_token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect('/?oauth_error=google_exception');
  }
});

router.router = router;
router.getGoogleCredentials = getGoogleCredentials;
router.getOAuthCredentials = getGoogleCredentials;
router.getBaseOrigin = getBaseOrigin;
router._lastTestOtpByEmail = _lastTestOtpByEmail;
module.exports = router;
