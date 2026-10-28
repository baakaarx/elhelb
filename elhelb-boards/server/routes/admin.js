const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run, transaction, getSetting, setSetting } = require('../db');
const {
  authenticate,
  evaluatePermission,
  writeAudit,
  denyPermission,
} = require('../rbac');
const { getOAuthCredentials, getBaseOrigin } = require('./oauth');
const {
  getGmailConfig,
  sendTestGmail,
  getRecentEmailLogs,
} = require('../mailer');

const router = express.Router();
router.use(authenticate);

function makeSlug(text, prefix = 'item') {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || `${prefix}-${Date.now().toString(36)}`;
}

function canCallerModifyRank(caller, targetRank) {
  if (caller.role_slug === 'chairman') return true;
  const callerRank = Number(caller.roleRank || 0);
  return Number(targetRank || 0) < callerRank;
}

function deleteUserCompletely(targetId) {
  transaction(() => {
    run(`UPDATE users SET approved_by = NULL WHERE approved_by = ?`, [targetId]);
    run(`UPDATE boards SET created_by = NULL WHERE created_by = ?`, [targetId]);
    run(`UPDATE cards SET created_by = NULL WHERE created_by = ?`, [targetId]);
    run(`UPDATE permission_requests SET reviewed_by = NULL WHERE reviewed_by = ?`, [targetId]);
    run(`UPDATE permission_grants SET granted_by = NULL WHERE granted_by = ?`, [targetId]);
    run(
      `UPDATE permission_grants
       SET request_id = NULL
       WHERE request_id IN (SELECT id FROM permission_requests WHERE requester_id = ?)`,
      [targetId]
    );
    run(`UPDATE audit_logs SET actor_id = NULL WHERE actor_id = ?`, [targetId]);

    run(`DELETE FROM board_stars WHERE user_id = ?`, [targetId]);
    run(`DELETE FROM card_assignees WHERE user_id = ?`, [targetId]);
    run(`DELETE FROM card_comments WHERE user_id = ?`, [targetId]);
    run(`DELETE FROM permission_grants WHERE user_id = ?`, [targetId]);
    run(`DELETE FROM permission_requests WHERE requester_id = ?`, [targetId]);
    run(`DELETE FROM notifications WHERE user_id = ?`, [targetId]);

    run(`DELETE FROM users WHERE id = ?`, [targetId]);
  });
}

// ==========================================
// ROLES & PERMISSIONS MATRIX (DB-Driven + Ranked Hierarchy)
// ==========================================

router.get('/roles', (req, res) => {
  const canRoles = evaluatePermission(req.user, 'roles.manage').allowed;
  const canUsers = evaluatePermission(req.user, 'users.manage').allowed;

  if (!canRoles && !canUsers) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'عرض مصفوفة الأدوار والصلاحيات',
      canRequestElevation: false,
    });
  }

  const permissions = all(`SELECT * FROM permissions ORDER BY sort_order ASC`);
  const roles = all(
    `SELECT r.*,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count
     FROM roles r
     ORDER BY r.rank_level DESC, r.id ASC`
  );
  const rpRows = all(`SELECT role_id, permission_key FROM role_permissions`);
  const mapByRole = new Map();
  for (const row of rpRows) {
    if (!mapByRole.has(row.role_id)) mapByRole.set(row.role_id, []);
    mapByRole.get(row.role_id).push(row.permission_key);
  }

  res.json({
    permissions,
    roles: roles.map((r) => ({
      ...r,
      is_protected: Boolean(r.is_protected),
      can_caller_edit:
        r.slug !== 'pending_onboarding' && canCallerModifyRank(req.user, r.rank_level),
      permissions: mapByRole.get(r.id) || [],
    })),
  });
});

