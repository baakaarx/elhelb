const express = require('express');
const { get, all, run, transaction } = require('../db');
const {
  authenticate,
  isChairmanExclusiveDepartment,
  canAccessBoard,
  evaluatePermission,
  writeAudit,
  denyPermission,
  resolveBoardHierarchy,
  resolveCardHierarchy,
} = require('../rbac');
const { sendElhelbEmail } = require('../mailer');

const router = express.Router();
router.use(authenticate);

const DURATION_SQL_MODIFIERS = {
  once: '+24 hours', // One-time grants also expire after 24h if unused
  '1h': '+1 hours',
  '8h': '+8 hours',
  '24h': '+24 hours',
  '7d': '+7 days',
};

const DURATION_LABELS = {
  once: 'تنفيذ لمرة واحدة فقط',
  '1h': 'ساعة واحدة',
  '8h': '8 ساعات (يوم عمل)',
  '24h': '24 ساعة (يوم كامل)',
  '7d': '7 أيام (أسبوع)',
};

const REQUESTABLE_CATEGORIES = new Set(['boards', 'lists', 'cards', 'collaboration']);

function canManagerReviewRequest(manager, reqRow) {
  if (Number(reqRow.requester_id) === Number(manager.id)) return false;
  if (isChairmanExclusiveDepartment(reqRow.target_department_id)) {
    return manager.role_slug === 'chairman';
  }
  if (manager.permissionSet.has('requests.review_all')) return true;
  if (
    manager.permissionSet.has('requests.review_department') &&
    manager.department_id &&
    Number(reqRow.target_department_id) === Number(manager.department_id) &&
    Number(reqRow.requester_department_id) === Number(manager.department_id) &&
    manager.permissionSet.has(reqRow.permission_key)
  ) {
    return true;
  }
  return false;
}

// Catalog of requestable permissions & departments for the "طلب صلاحية من المدير" dialog
router.get('/requests/catalog', (req, res) => {
  const isChairman = req.user.role_slug === 'chairman';
  const permissions = all(
    `SELECT key, name, description, category, category_label
     FROM permissions
     WHERE key != 'boards.view_all'
     ORDER BY sort_order ASC`
  ).filter((p) => REQUESTABLE_CATEGORIES.has(p.category));

  const departments = all(
    `SELECT id, slug, name, color, description
     FROM departments
     WHERE is_chairman_exclusive = 0 OR ? = 1 OR id = ?
     ORDER BY id ASC`,
    [isChairman ? 1 : 0, req.user.department_id || -1]
  );

  res.json({
    permissions,
    departments,
    durations: Object.entries(DURATION_LABELS).map(([value, label]) => ({ value, label })),
  });
});

// Employee's own submitted requests + active grants
router.get('/requests/mine', (req, res) => {
  const myRequests = all(
    `SELECT pr.*,
            p.name AS permission_name,
            p.category_label,
            d.name AS target_department_name,
            d.color AS target_department_color,
            rv.full_name AS reviewer_name
     FROM permission_requests pr
     JOIN permissions p ON p.key = pr.permission_key
     LEFT JOIN departments d ON d.id = pr.target_department_id
     LEFT JOIN users rv ON rv.id = pr.reviewed_by
     WHERE pr.requester_id = ?
     ORDER BY pr.id DESC
     LIMIT 50`,
    [req.user.id]
  );

  res.json({
    requests: myRequests,
    activeGrants: req.user.activeGrants,
  });
});

