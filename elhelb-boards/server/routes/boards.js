const express = require('express');
const { get, all, run, transaction } = require('../db');
const {
  authenticate,
  canAccessBoard,
  evaluatePermission,
  consumeGrantIfOneTime,
  writeAudit,
  denyPermission,
  resolveBoardHierarchy,
} = require('../rbac');

const router = express.Router();
router.use(authenticate);

const ALLOWED_BACKGROUNDS = new Set([
  'ocean',
  'gold',
  'purple',
  'emerald',
  'crimson',
  'slate',
  'royal',
  'sunset',
]);

function computeBoardCapabilities(user, board) {
  const ctx = {
    departmentId: board.department_id,
    boardId: board.id,
  };
  return {
    canEditBoard: evaluatePermission(user, 'boards.edit', ctx).allowed,
    canDeleteBoard: evaluatePermission(user, 'boards.delete', ctx).allowed,
    canCreateList: evaluatePermission(user, 'lists.create', ctx).allowed,
    canEditList: evaluatePermission(user, 'lists.edit', ctx).allowed,
    canDeleteList: evaluatePermission(user, 'lists.delete', ctx).allowed,
    canCreateCard: evaluatePermission(user, 'cards.create', ctx).allowed,
    canEditCard: evaluatePermission(user, 'cards.edit', ctx).allowed,
    canMoveCard: evaluatePermission(user, 'cards.move', ctx).allowed,
    canAssignCard: evaluatePermission(user, 'cards.assign', ctx).allowed,
    canDeleteCard: evaluatePermission(user, 'cards.delete', ctx).allowed,
    canComment: evaluatePermission(user, 'comments.create', ctx).allowed,
    canDeleteAnyComment: evaluatePermission(user, 'comments.delete_any', ctx).allowed,
  };
}

// Public directory of company departments (names & colors ONLY — zero private board details!)
router.get('/departments/directory', (req, res) => {
  const depts = all(
    `SELECT d.id, d.slug, d.name, d.description, d.color, d.icon
     FROM departments d
     ORDER BY d.id ASC`
  );
  res.json(
    depts.map((d) => ({
      ...d,
      isMyDepartment: req.user.department_id === d.id,
      canViewBoards:
        req.user.permissionSet.has('boards.view_all') ||
        (req.user.department_id === d.id && req.user.permissionSet.has('boards.view_department')) ||
        req.user.activeGrants.some(
          (g) =>
            g.permission_key === 'boards.view_department' &&
            g.scope_type === 'department' &&
            Number(g.target_department_id) === Number(d.id)
        ),
    }))
  );
});

// List ONLY boards the user is genuinely allowed to access
router.get('/boards', (req, res) => {
  const allBoards = all(
    `SELECT b.*,
            d.name AS department_name,
            d.color AS department_color,
            d.slug AS department_slug,
            d.icon AS department_icon,
            u.full_name AS creator_name,
            (SELECT COUNT(*) FROM lists l WHERE l.board_id = b.id) AS lists_count,
            (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS cards_count,
            (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.is_completed = 1) AS completed_cards_count,
            EXISTS(SELECT 1 FROM board_stars s WHERE s.board_id = b.id AND s.user_id = ?) AS is_starred
     FROM boards b
     JOIN departments d ON d.id = b.department_id
     LEFT JOIN users u ON u.id = b.created_by
     WHERE b.is_archived = 0
     ORDER BY is_starred DESC, b.id ASC`,
    [req.user.id]
  );

  const visibleBoards = [];
  for (const board of allBoards) {
    const access = canAccessBoard(req.user, board);
    if (access.allowed) {
      visibleBoards.push({
        ...board,
        is_starred: Boolean(board.is_starred),
        accessViaGrant: access.viaGrant
          ? {
              id: access.viaGrant.id,
              expiresAt: access.viaGrant.expires_at,
              grantedByName: access.viaGrant.granted_by_name,
            }
          : null,
        capabilities: computeBoardCapabilities(req.user, board),
      });
    }
  }

  res.json(visibleBoards);
});