router.post('/roles', (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'إنشاء دور وظيفي جديد',
      canRequestElevation: false,
    });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim().slice(0, 300);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#0a6fa8';
  const permKeys = Array.isArray(body.permissions) ? body.permissions.map(String) : [];

  const maxAllowedRank =
    req.user.role_slug === 'chairman' ? 95 : Math.max(10, Number(req.user.roleRank || 60) - 10);
  const requestedRank = body.rankLevel !== undefined ? Number(body.rankLevel) : 30;
  const rankLevel = Math.max(5, Math.min(maxAllowedRank, Number.isFinite(requestedRank) ? requestedRank : 30));

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: 'اسم الدور يجب أن يكون بين حرفين و60 حرفاً' });
  }

  const dupName = get(`SELECT id FROM roles WHERE name = ?`, [name]);
  if (dupName) {
    return res.status(409).json({ error: 'يوجد دور بنفس الاسم بالفعل' });
  }

  const validKeys = new Set(all(`SELECT key FROM permissions`).map((p) => p.key));
  const filteredKeys = [...new Set(permKeys.filter((k) => validKeys.has(k)))];
  const slug = `${makeSlug(body.slug || name, 'role')}-${Date.now().toString(36).slice(-4)}`;

  let roleId;
  transaction(() => {
    roleId = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [slug, name, description, color, rankLevel]
    ).lastInsertRowid;

    for (const k of filteredKeys) {
      run(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [roleId, k]);
    }
  });

  writeAudit({
    user: req.user,
    action: 'إنشاء دور وظيفي جديد في قاعدة البيانات',
    permissionKey: 'roles.manage',
    status: 'ALLOWED',
    req,
    details: `${name} (${filteredKeys.length} صلاحية)`,
  });

  res.status(201).json({
    id: roleId,
    slug,
    name,
    description,
    color,
    rank_level: rankLevel,
    is_protected: false,
    can_caller_edit: true,
    users_count: 0,
    permissions: filteredKeys,
  });
});

router.put('/roles/:id(\\d+)', (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'تعديل مصفوفة صلاحيات دور وظيفي',
      canRequestElevation: false,
    });
  }

  const roleId = Number(req.params.id);
  const role = get(`SELECT * FROM roles WHERE id = ?`, [roleId]);
  if (!role) return res.status(404).json({ error: 'الدور غير موجود' });

  if (role.slug === 'pending_onboarding') {
    return res.status(400).json({
      error: 'دور (بانتظار التسكين في قسم) مخصص أمنياً للمسجلين الجدد بدون أي صلاحيات حتى يضمهم رئيس القسم.',
    });
  }

  // Enforce Sovereign Role Hierarchy!
  if (!canCallerModifyRank(req.user, role.rank_level)) {
    writeAudit({
      user: req.user,
      action: `محاولة تعديل دور أعلى أو مساوٍ في الرتبة السيادية (${role.name})`,
      permissionKey: 'roles.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      error:
        role.slug === 'chairman'
          ? 'حماية سيادية: دور (رئيس مجلس الإدارة) هو الأعلى في النظام ولا يمكن تعديله إلا من حساب رئيس مجلس الإدارة شخصياً.'
          : `لا يمكنك تعديل صلاحيات دور (${role.name}) لأنه يماثل أو يعلو رتبتك الإدارية.`,
    });
  }

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : role.name;
  const description =
    body.description !== undefined ? String(body.description).trim().slice(0, 300) : role.description;
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : role.color;

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: 'اسم الدور يجب أن يكون بين حرفين و60 حرفاً' });
  }

  const dupName = get(`SELECT id FROM roles WHERE name = ? AND id != ?`, [name, role.id]);
  if (dupName) {
    return res.status(409).json({ error: 'يوجد دور آخر بنفس الاسم' });
  }

  const validKeys = new Set(all(`SELECT key FROM permissions`).map((p) => p.key));
  const nextKeys = Array.isArray(body.permissions)
    ? [...new Set(body.permissions.map(String).filter((k) => validKeys.has(k)))]
    : all(`SELECT permission_key FROM role_permissions WHERE role_id = ?`, [role.id]).map(
        (r) => r.permission_key
      );

  // Sovereign protection: Chairman role can NEVER lose core sovereign permissions
  if (role.slug === 'chairman') {
    for (const mustHave of ['roles.manage', 'users.manage', 'departments.manage', 'boards.view_all']) {
      if (!nextKeys.includes(mustHave)) nextKeys.push(mustHave);
    }
  }

  // Anti-lockout safety: ensure at least 1 active user retains roles.manage
  if (!nextKeys.includes('roles.manage')) {
    const otherAdmins = get(
      `SELECT COUNT(*) AS cnt
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       WHERE u.is_active = 1
         AND u.onboarding_status = 'approved'
         AND u.role_id != ?
         AND rp.permission_key = 'roles.manage'`,
      [role.id]
    );
    if (!otherAdmins || otherAdmins.cnt === 0) {
      return res.status(400).json({
        error:
          'حماية النظام: لا يمكن نزع صلاحية (إدارة الأدوار ومصفوفة الصلاحيات) من آخر دور إداري نشط حتى لا يتم قفل لوحة التحكم بالكامل.',
      });
    }
  }

  transaction(() => {
    run(`UPDATE roles SET name = ?, description = ?, color = ? WHERE id = ?`, [
      name,
      description,
      color,
      role.id,
    ]);
    run(`DELETE FROM role_permissions WHERE role_id = ?`, [role.id]);
    for (const k of nextKeys) {
      run(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [role.id, k]);
    }

    const members = all(`SELECT id FROM users WHERE role_id = ? AND is_active = 1 AND id != ?`, [
      role.id,
      req.user.id,
    ]);
    for (const m of members) {
      run(
        `INSERT INTO notifications (user_id, type, title, message)
         VALUES (?, 'role_updated', 'تحديث صلاحيات دورك الوظيفي', ?)`,
        [
          m.id,
          `قامت الإدارة بتحديث صلاحيات دور (${name}) في قاعدة البيانات، وتم تطبيقها فوراً على حسابك.`,
        ]
      );
    }
  });

  writeAudit({
    user: req.user,
    action: 'تحديث مصفوفة الصلاحيات في قاعدة البيانات',
    permissionKey: 'roles.manage',
    status: 'ALLOWED',
    req,
    details: `دور (${name}) — إجمالي الصلاحيات المفعلة: ${nextKeys.length}`,
  });

  res.json({
    id: role.id,
    slug: role.slug,
    name,
    description,
    color,
    rank_level: role.rank_level,
    is_protected: Boolean(role.is_protected),
    can_caller_edit: true,
    permissions: nextKeys,
  });
});

