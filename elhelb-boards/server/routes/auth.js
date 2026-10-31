const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../db');
const {
  COOKIE_NAME,
  LEGACY_COOKIE_NAMES,
  signUserToken,
  loadUserById,
  authenticate,
  writeAudit,
} = require('../rbac');

const router = express.Router();

function countReviewablePendingRequests(user) {
  if (!user.permissionSet || user.onboarding_status === 'pending') return 0;
  const isChairman = user.role_slug === 'chairman';
  if (user.permissionSet.has('requests.review_all')) {
    const r = get(
      `SELECT COUNT(*) AS cnt
       FROM permission_requests pr
       LEFT JOIN departments td ON td.id = pr.target_department_id
       WHERE pr.status = 'pending'
         AND pr.requester_id != ?
         AND (COALESCE(td.is_chairman_exclusive, 0) = 0 OR ? = 1)`,
      [user.id, isChairman ? 1 : 0]
    );
    return r ? r.cnt : 0;
  }
  if (user.permissionSet.has('requests.review_department') && user.department_id) {
    const rows = all(
      `SELECT pr.id, pr.permission_key
       FROM permission_requests pr
       JOIN users u ON u.id = pr.requester_id
       LEFT JOIN departments td ON td.id = pr.target_department_id
       WHERE pr.status = 'pending'
         AND pr.requester_id != ?
         AND pr.target_department_id = ?
         AND u.department_id = ?
         AND COALESCE(td.is_chairman_exclusive, 0) = 0`,
      [user.id, user.department_id, user.department_id]
    );
    return rows.filter((r) => user.permissionSet.has(r.permission_key)).length;
  }
  return 0;
}

function countPendingOnboardingUsers(user) {
  if (!user.permissionSet || user.onboarding_status === 'pending') return 0;
  const isChairman = user.role_slug === 'chairman';
  if (user.permissionSet.has('users.manage')) {
    const r = get(
      `SELECT COUNT(*) AS cnt
       FROM users u
       LEFT JOIN departments pd ON pd.id = u.preferred_department_id
       WHERE u.onboarding_status = 'pending'
         AND u.is_active = 1
         AND (COALESCE(pd.is_chairman_exclusive, 0) = 0 OR ? = 1)`,
      [isChairman ? 1 : 0]
    );
    return r ? r.cnt : 0;
  }
  if (user.permissionSet.has('department.onboard_members') && user.department_id) {
    const r = get(
      `SELECT COUNT(*) AS cnt
       FROM users u
       LEFT JOIN departments pd ON pd.id = u.preferred_department_id
       WHERE u.onboarding_status = 'pending'
         AND u.is_active = 1
         AND COALESCE(pd.is_chairman_exclusive, 0) = 0
         AND (u.preferred_department_id IS NULL OR u.preferred_department_id = ?)`,
      [user.department_id]
    );
    return r ? r.cnt : 0;
  }
  return 0;
}

function serializeCurrentUser(user) {
  const unreadNotifs = get(
    `SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`,
    [user.id]
  );
  const myPendingRequests = get(
    `SELECT COUNT(*) AS cnt FROM permission_requests WHERE requester_id = ? AND status = 'pending'`,
    [user.id]
  );

  const isPending = user.onboarding_status === 'pending';

  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    fullName: user.full_name,
    jobTitle: user.job_title,
    avatarColor: user.avatar_color,
    avatarUrl: user.avatar_url || null,
    authProvider: user.auth_provider || 'local',
    emailVerified: user.email_verified !== 0,
    hasCustomCredentials: Boolean(user.has_custom_credentials),
    departmentConfirmed: Boolean(user.department_confirmed),
    onboardingStatus: user.onboarding_status || 'approved',
    preferredDepartmentId: user.preferred_department_id || null,
    preferredDepartmentName: user.preferred_department_name || null,
    roleId: user.role_id,
    roleSlug: user.role_slug,
    roleName: user.role_name,
    roleColor: user.role_color,
    roleRank: Number(user.roleRank || 0),
    departmentId: user.department_id,
    departmentSlug: user.department_slug,
    departmentName: isPending
      ? 'بانتظار اعتماد الموارد البشرية (HR)'
      : user.department_name || 'الإدارة العليا (كل الأقسام)',
    departmentColor: isPending ? '#64748b' : user.department_color || '#b45309',
    permissions: user.permissions,
    activeGrants: user.activeGrants,
    unreadNotificationsCount: unreadNotifs ? unreadNotifs.cnt : 0,
    myPendingRequestsCount: myPendingRequests ? myPendingRequests.cnt : 0,
    reviewableRequestsCount: countReviewablePendingRequests(user),
    pendingOnboardingCount: countPendingOnboardingUsers(user),
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات تسجيل دخول فاشلة كثيرة، يرجى الانتظار 15 دقيقة والمحاولة مرة أخرى' },
});

