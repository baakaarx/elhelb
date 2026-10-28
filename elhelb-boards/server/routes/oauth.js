const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get, all, run, transaction, getSetting } = require('../db');
const {
  JWT_SECRET,
  COOKIE_NAME,
  signUserToken,
  loadUserById,
  writeAudit,
} = require('../rbac');

const router = express.Router();

function getOAuthCredentials() {
  const googleClientId =
    process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id', '');
  const googleClientSecret =
    process.env.GOOGLE_CLIENT_SECRET || getSetting('google_client_secret', '');
  const facebookAppId =
    process.env.FACEBOOK_APP_ID || getSetting('facebook_app_id', '');
  const facebookAppSecret =
    process.env.FACEBOOK_APP_SECRET || getSetting('facebook_app_secret', '');

  return {
    googleClientId: googleClientId.trim(),
    googleClientSecret: googleClientSecret.trim(),
    facebookAppId: facebookAppId.trim(),
    facebookAppSecret: facebookAppSecret.trim(),
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

function generateUniqueUsername(emailOrName, provider) {
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

/**
 * Finds an existing user by OAuth ID or Email, OR registers a brand-new user
 * in 'pending' onboarding state waiting for a Department Head to claim them!
 */
function findOrCreateSocialUser({
  provider,
  oauthId,
  fullName,
  email,
  avatarUrl = null,
  preferredDepartmentId = null,
  jobTitle = '',
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
    // Keep profile name / avatar synced if missing
    run(
      `UPDATE users
       SET avatar_url = COALESCE(?, avatar_url),
           oauth_id = COALESCE(oauth_id, ?)
       WHERE id = ?`,
      [avatarUrl || null, oauthId ? String(oauthId) : null, existing.id]
    );
    const loaded = loadUserById(existing.id);
    writeAudit({
      user: loaded,
      action: `تسجيل دخول عبر ${provider === 'google' ? 'Google' : 'Facebook'}`,
      status: 'ALLOWED',
      req,
      details: cleanEmail || loaded.username,
    });
    return { user: loaded, isNewUser: false };
  }

  // Brand-new employee -> place in Pending Onboarding Waiting Room!
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
  const avatarColor = provider === 'facebook' ? '#1877f2' : '#ea4335';
  const deptConfirmed = validPrefDept ? 1 : 0;

  const newUserId = transaction(() => {
    const uid = run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title,
        avatar_color, avatar_url, auth_provider, oauth_id,
        has_custom_credentials, department_confirmed,
        onboarding_status, preferred_department_id, role_id, department_id
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, NULL)`,
      [
        username,
        cleanEmail || null,
        cleanName,
        String(jobTitle || '').trim().slice(0, 100),
        avatarColor,
        avatarUrl || null,
        provider,
        oauthId ? String(oauthId) : `${provider}-${crypto.randomUUID()}`,
        deptConfirmed,
        validPrefDept ? validPrefDept.id : null,
        pendingRole.id,
      ]
    ).lastInsertRowid;

    return uid;
  });

  const loaded = loadUserById(newUserId);
  writeAudit({
    user: loaded,
    action: `تسجيل حساب موظف جديد عبر ${provider === 'facebook' ? 'Facebook' : 'Google'}`,
    status: 'ALLOWED',
    req,
    details: `${cleanName} (${cleanEmail || username}) — بانتظار تسكين رئيس القسم`,
  });

  return { user: loaded, isNewUser: true };
}

// Public metadata about configured OAuth providers + public department list for registration
router.get('/oauth/providers', (req, res) => {
  const creds = getOAuthCredentials();
  const origin = getBaseOrigin(req);
  const departments = all(
    `SELECT id, name, color FROM departments ORDER BY id ASC`
  );

  res.json({
    googleConfigured: Boolean(creds.googleClientId && creds.googleClientSecret),
    facebookConfigured: Boolean(creds.facebookAppId && creds.facebookAppSecret),
    googleCallbackUrl: `${origin}/api/auth/oauth/google/callback`,
    facebookCallbackUrl: `${origin}/api/auth/oauth/facebook/callback`,
    departments,
  });
});

// ==========================================
// 1. REAL GOOGLE OAUTH 2.0 FLOW
// ==========================================
router.get('/oauth/google/start', (req, res) => {
  const { googleClientId, googleClientSecret } = getOAuthCredentials();
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
    const { googleClientId, googleClientSecret } = getOAuthCredentials();
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
    if (!profile || !profile.sub) {
      return res.redirect('/?oauth_error=google_profile_failed');
    }

    const { user } = findOrCreateSocialUser({
      provider: 'google',
      oauthId: profile.sub,
      fullName: profile.name || profile.email || 'موظف Google',
      email: profile.email || '',
      avatarUrl: profile.picture || null,
      preferredDepartmentId: decodedState.d || null,
      req,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    const appToken = signUserToken(rawRow);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(COOKIE_NAME, appToken, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    return res.redirect(`/?oauth_token=${encodeURIComponent(appToken)}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect('/?oauth_error=google_exception');
  }
});

// ==========================================
// 2. REAL FACEBOOK OAUTH 2.0 FLOW
// ==========================================
router.get('/oauth/facebook/start', (req, res) => {
  const { facebookAppId, facebookAppSecret } = getOAuthCredentials();
  if (!facebookAppId || !facebookAppSecret) {
    return res.redirect('/?oauth_error=facebook_not_configured');
  }
  const redirectUri = `${getBaseOrigin(req)}/api/auth/oauth/facebook/callback`;
  const prefDept = req.query.dept ? Number(req.query.dept) : null;
  const state = jwt.sign({ p: 'facebook', d: prefDept }, JWT_SECRET, { expiresIn: '15m' });

  const params = new URLSearchParams({
    client_id: facebookAppId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'public_profile,email',
    state,
  });

  res.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`);
});

router.get('/oauth/facebook/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/?oauth_error=cancelled');

    const decodedState = jwt.verify(String(state), JWT_SECRET);
    const { facebookAppId, facebookAppSecret } = getOAuthCredentials();
    const redirectUri = `${getBaseOrigin(req)}/api/auth/oauth/facebook/callback`;

    const tokenUrl = `https://graph.facebook.com/v20.0/oauth/access_token?${new URLSearchParams({
      client_id: facebookAppId,
      client_secret: facebookAppSecret,
      redirect_uri: redirectUri,
      code: String(code),
    }).toString()}`;

    const tokenResp = await fetch(tokenUrl);
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson.access_token) {
      return res.redirect('/?oauth_error=facebook_token_failed');
    }

    const meUrl = `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(
      tokenJson.access_token
    )}`;
    const meResp = await fetch(meUrl);
    const profile = await meResp.json();
    if (!profile || !profile.id) {
      return res.redirect('/?oauth_error=facebook_profile_failed');
    }

    const picUrl =
      profile.picture && profile.picture.data && profile.picture.data.url
        ? profile.picture.data.url
        : null;

    const { user } = findOrCreateSocialUser({
      provider: 'facebook',
      oauthId: profile.id,
      fullName: profile.name || 'موظف Facebook',
      email: profile.email || `${profile.id}@facebook.user`,
      avatarUrl: picUrl,
      preferredDepartmentId: decodedState.d || null,
      req,
    });

    const rawRow = get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    const appToken = signUserToken(rawRow);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(COOKIE_NAME, appToken, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    return res.redirect(`/?oauth_token=${encodeURIComponent(appToken)}`);
  } catch (err) {
    console.error('Facebook OAuth callback error:', err);
    return res.redirect('/?oauth_error=facebook_exception');
  }
});

// ==========================================
// 3. INSTANT SOCIAL ENTRY (Works immediately without external API keys for fast onboarding & testing!)
// ==========================================
router.post('/social-entry', (req, res) => {
  try {
    const body = req.body || {};
    const provider = body.provider === 'facebook' ? 'facebook' : 'google';
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const jobTitle = String(body.jobTitle || '').trim();
    const preferredDepartmentId = body.preferredDepartmentId
      ? Number(body.preferredDepartmentId)
      : null;

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({ error: 'يرجى كتابة اسمك الثلاثي أو الكامل باللغة العربية أو الإنجليزية' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح مرتبط بحسابك' });
    }

    const { user, isNewUser } = findOrCreateSocialUser({
      provider,
      oauthId: `${provider}:${email}`,
      fullName,
      email,
      preferredDepartmentId,
      jobTitle,
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

    res.json({
      ok: true,
      isNewUser,
      token,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    res.status(code).json({ error: err.message || 'تعذر إتمام التسجيل' });
  }
});

module.exports = {
  router,
  getOAuthCredentials,
  getBaseOrigin,
};