router.delete('/roles/:id(\\d+)', (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'حذف دور وظيفي',
      canRequestElevation: false,
    });
  }

  const roleId = Number(req.params.id);
  const role = get(`SELECT * FROM roles WHERE id = ?`, [roleId]);
  if (!role) return res.status(404).json({ error: 'الدور غير موجود' });

  if (role.is_protected) {
    return res.status(400).json({ error: 'هذا الدور أساسي في النظام ولا يمكن حذفه (يمكنك تعديل صلاحياته)' });
  }

  if (!canCallerModifyRank(req.user, role.rank_level)) {
    return res.status(403).json({ error: 'لا يمكنك حذف دور يماثل أو يعلو رتبتك الإدارية' });
  }

  const assignedCount = get(`SELECT COUNT(*) AS cnt FROM users WHERE role_id = ?`, [role.id]).cnt;
  if (assignedCount > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف هذا الدور لوجود (${assignedCount}) موظفين مسجلين عليه حالياً. قم بنقلهم لدور آخر أولاً.`,
    });
  }

  run(`DELETE FROM roles WHERE id = ?`, [role.id]);

  writeAudit({
    user: req.user,
    action: 'حذف دور وظيفي',
    permissionKey: 'roles.manage',
    status: 'ALLOWED',
    req,
    details: role.name,
  });

  res.json({ ok: true });
});

// ==========================================
// USERS MANAGEMENT (الموظفون والحسابات)
// ==========================================

router.get('/users', (req, res) => {
  if (!evaluatePermission(req.user, 'users.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'users.manage',
      actionLabel: 'إدارة حسابات الموظفين',
      canRequestElevation: false,
    });
  }

  const users = all(
    `SELECT u.id, u.username, u.email, u.full_name, u.job_title, u.avatar_color, u.avatar_url,
            u.auth_provider, u.onboarding_status, u.preferred_department_id,
            u.role_id, u.department_id, u.is_active, u.created_at,
            r.slug AS role_slug, r.name AS role_name, r.color AS role_color, r.rank_level,
            d.name AS department_name, d.color AS department_color,
            pd.name AS preferred_department_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN departments pd ON pd.id = u.preferred_department_id
     ORDER BY r.rank_level DESC, u.id ASC`
  ).map((u) => ({
    ...u,
    is_active: Boolean(u.is_active),
    can_caller_edit:
      u.id === req.user.id || canCallerModifyRank(req.user, u.rank_level),
    can_caller_delete:
      u.id !== req.user.id &&
      u.role_slug !== 'chairman' &&
      canCallerModifyRank(req.user, u.rank_level),
  }));

  res.json(users);
});

router.post('/users', async (req, res) => {
  if (!evaluatePermission(req.user, 'users.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'users.manage',
      actionLabel: 'إضافة موظف جديد',
      canRequestElevation: false,
    });
  }

  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const password = String(body.password || '');
  const fullName = String(body.fullName || '').trim();
  const jobTitle = String(body.jobTitle || '').trim().slice(0, 100);
  const roleId = Number(body.roleId);
  const departmentId = body.departmentId ? Number(body.departmentId) : null;
  const avatarColor = /^#[0-9a-fA-F]{6}$/.test(body.avatarColor || '')
    ? body.avatarColor
    : '#0a6fa8';

  if (!/^[a-z0-9_.@-]{3,64}$/.test(username)) {
    return res.status(400).json({
      error: 'اسم المستخدم يجب أن يكون من 3 إلى 64 حرفاً إنجليزياً أو رقماً أو بريداً إلكترونياً بدون مسافات',
    });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 4 أحرف' });
  }
  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(400).json({ error: 'الاسم الكامل للموظف مطلوب' });
  }

  const dup = get(`SELECT id FROM users WHERE username = ?`, [username]);
  if (dup) {
    return res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً لموظف آخر' });
  }

  const role = get(`SELECT * FROM roles WHERE id = ?`, [roleId]);
  if (!role) return res.status(400).json({ error: 'الدور الوظيفي المحدد غير صالح' });

  if (!canCallerModifyRank(req.user, role.rank_level)) {
    return res.status(403).json({
      error: `لا يمكنك إنشاء حساب بدور (${role.name}) لأنه يماثل أو يعلو رتبتك الإدارية`,
    });
  }

  let dept = null;
  if (departmentId !== null) {
    dept = get(`SELECT * FROM departments WHERE id = ?`, [departmentId]);
    if (!dept) return res.status(400).json({ error: 'القسم المحدد غير موجود' });
  }

  const hash = await bcrypt.hash(password, 10);
  const onboardingStatus = role.slug === 'pending_onboarding' ? 'pending' : 'approved';
  const newUserId = run(
    `INSERT INTO users (
      username, email, password_hash, full_name, job_title, avatar_color,
      auth_provider, onboarding_status, role_id, department_id, approved_by, approved_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?, datetime('now'))`,
    [
      username,
      email,
      hash,
      fullName,
      jobTitle,
      avatarColor,
      onboardingStatus,
      role.id,
      dept ? dept.id : null,
      req.user.id,
    ]
  ).lastInsertRowid;

  writeAudit({
    user: req.user,
    action: 'إضافة حساب موظف جديد',
    permissionKey: 'users.manage',
    status: 'ALLOWED',
    req,
    details: `${fullName} (@${username}) — دور: ${role.name} — قسم: ${dept ? dept.name : 'عام'}`,
  });

  res.status(201).json({ id: newUserId, ok: true });
});

router.patch('/users/:id(\\d+)', async (req, res) => {
  if (!evaluatePermission(req.user, 'users.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'users.manage',
      actionLabel: 'تعديل بيانات أو صلاحيات موظف',
      canRequestElevation: false,
    });
  }

  const targetId = Number(req.params.id);
  const existing = get(
    `SELECT u.*, r.rank_level AS current_rank, r.slug AS current_role_slug, r.name AS current_role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [targetId]
  );
  if (!existing) return res.status(404).json({ error: 'الموظف غير موجود' });

  // Sovereign Rank Protection on Target User
  if (targetId !== req.user.id && !canCallerModifyRank(req.user, existing.current_rank)) {
    writeAudit({
      user: req.user,
      action: `محاولة تعديل حساب أعلى في الرتبة السيادية (${existing.full_name})`,
      permissionKey: 'users.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      error:
        existing.current_role_slug === 'chairman'
          ? 'حماية سيادية: حساب رئيس مجلس الإدارة محمي ولا يمكن تعديله أو إيقافه من أي حساب آخر.'
          : `لا يمكنك تعديل حساب (${existing.full_name}) لأن دوره (${existing.current_role_name}) يماثل أو يعلو رتبتك الإدارية.`,
    });
  }

  const body = req.body || {};
  const fullName =
    body.fullName !== undefined ? String(body.fullName).trim() : existing.full_name;
  const email =
    body.email !== undefined
      ? String(body.email || '').trim().toLowerCase() || null
      : existing.email;
  const jobTitle =
    body.jobTitle !== undefined ? String(body.jobTitle).trim().slice(0, 100) : existing.job_title;
  const roleId = body.roleId !== undefined ? Number(body.roleId) : existing.role_id;
  const departmentId =
    body.departmentId === null || body.departmentId === ''
      ? null
      : body.departmentId !== undefined
      ? Number(body.departmentId)
      : existing.department_id;
  const isActive =
    body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active;

  if (targetId === req.user.id && !isActive) {
    return res.status(400).json({ error: 'لا يمكنك إيقاف حسابك الشخصي أثناء تسجيل دخولك' });
  }

  if (existing.current_role_slug === 'chairman' && !isActive) {
    return res.status(400).json({ error: 'حماية سيادية: لا يمكن إيقاف حساب رئيس مجلس الإدارة' });
  }

  const role = get(`SELECT * FROM roles WHERE id = ?`, [roleId]);
  if (!role) return res.status(400).json({ error: 'الدور المحدد غير موجود' });

  // Sovereign Rank Protection on New Role Assignment
  if (
    role.id !== existing.role_id &&
    !canCallerModifyRank(req.user, role.rank_level)
  ) {
    return res.status(403).json({
      error: `لا يمكنك منح دور (${role.name}) لأنه يماثل أو يعلو رتبتك الإدارية`,
    });
  }

  if (departmentId !== null) {
    const dept = get(`SELECT * FROM departments WHERE id = ?`, [departmentId]);
    if (!dept) return res.status(400).json({ error: 'القسم المحدد غير موجود' });
  }

  // Prevent removing last active roles.manage holder
  const nextRoleHasManage = Boolean(
    get(
      `SELECT 1 AS ok FROM role_permissions WHERE role_id = ? AND permission_key = 'roles.manage'`,
      [role.id]
    )
  );
  if (!isActive || !nextRoleHasManage) {
    const remainingManagers = get(
      `SELECT COUNT(*) AS cnt
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       WHERE u.is_active = 1
         AND u.onboarding_status = 'approved'
         AND u.id != ?
         AND rp.permission_key = 'roles.manage'`,
      [existing.id]
    );
    if (!remainingManagers || remainingManagers.cnt === 0) {
      return res.status(400).json({
        error: 'حماية النظام: يجب بقاء حساب نشط واحد على الأقل يحمل صلاحية إدارة الأدوار والصلاحيات.',
      });
    }
  }

  let passwordHash = existing.password_hash;
  let bumpToken = !isActive && existing.is_active ? 1 : 0;

  if (body.newPassword && String(body.newPassword).length > 0) {
    if (String(body.newPassword).length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
    }
    passwordHash = await bcrypt.hash(String(body.newPassword), 10);
    bumpToken = 1;
  }

  const nextOnboardingStatus =
    role.slug === 'pending_onboarding' ? 'pending' : 'approved';

  run(
    `UPDATE users
     SET full_name = ?, email = ?, job_title = ?, role_id = ?, department_id = ?,
         onboarding_status = ?,
         approved_by = COALESCE(approved_by, ?),
         approved_at = COALESCE(approved_at, datetime('now')),
         is_active = ?, password_hash = ?, token_version = token_version + ?
     WHERE id = ?`,
    [
      fullName,
      email,
      jobTitle,
      role.id,
      departmentId,
      nextOnboardingStatus,
      req.user.id,
      isActive,
      passwordHash,
      bumpToken,
      existing.id,
    ]
  );

  writeAudit({
    user: req.user,
    action: 'تحديث حساب وصلاحيات موظف',
    permissionKey: 'users.manage',
    status: 'ALLOWED',
    req,
    details: `${fullName} — الدور: ${role.name} — الحالة: ${isActive ? 'نشط' : 'موقوف'}`,
  });

  res.json({ ok: true });
});