// Manager Inbox: Pending & Historical requests + Active Grants they can manage
router.get('/requests/inbox', (req, res) => {
  const canAll = req.user.permissionSet.has('requests.review_all');
  const canDept = req.user.permissionSet.has('requests.review_department');

  if (!canAll && !canDept) {
    return denyPermission(req, res, {
      permissionKey: 'requests.review_department',
      actionLabel: 'الاطلاع على صندوق طلبات الصلاحيات',
      scopeType: 'department',
      departmentId: req.user.department_id,
      canRequestElevation: false,
    });
  }

  const isChairman = req.user.role_slug === 'chairman';
  const whereClauses = [];
  const whereParams = [];

  if (!isChairman) {
    whereClauses.push('COALESCE(td.is_chairman_exclusive, 0) = 0');
    if (!canAll) {
      whereClauses.push('pr.target_department_id = ?');
      whereClauses.push('u.department_id = ?');
      whereParams.push(req.user.department_id || -1, req.user.department_id || -1);
    }
  }

  const allRows = all(
    `SELECT pr.*,
            u.full_name AS requester_name,
            u.username AS requester_username,
            u.job_title AS requester_job_title,
            u.avatar_color AS requester_avatar_color,
            u.department_id AS requester_department_id,
            ud.name AS requester_department_name,
            r.name AS requester_role_name,
            r.color AS requester_role_color,
            p.name AS permission_name,
            p.description AS permission_description,
            p.category_label,
            td.name AS target_department_name,
            td.color AS target_department_color,
            td.is_chairman_exclusive AS target_dept_exclusive,
            b.title AS target_board_title,
            c.title AS target_card_title,
            rv.full_name AS reviewer_name
     FROM permission_requests pr
     JOIN users u ON u.id = pr.requester_id
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments ud ON ud.id = u.department_id
     JOIN permissions p ON p.key = pr.permission_key
     LEFT JOIN departments td ON td.id = pr.target_department_id
     LEFT JOIN boards b ON b.id = pr.target_board_id
     LEFT JOIN cards c ON c.id = pr.target_card_id
     LEFT JOIN users rv ON rv.id = pr.reviewed_by
     ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}
     ORDER BY CASE pr.status WHEN 'pending' THEN 0 ELSE 1 END ASC, pr.id DESC
     LIMIT 100`,
    whereParams
  );

  const filteredRequests = allRows
    .filter((row) => {
      if (canAll) return true;
      return req.user.permissionSet.has(row.permission_key);
    })
    .map((row) => ({
      ...row,
      canReview: row.status === 'pending' && canManagerReviewRequest(req.user, row),
    }));

  // Active grants visible to this manager
  const activeGrants = all(
    `SELECT g.*,
            u.full_name AS user_name,
            u.job_title AS user_job_title,
            u.avatar_color AS user_avatar_color,
            u.department_id AS user_department_id,
            r.name AS user_role_name,
            p.name AS permission_name,
            d.name AS target_department_name,
            b.title AS target_board_title,
            c.title AS target_card_title,
            gb.full_name AS granted_by_name
     FROM permission_grants g
     JOIN users u ON u.id = g.user_id
     JOIN roles r ON r.id = u.role_id
     JOIN permissions p ON p.key = g.permission_key
     LEFT JOIN departments d ON d.id = g.target_department_id
     LEFT JOIN boards b ON b.id = g.target_board_id
     LEFT JOIN cards c ON c.id = g.target_card_id
     LEFT JOIN users gb ON gb.id = g.granted_by
     WHERE g.is_revoked = 0
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))
       AND (g.uses_remaining IS NULL OR g.uses_remaining > 0)
     ORDER BY g.id DESC`
  ).filter((g) => {
    if (isChairmanExclusiveDepartment(g.target_department_id)) {
      return req.user.role_slug === 'chairman';
    }
    if (canAll) return true;
    return (
      req.user.department_id &&
      Number(g.target_department_id) === Number(req.user.department_id) &&
      Number(g.user_department_id) === Number(req.user.department_id)
    );
  });

  res.json({
    requests: filteredRequests,
    activeGrants,
  });
});

