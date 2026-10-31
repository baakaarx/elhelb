const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { get, all, run, transaction, getSetting } = require('../db');
const {
  JWT_SECRET,
  COOKIE_NAME,
  LEGACY_COOKIE_NAMES,
  isSecureRequest,
  validatePasswordStrength,
  decryptSecretValue,
  signUserToken,
  loadUserById,
  writeAudit,
} = require('../rbac');
const { getGmailConfig, isDeliverableEmail } = require('../mailer');
const authRoutes = require('./auth');

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات تسجيل كثيرة جداً، يرجى الانتظار قليلاً والمحاولة مرة أخرى' },
});

function getGoogleCredentials() {
  const googleClientId =
    process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id', '');
  const googleClientSecret =
    process.env.GOOGLE_CLIENT_SECRET ||
    decryptSecretValue(getSetting('google_client_secret', ''));

  return {
    googleClientId: googleClientId.trim(),
    googleClientSecret: googleClientSecret.trim(),
  };
}

function getBaseOrigin(req) {
  const configuredOrigin = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch (_) {}
  }

  const trustProxyEnabled = Boolean(req && req.app && req.app.get('trust proxy'));
  const rawProto = trustProxyEnabled
    ? String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http'))
        .split(',')[0]
        .trim()
    : req.secure
    ? 'https'
    : 'http';
  const proto = rawProto === 'https' ? 'https' : 'http';

  const rawHost = trustProxyEnabled
    ? String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000')
        .split(',')[0]
        .trim()
    : String(req.headers.host || 'localhost:3000')
        .split(',')[0]
        .trim();

  const safeHost = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost)
    ? rawHost
    : 'localhost:3000';

  return `${proto}://${safeHost}`;
}

function getOrCreatePendingRole() {
  let pendingRole = get(`SELECT id FROM roles WHERE slug = 'pending_onboarding'`);
  if (!pendingRole) {
    const rId = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected)
       VALUES ('pending_onboarding', 'بانتظار التسكين في قسم', 'بانتظار إضافة رئيس القسم', '#94a3b8', 0, 1)`
    ).lastInsertRowid;
    pendingRole = { id: rId };
  }
  return pendingRole;
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

function findOrCreateGoogleEmployee({
  oauthId,
  fullName,
  email,
  emailVerifiedByGoogle = true,
  avatarUrl = null,
  preferredDepartmentId = null,
  req = null,
}) {
  const cleanEmail = emailVerifiedByGoogle
    ? String(email || '').trim().toLowerCase()
    : '';
  const cleanName = String(fullName || '').trim();

  let existing = null;
  if (oauthId) {
    existing = get(
      `SELECT * FROM users WHERE auth_provider = 'google' AND oauth_id = ?`,
      [String(oauthId)]
    );
  }
  if (!existing && cleanEmail) {
    const candidate = get(
      `SELECT u.*, r.slug AS role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = LOWER(?)`,
      [cleanEmail]
    );
    if (candidate) {
      // Sovereign protection: never auto-link external OAuth into Chairman account
      if (candidate.role_slug === 'chairman') {
        const err = new Error('حساب رئيس مجلس الإدارة محمي بالدخول المباشر فقط ولا يقبل الربط التلقائي الخارجي');
        err.statusCode = 403;
        throw err;
      }
      // Anti-Pre-Hijacking: NEVER auto-link Google login into a local account whose email was never verified!
      // Detach the unverified squatter claim so the real verified Google owner gets a clean independent account.
      if (Number(candidate.email_verified) === 1) {
        existing = candidate;
      } else {
        run(
          `UPDATE users SET email = NULL, email_verified = 0 WHERE id = ? AND email_verified = 0`,
          [candidate.id]
        );
      }
    }
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
      action: 'تسجيل دخول عبر Google',
      status: 'ALLOWED',
      req,
      details: cleanEmail || loaded.username,
    });
    return { user: loaded, isNewUser: false };
  }

  const pendingRole = getOrCreatePendingRole();
  let validPrefDept = null;
  if (preferredDepartmentId) {
    validPrefDept = get(`SELECT * FROM departments WHERE id = ?`, [
      Number(preferredDepartmentId),
    ]);
  }

  const username = generateUniqueUsername(cleanEmail || cleanName, 'google');
  const deptConfirmed = validPrefDept ? 1 : 0;

  const newUserId = transaction(() =>
    run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title,
        avatar_color, avatar_url, auth_provider, oauth_id,
        email_verified, has_custom_credentials, department_confirmed,
        onboarding_status, preferred_department_id, role_id, department_id
      ) VALUES (?, ?, '', ?, '', '#15803d', ?, 'google', ?, 1, 0, ?, 'pending', ?, ?, NULL)`,
      [
        username,
        cleanEmail || null,
        cleanName,
        avatarUrl || null,
        oauthId ? String(oauthId) : `google-${crypto.randomUUID()}`,
        deptConfirmed,
        validPrefDept ? validPrefDept.id : null,
        pendingRole.id,
      ]
    ).lastInsertRowid
  );

  const loaded = loadUserById(newUserId);
  writeAudit({
    user: loaded,
    action: 'تسجيل موظف جديد عبر Google',
    status: 'ALLOWED',
    req,
    details: `${cleanName} (${cleanEmail})`,
  });

  return { user: loaded, isNewUser: true };
}

// Public metadata for registration & departments
router.get('/oauth/providers', (req, res) => {
  const creds = getGoogleCredentials();
  const gmailCfg = getGmailConfig();
  const origin = getBaseOrigin(req);
  const departments = all(
    `SELECT id, slug, name, color, is_chairman_exclusive FROM departments ORDER BY id ASC`
  ).map((d) => ({
    ...d,
    is_chairman_exclusive: Boolean(Number(d.is_chairman_exclusive)),
  }));

  res.json({
    googleConfigured: Boolean(creds.googleClientId && creds.googleClientSecret),
    gmailConfigured: Boolean(gmailCfg.configured && gmailCfg.enabled),
    googleCallbackUrl: `${origin}/api/auth/oauth/google/callback`,
    departments,
  });
});