router.delete('/users/:id(\\d+)', (req, res) => {
  if (!evaluatePermission(req.user, 'users.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'users.manage',
      actionLabel: 'حذف حساب موظف نهائياً',
      canRequestElevation: false,
    });
  }

  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'لا يمكنك حذف حسابك الشخصي أثناء تسجيل دخولك' });
  }

  const existing = get(
    `SELECT u.*, r.rank_level AS current_rank, r.slug AS current_role_slug, r.name AS current_role_name,
            d.name AS current_department_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`,
    [targetId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'الموظف غير موجود أو تم حذفه مسبقاً' });
  }

  if (existing.current_role_slug === 'chairman') {
    writeAudit({
      user: req.user,
      action: `محاولة حذف الحساب السيادي لرئيس مجلس الإدارة (${existing.full_name})`,
      permissionKey: 'users.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      error: 'حماية سيادية: حساب رئيس مجلس الإدارة محمي ولا يمكن حذفه نهائياً تحت أي ظرف.',
    });
  }

  if (!canCallerModifyRank(req.user, existing.current_rank)) {
    writeAudit({
      user: req.user,
      action: `محاولة حذف حساب أعلى أو مساوٍ في الرتبة السيادية (${existing.full_name})`,
      permissionKey: 'users.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      error: `لا يمكنك حذف حساب (${existing.full_name}) لأن دوره (${existing.current_role_name}) يماثل أو يعلو رتبتك الإدارية.`,
    });
  }

  // Anti-lockout safety: ensure at least 1 active roles.manage holder remains
  const remainingManagers = get(
    `SELECT COUNT(*) AS cnt
     FROM users u
     JOIN role_permissions rp ON rp.role_id = u.role_id
     WHERE u.is_active = 1
       AND u.onboarding_status = 'approved'
       AND u.id != ?
       AND rp.permission_key = 'roles.manage'`,
    [existing.id]
  );
  if (!remainingManagers || remainingManagers.cnt === 0) {
    return res.status(400).json({
      error: 'حماية النظام: لا يمكن حذف آخر حساب نشط يحمل صلاحية إدارة الأدوار والصلاحيات.',
    });
  }

  deleteUserCompletely(existing.id);

  writeAudit({
    user: req.user,
    action: 'حذف حساب موظف نهائياً من النظام',
    permissionKey: 'users.manage',
    status: 'ALLOWED',
    req,
    details: `${existing.full_name} (@${existing.username}) — الدور: ${existing.current_role_name} — القسم: ${
      existing.current_department_name || 'غير مسكن'
    }`,
  });

  return res.json({
    ok: true,
    message: `تم حذف حساب (${existing.full_name}) نهائياً من النظام بنجاح`,
  });
});