// Global search ONLY across boards & cards the user is authorized to view
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ boards: [], cards: [] });

  const allBoards = all(
    `SELECT b.id, b.title, b.description, b.department_id, b.background,
            d.name AS department_name, d.color AS department_color
     FROM boards b
     JOIN departments d ON d.id = b.department_id
     WHERE b.is_archived = 0`
  );
  const allowedBoardIds = new Set();
  const matchedBoards = [];

  for (const b of allBoards) {
    if (canAccessBoard(req.user, b).allowed) {
      allowedBoardIds.add(b.id);
      if (
        b.title.toLowerCase().includes(q.toLowerCase()) ||
        b.description.toLowerCase().includes(q.toLowerCase())
      ) {
        matchedBoards.push(b);
      }
    }
  }

  if (allowedBoardIds.size === 0) {
    return res.json({ boards: [], cards: [] });
  }

  const placeholders = Array.from(allowedBoardIds).map(() => '?').join(',');
  const pattern = `%${q}%`;
  const matchedCards = all(
    `SELECT c.id, c.title, c.priority, c.due_date, c.is_completed, c.board_id,
            l.title AS list_title,
            b.title AS board_title,
            d.name AS department_name, d.color AS department_color
     FROM cards c
     JOIN lists l ON l.id = c.list_id
     JOIN boards b ON b.id = c.board_id
     JOIN departments d ON d.id = b.department_id
     WHERE c.board_id IN (${placeholders})
       AND (c.title LIKE ? OR c.description LIKE ?)
     ORDER BY c.id DESC
     LIMIT 20`,
    [...Array.from(allowedBoardIds), pattern, pattern]
  );

  res.json({ boards: matchedBoards, cards: matchedCards });
});

