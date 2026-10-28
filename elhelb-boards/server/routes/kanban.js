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
  resolveListHierarchy,
  resolveCardHierarchy,
} = require('../rbac');

const router = express.Router();
router.use(authenticate);

const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function loadFullCardDetails(cardId) {
  const card = resolveCardHierarchy(cardId);
  if (!card) return null;

  const assignees = all(
    `SELECT u.id, u.full_name, u.job_title, u.avatar_color, r.name AS role_name
     FROM card_assignees ca
     JOIN users u ON u.id = ca.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE ca.card_id = ?
     ORDER BY u.id ASC`,
    [card.id]
  ).map((u) => ({
    id: u.id,
    fullName: u.full_name,
    jobTitle: u.job_title,
    avatarColor: u.avatar_color,
    roleName: u.role_name,
  }));

  const labels = all(
    `SELECT bl.id, bl.name, bl.color
     FROM card_label_links cl
     JOIN board_labels bl ON bl.id = cl.label_id
     WHERE cl.card_id = ?
     ORDER BY bl.id ASC`,
    [card.id]
  );

  const checklist = all(
    `SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position ASC, id ASC`,
    [card.id]
  ).map((i) => ({ ...i, is_checked: Boolean(i.is_checked) }));

  const comments = all(
    `SELECT cm.*, u.full_name, u.avatar_color, u.job_title, r.name AS role_name
     FROM card_comments cm
     JOIN users u ON u.id = cm.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE cm.card_id = ?
     ORDER BY cm.id DESC`,
    [card.id]
  );

  return {
    ...card,
    is_completed: Boolean(card.is_completed),
    assignees,
    labels,
    checklist,
    comments,
  };
}

// ==========================================
// LISTS (أعمدة مراحل الكانبان)
// ==========================================

router.post('/boards/:boardId(\\d+)/lists', (req, res) => {
  const board = resolveBoardHierarchy(Number(req.params.boardId));
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'lists.create', {
    departmentId: board.department_id,
    boardId: board.id,
  });

  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'lists.create',
      actionLabel: `إضافة قائمة جديدة في لوحة "${board.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const title = String((req.body && req.body.title) || '').trim();
  if (title.length < 1 || title.length > 100) {
    return res.status(400).json({ error: 'عنوان القائمة مطلوب (بحد أقصى 100 حرف)' });
  }

  let createdList;
  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    const maxPos = get(`SELECT COALESCE(MAX(position), 0) AS m FROM lists WHERE board_id = ?`, [
      board.id,
    ]).m;
    const id = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)`, [
      board.id,
      title,
      maxPos + 1,
    ]).lastInsertRowid;
    createdList = get(`SELECT * FROM lists WHERE id = ?`, [id]);
  });

  writeAudit({
    user: req.user,
    action: 'إضافة قائمة مراحل',
    permissionKey: 'lists.create',
    status: 'ALLOWED',
    req,
    details: `${title} — ${board.title}`,
  });

  res.status(201).json(createdList);
});

router.patch('/lists/:id(\\d+)', (req, res) => {
  const listH = resolveListHierarchy(Number(req.params.id));
  if (!listH) return res.status(404).json({ error: 'القائمة غير موجودة' });

  const board = resolveBoardHierarchy(listH.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'lists.edit', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'lists.edit',
      actionLabel: `تعديل قائمة "${listH.list_title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const title = String((req.body && req.body.title) || '').trim();
  if (title.length < 1 || title.length > 100) {
    return res.status(400).json({ error: 'عنوان القائمة مطلوب' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`UPDATE lists SET title = ? WHERE id = ?`, [title, listH.list_id]);
  });

  res.json(get(`SELECT * FROM lists WHERE id = ?`, [listH.list_id]));
});

router.post('/boards/:boardId(\\d+)/lists/reorder', (req, res) => {
  const board = resolveBoardHierarchy(Number(req.params.boardId));
  if (!board) return res.status(404).json({ error: 'اللوحة غير موجودة' });

  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'lists.edit', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'lists.edit',
      actionLabel: 'إعادة ترتيب قوائم اللوحة',
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const orderedIds = Array.isArray(req.body && req.body.listIds) ? req.body.listIds.map(Number) : [];
  if (!orderedIds.length) return res.status(400).json({ error: 'ترتيب القوائم غير صالح' });

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    orderedIds.forEach((lid, index) => {
      run(`UPDATE lists SET position = ? WHERE id = ? AND board_id = ?`, [index + 1, lid, board.id]);
    });
  });

  res.json({ ok: true });
});

router.delete('/lists/:id(\\d+)', (req, res) => {
  const listH = resolveListHierarchy(Number(req.params.id));
  if (!listH) return res.status(404).json({ error: 'القائمة غير موجودة' });

  const board = resolveBoardHierarchy(listH.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'lists.delete', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'lists.delete',
      actionLabel: `حذف قائمة "${listH.list_title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`DELETE FROM lists WHERE id = ?`, [listH.list_id]);
  });

  writeAudit({
    user: req.user,
    action: 'حذف قائمة مراحل',
    permissionKey: 'lists.delete',
    status: 'ALLOWED',
    req,
    details: `${listH.list_title} — ${board.title}`,
  });

  res.json({ ok: true });
});