// ==========================================
// DEPARTMENTS MANAGEMENT (أقسام الشركة)
// ==========================================

router.get('/departments', (req, res) => {
  const canDepts = evaluatePermission(req.user, 'departments.manage').allowed;
  const canUsers = evaluatePermission(req.user, 'users.manage').allowed;
  if (!canDepts && !canUsers) {
    return denyPermission(req, res, {
      permissionKey: 'departments.manage',
      actionLabel: 'إدارة أقسام الشركة',
      canRequestElevation: false,
    });
  }

  const depts = all(
    `SELECT d.*,
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.onboarding_status = 'approved') AS users_count,
            (SELECT COUNT(*) FROM boards b WHERE b.department_id = d.id) AS boards_count
     FROM departments d
     ORDER BY d.id ASC`
  );

  res.json(depts);
});

router.post('/departments', (req, res) => {
  if (!evaluatePermission(req.user, 'departments.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'departments.manage',
      actionLabel: 'إنشاء قسم جديد بالشركة',
      canRequestElevation: false,
    });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim().slice(0, 300);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#0a6fa8';
  const icon = String(body.icon || 'briefcase').trim().slice(0, 30);

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'اسم القسم يجب أن يكون بين حرفين و80 حرفاً' });
  }

  const dup = get(`SELECT id FROM departments WHERE name = ?`, [name]);
  if (dup) return res.status(409).json({ error: 'يوجد قسم بنفس الاسم بالفعل' });

  const slug = `${makeSlug(body.slug || name, 'dept')}-${Date.now().toString(36).slice(-4)}`;
  const id = run(
    `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
    [slug, name, description, color, icon]
  ).lastInsertRowid;

  writeAudit({
    user: req.user,
    action: 'إضافة قسم جديد بالشركة',
    permissionKey: 'departments.manage',
    status: 'ALLOWED',
    req,
    details: name,
  });

  res.status(201).json(get(`SELECT * FROM departments WHERE id = ?`, [id]));
});

router.patch('/departments/:id(\\d+)', (req, res) => {
  if (!evaluatePermission(req.user, 'departments.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'departments.manage',
      actionLabel: 'تعديل بيانات قسم',
      canRequestElevation: false,
    });
  }

  const dept = get(`SELECT * FROM departments WHERE id = ?`, [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: 'القسم غير موجود' });

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : dept.name;
  const description =
    body.description !== undefined ? String(body.description).trim().slice(0, 300) : dept.description;
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : dept.color;

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'اسم القسم غير صالح' });
  }

  const dup = get(`SELECT id FROM departments WHERE name = ? AND id != ?`, [name, dept.id]);
  if (dup) return res.status(409).json({ error: 'يوجد قسم آخر بنفس الاسم' });

  run(`UPDATE departments SET name = ?, description = ?, color = ? WHERE id = ?`, [
    name,
    description,
    color,
    dept.id,
  ]);

  writeAudit({
    user: req.user,
    action: 'تحديث بيانات قسم',
    permissionKey: 'departments.manage',
    status: 'ALLOWED',
    req,
    details: name,
  });

  res.json(get(`SELECT * FROM departments WHERE id = ?`, [dept.id]));
});

router.delete('/departments/:id(\\d+)', (req, res) => {
  if (!evaluatePermission(req.user, 'departments.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'departments.manage',
      actionLabel: 'حذف قسم من الشركة',
      canRequestElevation: false,
    });
  }

  const dept = get(`SELECT * FROM departments WHERE id = ?`, [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: 'القسم غير موجود' });

  const boardsCount = get(`SELECT COUNT(*) AS cnt FROM boards WHERE department_id = ?`, [dept.id]).cnt;
  const usersCount = get(`SELECT COUNT(*) AS cnt FROM users WHERE department_id = ?`, [dept.id]).cnt;

  if (boardsCount > 0 || usersCount > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف القسم لارتباطه بـ (${boardsCount}) لوحات عمل و(${usersCount}) موظفين. انقلهم أولاً.`,
    });
  }

  run(`DELETE FROM departments WHERE id = ?`, [dept.id]);

  writeAudit({
    user: req.user,
    action: 'حذف قسم',
    permissionKey: 'departments.manage',
    status: 'ALLOWED',
    req,
    details: dept.name,
  });

  res.json({ ok: true });
});

