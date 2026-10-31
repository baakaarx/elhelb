const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get, all, run, initSchema, getSetting, setSetting } = require('./db');

const EPHEMERAL_DEV_JWT_SECRET = crypto.randomBytes(48).toString('hex');

function getJwtSecret() {
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (envSecret) {
    if (process.env.NODE_ENV === 'production' && envSecret.length < 32) {
      throw new Error(
        'FATAL SECURITY ERROR: JWT_SECRET must be at least 32 characters in production.'
      );
    }
    return envSecret;
  }

  // Zero-config serverless cloud provisioning on Vercel when JWT_SECRET wasn't entered in dashboard:
  // Generates a 384-bit CSPRNG secret stored in encrypted/redacted system_settings (synced across cloud containers).
  if (process.env.VERCEL) {
    try {
      const existing = getSetting('internal_jwt_secret_v19', '');
      if (existing && existing.length >= 64) {
        return existing;
      }
    } catch (_) {
      initSchema();
    }
    const afterInit = getSetting('internal_jwt_secret_v19', '');
    if (afterInit && afterInit.length >= 64) {
      return afterInit;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    setSetting('internal_jwt_secret_v19', generated);
    return generated;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL SECURITY ERROR: JWT_SECRET environment variable (min 32 chars, separate from storage tokens) is required in production.'
    );
  }

  return EPHEMERAL_DEV_JWT_SECRET;
}

// Fail fast at module load on dedicated non-Vercel production servers if JWT_SECRET is missing
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  getJwtSecret();
}
const COOKIE_NAME = 'elhelb_session_v10';
const LEGACY_COOKIE_NAMES = ['elhelb_session'];

const GLOBAL_PERMISSIONS = new Set([
  'boards.view_all',
  'requests.review_all',
  'users.manage',
  'roles.manage',
  'departments.manage',
  'audit.view',
]);

function isSecureRequest(req) {
  if (!req) return false;
  if (req.secure) return true;
  if (req.app && req.app.get('trust proxy')) {
    const proto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return proto === 'https';
  }
  return false;
}

function signUserToken(user) {
  return jwt.sign(
    {
      uid: Number(user.id),
      uname: String(user.username || '').trim().toLowerCase(),
      tv: Number(user.token_version || 1),
      jti: crypto.randomUUID(),
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '12h' }
  );
}

function revokeTokenPayload(payload) {
  if (!payload || typeof payload.jti !== 'string' || !payload.jti) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = Number.isFinite(Number(payload.exp))
    ? Number(payload.exp)
    : nowSec + 12 * 3600;
  try {
    run(`DELETE FROM revoked_tokens WHERE expires_epoch <= ?`, [nowSec]);
    run(
      `INSERT OR IGNORE INTO revoked_tokens (jti, expires_epoch) VALUES (?, ?)`,
      [payload.jti.slice(0, 64), expSec]
    );
  } catch (_) {}
}