// Submit a new Permission Request to Manager
router.post('/requests', async (req, res) => {
  if (req.user.onboarding_status === 'pending') {
    return res.status(403).json({
      error: 'حسابك بانتظار ضم رئيس القسم أولاً قبل إرسال طلبات صلاحية إضافية',
    });
  }
  const body = req.body || {};
  const permissionKey = String(body.permissionKey || '').trim();
  const reason = String(body.reason || '').trim();
  let requestedDuration = String(body.requestedDuration || 'once').trim();

  const perm = get(`SELECT * FROM permissions WHERE key = ?`, [permissionKey]);
  if (!perm || !REQUESTABLE_CATEGORIES.has(perm.category) || perm.key === 'boards.view_all') {
    return res.status(400).json({ error: 'الصلاحية المطلوبة غير متاحة للطلب المؤقت' });
  }

  if (!DURATION_SQL_MODIFIERS[requestedDuration]) {
    requestedDuration = 'once';
  }
  // Viewing permissions should always be time-bound rather than 1-use
  if (permissionKey === 'boards.view_department' && requestedDuration === 'once') {
    requestedDuration = '8h';
  }

  if (reason.length < 5 || reason.length > 600) {
    return res.status(400).json({
      error: 'يرجى كتابة سبب واضح للطلب لا يقل عن 5 أحرف لمساعدة المدير في اتخاذ القرار',
    });
  }

  let scopeType = 'department';
  let targetDepartmentId = null;
  let targetBoardId = null;
  let targetCardId = null;
  let actionSummary = String(body.actionSummary || '').trim();

  if (body.targetCardId) {
    const card = resolveCardHierarchy(Number(body.targetCardId));
    if (!card) return res.status(404).json({ error: 'الكارت المحدد غير موجود' });
    const board = resolveBoardHierarchy(card.board_id);
    if (!canAccessBoard(req.user, board).allowed) {
      return res.status(403).json({ error: 'لا يمكنك تقديم طلب على كارت في لوحة غير مصرح لك بعرضها' });
    }
    scopeType = 'card';
    targetCardId = card.id;
    targetBoardId = board.id;
    targetDepartmentId = board.department_id;
    if (!actionSummary) {
      actionSummary = `${perm.name} — كارت "${card.title}"`;
    }
  } else if (body.targetBoardId) {
    const board = resolveBoardHierarchy(Number(body.targetBoardId));
    if (!board) return res.status(404).json({ error: 'اللوحة المحددة غير موجودة' });
    if (canAccessBoard(req.user, board).allowed) {
      scopeType = 'board';
      targetBoardId = board.id;
      targetDepartmentId = board.department_id;
      if (!actionSummary) {
        actionSummary = `${perm.name} — لوحة "${board.title}"`;
      }
    } else {
      // Do NOT widen a single-board request into department-wide access!
      if (permissionKey !== 'boards.view_department') {
        return res.status(403).json({
          error: 'لا يمكنك طلب صلاحية إجراء على لوحة قبل الحصول على صلاحية عرضها أولاً',
        });
      }
      scopeType = 'board';
      targetBoardId = board.id;
      targetDepartmentId = board.department_id;
      if (!actionSummary) {
        actionSummary = `${perm.name} — لوحة محددة داخل (${board.department_name})`;
      }
    }
  } else {
    targetDepartmentId = Number(body.targetDepartmentId || req.user.department_id || 0);
    const dept = get(`SELECT * FROM departments WHERE id = ?`, [targetDepartmentId]);
    if (!dept) {
      return res.status(400).json({ error: 'يرجى اختيار القسم المستهدف للطلب' });
    }
    scopeType = 'department';
    targetDepartmentId = dept.id;
    if (!actionSummary) {
      actionSummary = `${perm.name} — (${dept.name})`;
    }
  }

  // Check if user ALREADY holds this permission on this scope
  const alreadyHas = evaluatePermission(req.user, permissionKey, {
    departmentId: targetDepartmentId,
    boardId: targetBoardId,
    cardId: targetCardId,
  });
  if (alreadyHas.allowed) {
    return res.status(400).json({
      error: 'لديك هذه الصلاحية بالفعل حاليًا ولا تحتاج إلى إرسال طلب استثناء!',
    });
  }

  // Prevent duplicate pending requests
  const dup = get(
    `SELECT id FROM permission_requests
     WHERE requester_id = ?
       AND permission_key = ?
       AND scope_type = ?
       AND COALESCE(target_department_id, 0) = COALESCE(?, 0)
       AND COALESCE(target_board_id, 0) = COALESCE(?, 0)
       AND COALESCE(target_card_id, 0) = COALESCE(?, 0)
       AND status = 'pending'`,
    [req.user.id, permissionKey, scopeType, targetDepartmentId, targetBoardId, targetCardId]
  );

  if (dup) {
    return res.status(409).json({
      error: 'لديك طلب مماثل قيد المراجعة بالفعل عند المدير، يرجى انتظار الرد عليه.',
    });
  }

  const deptRow = get(`SELECT * FROM departments WHERE id = ?`, [targetDepartmentId]);
  if (
    deptRow &&
    Number(deptRow.is_chairman_exclusive) &&
    req.user.role_slug !== 'chairman' &&
    Number(req.user.department_id) !== Number(deptRow.id)
  ) {
    return res.status(403).json({
      error: 'حماية سيادية: هذا القسم خاص ومرتبط مباشرةً برئيس مجلس الإدارة فقط ولا يقبل طلبات وصول خارجية.',
    });
  }
  const isExclusiveTarget = Boolean(deptRow && Number(deptRow.is_chairman_exclusive));
  const isCrossDept =
    !req.user.department_id || Number(req.user.department_id) !== Number(targetDepartmentId);

  let createdRequestId;
  const reviewerEmails = [];
  transaction(() => {
    createdRequestId = run(
      `INSERT INTO permission_requests (
        requester_id, permission_key, scope_type,
        target_department_id, target_board_id, target_card_id,
        requested_duration, reason, action_summary, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        req.user.id,
        permissionKey,
        scopeType,
        targetDepartmentId,
        targetBoardId,
        targetCardId,
        requestedDuration,
        reason,
        actionSummary.slice(0, 250),
      ]
    ).lastInsertRowid;

    // Notify eligible managers (strictly Chairman-only if department is sovereign Chairman-exclusive!)
    const managers = all(
      `SELECT u.id, u.email, u.email_verified, u.department_id, r.slug AS role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1 AND u.onboarding_status = 'approved' AND u.id != ?`,
      [req.user.id]
    );

    for (const m of managers) {
      if (isExclusiveTarget && m.role_slug !== 'chairman') {
        continue;
      }
      const mPerms = new Set(
        all(
          `SELECT permission_key FROM role_permissions WHERE role_id = (SELECT role_id FROM users WHERE id = ?)`,
          [m.id]
        ).map((x) => x.permission_key)
      );
      const canReview = isExclusiveTarget
        ? m.role_slug === 'chairman'
        : mPerms.has('requests.review_all') ||
          (!isCrossDept &&
            mPerms.has('requests.review_department') &&
            Number(m.department_id) === Number(targetDepartmentId) &&
            mPerms.has(permissionKey));

      if (canReview) {
        run(
          `INSERT INTO notifications (user_id, type, title, message, link_tab)
           VALUES (?, 'request_new', 'طلب صلاحية جديد من موظف', ?, 'requests')`,
          [
            m.id,
            `يطلب ${req.user.full_name} (@${req.user.username}) صلاحية (${perm.name}) — ${actionSummary}.`,
          ]
        );
        if (m.email && Number(m.email_verified) === 1) reviewerEmails.push(m.email);
      }
    }
  });

  writeAudit({
    user: req.user,
    action: 'تقديم طلب صلاحية للمدير',
    permissionKey,
    status: 'ALLOWED',
    req,
    details: `${actionSummary} (${DURATION_LABELS[requestedDuration]})`,
    departmentId: targetDepartmentId,
    isChairmanExclusive: isExclusiveTarget,
  });

  await sendElhelbEmail({
    to: reviewerEmails,
    ccAdmin: !isExclusiveTarget,
    isChairmanExclusive: isExclusiveTarget,
    eventType: 'permission_request',
    subject: `🔑 طلب صلاحية جديد من (${req.user.full_name}) — ${perm.name}`,
    badgeText: 'طلب إذن صلاحية مؤقتة',
    badgeColor: '#0a6fa8',
    heading: `طلب صلاحية استثنائية من الموظف (${req.user.full_name})`,
    bodyLines: [
      `تقدم الموظف بطلب للحصول على صلاحية مؤقتة وينتظر مراجعتك واعتمادك من تبويب "طلبات الصلاحيات".`,
    ],
    details: [
      ['الموظف مقدم الطلب', `${req.user.full_name} (@${req.user.username})`],
      ['الصلاحية المطلوبة', perm.name],
      ['العملية المحددة', actionSummary],
      ['المدة المطلوبة', DURATION_LABELS[requestedDuration]],
      ['سبب الطلب', reason],
    ],
  });

  res.status(201).json({
    ok: true,
    id: createdRequestId,
    routedTo: isExclusiveTarget
      ? 'رئيس مجلس الإدارة فقط (خصوصية سيادية)'
      : isCrossDept
        ? 'الإدارة العليا (المدير العام)'
        : `مدير ${deptRow ? deptRow.name : 'القسم'} أو الإدارة العليا`,
  });
});

// Manager approves or rejects a pending request
router.post('/requests/:id(\\d+)/review', async (req, res) => {
  const reqId = Number(req.params.id);
  const reqRow = get(
    `SELECT pr.*, u.department_id AS requester_department_id, u.full_name AS requester_name,
            u.email AS requester_email, u.email_verified AS requester_email_verified,
            p.name AS permission_name
     FROM permission_requests pr
     JOIN users u ON u.id = pr.requester_id
     JOIN permissions p ON p.key = pr.permission_key
     WHERE pr.id = ?`,
    [reqId]
  );

  if (!reqRow) {
    return res.status(404).json({ error: 'طلب الصلاحية غير موجود' });
  }
  if (reqRow.status !== 'pending') {
    return res.status(400).json({ error: 'تمت مراجعة هذا الطلب مسبقاً' });
  }

  if (Number(reqRow.requester_id) === Number(req.user.id)) {
    return res.status(403).json({ error: 'لا يمكن للموظف اعتماد طلب الصلاحية الخاص به بنفسه' });
  }

  if (!canManagerReviewRequest(req.user, reqRow)) {
    return denyPermission(req, res, {
      permissionKey: 'requests.review_all',
      actionLabel: 'مراجعة طلب صلاحية خارج نطاق القسم أو الصلاحيات',
      scopeType: 'department',
      departmentId: reqRow.target_department_id,
      customMessage:
        'هذا الطلب يتجاوز صلاحيات مدير القسم (أو يخص قسماً آخر) ويحتاج لاعتماد المدير العام.',
      canRequestElevation: false,
    });
  }

  const decision = String((req.body && req.body.decision) || '').trim();
  const reviewNote = String((req.body && req.body.reviewNote) || '').trim().slice(0, 400);
  let approvedDuration = String(
    (req.body && req.body.approvedDuration) || reqRow.requested_duration || 'once'
  ).trim();

  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: 'القرار يجب أن يكون قبول (approved) أو رفض (rejected)' });
  }

  if (!DURATION_SQL_MODIFIERS[approvedDuration]) {
    approvedDuration = reqRow.requested_duration;
  }
  if (reqRow.permission_key === 'boards.view_department' && approvedDuration === 'once') {
    approvedDuration = '8h';
  }

  let alreadyReviewedRace = false;
  transaction(() => {
    if (decision === 'approved') {
      const modifier = DURATION_SQL_MODIFIERS[approvedDuration];
      const expiresAt = get(`SELECT datetime('now', ?) AS exp`, [modifier]).exp;
      const usesRemaining = approvedDuration === 'once' ? 1 : null;

      const updated = run(
        `UPDATE permission_requests
         SET status = 'approved',
             reviewed_by = ?,
             review_note = ?,
             approved_duration = ?,
             reviewed_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [req.user.id, reviewNote, approvedDuration, reqRow.id]
      );
      if (updated.changes === 0) {
        alreadyReviewedRace = true;
        return;
      }

      run(
        `INSERT INTO permission_grants (
          request_id, user_id, granted_by, permission_key,
          scope_type, target_department_id, target_board_id, target_card_id,
          uses_remaining, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reqRow.id,
          reqRow.requester_id,
          req.user.id,
          reqRow.permission_key,
          reqRow.scope_type,
          reqRow.target_department_id,
          reqRow.target_board_id,
          reqRow.target_card_id,
          usesRemaining,
          expiresAt,
        ]
      );

      run(
        `INSERT INTO notifications (user_id, type, title, message, link_board_id)
         VALUES (?, 'request_approved', 'تمت الموافقة على طلب الصلاحية ✅', ?, ?)`,
        [
          reqRow.requester_id,
          `وافق ${req.user.full_name} على منحك صلاحية (${reqRow.permission_name}) — المدة: ${
            DURATION_LABELS[approvedDuration]
          }${reviewNote ? ` — ملاحظة المدير: ${reviewNote}` : ''}.`,
          reqRow.target_board_id || null,
        ]
      );
    } else {
      const updated = run(
        `UPDATE permission_requests
         SET status = 'rejected',
             reviewed_by = ?,
             review_note = ?,
             reviewed_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [req.user.id, reviewNote, reqRow.id]
      );
      if (updated.changes === 0) {
        alreadyReviewedRace = true;
        return;
      }

      run(
        `INSERT INTO notifications (user_id, type, title, message, link_tab)
         VALUES (?, 'request_rejected', 'تم رفض طلب الصلاحية', ?, 'my-requests')`,
        [
          reqRow.requester_id,
          `اعتذر ${req.user.full_name} عن الموافقة على طلب (${reqRow.permission_name})${
            reviewNote ? ` — السبب: ${reviewNote}` : '.'
          }`,
        ]
      );
    }
  });

  if (alreadyReviewedRace) {
    return res.status(400).json({ error: 'تمت مراجعة هذا الطلب مسبقاً' });
  }

  const isExclusiveReview = isChairmanExclusiveDepartment(reqRow.target_department_id);

  writeAudit({
    user: req.user,
    action: decision === 'approved' ? 'اعتماد طلب صلاحية استثنائية' : 'رفض طلب صلاحية',
    permissionKey: reqRow.permission_key,
    status: 'ALLOWED',
    req,
    details: `للموظف: ${reqRow.requester_name} — ${reqRow.action_summary}${
      decision === 'approved' ? ` (${DURATION_LABELS[approvedDuration]})` : ''
    }`,
    departmentId: reqRow.target_department_id,
    isChairmanExclusive: isExclusiveReview,
  });

  await sendElhelbEmail({
    to:
      reqRow.requester_email && Number(reqRow.requester_email_verified) === 1
        ? [reqRow.requester_email]
        : [],
    ccAdmin: false,
    isChairmanExclusive: isExclusiveReview,
    eventType: decision === 'approved' ? 'request_approved' : 'request_rejected',
    subject:
      decision === 'approved'
        ? `✅ تمت الموافقة على طلب صلاحية (${reqRow.permission_name})`
        : `ℹ️ تحديث بشأن طلب صلاحية (${reqRow.permission_name})`,
    badgeText: decision === 'approved' ? 'تمت الموافقة' : 'تم الاعتذار عن الطلب',
    badgeColor: decision === 'approved' ? '#059669' : '#dc2626',
    heading:
      decision === 'approved'
        ? `وافق (${req.user.full_name}) على منحك صلاحية (${reqRow.permission_name})`
        : `قام (${req.user.full_name}) بمراجعة طلب الصلاحية الخاص بك`,
    bodyLines: [
      decision === 'approved'
        ? `تم تفعيل التصريح على حسابك الآن ويمكنك تنفيذ العملية فوراً.`
        : `لم تتم الموافقة على هذا الطلب حالياً.`,
    ],
    details: [
      ['الصلاحية', reqRow.permission_name],
      ['العملية', reqRow.action_summary || '—'],
      ...(decision === 'approved'
        ? [['مدة الصلاحية المعتمدة', DURATION_LABELS[approvedDuration]]]
        : []),
      ...(reviewNote ? [['ملاحظة المدير', reviewNote]] : []),
    ],
  });

  res.json({ ok: true, status: decision });
});