// ==========================================
// GOOGLE OAUTH 2.0 CONFIGURATION (لـ IT والإدارة العليا)
// ==========================================

router.get('/oauth-settings', (req, res) => {
  if (
    !evaluatePermission(req.user, 'roles.manage').allowed &&
    !evaluatePermission(req.user, 'users.manage').allowed
  ) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'عرض إعدادات ربط تسجيل الدخول عبر Google',
      canRequestElevation: false,
    });
  }

  const creds = getOAuthCredentials();
  const origin = getBaseOrigin(req);

  res.json({
    googleClientId: getSetting('google_client_id', process.env.GOOGLE_CLIENT_ID || ''),
    googleSecretSaved: Boolean(creds.googleClientSecret),
    googleConfigured: Boolean(creds.googleClientId && creds.googleClientSecret),
    googleCallbackUrl: `${origin}/api/auth/oauth/google/callback`,
  });
});

router.put('/oauth-settings', (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'تحديث مفاتيح الربط مع Google',
      canRequestElevation: false,
    });
  }

  const body = req.body || {};
  if (body.googleClientId !== undefined) {
    setSetting('google_client_id', String(body.googleClientId || '').trim(), req.user.id);
  }
  if (body.googleClientSecret !== undefined && String(body.googleClientSecret).trim() !== '') {
    setSetting('google_client_secret', String(body.googleClientSecret).trim(), req.user.id);
  }
  if (body.clearGoogleSecret) {
    setSetting('google_client_secret', '', req.user.id);
  }

  writeAudit({
    user: req.user,
    action: 'تحديث إعدادات تسجيل الدخول عبر Google',
    permissionKey: 'roles.manage',
    status: 'ALLOWED',
    req,
  });

  const creds = getOAuthCredentials();
  res.json({
    ok: true,
    googleConfigured: Boolean(creds.googleClientId && creds.googleClientSecret),
  });
});