// Create a new board
router.post('/boards', (req, res) => {
  const title = String((req.body && req.body.title) || '').trim();
  const description = String((req.body && req.body.description) || '').trim();
  const background = ALLOWED_BACKGROUNDS.has(req.body && req.body.background)
    ? req.body.background
    : 'ocean';
  const targetDepartmentId = Number(
    (req.body && req.body.departmentId) || req.user.department_id || 0
  );

  if (!targetDepartmentId) {
    return res.status(400).json({ error: 'يرجى تحديد القسم المرتبط باللوحة' });
  }

  const dept = get(`SELECT * FROM departments WHERE id = ?`, [targetDepartmentId]);
  if (!dept) {
    return res.status(404).json({ error: 'القسم المحدد غير موجود' });
  }

  const permCheck = evaluatePermission(req.user, 'boards.create', {
    departmentId: dept.id,
  });

  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.create',
      actionLabel: `إنشاء لوحة جديدة في (${dept.name})`,
      scopeType: 'department',
      departmentId: dept.id,
    });
  }

  if (title.length < 2 || title.length > 120) {
    return res.status(400).json({ error: 'اسم اللوحة يجب أن يكون بين حرفين و120 حرفاً' });
  }

  const boardId = transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);

    const inserted = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [title, description.slice(0, 500), dept.id, background, req.user.id]
    ).lastInsertRowid;

    // Default Kanban workflow columns
    const defaultLists = [
      'قائمة المهام الجديدة',
      'جاري العمل عليها',
      'قيد المراجعة والاعتماد',
      'مكتمل ✅',
    ];
    defaultLists.forEach((lTitle, idx) => {
      run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)`, [
        inserted,
        lTitle,
        idx + 1,
      ]);
    });

    // Default helpful colored labels
    const defaultLabels = [
      ['عاجل', '#dc2626'],
      ['مهم', '#d97706'],
      ['متابعة', '#0a6fa8'],
      ['معتمد', '#059669'],
    ];
    defaultLabels.forEach(([lName, lColor]) => {
      run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [
        inserted,
        lName,
        lColor,
      ]);
    });

    return inserted;
  });

  writeAudit({
    user: req.user,
    action: 'إنشاء لوحة عمل جديدة',
    permissionKey: 'boards.create',
    status: 'ALLOWED',
    req,
    details: `${title} (${dept.name})`,
  });

  const created = resolveBoardHierarchy(boardId);
  res.status(201).json(created);
});

// Get full single Kanban board details (Lists + Cards + Labels + Assignees + Capabilities)
router.get('/boards/:id(\\d+)', (req, res) => {
  const boardId = Number(req.params.id);
  const board = resolveBoardHierarchy(boardId);
  if (!board || board.is_archived) {
    return res.status(404).json({ error: 'اللوحة المطلوبة غير موجودة' });
  }

  const access = canAccessBoard(req.user, board);
  if (!access.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: `فتح لوحة تابعة لـ (${board.department_name})`,
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const isStarredRow = get(
    `SELECT 1 AS starred FROM board_stars WHERE user_id = ? AND board_id = ?`,
    [req.user.id, board.id]
  );

  const lists = all(
    `SELECT * FROM lists WHERE board_id = ? ORDER BY position ASC, id ASC`,
    [board.id]
  );

  const labels = all(
    `SELECT * FROM board_labels WHERE board_id = ? ORDER BY id ASC`,
    [board.id]
  );

  const cards = all(
    `SELECT c.*,
            u.full_name AS creator_name,
            (SELECT COUNT(*) FROM card_comments cm WHERE cm.card_id = c.id) AS comments_count,
            (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id) AS checklist_total,
            (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id AND ci.is_checked = 1) AS checklist_done
     FROM cards c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.board_id = ?
     ORDER BY c.position ASC, c.id ASC`,
    [board.id]
  );

  const cardAssignees = all(
    `SELECT ca.card_id, u.id, u.full_name, u.job_title, u.avatar_color, r.name AS role_name
     FROM card_assignees ca
     JOIN cards c ON c.id = ca.card_id
     JOIN users u ON u.id = ca.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE c.board_id = ?
     ORDER BY u.id ASC`,
    [board.id]
  );

  const cardLabels = all(
    `SELECT cl.card_id, bl.id, bl.name, bl.color
     FROM card_label_links cl
     JOIN cards c ON c.id = cl.card_id
     JOIN board_labels bl ON bl.id = cl.label_id
     WHERE c.board_id = ?
     ORDER BY bl.id ASC`,
    [board.id]
  );

  const assigneesByCard = new Map();
  for (const a of cardAssignees) {
    if (!assigneesByCard.has(a.card_id)) assigneesByCard.set(a.card_id, []);
    assigneesByCard.get(a.card_id).push({
      id: a.id,
      fullName: a.full_name,
      jobTitle: a.job_title,
      avatarColor: a.avatar_color,
      roleName: a.role_name,
    });
  }

  const labelsByCard = new Map();
  for (const l of cardLabels) {
    if (!labelsByCard.has(l.card_id)) labelsByCard.set(l.card_id, []);
    labelsByCard.get(l.card_id).push({
      id: l.id,
      name: l.name,
      color: l.color,
    });
  }

  // Also detect any card-specific grants the user holds on this board
  const cardGrantMap = new Map();
  for (const g of req.user.activeGrants) {
    if (g.scope_type === 'card' && g.target_card_id) {
      if (!cardGrantMap.has(g.target_card_id)) cardGrantMap.set(g.target_card_id, []);
      cardGrantMap.get(g.target_card_id).push(g.permission_key);
    }
  }

  const enrichedCards = cards.map((c) => ({
    ...c,
    is_completed: Boolean(c.is_completed),
    assignees: assigneesByCard.get(c.id) || [],
    labels: labelsByCard.get(c.id) || [],
    grantedCardPermissions: cardGrantMap.get(c.id) || [],
  }));

  // Members who belong to this board's department (or company-wide managers) for assignment dropdown
  const departmentMembers = all(
    `SELECT u.id, u.full_name, u.job_title, u.avatar_color, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1
       AND (u.department_id = ? OR EXISTS (
         SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = u.role_id AND rp.permission_key = 'boards.view_all'
       ))
     ORDER BY u.department_id IS NULL ASC, u.id ASC`,
    [board.department_id]
  ).map((m) => ({
    id: m.id,
    fullName: m.full_name,
    jobTitle: m.job_title,
    avatarColor: m.avatar_color,
    roleName: m.role_name,
  }));

  res.json({
    board: {
      ...board,
      is_starred: Boolean(isStarredRow),
      accessViaGrant: access.viaGrant
        ? {
            id: access.viaGrant.id,
            expiresAt: access.viaGrant.expires_at,
            grantedByName: access.viaGrant.granted_by_name,
          }
        : null,
    },
    capabilities: computeBoardCapabilities(req.user, board),
    lists,
    cards: enrichedCards,
    labels,
    departmentMembers,
  });
});

// Edit board details
router.patch('/boards/:id(\\d+)', (req, res) => {
  const boardId = Number(req.params.id);
  const board = resolveBoardHierarchy(boardId);
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  const permCheck = evaluatePermission(req.user, 'boards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
  });

  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.edit',
      actionLabel: `تعديل إعدادات لوحة "${board.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const title =
    req.body && req.body.title !== undefined
      ? String(req.body.title).trim()
      : board.title;
  const description =
    req.body && req.body.description !== undefined
      ? String(req.body.description).trim().slice(0, 500)
      : board.description;
  const background =
    req.body && ALLOWED_BACKGROUNDS.has(req.body.background)
      ? req.body.background
      : board.background;

  if (title.length < 2 || title.length > 120) {
    return res.status(400).json({ error: 'عنوان اللوحة يجب أن يكون بين حرفين و120 حرفاً' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(
      `UPDATE boards SET title = ?, description = ?, background = ?, updated_at = datetime('now') WHERE id = ?`,
      [title, description, background, board.id]
    );
  });

  writeAudit({
    user: req.user,
    action: 'تعديل إعدادات لوحة',
    permissionKey: 'boards.edit',
    status: 'ALLOWED',
    req,
    details: title,
  });

  res.json(resolveBoardHierarchy(board.id));
});

