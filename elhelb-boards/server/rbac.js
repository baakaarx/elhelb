const jwt = require('jsonwebtoken');
const { get, all, run } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'elhelb-enterprise-rbac-secret-2026-v1';
const COOKIE_NAME = 'elhelb_session';

const GLOBAL_PERMISSIONS = new Set([
  'boards.view_all',
  'requests.review_all',
  'users.manage',
  'roles.manage',
  'departments.manage',
  'audit.view',
]);

function signUserToken(user) {
  return jwt.sign(
    { uid: user.id, tv: user.token_version },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function extractCandidateTokens(req) {
  const candidates = [];
  const customHeader = req.headers['x-elhelb-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    candidates.push(customHeader.trim());
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) candidates.push(bearer);
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    candidates.push(String(req.cookies[COOKIE_NAME]).trim());
  }
  if (req.query && typeof req.query._t === 'string' && req.query._t.trim()) {
    candidates.push(req.query._t.trim());
  }
  return candidates;
}

function getActiveGrantsForUser(userId) {
  return all(
    `SELECT g.*,
            p.name AS permission_name,
            d.name AS department_name,
            b.title AS board_title,
            c.title AS card_title,
            u.full_name AS granted_by_name
     FROM permission_grants g
     JOIN permissions p ON p.key = g.permission_key
     LEFT JOIN departments d ON d.id = g.target_department_id
     LEFT JOIN boards b ON b.id = g.target_board_id
     LEFT JOIN cards c ON c.id = g.target_card_id
     LEFT JOIN users u ON u.id = g.granted_by
     WHERE g.user_id = ?
       AND g.is_revoked = 0
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))
       AND (g.uses_remaining IS NULL OR g.uses_remaining > 0)
     ORDER BY g.id DESC`,
    [userId]
  );
}

function loadUserById(userId) {
  const user = get(
    `SELECT u.id, u.username, u.email, u.full_name, u.job_title, u.avatar_color, u.avatar_url,
            u.auth_provider, u.email_verified, u.has_custom_credentials, u.department_confirmed,
            u.onboarding_status, u.preferred_department_id,
            u.role_id, u.department_id, u.is_active, u.token_version,
            r.slug AS role_slug, r.name AS role_name, r.color AS role_color, r.rank_level AS role_rank,
            d.slug AS department_slug, d.name AS department_name, d.color AS department_color,
            pd.name AS preferred_department_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN departments pd ON pd.id = u.preferred_department_id
     WHERE u.id = ?`,
    [userId]
  );
  if (!user || !user.is_active) return null;

  // Users waiting in onboarding room have ZERO permissions until assigned by a Department Head / Admin
  if (user.onboarding_status === 'pending') {
    return {
      ...user,
      roleRank: 0,
      permissions: [],
      permissionSet: new Set(),
      activeGrants: [],
    };
  }

  const permRows = all(
    `SELECT permission_key FROM role_permissions WHERE role_id = ?`,
    [user.role_id]
  );
  const permissions = permRows.map((r) => r.permission_key);
  const activeGrants = getActiveGrantsForUser(user.id);

  return {
    ...user,
    roleRank: Number(user.role_rank || 0),
    permissions,
    permissionSet: new Set(permissions),
    activeGrants,
  };
}

function authenticate(req, res, next) {
  const candidates = extractCandidateTokens(req);
  if (candidates.length === 0) {
    return res.status(401).json({
      error: 'يرجى تسجيل الدخول أولاً للوصول إلى النظام',
      code: 'UNAUTHENTICATED',
    });
  }

  let payload = null;
  for (const token of candidates) {
    try {
      payload = jwt.verify(token, JWT_SECRET);
      break;
    } catch (_) {
      // Try next candidate token in case a proxy injected an unrelated header
    }
  }

  if (!payload) {
    return res.status(401).json({
      error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى',
      code: 'INVALID_TOKEN',
    });
  }

  const user = loadUserById(payload.uid);
  if (!user || user.token_version !== payload.tv) {
    return res.status(401).json({
      error: 'تم تحديث بيانات الحساب أو إيقافه، يرجى تسجيل الدخول مجدداً',
      code: 'SESSION_REVOKED',
    });
  }

  req.user = user;
  next();
}

function findMatchingGrant(user, permissionKey, target = {}) {
  const { departmentId = null, boardId = null, cardId = null } = target;
  // Prefer narrowest grant first (card -> board -> department) so specific one-time grants consume cleanly
  const scopePriority = { card: 1, board: 2, department: 3 };
  const candidates = user.activeGrants
    .filter((g) => g.permission_key === permissionKey)
    .sort((a, b) => (scopePriority[a.scope_type] || 9) - (scopePriority[b.scope_type] || 9));

  for (const g of candidates) {
    if (g.scope_type === 'card') {
      if (cardId !== null && Number(g.target_card_id) === Number(cardId)) return g;
    } else if (g.scope_type === 'board') {
      if (boardId !== null && Number(g.target_board_id) === Number(boardId)) return g;
    } else if (g.scope_type === 'department') {
      if (g.target_department_id === null) return g;
      if (departmentId !== null && Number(g.target_department_id) === Number(departmentId)) return g;
    }
  }
  return null;
}

/**
 * Checks whether user can view a specific board (or department).
 */
function canAccessBoard(user, board) {
  if (!board) return { allowed: false, viaGrant: null };
  if (user.permissionSet.has('boards.view_all')) {
    return { allowed: true, viaGrant: null };
  }
  if (
    user.department_id &&
    Number(user.department_id) === Number(board.department_id) &&
    user.permissionSet.has('boards.view_department')
  ) {
    return { allowed: true, viaGrant: null };
  }

  // Check active temporary grant for viewing this board or its department
  const viewGrant =
    findMatchingGrant(user, 'boards.view_department', {
      departmentId: board.department_id,
      boardId: board.id,
    }) ||
    // Also allow viewing the board if user holds a board-specific action grant on this exact board
    user.activeGrants.find(
      (g) =>
        (g.scope_type === 'board' && Number(g.target_board_id) === Number(board.id)) ||
        (g.scope_type === 'department' &&
          Number(g.target_department_id) === Number(board.department_id) &&
          g.permission_key === 'boards.view_department')
    );

  if (viewGrant) {
    return { allowed: true, viaGrant: viewGrant };
  }
  return { allowed: false, viaGrant: null };
}

/**
 * Core server-side authorization evaluator.
 * Every mutating or reading route MUST verify permissions through this function.
 */
function evaluatePermission(user, permissionKey, target = {}) {
  const { departmentId = null, boardId = null, cardId = null } = target;

  // Global permissions (not tied to a single department)
  if (GLOBAL_PERMISSIONS.has(permissionKey)) {
    if (user.permissionSet.has(permissionKey)) {
      return { allowed: true, viaGrant: null };
    }
    const grant = findMatchingGrant(user, permissionKey, target);
    if (grant) return { allowed: true, viaGrant: grant };
    return { allowed: false, viaGrant: null };
  }

  // Scoped permissions (Boards, Lists, Cards, Comments, Department Requests)
  const hasCompanyWideScope = user.permissionSet.has('boards.view_all');
  const isOwnDepartment =
    departmentId !== null &&
    user.department_id !== null &&
    Number(user.department_id) === Number(departmentId);

  if (hasCompanyWideScope || isOwnDepartment) {
    if (user.permissionSet.has(permissionKey)) {
      return { allowed: true, viaGrant: null };
    }
  }

  // Fallback: check active manager-approved grant matching exact target scope
  const grant = findMatchingGrant(user, permissionKey, {
    departmentId,
    boardId,
    cardId,
  });
  if (grant) {
    return { allowed: true, viaGrant: grant };
  }

  return { allowed: false, viaGrant: null };
}

function consumeGrantIfOneTime(grant) {
  if (!grant || grant.uses_remaining === null || grant.uses_remaining === undefined) {
    return;
  }
  const updated = run(
    `UPDATE permission_grants
     SET uses_remaining = uses_remaining - 1
     WHERE id = ? AND uses_remaining > 0 AND is_revoked = 0`,
    [grant.id]
  );
  if (updated.changes === 0) {
    const err = new Error('GRANT_EXHAUSTED');
    err.statusCode = 403;
    throw err;
  }
}

function writeAudit({
  user = null,
  actorName = 'زائر',
  action,
  permissionKey = '',
  status = 'ALLOWED',
  req = null,
  details = '',
}) {
  try {
    run(
      `INSERT INTO audit_logs (
        actor_id, actor_name, actor_role, department_name,
        action, permission_key, status, method, endpoint, details, ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user ? user.id : null,
        user ? user.full_name : actorName,
        user ? user.role_name : '',
        user ? user.department_name || 'الإدارة العليا' : '',
        action,
        permissionKey,
        status,
        req ? req.method : '',
        req ? req.originalUrl : '',
        details,
        req ? req.ip || '' : '',
      ]
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

function denyPermission(req, res, {
  permissionKey,
  actionLabel = 'تنفيذ هذا الإجراء',
  scopeType = 'department',
  departmentId = null,
  boardId = null,
  cardId = null,
  customMessage = null,
  canRequestElevation = true,
}) {
  const perm = get(`SELECT key, name, description FROM permissions WHERE key = ?`, [permissionKey]);
  const dept = departmentId ? get(`SELECT id, name FROM departments WHERE id = ?`, [departmentId]) : null;
  // IMPORTANT: Do NOT leak private board/card titles if user cannot view that board!
  let safeBoardTitle = null;
  let safeCardTitle = null;
  if (boardId) {
    const board = get(`SELECT id, title, department_id FROM boards WHERE id = ?`, [boardId]);
    if (board && canAccessBoard(req.user, board).allowed) {
      safeBoardTitle = board.title;
      if (cardId) {
        const card = get(`SELECT id, title FROM cards WHERE id = ? AND board_id = ?`, [cardId, board.id]);
        if (card) safeCardTitle = card.title;
      }
    }
  }

  const message =
    customMessage ||
    `تم رفض الطلب من السيرفر: لا تملك صلاحية "${perm ? perm.name : permissionKey}"${
      dept && (!req.user.department_id || Number(req.user.department_id) !== Number(dept.id))
        ? ` على (${dept.name})`
        : ''
    }`;

  writeAudit({
    user: req.user,
    action: `رفض صلاحية: ${actionLabel}`,
    permissionKey,
    status: 'DENIED',
    req,
    details: `${perm ? perm.name : permissionKey}${dept ? ' — ' + dept.name : ''}`,
  });

  return res.status(403).json({
    error: message,
    code: 'PERMISSION_DENIED',
    missingPermission: permissionKey,
    permissionName: perm ? perm.name : permissionKey,
    permissionDescription: perm ? perm.description : '',
    actionLabel,
    scopeType,
    targetDepartmentId: dept ? dept.id : departmentId,
    targetDepartmentName: dept ? dept.name : null,
    targetBoardId: safeBoardTitle ? boardId : null,
    targetBoardTitle: safeBoardTitle,
    targetCardId: safeCardTitle ? cardId : null,
    targetCardTitle: safeCardTitle,
    canRequestElevation,
  });
}

/**
 * Resolves full hierarchy from DB for a boardId, listId, or cardId
 * so client input can NEVER spoof parent board or department!
 */
function resolveBoardHierarchy(boardId) {
  return get(
    `SELECT b.*, d.name AS department_name, d.color AS department_color, d.slug AS department_slug
     FROM boards b
     JOIN departments d ON d.id = b.department_id
     WHERE b.id = ?`,
    [boardId]
  );
}

function resolveListHierarchy(listId) {
  return get(
    `SELECT l.id AS list_id, l.title AS list_title, l.position AS list_position, l.board_id,
            b.title AS board_title, b.department_id, b.background,
            d.name AS department_name
     FROM lists l
     JOIN boards b ON b.id = l.board_id
     JOIN departments d ON d.id = b.department_id
     WHERE l.id = ?`,
    [listId]
  );
}

function resolveCardHierarchy(cardId) {
  return get(
    `SELECT c.*, l.title AS list_title,
            b.title AS board_title, b.department_id,
            d.name AS department_name
     FROM cards c
     JOIN lists l ON l.id = c.list_id
     JOIN boards b ON b.id = c.board_id
     JOIN departments d ON d.id = b.department_id
     WHERE c.id = ?`,
    [cardId]
  );
}

function userHasPermission(user, permissionKey) {
  return Boolean(user && user.permissionSet && user.permissionSet.has(permissionKey));
}

module.exports = {
  JWT_SECRET,
  COOKIE_NAME,
  GLOBAL_PERMISSIONS,
  signUserToken,
  loadUserById,
  getActiveGrantsForUser,
  authenticate,
  userHasPermission,
  canAccessBoard,
  evaluatePermission,
  consumeGrantIfOneTime,
  writeAudit,
  denyPermission,
  resolveBoardHierarchy,
  resolveListHierarchy,
  resolveCardHierarchy,
};