// ==========================================
// GMAIL NOTIFICATIONS INTEGRATION (ربط إشعارات Gmail)
// ==========================================

router.get('/gmail-settings', (req, res) => {
  if (
    !evaluatePermission(req.user, 'roles.manage').allowed &&
    !evaluatePermission(req.user, 'users.manage').allowed
  ) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'عرض إعدادات ربط إشعارات Gmail',
      canRequestElevation: false,
    });
  }

  const cfg = getGmailConfig();
  res.json({
    gmailUser: cfg.gmailUser,
    appPasswordSaved: Boolean(cfg.gmailAppPassword),
    configured: cfg.configured,
    enabled: cfg.enabled,
    senderName: cfg.senderName,
    adminNotifyEmail: cfg.adminNotifyEmail,
    emailLogs: getRecentEmailLogs(40),
  });
});

router.put('/gmail-settings', (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'تحديث إعدادات ربط إشعارات Gmail',
      canRequestElevation: false,
    });
  }

  const body = req.body || {};
  if (body.gmailUser !== undefined) {
    setSetting('gmail_user', String(body.gmailUser || '').trim().toLowerCase());
  }
  if (
    body.gmailAppPassword !== undefined &&
    String(body.gmailAppPassword).replace(/\s+/g, '') !== ''
  ) {
    setSetting(
      'gmail_app_password',
      String(body.gmailAppPassword).replace(/\s+/g, '')
    );
  }
  if (body.clearAppPassword) {
    setSetting('gmail_app_password', '');
  }
  if (body.senderName !== undefined) {
    setSetting('gmail_sender_name', String(body.senderName || '').trim());
  }
  if (body.adminNotifyEmail !== undefined) {
    setSetting(
      'gmail_admin_cc',
      String(body.adminNotifyEmail || '').trim().toLowerCase()
    );
  }
  if (body.enabled !== undefined) {
    setSetting('gmail_enabled', body.enabled ? '1' : '0');
  }

  writeAudit({
    user: req.user,
    action: 'تحديث إعدادات ربط إشعارات Gmail',
    permissionKey: 'roles.manage',
    status: 'ALLOWED',
    req,
  });

  const cfg = getGmailConfig();
  res.json({
    ok: true,
    configured: cfg.configured,
    enabled: cfg.enabled,
  });
});

