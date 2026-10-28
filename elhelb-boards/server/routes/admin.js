const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run, transaction } = require('../db');
const {
  authenticate,
  evaluatePermission,
  writeAudit,
  denyPermission,
} = require('../rbac');

const router = express.Router();
router.use(authenticate);

function makeSlug(text, prefix = 'item') {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || `${prefix}-${Date.now().toString(36)}`;
}

// ==========================================
// ROLES & PERMISSIONS MATRIX (DB-Driven)
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
     ORDER BY r.id ASC`
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
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 0)`,
      [slug, name, description, color]
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
    is_protected: false,
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

  // Anti-lockout safety: ensure at least 1 active user retains roles.manage
  if (!nextKeys.includes('roles.manage')) {
    const otherAdmins = get(
      `SELECT COUNT(*) AS cnt
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       WHERE u.is_active = 1
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

    // Notify employees in this role that their permissions were updated live
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
    is_protected: Boolean(role.is_protected),
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
    `SELECT u.id, u.username, u.full_name, u.job_title, u.avatar_color,
            u.role_id, u.department_id, u.is_active, u.created_at,
            r.name AS role_name, r.color AS role_color,
            d.name AS department_name, d.color AS department_color
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     ORDER BY u.id ASC`
  ).map((u) => ({
    ...u,
    is_active: Boolean(u.is_active),
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

  let dept = null;
  if (departmentId !== null) {
    dept = get(`SELECT * FROM departments WHERE id = ?`, [departmentId]);
    if (!dept) return res.status(400).json({ error: 'القسم المحدد غير موجود' });
  }

  const hash = await bcrypt.hash(password, 10);
  const newUserId = run(
    `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, hash, fullName, jobTitle, avatarColor, role.id, dept ? dept.id : null]
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
  const existing = get(`SELECT * FROM users WHERE id = ?`, [targetId]);
  if (!existing) return res.status(404).json({ error: 'الموظف غير موجود' });

  const body = req.body || {};
  const fullName =
    body.fullName !== undefined ? String(body.fullName).trim() : existing.full_name;
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

  const role = get(`SELECT * FROM roles WHERE id = ?`, [roleId]);
  if (!role) return res.status(400).json({ error: 'الدور المحدد غير موجود' });

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

  run(
    `UPDATE users
     SET full_name = ?, job_title = ?, role_id = ?, department_id = ?,
         is_active = ?, password_hash = ?, token_version = token_version + ?
     WHERE id = ?`,
    [fullName, jobTitle, role.id, departmentId, isActive, passwordHash, bumpToken, existing.id]
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
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS users_count,
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

module.exports = router;