// ==========================================
// CARDS (كروت المهام)
// ==========================================

router.get('/cards/:id(\\d+)', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: `عرض مهمة في (${board.department_name})`,
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  res.json(loadFullCardDetails(card.id));
});

router.post('/lists/:listId(\\d+)/cards', (req, res) => {
  const listH = resolveListHierarchy(Number(req.params.listId));
  if (!listH) return res.status(404).json({ error: 'القائمة غير موجودة' });

  const board = resolveBoardHierarchy(listH.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.create', {
    departmentId: board.department_id,
    boardId: board.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.create',
      actionLabel: `إضافة كارت مهمة جديد في "${board.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
    });
  }

  const title = String((req.body && req.body.title) || '').trim();
  const description = String((req.body && req.body.description) || '').trim().slice(0, 4000);
  const priority = ALLOWED_PRIORITIES.has(req.body && req.body.priority)
    ? req.body.priority
    : 'medium';
  const dueDate =
    req.body && req.body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate)
      ? req.body.dueDate
      : null;

  if (title.length < 1 || title.length > 200) {
    return res.status(400).json({ error: 'عنوان الكارت مطلوب (بحد أقصى 200 حرف)' });
  }

  let cardId;
  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    const maxPos = get(
      `SELECT COALESCE(MAX(position), 0) AS m FROM cards WHERE list_id = ?`,
      [listH.list_id]
    ).m;
    cardId = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [board.id, listH.list_id, title, description, priority, dueDate, maxPos + 1, req.user.id]
    ).lastInsertRowid;
  });

  writeAudit({
    user: req.user,
    action: 'إنشاء كارت مهمة',
    permissionKey: 'cards.create',
    status: 'ALLOWED',
    req,
    details: `${title} (${board.title})`,
  });

  res.status(201).json(loadFullCardDetails(cardId));
});

router.patch('/cards/:id(\\d+)', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.edit',
      actionLabel: `تعديل كارت "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const body = req.body || {};
  const title = body.title !== undefined ? String(body.title).trim() : card.title;
  const description =
    body.description !== undefined
      ? String(body.description).trim().slice(0, 4000)
      : card.description;
  const priority =
    body.priority !== undefined && ALLOWED_PRIORITIES.has(body.priority)
      ? body.priority
      : card.priority;
  const dueDate =
    body.dueDate === null || body.dueDate === ''
      ? null
      : body.dueDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? body.dueDate
      : card.due_date;
  const isCompleted =
    body.isCompleted !== undefined ? (body.isCompleted ? 1 : 0) : card.is_completed;
  const coverColor =
    body.coverColor === null || body.coverColor === ''
      ? null
      : body.coverColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.coverColor)
      ? body.coverColor
      : card.cover_color;

  if (title.length < 1 || title.length > 200) {
    return res.status(400).json({ error: 'عنوان الكارت مطلوب' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(
      `UPDATE cards
       SET title = ?, description = ?, priority = ?, due_date = ?, is_completed = ?, cover_color = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [title, description, priority, dueDate, isCompleted, coverColor, card.id]
    );
  });

  res.json(loadFullCardDetails(card.id));
});

// Move / Drag & Drop Card across lists or positions
router.post('/cards/:id(\\d+)/move', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.move', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.move',
      actionLabel: `نقل كارت "${card.title}" بين القوائم`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const targetListId = Number(req.body && req.body.targetListId);
  const targetIndex = Math.max(0, Number((req.body && req.body.targetIndex) ?? 0));

  const targetList = get(`SELECT * FROM lists WHERE id = ?`, [targetListId]);
  if (!targetList || Number(targetList.board_id) !== Number(card.board_id)) {
    return res.status(400).json({ error: 'القائمة المستهدفة غير صالحة أو لا تنتمي لنفس اللوحة' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);

    // Get existing cards in target list (excluding moving card)
    const siblings = all(
      `SELECT id FROM cards WHERE list_id = ? AND id != ? ORDER BY position ASC, id ASC`,
      [targetList.id, card.id]
    ).map((r) => r.id);

    const boundedIdx = Math.min(targetIndex, siblings.length);
    siblings.splice(boundedIdx, 0, card.id);

    run(`UPDATE cards SET list_id = ?, updated_at = datetime('now') WHERE id = ?`, [
      targetList.id,
      card.id,
    ]);

    siblings.forEach((cid, idx) => {
      run(`UPDATE cards SET position = ? WHERE id = ?`, [idx + 1, cid]);
    });

    // Normalize source list positions if moved across lists
    if (Number(card.list_id) !== Number(targetList.id)) {
      const oldSiblings = all(
        `SELECT id FROM cards WHERE list_id = ? ORDER BY position ASC, id ASC`,
        [card.list_id]
      );
      oldSiblings.forEach((row, idx) => {
        run(`UPDATE cards SET position = ? WHERE id = ?`, [idx + 1, row.id]);
      });
    }
  });

  writeAudit({
    user: req.user,
    action: 'نقل كارت مهمة',
    permissionKey: 'cards.move',
    status: 'ALLOWED',
    req,
    details: `${card.title} ← ${targetList.title}`,
  });

  res.json({ ok: true, card: loadFullCardDetails(card.id) });
});

// Toggle card assignee
router.post('/cards/:id(\\d+)/assignees', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.assign', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.assign',
      actionLabel: `تعيين موظف على كارت "${card.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const targetUserId = Number(req.body && req.body.userId);
  const targetUser = get(
    `SELECT u.*, EXISTS (
       SELECT 1 FROM role_permissions rp WHERE rp.role_id = u.role_id AND rp.permission_key = 'boards.view_all'
     ) AS has_view_all
     FROM users u WHERE u.id = ? AND u.is_active = 1`,
    [targetUserId]
  );
  if (!targetUser) {
    return res.status(404).json({ error: 'الموظف غير موجود أو غير نشط' });
  }
  if (Number(targetUser.department_id) !== Number(board.department_id) && !targetUser.has_view_all) {
    return res.status(400).json({ error: 'لا يمكن تعيين موظف من خارج القسم المختص على هذه المهمة' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    const exists = get(
      `SELECT 1 AS ok FROM card_assignees WHERE card_id = ? AND user_id = ?`,
      [card.id, targetUser.id]
    );
    if (exists) {
      run(`DELETE FROM card_assignees WHERE card_id = ? AND user_id = ?`, [
        card.id,
        targetUser.id,
      ]);
    } else {
      run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [
        card.id,
        targetUser.id,
      ]);
      if (targetUser.id !== req.user.id) {
        run(
          `INSERT INTO notifications (user_id, type, title, message, link_board_id)
           VALUES (?, 'card_assigned', 'مهمة جديدة مسندة إليك', ?, ?)`,
          [
            targetUser.id,
            `قام ${req.user.full_name} بتعيينك على مهمة "${card.title}" في لوحة "${board.title}".`,
            board.id,
          ]
        );
      }
    }
  });

  res.json(loadFullCardDetails(card.id));
});

// Toggle card label
router.post('/cards/:id(\\d+)/labels', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.edit',
      actionLabel: `تعديل تصنيفات كارت "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const labelId = Number(req.body && req.body.labelId);
  const label = get(`SELECT * FROM board_labels WHERE id = ? AND board_id = ?`, [
    labelId,
    board.id,
  ]);
  if (!label) {
    return res.status(400).json({ error: 'التصنيف غير صالح لهذه اللوحة' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    const exists = get(
      `SELECT 1 AS ok FROM card_label_links WHERE card_id = ? AND label_id = ?`,
      [card.id, label.id]
    );
    if (exists) {
      run(`DELETE FROM card_label_links WHERE card_id = ? AND label_id = ?`, [
        card.id,
        label.id,
      ]);
    } else {
      run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [
        card.id,
        label.id,
      ]);
    }
  });

  res.json(loadFullCardDetails(card.id));
});

// Checklist items
router.post('/cards/:id(\\d+)/checklist', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.edit',
      actionLabel: `إضافة مهمة فرعية في "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const title = String((req.body && req.body.title) || '').trim();
  if (!title || title.length > 200) {
    return res.status(400).json({ error: 'نص العنصر الفرعي مطلوب' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    const maxPos = get(
      `SELECT COALESCE(MAX(position), 0) AS m FROM checklist_items WHERE card_id = ?`,
      [card.id]
    ).m;
    run(`INSERT INTO checklist_items (card_id, title, position) VALUES (?, ?, ?)`, [
      card.id,
      title,
      maxPos + 1,
    ]);
  });

  res.status(201).json(loadFullCardDetails(card.id));
});

router.patch('/checklist/:itemId(\\d+)', (req, res) => {
  const item = get(`SELECT * FROM checklist_items WHERE id = ?`, [Number(req.params.itemId)]);
  if (!item) return res.status(404).json({ error: 'العنصر غير موجود' });

  const card = resolveCardHierarchy(item.card_id);
  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.edit',
      actionLabel: `تحديث قائمة التحقق في "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const isChecked =
    req.body && req.body.isChecked !== undefined
      ? req.body.isChecked
        ? 1
        : 0
      : item.is_checked;
  const title =
    req.body && req.body.title !== undefined
      ? String(req.body.title).trim()
      : item.title;

  if (!title) return res.status(400).json({ error: 'عنوان العنصر مطلوب' });

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`UPDATE checklist_items SET title = ?, is_checked = ? WHERE id = ?`, [
      title,
      isChecked,
      item.id,
    ]);
  });

  res.json(loadFullCardDetails(card.id));
});

router.delete('/checklist/:itemId(\\d+)', (req, res) => {
  const item = get(`SELECT * FROM checklist_items WHERE id = ?`, [Number(req.params.itemId)]);
  if (!item) return res.status(404).json({ error: 'العنصر غير موجود' });

  const card = resolveCardHierarchy(item.card_id);
  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.edit', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.edit',
      actionLabel: `حذف عنصر من قائمة التحقق في "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`DELETE FROM checklist_items WHERE id = ?`, [item.id]);
  });

  res.json(loadFullCardDetails(card.id));
});

// Delete Card
router.delete('/cards/:id(\\d+)', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'cards.delete', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'cards.delete',
      actionLabel: `حذف كارت "${card.title}"`,
      scopeType: 'card',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`DELETE FROM cards WHERE id = ?`, [card.id]);
  });

  writeAudit({
    user: req.user,
    action: 'حذف كارت مهمة',
    permissionKey: 'cards.delete',
    status: 'ALLOWED',
    req,
    details: `${card.title} (${board.title})${permCheck.viaGrant ? ' [بتصريح استثنائي من المدير]' : ''}`,
  });

  res.json({ ok: true, consumedGrant: Boolean(permCheck.viaGrant) });
});