router.post('/gmail-settings/test', async (req, res) => {
  if (!evaluatePermission(req.user, 'roles.manage').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'roles.manage',
      actionLabel: 'إرسال بريد اختباري عبر Gmail',
      canRequestElevation: false,
    });
  }

  try {
    const targetEmail = req.body && req.body.targetEmail;
    const result = await sendTestGmail(targetEmail);
    writeAudit({
      user: req.user,
      action: 'إرسال إيميل تجريبي عبر Gmail بنجاح',
      permissionKey: 'roles.manage',
      status: 'ALLOWED',
      req,
      details: `إلى: ${result.to}`,
    });
    res.json(result);
  } catch (err) {
    const code = err.statusCode || 500;
    res.status(code).json({ error: err.message || 'تعذر إرسال الرسالة التجريبية' });
  }
});

// ==========================================
// SECURITY AUDIT LOGS
// ==========================================

router.get('/audit-logs', (req, res) => {
  if (!evaluatePermission(req.user, 'audit.view').allowed) {
    return denyPermission(req, res, {
      permissionKey: 'audit.view',
      actionLabel: 'عرض سجل المراقبة الأمنية للعمليات',
      canRequestElevation: false,
    });
  }

  const statusFilter = String(req.query.status || 'ALL').toUpperCase();
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];

  if (statusFilter === 'ALLOWED' || statusFilter === 'DENIED') {
    where.push('status = ?');
    params.push(statusFilter);
  }
  if (q) {
    where.push('(actor_name LIKE ? OR action LIKE ? OR details LIKE ? OR permission_key LIKE ?)');
    const p = `%${q}%`;
    params.push(p, p, p, p);
  }

  const sql = `
    SELECT * FROM audit_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC
    LIMIT 150
  `;

  res.json(all(sql, params));
});

router.deleteUserCompletely = deleteUserCompletely;
module.exports = router;