function isTokenJtiRevoked(jti) {
  if (!jti || typeof jti !== 'string') return false;
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const row = get(
      `SELECT 1 AS revoked FROM revoked_tokens WHERE jti = ? AND expires_epoch > ?`,
      [jti, nowSec]
    );
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

const SAFE_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractCandidateTokens(req) {
  const candidates = [];
  const customHeader = req.headers['x-elhelb-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    candidates.push({ token: customHeader.trim(), source: 'header' });
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) candidates.push({ token: bearer, source: 'header' });
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    candidates.push({ token: String(req.cookies[COOKIE_NAME]).trim(), source: 'cookie' });
  }
  // Never accept session tokens via URL query string (prevents log/Referer token leakage)
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

  const activeJwtSecret = getJwtSecret();
  let payload = null;
  let verifiedSource = null;
  for (const item of candidates) {
    try {
      const decoded = jwt.verify(item.token, activeJwtSecret, { algorithms: ['HS256'] });
      if (decoded && decoded.jti && isTokenJtiRevoked(decoded.jti)) {
        continue;
      }
      payload = decoded;
      verifiedSource = item.source;
      break;
    } catch (_) {
      // Try next candidate token in case a proxy injected an unrelated header
    }
  }

  if (!payload || !payload.uid || typeof payload.uname !== 'string' || !payload.uname) {
    for (const oldName of LEGACY_COOKIE_NAMES) res.clearCookie(oldName);
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({
      error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى',
      code: 'INVALID_TOKEN',
    });
  }

  // Strict CSRF Defense: state-changing requests MUST include an explicit custom/Bearer header
  // (cross-origin forms/subdomains cannot attach custom headers without CORS preflight approval)
  if (!SAFE_READ_METHODS.has(String(req.method || '').toUpperCase()) && verifiedSource !== 'header') {
    return res.status(403).json({
      error: 'تم رفض الطلب لحماية الجلسة من التزوير العابر للمواقع (CSRF) — يرجى التحديث وإعادة المحاولة',
      code: 'CSRF_BLOCKED',
    });
  }

  const user = loadUserById(payload.uid);
  if (
    !user ||
    Number(user.token_version) !== Number(payload.tv) ||
    String(user.username || '').trim().toLowerCase() !== payload.uname.trim().toLowerCase()
  ) {
    for (const oldName of LEGACY_COOKIE_NAMES) res.clearCookie(oldName);
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({
      error: 'تم تحديث بيانات الحساب أو إيقافه، يرجى تسجيل الدخول مجدداً',
      code: 'SESSION_REVOKED',
    });
  }

  req.user = user;
  req.tokenPayload = payload;
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

function isChairmanExclusiveDepartment(departmentId, preloadedFlag = undefined) {
  if (preloadedFlag !== undefined && preloadedFlag !== null) {
    return Boolean(Number(preloadedFlag));
  }
  if (!departmentId) return false;
  const row = get(`SELECT is_chairman_exclusive FROM departments WHERE id = ?`, [
    Number(departmentId),
  ]);
  return Boolean(row && Number(row.is_chairman_exclusive));
}

/**
 * Checks whether user can view a specific board (or department).
 */
function canAccessBoard(user, board) {
  if (!board) return { allowed: false, viaGrant: null };
  const isExclusive = isChairmanExclusiveDepartment(
    board.department_id,
    board.department_chairman_exclusive
  );

  if (user.permissionSet.has('boards.view_all') && (!isExclusive || user.role_slug === 'chairman')) {
    return { allowed: true, viaGrant: null };
  }
  if (
    user.department_id &&
    Number(user.department_id) === Number(board.department_id) &&
    user.permissionSet.has('boards.view_department')
  ) {
    return { allowed: true, viaGrant: null };
  }

  // Check active temporary grant explicitly authorizing viewing this board or its department
  const viewGrant = findMatchingGrant(user, 'boards.view_department', {
    departmentId: board.department_id,
    boardId: board.id,
  });

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
  const {
    departmentId = null,
    boardId = null,
    cardId = null,
    departmentChairmanExclusive = undefined,
  } = target;

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
  const isExclusive =
    departmentId !== null
      ? isChairmanExclusiveDepartment(departmentId, departmentChairmanExclusive)
      : false;
  const hasCompanyWideScope =
    user.permissionSet.has('boards.view_all') &&
    (!isExclusive || user.role_slug === 'chairman');
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

function detectExclusiveAuditScope({ user, req, details, action, departmentId, isChairmanExclusive }) {
  if (isChairmanExclusive) return 1;
  if (departmentId && isChairmanExclusiveDepartment(departmentId)) return 1;
  if (
    user &&
    user.onboarding_status === 'approved' &&
    user.department_id &&
    isChairmanExclusiveDepartment(user.department_id)
  ) {
    return 1;
  }

  const cleanPath = req ? String(req.originalUrl || req.url || '').split('?')[0] : '';
  if (cleanPath.startsWith('/api/admin/backup')) return 1;

  let m = cleanPath.match(/^\/api\/boards\/(\d+)\b/);
  if (m) {
    const b = resolveBoardHierarchy(Number(m[1]));
    if (b && Number(b.department_chairman_exclusive)) return 1;
  }
  m = cleanPath.match(/^\/api\/lists\/(\d+)\b/);
  if (m) {
    const l = resolveListHierarchy(Number(m[1]));
    if (l && Number(l.department_chairman_exclusive)) return 1;
  }
  m = cleanPath.match(/^\/api\/cards\/(\d+)\b/);
  if (m) {
    const c = resolveCardHierarchy(Number(m[1]));
    if (c && Number(c.department_chairman_exclusive)) return 1;
  }

  const exclusiveDepts = all(`SELECT id, name FROM departments WHERE is_chairman_exclusive = 1`);
  if (exclusiveDepts.length > 0) {
    const combinedText = `${action || ''} ${details || ''}`;
    for (const d of exclusiveDepts) {
      if (d.name && combinedText.includes(d.name)) return 1;
    }
    const exclusiveBoards = all(
      `SELECT b.title FROM boards b JOIN departments d ON d.id = b.department_id WHERE d.is_chairman_exclusive = 1`
    );
    for (const b of exclusiveBoards) {
      if (b.title && combinedText.includes(b.title)) return 1;
    }
  }

  return 0;
}

function writeAudit({
  user = null,
  actorName = 'زائر',
  action,
  permissionKey = '',
  status = 'ALLOWED',
  req = null,
  details = '',
  departmentId = null,
  isChairmanExclusive = false,
}) {
  try {
    const cleanEndpoint = req
      ? String(req.originalUrl || req.url || '')
          .split('?')[0]
          .slice(0, 240)
      : '';
    const exclusiveFlag = detectExclusiveAuditScope({
      user,
      req,
      details,
      action,
      departmentId,
      isChairmanExclusive,
    });

    run(
      `INSERT INTO audit_logs (
        actor_id, actor_name, actor_role, department_name,
        action, permission_key, status, method, endpoint, details, ip, is_chairman_exclusive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user ? user.id : null,
        user ? user.full_name : actorName,
        user ? user.role_name : '',
        user ? user.department_name || 'الإدارة العليا' : '',
        action,
        permissionKey,
        status,
        req ? req.method : '',
        cleanEndpoint,
        details,
        req ? req.ip || '' : '',
        exclusiveFlag,
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
  const dept = departmentId
    ? get(`SELECT id, name, is_chairman_exclusive FROM departments WHERE id = ?`, [departmentId])
    : null;
  const isHiddenExclusive = Boolean(
    dept &&
      Number(dept.is_chairman_exclusive) &&
      req.user.role_slug !== 'chairman' &&
      Number(req.user.department_id) !== Number(dept.id)
  );
  if (isHiddenExclusive) {
    canRequestElevation = false;
  }
  // IMPORTANT: Do NOT leak private board/card titles if user cannot view that board!
  let safeBoardTitle = null;
  let safeCardTitle = null;
  if (boardId) {
    const board = resolveBoardHierarchy(boardId);
    if (board && canAccessBoard(req.user, board).allowed) {
      safeBoardTitle = board.title;
      if (cardId) {
        const card = get(`SELECT id, title FROM cards WHERE id = ? AND board_id = ?`, [cardId, board.id]);
        if (card) safeCardTitle = card.title;
      }
    }
  }

  const safeDeptLabel = isHiddenExclusive ? 'قسم خاص بمكتب رئيس مجلس الإدارة' : dept ? dept.name : null;

  const message =
    customMessage ||
    (isHiddenExclusive
      ? 'حماية سيادية: هذا القسم خاص ومرتبط مباشرةً برئيس مجلس الإدارة فقط'
      : `تم رفض الطلب من السيرفر: لا تملك صلاحية "${perm ? perm.name : permissionKey}"${
          dept && (!req.user.department_id || Number(req.user.department_id) !== Number(dept.id))
            ? ` على (${dept.name})`
            : ''
        }`);

  writeAudit({
    user: req.user,
    action: `رفض صلاحية: ${actionLabel}`,
    permissionKey,
    status: 'DENIED',
    req,
    details: `${perm ? perm.name : permissionKey}${safeDeptLabel ? ' — ' + safeDeptLabel : ''}`,
    departmentId: dept ? dept.id : departmentId,
  });

  return res.status(403).json({
    error: message,
    code: 'PERMISSION_DENIED',
    missingPermission: permissionKey,
    permissionName: perm ? perm.name : permissionKey,
    permissionDescription: perm ? perm.description : '',
    actionLabel,
    scopeType,
    targetDepartmentId: isHiddenExclusive ? null : dept ? dept.id : departmentId,
    targetDepartmentName: safeDeptLabel,
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
    `SELECT b.*,
            d.name AS department_name,
            d.color AS department_color,
            d.slug AS department_slug,
            d.is_chairman_exclusive AS department_chairman_exclusive
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
            d.name AS department_name,
            d.is_chairman_exclusive AS department_chairman_exclusive
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
            d.name AS department_name,
            d.is_chairman_exclusive AS department_chairman_exclusive
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

const COMMON_WEAK_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '9876543210',
  '12345678910',
  '1111111111',
  '0000000000',
  'password123',
  'password1234',
  'qwerty12345',
  'qwertyuiop',
  'admin12345',
  'admin123456',
  'welcome123',
  'welcome1234',
  'elhelb1234',
  'abcdefghij',
]);

function validatePasswordStrength(password, username = '') {
  const raw = String(password || '');
  if (raw.length < 10 || raw.length > 128) {
    return 'كلمة المرور يجب أن تتكون من 10 إلى 128 حرفاً أو رقماً على الأقل لتأمين الحساب';
  }
  const lower = raw.toLowerCase();
  const cleanUser = String(username || '').trim().toLowerCase();
  if (
    COMMON_WEAK_PASSWORDS.has(lower) ||
    /^(.)\1+$/.test(raw) ||
    (cleanUser.length >= 3 && lower === cleanUser)
  ) {
    return 'كلمة المرور المختارة شائعة أو سهلة التخمين — يرجى اختيار كلمة مرور أقوى';
  }
  return null;
}

const RESERVED_TITLE_PATTERNS = [
  /رئيس\s*مجلس/,
  /رييس\s*مجلس/,
  /مجلس\s*ال[اإآ]دار[هة]/,
  /المدير\s*العام/,
  /\bchairman\b/i,
  /\bsuper\s*admin\b/i,
  /\bsystem\s*admin\b/i,
];

function sanitizeDisplayText(str, maxLen = 100) {
  return String(str || '')
    .replace(/[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function validateEmployeeFullName(fullName, { allowExecutiveTitles = false, minLen = 2 } = {}) {
  const clean = sanitizeDisplayText(fullName, 100);
  if (clean.length < minLen || clean.length > 100) {
    return {
      ok: false,
      clean,
      error: `يرجى كتابة الاسم الكامل للموظف (${minLen} إلى 100 حرف)`,
    };
  }
  if (!allowExecutiveTitles) {
    for (const rx of RESERVED_TITLE_PATTERNS) {
      if (rx.test(clean)) {
        return {
          ok: false,
          clean,
          error: 'الاسم المدخل يحتوي على مسمى سيادي محجوز — يرجى كتابة اسمك الشخصي الثلاثي الحقيقي',
        };
      }
    }
  }
  return { ok: true, clean, error: null };
}

function deriveSettingsVaultKey() {
  const seedMaterial = (process.env.SETTINGS_ENCRYPTION_KEY || getJwtSecret() || '').trim();
  return crypto
    .createHmac('sha256', seedMaterial)
    .update('elhelb-settings-vault-v17')
    .digest();
}

function encryptSecretValue(plaintext) {
  const raw = String(plaintext ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('enc:v1:')) return raw;
  const key = deriveSettingsVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecretValue(storedValue) {
  const raw = String(storedValue ?? '').trim();
  if (!raw) return '';
  if (!raw.startsWith('enc:v1:')) return raw;
  const parts = raw.split(':');
  if (parts.length !== 5) return '';
  try {
    const iv = Buffer.from(parts[2], 'base64');
    const authTag = Buffer.from(parts[3], 'base64');
    const ciphertext = Buffer.from(parts[4], 'base64');
    const key = deriveSettingsVaultKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = {
  get JWT_SECRET() {
    return getJwtSecret();
  },
  getJwtSecret,
  COOKIE_NAME,
  LEGACY_COOKIE_NAMES,
  GLOBAL_PERMISSIONS,
  isSecureRequest,
  extractCandidateTokens,
  sanitizeDisplayText,
  validateEmployeeFullName,
  validatePasswordStrength,
  encryptSecretValue,
  decryptSecretValue,
  signUserToken,
  revokeTokenPayload,
  loadUserById,
  getActiveGrantsForUser,
  authenticate,
  userHasPermission,
  isChairmanExclusiveDepartment,
  canAccessBoard,
  evaluatePermission,
  consumeGrantIfOneTime,
  writeAudit,
  denyPermission,
  resolveBoardHierarchy,
  resolveListHierarchy,
  resolveCardHierarchy,
};