// Per-account brute-force protection with bounded memory cap (blocks IP-rotation & RAM DoS)
const failedAccountAttempts = new Map();
const ACCOUNT_LOCK_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MAX_FAILS = 8;
const MAX_TRACKED_ACCOUNTS = 4096;

function pruneFailedAccountsMap(now) {
  if (failedAccountAttempts.size < MAX_TRACKED_ACCOUNTS) return;
  for (const [k, v] of failedAccountAttempts.entries()) {
    if (now - v.firstAt > ACCOUNT_LOCK_WINDOW_MS) {
      failedAccountAttempts.delete(k);
    }
  }
  while (failedAccountAttempts.size >= MAX_TRACKED_ACCOUNTS) {
    const oldestKey = failedAccountAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    failedAccountAttempts.delete(oldestKey);
  }
}

function isAccountLocked(accountKey) {
  const rec = failedAccountAttempts.get(accountKey);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > ACCOUNT_LOCK_WINDOW_MS) {
    failedAccountAttempts.delete(accountKey);
    return false;
  }
  return rec.count >= ACCOUNT_MAX_FAILS;
}

function recordAccountFailure(accountKey) {
  if (!accountKey) return;
  const now = Date.now();
  const rec = failedAccountAttempts.get(accountKey);
  if (!rec || now - rec.firstAt > ACCOUNT_LOCK_WINDOW_MS) {
    pruneFailedAccountsMap(now);
    failedAccountAttempts.set(accountKey, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }
    if (username.length > 128 || password.length > 128) {
      return res.status(400).json({ error: 'طول اسم المستخدم أو كلمة المرور يتجاوز الحد المسموح (128 حرفاً)' });
    }

    const accountKey = username.toLowerCase();
    if (isAccountLocked(accountKey)) {
      writeAudit({
        actorName: username.slice(0, 40),
        action: 'إيقاف مؤقت بسبب محاولات دخول متكررة فاشلة',
        status: 'DENIED',
        req,
        details: 'تجاوز حد المحاولات المسموح بها على الحساب',
      });
      return res.status(429).json({
        error: 'تم إيقاف محاولات الدخول لهذا الحساب مؤقتاً لمدة 15 دقيقة لحمايته من التخمين',
      });
    }

    const row = get(
      `SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`,
      [username, username]
    );
    if (!row) {
      recordAccountFailure(accountKey);
      writeAudit({
        actorName: username.slice(0, 40),
        action: 'محاولة تسجيل دخول فاشلة',
        status: 'DENIED',
        req,
        details: 'اسم مستخدم غير موجود',
      });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    if (!row.is_active) {
      writeAudit({
        actorName: row.full_name,
        action: 'محاولة دخول بحساب موقوف',
        status: 'DENIED',
        req,
        details: `الحساب (${row.username}) غير مفعل حالياً`,
      });
      return res.status(403).json({ error: 'هذا الحساب موقوف حالياً، يرجى مراجعة الإدارة' });
    }

    if (!row.password_hash) {
      return res.status(400).json({
        error: 'لم يتم استكمال إنشاء كلمة المرور لهذا الحساب بعد — يرجى المتابعة من تبويب تسجيل موظف جديد وتأكيد البريد الإلكتروني',
      });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      recordAccountFailure(accountKey);
      recordAccountFailure(String(row.username || '').toLowerCase());
      writeAudit({
        actorName: row.full_name,
        action: 'محاولة تسجيل دخول فاشلة',
        status: 'DENIED',
        req,
        details: 'كلمة مرور غير صحيحة',
      });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    failedAccountAttempts.delete(accountKey);
    failedAccountAttempts.delete(String(row.username || '').toLowerCase());

    const token = signUserToken(row);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    for (const oldName of LEGACY_COOKIE_NAMES || []) res.clearCookie(oldName);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 12 * 3600 * 1000,
    });

    const fullUser = loadUserById(row.id);
    writeAudit({
      user: fullUser,
      action: 'تسجيل دخول ناجح',
      status: 'ALLOWED',
      req,
      details: `الدخول بدور (${fullUser.role_name})`,
    });

    return res.json({
      ok: true,
      token,
      user: serializeCurrentUser(fullUser),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

router.post('/logout', authenticate, (req, res) => {
  writeAudit({
    user: req.user,
    action: 'تسجيل خروج',
    status: 'ALLOWED',
    req,
  });
  for (const oldName of LEGACY_COOKIE_NAMES || []) res.clearCookie(oldName);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json({
    user: serializeCurrentUser(req.user),
  });
});

router.get('/notifications', authenticate, (req, res) => {
  const items = all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40`,
    [req.user.id]
  );
  res.json(items);
});

router.post('/notifications/read-all', authenticate, (req, res) => {
  run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id]);
  res.json({ ok: true });
});

router.serializeCurrentUser = serializeCurrentUser;
module.exports = router;