// ==========================================
// COMMENTS (التعليقات)
// ==========================================

router.post('/cards/:cardId(\\d+)/comments', (req, res) => {
  const card = resolveCardHierarchy(Number(req.params.cardId));
  if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

  const board = resolveBoardHierarchy(card.board_id);
  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const permCheck = evaluatePermission(req.user, 'comments.create', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!permCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'comments.create',
      actionLabel: `إضافة تعليق على كارت "${card.title}"`,
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  const body = String((req.body && req.body.body) || '').trim();
  if (!body || body.length > 2000) {
    return res.status(400).json({ error: 'نص التعليق مطلوب (بحد أقصى 2000 حرف)' });
  }

  transaction(() => {
    consumeGrantIfOneTime(permCheck.viaGrant);
    run(`INSERT INTO card_comments (card_id, user_id, body) VALUES (?, ?, ?)`, [
      card.id,
      req.user.id,
      body,
    ]);
  });

  res.status(201).json(loadFullCardDetails(card.id));
});

router.delete('/comments/:id(\\d+)', (req, res) => {
  const comment = get(`SELECT * FROM card_comments WHERE id = ?`, [Number(req.params.id)]);
  if (!comment) return res.status(404).json({ error: 'التعليق غير موجود' });

  const card = resolveCardHierarchy(comment.card_id);
  const board = resolveBoardHierarchy(card.board_id);

  if (!canAccessBoard(req.user, board).allowed) {
    return denyPermission(req, res, {
      permissionKey: 'boards.view_department',
      actionLabel: 'الوصول للوحة',
      scopeType: 'department',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  // Own comment can be deleted if user has comments.create; others' comments require comments.delete_any
  if (Number(comment.user_id) === Number(req.user.id)) {
    const ownCheck = evaluatePermission(req.user, 'comments.create', {
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
    if (!ownCheck.allowed) {
      return denyPermission(req, res, {
        permissionKey: 'comments.create',
        actionLabel: 'حذف التعليق',
        scopeType: 'board',
        departmentId: board.department_id,
        boardId: board.id,
        cardId: card.id,
      });
    }
    run(`DELETE FROM card_comments WHERE id = ?`, [comment.id]);
    return res.json(loadFullCardDetails(card.id));
  }

  const modCheck = evaluatePermission(req.user, 'comments.delete_any', {
    departmentId: board.department_id,
    boardId: board.id,
    cardId: card.id,
  });
  if (!modCheck.allowed) {
    return denyPermission(req, res, {
      permissionKey: 'comments.delete_any',
      actionLabel: 'حذف تعليق موظف آخر',
      scopeType: 'board',
      departmentId: board.department_id,
      boardId: board.id,
      cardId: card.id,
    });
  }

  transaction(() => {
    consumeGrantIfOneTime(modCheck.viaGrant);
    run(`DELETE FROM card_comments WHERE id = ?`, [comment.id]);
  });

  res.json(loadFullCardDetails(card.id));
});

module.exports = router;
