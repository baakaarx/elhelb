const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../db');
const {
  COOKIE_NAME,
  signUserToken,
  loadUserById,
  authenticate,
  writeAudit,
} = require('../rbac');

const router = express.Router();

const DEMO_PASSWORDS = {
  chairman: '123456',
  admin: '123456',
  it_mgr: '123456',
  export_mgr: '123456',
  reg_mgr: '123456',
  sales_mgr: '123456',
  media_mgr: '123456',
  proc_mgr: '123456',
  export_emp: '123456',
  reg_emp: '123456',
  sales_lead: '123456',
  sales_emp: '123456',
  sales_viewer: '123456',
  media_emp: '123456',
  hr_emp: '123456',
};

function countReviewablePendingRequests(user) {
  if (!user.permissionSet || user.onboarding_status === 'pending') return 0;
  if (user.permissionSet.has('requests.review_all')) {
    const r = get(
      `SELECT COUNT(*) AS cnt FROM permission_requests WHERE status = 'pending' AND requester_id != ?`,
      [user.id]
    );
    return r ? r.cnt : 0;
  }
  if (user.permissionSet.has('requests.review_department') && user.department_id) {
    const rows = all(
      `SELECT pr.id, pr.permission_key
       FROM permission_requests pr
       JOIN users u ON u.id = pr.requester_id
       WHERE pr.status = 'pending'
         AND pr.requester_id != ?
         AND pr.target_department_id = ?
         AND u.department_id = ?`,
      [user.id, user.department_id, user.department_id]
    );
    return rows.filter((r) => user.permissionSet.has(r.permission_key)).length;
  }
  return 0;
}

function countPendingOnboardingUsers(user) {
  if (!user.permissionSet || user.onboarding_status === 'pending') return 0;
  if (
    user.permissionSet.has('users.manage') ||
    user.permissionSet.has('department.onboard_members')
  ) {
    const r = get(
      `SELECT COUNT(*) AS cnt FROM users WHERE onboarding_status = 'pending' AND is_active = 1`
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
      ? 'بانتظار ضم رئيس القسم'
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

// List demo accounts (for quick evaluation & testing across roles/departments)
router.get('/demo-accounts', (req, res) => {
  const users = all(
    `SELECT u.id, u.username, u.full_name, u.job_title, u.avatar_color,
            r.slug AS role_slug, r.name AS role_name, r.color AS role_color, r.rank_level,
            d.name AS department_name, d.color AS department_color
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.is_active = 1 AND u.onboarding_status = 'approved'
     ORDER BY r.rank_level DESC, u.id ASC`
  );
  res.json(
    users
      .filter((u) => DEMO_PASSWORDS[u.username])
      .map((u) => ({
        username: u.username,
        demoPassword: DEMO_PASSWORDS[u.username],
        fullName: u.full_name,
        jobTitle: u.job_title,
        avatarColor: u.avatar_color,
        roleSlug: u.role_slug,
        roleName: u.role_name,
        roleColor: u.role_color,
        roleRank: u.rank_level,
        departmentName: u.department_name || 'جميع الأقسام (مجلس الإدارة والإدارة العليا)',
        departmentColor: u.department_color || '#92400e',
      }))
  );
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات تسجيل دخول كثيرة، يرجى الانتظار قليلاً' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const row = get(
      `SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`,
      [username, username]
    );
    if (!row) {
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
        error: 'هذا الحساب مسجل عبر Google أو Facebook — يرجى تسجيل الدخول عبر الزر المخصص بالأسفل',
      });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      writeAudit({
        actorName: row.full_name,
        action: 'محاولة تسجيل دخول فاشلة',
        status: 'DENIED',
        req,
        details: 'كلمة مرور غير صحيحة',
      });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = signUserToken(row);
    const isHttps =
      req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
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

module.exports = router;
