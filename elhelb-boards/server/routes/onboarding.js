const express = require('express');
const { all, get, run, transaction } = require('../db');
const { authenticate, userHasPermission, writeAudit } = require('../rbac');

const router = express.Router();
router.use(authenticate);

// Allow a waiting ('pending') employee to select/update their preferred department & job title
router.patch('/my-preference', (req, res) => {
  const { preferredDepartmentId, jobTitle } = req.body || {};

  let dept = null;
  if (preferredDepartmentId) {
    dept = get(`SELECT * FROM departments WHERE id = ?`, [Number(preferredDepartmentId)]);
    if (!dept) {
      return res.status(400).json({ error: 'القسم المختار غير موجود' });
    }
  }

  run(
    `UPDATE users
     SET preferred_department_id = ?,
         job_title = COALESCE(?, job_title)
     WHERE id = ?`,
    [
      dept ? dept.id : null,
      typeof jobTitle === 'string' ? jobTitle.trim().slice(0, 100) : null,
      req.user.id,
    ]
  );

  if (dept && req.user.onboarding_status === 'pending') {
    const deptHeads = all(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       WHERE u.is_active = 1
         AND u.onboarding_status = 'approved'
         AND u.department_id = ?
         AND rp.permission_key = 'department.onboard_members'`,
      [dept.id]
    );
    for (const h of deptHeads) {
      run(
        `INSERT INTO notifications (user_id, type, title, message, link_tab)
         VALUES (?, 'onboarding_pref', 'موظف بانتظار الضم إلى قسمك', ?, 'onboarding')`,
        [
          h.id,
          `الموظف (${req.user.full_name}) اختار الانضمام إلى (${dept.name}) وينتظر موافقتك.`,
        ]
      );
    }
  }

  res.json({
    ok: true,
    preferredDepartmentId: dept ? dept.id : null,
    preferredDepartmentName: dept ? dept.name : null,
  });
});

// List pending Google/Facebook employees + department team roster for Department Heads & IT/Admin
router.get('/pending', (req, res) => {
  const canManageAll = userHasPermission(req.user, 'users.manage');
  const canOnboardDept = userHasPermission(req.user, 'department.onboard_members');

  if (!canManageAll && !canOnboardDept) {
    writeAudit({
      user: req.user,
      action: 'محاولة فتح شاشة ضم الموظفين للأقسام',
      permissionKey: 'department.onboard_members',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      code: 'PERMISSION_DENIED',
      permissionKey: 'department.onboard_members',
      error: 'هذه الشاشة مخصصة لرؤساء الأقسام ومسؤولي الـ IT والإدارة العليا فقط',
    });
  }

  const myDeptId = req.user.department_id || null;
  const callerRank = Number(req.user.roleRank || 0);

  const pendingUsers = all(
    `SELECT
       u.id, u.username, u.email, u.full_name, u.job_title,
       u.avatar_color, u.avatar_url, u.auth_provider,
       u.onboarding_status, u.preferred_department_id, u.created_at,
       pd.name AS preferred_department_name,
       pd.color AS preferred_department_color
     FROM users u
     LEFT JOIN departments pd ON pd.id = u.preferred_department_id
     WHERE u.onboarding_status = 'pending' AND u.is_active = 1
     ORDER BY
       CASE WHEN u.preferred_department_id = ? THEN 0 ELSE 1 END ASC,
       u.id DESC`,
    [myDeptId || -1]
  );

  const assignableDepartments = canManageAll
    ? all(`SELECT id, slug, name, color FROM departments ORDER BY id ASC`)
    : myDeptId
    ? all(`SELECT id, slug, name, color FROM departments WHERE id = ?`, [myDeptId])
    : [];

  const assignableRoles = all(
    `SELECT id, slug, name, description, color, rank_level
     FROM roles
     WHERE slug != 'pending_onboarding'
       AND rank_level > 0
       AND rank_level < ?
     ORDER BY rank_level DESC, id ASC`,
    [req.user.role_slug === 'chairman' ? 101 : callerRank]
  );

  // Team roster inside this manager's department (or all recently onboarded if global admin)
  const teamMembers = canManageAll
    ? all(
        `SELECT
           u.id, u.username, u.email, u.full_name, u.job_title, u.avatar_color,
           u.auth_provider, u.department_id, u.approved_at,
           d.name AS department_name, d.color AS department_color,
           r.name AS role_name, r.color AS role_color, r.rank_level,
           approver.full_name AS approved_by_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN users approver ON approver.id = u.approved_by
         WHERE u.onboarding_status = 'approved' AND u.is_active = 1
         ORDER BY u.department_id ASC, r.rank_level DESC, u.id ASC`
      )
    : myDeptId
    ? all(
        `SELECT
           u.id, u.username, u.email, u.full_name, u.job_title, u.avatar_color,
           u.auth_provider, u.department_id, u.approved_at,
           d.name AS department_name, d.color AS department_color,
           r.name AS role_name, r.color AS role_color, r.rank_level,
           approver.full_name AS approved_by_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN users approver ON approver.id = u.approved_by
         WHERE u.onboarding_status = 'approved'
           AND u.is_active = 1
           AND u.department_id = ?
         ORDER BY r.rank_level DESC, u.id ASC`,
        [myDeptId]
      )
    : [];

  res.json({
    pendingUsers,
    assignableDepartments,
    assignableRoles,
    teamMembers,
    canManageAll,
  });
});

// Department Head (or IT / Admin) claims a pending employee into their department!
router.post('/:userId/claim', (req, res) => {
  const canManageAll = userHasPermission(req.user, 'users.manage');
  const canOnboardDept = userHasPermission(req.user, 'department.onboard_members');

  if (!canManageAll && !canOnboardDept) {
    writeAudit({
      user: req.user,
      action: 'محاولة ضم موظف بدون صلاحية رئيس قسم',
      permissionKey: 'department.onboard_members',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      code: 'PERMISSION_DENIED',
      permissionKey: 'department.onboard_members',
      error: 'ليس لديك صلاحية ضم الموظفين للأقسام',
    });
  }

  const targetUserId = Number(req.params.userId);
  const targetUser = get(`SELECT * FROM users WHERE id = ?`, [targetUserId]);
  if (!targetUser || !targetUser.is_active) {
    return res.status(404).json({ error: 'الموظف المطلوب غير موجود' });
  }
  if (targetUser.onboarding_status !== 'pending') {
    return res.status(400).json({ error: 'هذا الموظف تم ضمه وتسكينه بالفعل في قسم سابقاً' });
  }

  const body = req.body || {};
  const requestedDeptId = body.departmentId ? Number(body.departmentId) : req.user.department_id;
  const requestedRoleId = Number(body.roleId);
  const jobTitle = String(body.jobTitle || targetUser.job_title || '').trim().slice(0, 100);

  // Enforce strict department scope for Department Heads!
  if (!canManageAll) {
    if (!req.user.department_id) {
      return res.status(400).json({ error: 'حسابك غير مرتبط بقسم محدد' });
    }
    if (requestedDeptId && Number(requestedDeptId) !== Number(req.user.department_id)) {
      writeAudit({
        user: req.user,
        action: `محاولة ضم موظف إلى قسم آخر غير قسمه`,
        permissionKey: 'users.manage',
        resourceType: 'department',
        resourceId: requestedDeptId,
        status: 'DENIED',
        req,
      });
      return res.status(403).json({
        code: 'DEPARTMENT_ISOLATION',
        error: 'يحق لرئيس القسم ضم الموظفين إلى قسمه فقط',
      });
    }
  }

  const targetDeptId = canManageAll ? requestedDeptId : req.user.department_id;
  const dept = get(`SELECT * FROM departments WHERE id = ?`, [Number(targetDeptId)]);
  if (!dept) {
    return res.status(400).json({ error: 'يرجى تحديد القسم الذي سينضم إليه الموظف' });
  }

  const role = get(`SELECT * FROM roles WHERE id = ?`, [requestedRoleId]);
  if (!role || role.slug === 'pending_onboarding' || Number(role.rank_level) <= 0) {
    return res.status(400).json({ error: 'يرجى اختيار دور وظيفي صالح للموظف داخل القسم' });
  }

  const callerRank = Number(req.user.roleRank || 0);
  const targetRoleRank = Number(role.rank_level || 0);
  const allowedRank =
    req.user.role_slug === 'chairman' ? targetRoleRank <= 100 : targetRoleRank < callerRank;

  if (!allowedRank) {
    writeAudit({
      user: req.user,
      action: `محاولة منح رتبة صلاحية أعلى أو مساوية (${role.name})`,
      permissionKey: 'roles.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      error: `لا يمكنك منح دور (${role.name}) لأنه يماثل أو يفوق مستوى صلاحيتك الإدارية`,
    });
  }

  transaction(() => {
    run(
      `UPDATE users
       SET department_id = ?,
           role_id = ?,
           job_title = ?,
           onboarding_status = 'approved',
           approved_by = ?,
           approved_at = datetime('now')
       WHERE id = ?`,
      [dept.id, role.id, jobTitle || role.name, req.user.id, targetUser.id]
    );

    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'onboarding_approved', 'مرحباً بك! تم ضمك رسمياً إلى قسمك 🎉', ?, 'boards')`,
      [
        targetUser.id,
        `قام (${req.user.full_name}) بضمك إلى (${dept.name}) بصلاحية (${role.name}). يمكنك الآن الدخول إلى لوحات العمل فوراً.`,
      ]
    );
  });

  writeAudit({
    user: req.user,
    action: `ضم موظف جديد للقسم: ${targetUser.full_name}`,
    permissionKey: canManageAll ? 'users.manage' : 'department.onboard_members',
    resourceType: 'user',
    resourceId: targetUser.id,
    status: 'ALLOWED',
    req,
    details: `القسم: ${dept.name} — الدور: ${role.name}`,
  });

  res.json({
    ok: true,
    message: `تم ضم (${targetUser.full_name}) إلى (${dept.name}) بنجاح`,
  });
});

module.exports = router;
