const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run, transaction } = require('../db');
const { authenticate, userHasPermission, writeAudit } = require('../rbac');
const { sendElhelbEmail } = require('../mailer');
const adminRoutes = require('./admin');

const router = express.Router();
router.use(authenticate);

// Step 1: Employee creates or updates their own Username & Password
router.post('/setup-credentials', async (req, res) => {
  try {
    const body = req.body || {};
    const username = String(body.username || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const fullName =
      body.fullName !== undefined
        ? String(body.fullName).trim()
        : req.user.full_name;

    if (!/^[a-z0-9_.-]{3,36}$/.test(username)) {
      return res.status(400).json({
        error:
          'اسم المستخدم يجب أن يتكون من 3 إلى 36 حرفاً إنجليزياً أو رقماً (بدون مسافات، مثل: ahmed.ali)',
      });
    }
    if (password.length < 4 || password.length > 100) {
      return res.status(400).json({
        error: 'كلمة المرور يجب ألا تقل عن 4 أحرف أو أرقام',
      });
    }
    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({
        error: 'يرجى التأكد من كتابة اسمك الكامل بشكل صحيح',
      });
    }

    const duplicate = get(
      `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`,
      [username, req.user.id]
    );
    if (duplicate) {
      return res.status(409).json({
        error: 'اسم المستخدم هذا مستخدم بالفعل لموظف آخر، يرجى اختيار اسم مختلف',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    run(
      `UPDATE users
       SET username = ?,
           password_hash = ?,
           full_name = ?,
           has_custom_credentials = 1
       WHERE id = ?`,
      [username, passwordHash, fullName, req.user.id]
    );

    writeAudit({
      user: { ...req.user, full_name: fullName },
      action: 'إنشاء اسم مستخدم وكلمة مرور خاصة بالموظف',
      status: 'ALLOWED',
      req,
      details: `اسم المستخدم الجديد: @${username}`,
    });

    return res.json({
      ok: true,
      username,
      fullName,
    });
  } catch (err) {
    console.error('Setup credentials error:', err);
    return res.status(500).json({ error: 'تعذر حفظ اسم المستخدم وكلمة المرور' });
  }
});

// Step 2: Employee selects their Department -> notifies HR (الموارد البشرية) & Top Management!
router.patch('/my-preference', async (req, res) => {
  try {
    const { preferredDepartmentId, jobTitle } = req.body || {};

    if (!preferredDepartmentId) {
      return res.status(400).json({ error: 'يرجى اختيار القسم الذي تعمل به في الشركة' });
    }

    const dept = get(`SELECT * FROM departments WHERE id = ?`, [
      Number(preferredDepartmentId),
    ]);
    if (!dept) {
      return res.status(400).json({ error: 'القسم المختار غير موجود' });
    }

    const cleanJobTitle =
      typeof jobTitle === 'string' ? jobTitle.trim().slice(0, 100) : req.user.job_title;

    run(
      `UPDATE users
       SET preferred_department_id = ?,
           job_title = ?,
           department_confirmed = 1
       WHERE id = ?`,
      [dept.id, cleanJobTitle || '', req.user.id]
    );

    const managerEmails = [];

    if (req.user.onboarding_status === 'pending') {
      const notifyManagers = all(
        `SELECT u.id, u.email, u.department_id,
                MAX(CASE WHEN rp.permission_key = 'users.manage' THEN 1 ELSE 0 END) AS has_global_users_manage
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         WHERE u.is_active = 1
           AND u.onboarding_status = 'approved'
           AND rp.permission_key IN ('department.onboard_members', 'users.manage')
         GROUP BY u.id`
      );

      for (const m of notifyManagers) {
        const shouldNotify =
          Boolean(m.has_global_users_manage) ||
          !m.department_id ||
          Number(m.department_id) === Number(dept.id);

        if (shouldNotify) {
          run(
            `INSERT INTO notifications (user_id, type, title, message, link_tab)
             VALUES (?, 'onboarding_pref', 'طلب تسكين موظف جديد بانتظار اعتماد الـ HR', ?, 'onboarding')`,
            [
              m.id,
              `الموظف (${req.user.full_name} — @${req.user.username}) سجل حسابه وطلب الانضمام إلى (${dept.name}) وبانتظار القبول والتسكين.`,
            ]
          );
          if (m.email) managerEmails.push(m.email);
        }
      }

      // Optional background Gmail notification to HR & Admin
      await sendElhelbEmail({
        to: managerEmails,
        ccAdmin: true,
        eventType: 'onboarding_request',
        subject: `👤 طلب تسكين موظف جديد في (${dept.name}) — ${req.user.full_name}`,
        badgeText: 'طلب تسكين موظف جديد (HR)',
        badgeColor: '#d97706',
        heading: `قام (${req.user.full_name}) بالتسجيل وتحديد قسمه في مجموعة الهلب`,
        bodyLines: [
          `أنشأ الموظف حسابه وحدد أنه تابع لـ (${dept.name}).`,
          `يرجى الدخول إلى تبويب "تسكين وقبول الموظفين (HR)" لاعتماده وتحديد دوره الوظيفي.`,
        ],
        details: [
          ['الاسم الكامل للموظف', req.user.full_name],
          ['اسم المستخدم المختار', `@${req.user.username}`],
          ['البريد الإلكتروني', req.user.email || '—'],
          ['القسم المطلوب الانضمام إليه', dept.name],
          ['المسمى الوظيفي', cleanJobTitle || 'غير محدد بعد'],
        ],
      });
    }

    return res.json({
      ok: true,
      preferredDepartmentId: dept.id,
      preferredDepartmentName: dept.name,
      departmentConfirmed: true,
    });
  } catch (err) {
    console.error('Update onboarding preference error:', err);
    return res.status(500).json({ error: 'تعذر حفظ اختيار القسم' });
  }
});

// List pending employees + company/department team roster for HR, IT & Top Management
router.get('/pending', (req, res) => {
  const canManageAll = userHasPermission(req.user, 'users.manage');
  const canOnboardDept = userHasPermission(req.user, 'department.onboard_members');

  if (!canManageAll && !canOnboardDept) {
    writeAudit({
      user: req.user,
      action: 'محاولة فتح شاشة تسكين الموظفين بدون صلاحية HR أو إدارة',
      permissionKey: 'users.manage',
      status: 'DENIED',
      req,
    });
    return res.status(403).json({
      code: 'PERMISSION_DENIED',
      permissionKey: 'users.manage',
      error: 'هذه الشاشة مخصصة لإدارة الموارد البشرية (HR) ومسؤولي الـ IT والإدارة العليا فقط',
    });
  }

  const myDeptId = req.user.department_id || null;
  const callerRank = Number(req.user.roleRank || 0);

  const pendingUsers = canManageAll
    ? all(
        `SELECT
           u.id, u.username, u.email, u.full_name, u.job_title,
           u.avatar_color, u.avatar_url, u.auth_provider,
           u.has_custom_credentials, u.department_confirmed,
           u.onboarding_status, u.preferred_department_id, u.created_at,
           pd.name AS preferred_department_name,
           pd.slug AS preferred_department_slug,
           pd.color AS preferred_department_color
         FROM users u
         LEFT JOIN departments pd ON pd.id = u.preferred_department_id
         WHERE u.onboarding_status = 'pending' AND u.is_active = 1
         ORDER BY u.department_confirmed DESC, u.id DESC`
      )
    : all(
        `SELECT
           u.id, u.username, u.email, u.full_name, u.job_title,
           u.avatar_color, u.avatar_url, u.auth_provider,
           u.has_custom_credentials, u.department_confirmed,
           u.onboarding_status, u.preferred_department_id, u.created_at,
           pd.name AS preferred_department_name,
           pd.slug AS preferred_department_slug,
           pd.color AS preferred_department_color
         FROM users u
         LEFT JOIN departments pd ON pd.id = u.preferred_department_id
         WHERE u.onboarding_status = 'pending'
           AND u.is_active = 1
           AND (u.preferred_department_id IS NULL OR u.preferred_department_id = ?)
         ORDER BY
           CASE WHEN u.preferred_department_id = ? THEN 0 ELSE 1 END ASC,
           u.department_confirmed DESC,
           u.id DESC`,
        [myDeptId || -1, myDeptId || -1]
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

  const rawTeamMembers = canManageAll
    ? all(
        `SELECT
           u.id, u.username, u.email, u.full_name, u.job_title, u.avatar_color,
           u.auth_provider, u.department_id, u.approved_at, u.is_active,
           d.name AS department_name, d.color AS department_color,
           r.slug AS role_slug, r.name AS role_name, r.color AS role_color, r.rank_level,
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
           u.auth_provider, u.department_id, u.approved_at, u.is_active,
           d.name AS department_name, d.color AS department_color,
           r.slug AS role_slug, r.name AS role_name, r.color AS role_color, r.rank_level,
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

  const teamMembers = rawTeamMembers.map((m) => ({
    ...m,
    can_caller_delete:
      canManageAll &&
      m.id !== req.user.id &&
      m.role_slug !== 'chairman' &&
      (req.user.role_slug === 'chairman' || Number(m.rank_level || 0) < callerRank),
  }));

  res.json({
    pendingUsers,
    assignableDepartments,
    assignableRoles,
    teamMembers,
    canManageAll,
  });
});

// HR (or IT / Sovereign Admin) approves & assigns a pending employee into their company department!
router.post('/:userId(\\d+)/claim', async (req, res) => {
  try {
    const canManageAll = userHasPermission(req.user, 'users.manage');
    const canOnboardDept = userHasPermission(req.user, 'department.onboard_members');

    if (!canManageAll && !canOnboardDept) {
      writeAudit({
        user: req.user,
        action: 'محاولة قبول وتسكين موظف بدون صلاحية الموارد البشرية (HR)',
        permissionKey: 'users.manage',
        status: 'DENIED',
        req,
      });
      return res.status(403).json({
        code: 'PERMISSION_DENIED',
        permissionKey: 'users.manage',
        error: 'صلاحية قبول وتسكين الموظفين مخصصة لإدارة الموارد البشرية (HR) والإدارة العليا',
      });
    }

    const targetUserId = Number(req.params.userId);
    const targetUser = get(`SELECT * FROM users WHERE id = ?`, [targetUserId]);
    if (!targetUser || !targetUser.is_active) {
      return res.status(404).json({ error: 'الموظف المطلوب غير موجود' });
    }
    if (targetUser.onboarding_status !== 'pending') {
      return res.status(400).json({ error: 'هذا الموظف تم اعتماده وتسكينه بالفعل سابقاً' });
    }

    const body = req.body || {};
    const requestedDeptId = body.departmentId ? Number(body.departmentId) : req.user.department_id;
    const requestedRoleId = Number(body.roleId);
    const jobTitle = String(body.jobTitle || targetUser.job_title || '')
      .trim()
      .slice(0, 100);

    // Enforce strict department scope if user only holds department.onboard_members (without users.manage)
    if (!canManageAll) {
      if (!req.user.department_id) {
        return res.status(400).json({ error: 'حسابك غير مرتبط بقسم محدد' });
      }
      if (requestedDeptId && Number(requestedDeptId) !== Number(req.user.department_id)) {
        writeAudit({
          user: req.user,
          action: 'محاولة ضم موظف إلى قسم آخر بدون صلاحية HR الشاملة',
          permissionKey: 'users.manage',
          status: 'DENIED',
          req,
        });
        return res.status(403).json({
          code: 'DEPARTMENT_ISOLATION',
          error: 'لا تملك صلاحية تسكين موظفين في أقسام أخرى خارج قسمك',
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
             department_confirmed = 1,
             onboarding_status = 'approved',
             approved_by = ?,
             approved_at = datetime('now')
         WHERE id = ?`,
        [dept.id, role.id, jobTitle || role.name, req.user.id, targetUser.id]
      );

      run(
        `INSERT INTO notifications (user_id, type, title, message, link_tab)
         VALUES (?, 'onboarding_approved', 'مرحباً بك! تم اعتماد وتسكين حسابك رسمياً 🎉', ?, 'boards')`,
        [
          targetUser.id,
          `قامت إدارة الموارد البشرية / الإدارة (${req.user.full_name}) بتسكينك في (${dept.name}) بدور (${role.name}). يمكنك الآن الدخول إلى لوحات عمل قسمك فوراً.`,
        ]
      );
    });

    writeAudit({
      user: req.user,
      action: `اعتماد وتسكين موظف جديد: ${targetUser.full_name}`,
      permissionKey: canManageAll ? 'users.manage' : 'department.onboard_members',
      status: 'ALLOWED',
      req,
      details: `القسم: ${dept.name} — الدور: ${role.name}`,
    });

    await sendElhelbEmail({
      to: targetUser.email ? [targetUser.email] : [],
      ccAdmin: true,
      eventType: 'onboarding_approved',
      subject: `🎉 تم اعتماد انضمامك إلى (${dept.name}) — مجموعة الهلب`,
      badgeText: 'تم اعتماد حسابك وتسكينك',
      badgeColor: '#059669',
      heading: `مرحباً بك يا ${targetUser.full_name} في (${dept.name})!`,
      bodyLines: [
        `تمت الموافقة على انضمامك وتسكينك رسمياً بواسطة (${req.user.full_name}).`,
        `أصبحت لوحات العمل والمهام الخاصة بقسمك متاحة لك الآن بالكامل.`,
      ],
      details: [
        ['القسم المعتمد', dept.name],
        ['الدور الوظيفي والصلاحية', role.name],
        ['المسمى الوظيفي', jobTitle || role.name],
        ['اسم المستخدم للدخول المباشر', `@${targetUser.username}`],
        ['تم الاعتماد بواسطة', req.user.full_name],
      ],
    });

    return res.json({
      ok: true,
      message: `تم قبول وتسكين (${targetUser.full_name}) في (${dept.name}) بنجاح`,
    });
  } catch (err) {
    console.error('Claim user error:', err);
    return res.status(500).json({ error: 'تعذر إتمام عملية تسكين الموظف' });
  }
});

// Reject & permanently delete a pending registration request
router.delete('/:userId(\\d+)', (req, res) => {
  const canManageAll = userHasPermission(req.user, 'users.manage');
  const canOnboardDept = userHasPermission(req.user, 'department.onboard_members');

  if (!canManageAll && !canOnboardDept) {
    return res.status(403).json({
      code: 'PERMISSION_DENIED',
      error: 'ليس لديك صلاحية رفض أو حذف طلبات التسجيل',
    });
  }

  const targetUserId = Number(req.params.userId);
  const targetUser = get(`SELECT * FROM users WHERE id = ?`, [targetUserId]);
  if (!targetUser) {
    return res.status(404).json({ error: 'طلب التسجيل غير موجود أو تم حذفه مسبقاً' });
  }
  if (targetUser.onboarding_status !== 'pending') {
    return res.status(400).json({
      error: 'هذا الحساب معتمد بالفعل؛ لحذف موظف حالي استخدم زر الحذف النهائي من قائمة الموظفين',
    });
  }

  if (
    !canManageAll &&
    targetUser.preferred_department_id &&
    Number(targetUser.preferred_department_id) !== Number(req.user.department_id)
  ) {
    return res.status(403).json({
      error: 'لا يمكنك حذف طلب انضمام موجه لقسم آخر',
    });
  }

  adminRoutes.deleteUserCompletely(targetUser.id);

  writeAudit({
    user: req.user,
    action: 'رفض وحذف طلب تسجيل موظف معلق',
    permissionKey: canManageAll ? 'users.manage' : 'department.onboard_members',
    status: 'ALLOWED',
    req,
    details: `${targetUser.full_name} (@${targetUser.username})`,
  });

  return res.json({
    ok: true,
    message: `تم رفض وحذف طلب تسجيل (${targetUser.full_name}) نهائياً`,
  });
});

module.exports = router;