// ==========================================
// 1. DIRECT EMPLOYEE REGISTRATION (بدون كود تحقق بريد — ينشئ اسمه وباسورده ثم يختار قسمه)
// ==========================================
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim();
    const rawUsername = String(body.username || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const rawEmail = String(body.email || '')
      .trim()
      .toLowerCase();

    if (fullName.length < 3) {
      return res.status(400).json({
        error: 'يرجى كتابة الاسم الكامل للموظف (3 أحرف على الأقل)',
      });
    }

    if (!/^[a-z0-9_.-]{3,32}$/.test(rawUsername)) {
      return res.status(400).json({
        error: 'اسم المستخدم يجب أن يتكون من 3 إلى 32 حرفاً أو رقماً بالإنجليزية بدون مسافات (مثال: ahmed.export)',
      });
    }

    const pwErr = validatePasswordStrength(password, rawUsername);
    if (pwErr) {
      return res.status(400).json({ error: pwErr });
    }

    const existingUsername = get(
      `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`,
      [rawUsername]
    );
    if (existingUsername) {
      return res.status(409).json({
        error: 'اسم المستخدم هذا مستخدم بالفعل — يرجى اختيار اسم مستخدم آخر',
      });
    }

    let cleanEmail = null;
    if (rawEmail) {
      if (!isDeliverableEmail(rawEmail)) {
        return res.status(400).json({
          error: 'صيغة البريد الإلكتروني غير صحيحة (أو اتركه فارغاً)',
        });
      }
      const existingEmail = get(
        `SELECT id FROM users WHERE LOWER(email) = LOWER(?)`,
        [rawEmail]
      );
      if (existingEmail) {
        return res.status(409).json({
          error: 'هذا البريد الإلكتروني مسجل لحساب آخر بالفعل',
        });
      }
      cleanEmail = rawEmail;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pendingRole = getOrCreatePendingRole();

    const newUserId = transaction(() =>
      run(
        `INSERT INTO users (
          username, email, password_hash, full_name, job_title,
          avatar_color, auth_provider, email_verified,
          has_custom_credentials, department_confirmed,
          onboarding_status, preferred_department_id, role_id, department_id
        ) VALUES (?, ?, ?, ?, '', '#15803d', 'local', 0, 1, 0, 'pending', NULL, ?, NULL)`,
        [rawUsername, cleanEmail, passwordHash, fullName, pendingRole.id]
      ).lastInsertRowid
    );

    const loaded = loadUserById(newUserId);
    writeAudit({
      user: loaded,
      action: 'تسجيل حساب موظف جديد (بانتظار تحديد القسم واعتماد رئيس القسم)',
      status: 'ALLOWED',
      req,
      details: `${fullName} (@${rawUsername})`,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [newUserId]);
    const token = signUserToken(rawRow);
    const isHttps = isSecureRequest(req);
    for (const oldName of LEGACY_COOKIE_NAMES || []) res.clearCookie(oldName);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    return res.status(201).json({
      ok: true,
      token,
      isNewUser: true,
      user: authRoutes.serializeCurrentUser(loaded),
    });
  } catch (err) {
    console.error('Register employee error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الحساب' });
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
  const rawDept = Number(req.query.dept);
  const prefDept = Number.isInteger(rawDept) && rawDept > 0 ? rawDept : null;
  const nonce = crypto.randomBytes(16).toString('hex');
  const isHttps =
    req.secure ||
    (Boolean(req.app && req.app.get('trust proxy')) &&
      String(req.headers['x-forwarded-proto'] || '').includes('https'));

  res.cookie('elhelb_oauth_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: 15 * 60 * 1000,
  });

  const state = jwt.sign(
    { p: 'google', d: prefDept, n: nonce },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );

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

    const decodedState = jwt.verify(String(state), JWT_SECRET, {
      algorithms: ['HS256'],
    });
    const cookieNonce = req.cookies && req.cookies.elhelb_oauth_nonce;
    res.clearCookie('elhelb_oauth_nonce');
    if (!decodedState || !decodedState.n || cookieNonce !== decodedState.n) {
      return res.redirect('/?oauth_error=state_mismatch');
    }
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
    if (!profileResp.ok || !profile.sub) {
      return res.redirect('/?oauth_error=google_profile_failed');
    }

    const verifiedGoogleEmail =
      profile.email_verified === true || profile.email_verified === 'true'
        ? profile.email || ''
        : '';

    const { user } = findOrCreateGoogleEmployee({
      oauthId: profile.sub,
      fullName: profile.name || verifiedGoogleEmail || 'موظف Google',
      email: verifiedGoogleEmail,
      emailVerifiedByGoogle: Boolean(verifiedGoogleEmail),
      avatarUrl: profile.picture || null,
      preferredDepartmentId: decodedState.d || null,
      req,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    const token = signUserToken(rawRow);
    const isHttps = isSecureRequest(req);
    for (const oldName of LEGACY_COOKIE_NAMES || []) res.clearCookie(oldName);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    // Deliver token in URL fragment (#) so it is never sent in HTTP GET requests or access logs
    return res.redirect(`/#oauth_token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect('/?oauth_error=google_exception');
  }
});

router.router = router;
router.getGoogleCredentials = getGoogleCredentials;
router.getOAuthCredentials = getGoogleCredentials;
router.getBaseOrigin = getBaseOrigin;
router.findOrCreateGoogleEmployee = findOrCreateGoogleEmployee;
module.exports = router;