// Delete board
router.delete('/boards/:id(\\d+)', (req, res) => {
  const boardId = Number(req.params.id);
  const board = resolveBoardHierarchy(boardId);
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  const permCheck = evaluatePermission(req.user, 'boards.delete', {
    departmentId: board.department_id,
    boardId: board.id,
  });

  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.delete',
      actionLabel: `حذف لوحة "${board.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`DELETE FROM boards WHERE id = ?`, [board.id]);
  });

  writeAudit({
    user: req.user,
    action: 'حذف لوحة عمل',
    permissionKey: 'boards.delete',
    status: 'ALLOWED',
    req,
    details: `${board.title} (${board.department_name})`,
  });

  res.json({ ok: true });
});

// Toggle board star
router.post('/boards/:id(\\d+)/star', (req, res) => {
  const boardId = Number(req.params.id);
  const board = resolveBoardHierarchy(boardId);
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'تفضيل اللوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const existing = get(
    `SELECT 1 AS ok FROM board_stars WHERE user_id = ? AND board_id = ?`,
    [req.user.id, board.id]
  );
  if (existing) {
    run(`DELETE FROM board_stars WHERE user_id = ? AND board_id = ?`, [req.user.id, board.id]);
    return res.json({ is_starred: false });
  } else {
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [req.user.id, board.id]);
    return res.json({ is_starred: true });
  }
});

// Create board label
router.post('/boards/:id(\\d+)/labels', (req, res) => {
  const boardId = Number(req.params.id);
  const board = resolveBoardHierarchy(boardId);
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  const permCheck = evaluatePermission(req.user, 'boards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.edit',
      actionLabel: 'إضافة تصنيف جديد للوحة',
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const name = String((req.body && req.body.name) || '').trim();
  const color = /^#[0-9a-fA-F]{6}$/.test((req.body && req.body.color) || '')
    ? req.body.color
    : '#0a6fa8';

  if (!name || name.length > 40) {
    return res.status(400).json({ error: 'اسم التصنيف مطلوب (بحد أقصى 40 حرفاً)' });
  }

  let newId;
  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    newId = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [
      board.id,
      name,
      color,
    ]).lastInsertRowid;
  });

  res.status(201).json({ id: newId, board_id: board.id, name, color });
});

router.delete('/labels/:id(\\d+)', (req, res) => {
  const labelId = Number(req.params.id);
  const label = get(`SELECT * FROM board_labels WHERE id = ?`, [labelId]);
  if (!label) return res.status(404).json({ error: 'التصنيف غير موجود' });

  const board = resolveBoardHierarchy(label.board_id);
  const permCheck = evaluatePermission(req.user, 'boards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.edit',
      actionLabel: 'حذف تصنيف من اللوحة',
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`DELETE FROM board_labels WHERE id = ?`, [label.id]);
  });

  res.json({ ok: true });
});

module.exports = router;