// Manager revokes an active temporary grant immediately
router.post('/grants/:id(\\d+)/revoke', (req, res) => {
  const grantId = Number(req.params.id);
  const grant = get(
    `SELECT g.*, u.full_name AS user_name, u.department_id AS user_department_id,
            p.name AS permission_name
     FROM permission_grants g
     JOIN users u ON u.id = g.user_id
     JOIN permissions p ON p.key = g.permission_key
     WHERE g.id = ?`,
    [grantId]
  );

  if (!grant) return res.status(404).json({ error: 'التصريح غير موجود' });
  if (Number(grant.is_revoked)) {
    return res.status(400).json({ error: 'تم سحب وإيقاف هذا التصريح مسبقاً' });
  }

  const isExclusiveGrant = isChairmanExclusiveDepartment(grant.target_department_id);
  if (isExclusiveGrant && req.user.role_slug !== 'chairman') {
    return denyPermission(req, res, {
      permissionKey: 'requests.review_all',
      actionLabel: 'سحب التصريح المؤقت',
      scopeType: 'department',
      departmentId: grant.target_department_id,
      canRequestElevation: false,
    });
  }

  const canAll = req.user.permissionSet.has('requests.review_all');
  const canDept =
    req.user.permissionSet.has('requests.review_department') &&
    req.user.department_id &&
    Number(grant.target_department_id) === Number(req.user.department_id) &&
    Number(grant.user_department_id) === Number(req.user.department_id);

  if (!canAll && !canDept) {
    return denyPermission(req, res, {
      permissionKey: 'requests.review_department',
      actionLabel: 'سحب التصريح المؤقت',
      scopeType: 'department',
      departmentId: grant.target_department_id,
      canRequestElevation: false,
    });
  }

  let alreadyRevokedRace = false;
  transaction(() => {
    const rev = run(
      `UPDATE permission_grants SET is_revoked = 1 WHERE id = ? AND is_revoked = 0`,
      [grant.id]
    );
    if (rev.changes === 0) {
      alreadyRevokedRace = true;
      return;
    }
    if (grant.request_id) {
      run(`UPDATE permission_requests SET status = 'revoked' WHERE id = ?`, [grant.request_id]);
    }
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'grant_revoked', 'تم إيقاف التصريح المؤقت', ?, 'my-requests')`,
      [
        grant.user_id,
        `قام ${req.user.full_name} بإنهاء التصريح المؤقت الخاص بصلاحية (${grant.permission_name}).`,
      ]
    );
  });

  if (alreadyRevokedRace) {
    return res.status(400).json({ error: 'تم سحب وإيقاف هذا التصريح مسبقاً' });
  }

  writeAudit({
    user: req.user,
    action: 'سحب وإلغاء تصريح صلاحية مؤقت',
    permissionKey: grant.permission_key,
    status: 'ALLOWED',
    req,
    details: `تم سحب (${grant.permission_name}) من ${grant.user_name}`,
    departmentId: grant.target_department_id,
    isChairmanExclusive: isExclusiveGrant,
  });

  res.json({ ok: true });
});

module.exports = router;
