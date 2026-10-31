const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'elhelb-boards-prod-v8.db');
  }
  const defaultDataDir = path.join(__dirname, '..', 'data');
  try {
    if (!fs.existsSync(defaultDataDir)) {
      fs.mkdirSync(defaultDataDir, { recursive: true });
    }
    return path.join(defaultDataDir, 'elhelb-boards.db');
  } catch (_) {
    return path.join(os.tmpdir(), 'elhelb-boards-prod-v8.db');
  }
}

const DB_PATH = resolveDbPath();
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

function normalizeParam(val) {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

function get(sql, params = []) {
  const row = db.prepare(sql).get(...params.map(normalizeParam));
  return row ? { ...row } : null;
}

function all(sql, params = []) {
  const rows = db.prepare(sql).all(...params.map(normalizeParam));
  return rows.map((r) => ({ ...r }));
}

let localWriteCounter = 0;
let coreWriteCounter = 0;
let suppressWriteTracking = false;

function runUntracked(fn) {
  const prev = suppressWriteTracking;
  suppressWriteTracking = true;
  try {
    return fn();
  } finally {
    suppressWriteTracking = prev;
  }
}

function getWriteCounters() {
  return {
    total: localWriteCounter,
    core: coreWriteCounter,
  };
}

function run(sql, params = []) {
  const res = db.prepare(sql).run(...params.map(normalizeParam));
  const changes = Number(res.changes);
  if (!suppressWriteTracking && changes > 0) {
    localWriteCounter += 1;
    const trimmed = String(sql || '').trim();
    const isAuxLogOnly =
      /^(INSERT|UPDATE|DELETE)\s+(?:OR\s+\w+\s+)?INTO\s+"?(audit_logs|email_logs)"?\b/i.test(
        trimmed
      );
    if (!isAuxLogOnly) {
      coreWriteCounter += 1;
    }
  }
  return {
    lastInsertRowid: Number(res.lastInsertRowid),
    changes,
  };
}

let txDepth = 0;
function transaction(fn) {
  const sp = `sp_${txDepth}`;
  if (txDepth === 0) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec(`SAVEPOINT ${sp}`);
  }
  txDepth += 1;
  try {
    const result = fn();
    txDepth -= 1;
    if (txDepth === 0) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE SAVEPOINT ${sp}`);
    }
    return result;
  } catch (err) {
    txDepth -= 1;
    if (txDepth === 0) {
      try { db.exec('ROLLBACK'); } catch (_) {}
    } else {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${sp}`); db.exec(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}
    }
    throw err;
  }
}

function ensureColumn(tableName, colName, colDef) {
  const cols = all(`PRAGMA table_info(${tableName})`);
  if (!cols.some((c) => c.name === colName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
  }
}

function getSetting(key, fallback = '') {
  const row = get(`SELECT value FROM system_settings WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  run(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, String(value ?? '')]
  );
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#0a6fa8',
      icon TEXT NOT NULL DEFAULT 'briefcase',
      is_chairman_exclusive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#0a6fa8',
      rank_level INTEGER NOT NULL DEFAULT 20,
      is_protected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT DEFAULT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#0a6fa8',
      avatar_url TEXT DEFAULT NULL,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      oauth_id TEXT DEFAULT NULL,
      email_verified INTEGER NOT NULL DEFAULT 1,
      has_custom_credentials INTEGER NOT NULL DEFAULT 1,
      department_confirmed INTEGER NOT NULL DEFAULT 1,
      onboarding_status TEXT NOT NULL DEFAULT 'approved' CHECK(onboarding_status IN ('pending', 'approved')),
      preferred_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT DEFAULT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      background TEXT NOT NULL DEFAULT 'ocean',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS board_stars (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, board_id)
    );

    CREATE TABLE IF NOT EXISTS board_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0a6fa8'
    );

    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      due_date TEXT DEFAULT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      cover_color TEXT DEFAULT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS card_assignees (
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS card_label_links (
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES board_labels(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_checked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS card_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permission_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('department', 'board', 'card')),
      target_department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      target_board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
      target_card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
      requested_duration TEXT NOT NULL DEFAULT 'once' CHECK(requested_duration IN ('once', '1h', '8h', '24h', '7d')),
      reason TEXT NOT NULL,
      action_summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'revoked')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      review_note TEXT NOT NULL DEFAULT '',
      approved_duration TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES permission_requests(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('department', 'board', 'card')),
      target_department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      target_board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
      target_card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
      uses_remaining INTEGER DEFAULT NULL,
      expires_at TEXT DEFAULT NULL,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_tab TEXT DEFAULT NULL,
      link_board_id INTEGER DEFAULT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL DEFAULT '',
      department_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      permission_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('ALLOWED', 'DENIED')),
      method TEXT NOT NULL DEFAULT '',
      endpoint TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      is_chairman_exclusive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'notification',
      status TEXT NOT NULL CHECK(status IN ('SENT', 'SKIPPED_NOT_CONFIGURED', 'FAILED')),
      error_message TEXT NOT NULL DEFAULT '',
      is_chairman_exclusive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      verified_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations for existing local DB files
  ensureColumn('departments', 'is_chairman_exclusive', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('audit_logs', 'is_chairman_exclusive', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('email_logs', 'is_chairman_exclusive', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('roles', 'rank_level', 'INTEGER NOT NULL DEFAULT 20');
  ensureColumn('users', 'email', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'avatar_url', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn('users', 'oauth_id', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('users', 'has_custom_credentials', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('users', 'department_confirmed', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('users', 'onboarding_status', "TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn('users', 'preferred_department_id', 'INTEGER DEFAULT NULL');
  ensureColumn('users', 'approved_by', 'INTEGER DEFAULT NULL');
  ensureColumn('users', 'approved_at', 'TEXT DEFAULT NULL');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_boards_dept ON boards(department_id);
    CREATE INDEX IF NOT EXISTS idx_lists_board ON lists(board_id, position);
    CREATE INDEX IF NOT EXISTS idx_cards_list ON cards(list_id, position);
    CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
    CREATE INDEX IF NOT EXISTS idx_grants_user ON permission_grants(user_id, permission_key, is_revoked);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON permission_requests(status, target_department_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(id DESC);
    CREATE INDEX IF NOT EXISTS idx_users_onboarding ON users(onboarding_status, preferred_department_id);
    CREATE INDEX IF NOT EXISTS idx_email_verif_lookup ON email_verifications(email, id DESC);
  `);
}

const SNAPSHOT_TABLES_FORWARD = [
  'system_settings',
  'departments',
  'permissions',
  'roles',
  'role_permissions',
  'users',
  'boards',
  'board_stars',
  'board_labels',
  'lists',
  'cards',
  'card_assignees',
  'card_label_links',
  'checklist_items',
  'card_comments',
  'permission_requests',
  'permission_grants',
  'notifications',
  'audit_logs',
  'email_logs',
  'email_verifications',
];

const SNAPSHOT_TABLES_REVERSE = [...SNAPSHOT_TABLES_FORWARD].reverse();

function getTableColumnSet(tableName) {
  const info = all(`PRAGMA table_info("${tableName}")`);
  return new Set(info.map((c) => c.name));
}

function exportDatabaseSnapshot() {
  const tables = {};
  for (const table of SNAPSHOT_TABLES_FORWARD) {
    if (table === 'audit_logs') {
      tables[table] = all(
        `SELECT * FROM (SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500) ORDER BY id ASC`
      );
    } else if (table === 'email_logs') {
      tables[table] = all(
        `SELECT * FROM (SELECT * FROM email_logs ORDER BY id DESC LIMIT 200) ORDER BY id ASC`
      );
    } else if (table === 'email_verifications') {
      tables[table] = all(
        `SELECT * FROM (SELECT * FROM email_verifications ORDER BY id DESC LIMIT 100) ORDER BY id ASC`
      );
    } else {
      tables[table] = all(`SELECT * FROM "${table}"`);
    }
  }

  let sqliteSequence = [];
  try {
    sqliteSequence = all(`SELECT name, seq FROM sqlite_sequence`);
  } catch (_) {}

  return {
    schemaVersion: 11,
    exportedAt: new Date().toISOString(),
    tables,
    sqliteSequence,
  };
}

function importDatabaseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables) {
    throw new Error('Invalid database snapshot payload');
  }

  runUntracked(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec('BEGIN IMMEDIATE;');
      try {
        for (const table of SNAPSHOT_TABLES_REVERSE) {
          db.exec(`DELETE FROM "${table}";`);
        }
        try {
          db.exec(`DELETE FROM sqlite_sequence;`);
        } catch (_) {}

        for (const table of SNAPSHOT_TABLES_FORWARD) {
          const rows = snapshot.tables[table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const validCols = getTableColumnSet(table);
          const cols = Object.keys(rows[0]).filter((c) => validCols.has(c));
          if (cols.length === 0) continue;

          const colSql = cols.map((c) => `"${c}"`).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const stmt = db.prepare(
            `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders})`
          );
          for (const row of rows) {
            stmt.run(...cols.map((c) => normalizeParam(row[c])));
          }
        }

        if (Array.isArray(snapshot.sqliteSequence) && snapshot.sqliteSequence.length > 0) {
          const seqStmt = db.prepare(
            `INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`
          );
          for (const item of snapshot.sqliteSequence) {
            if (item && item.name && item.seq !== undefined && item.seq !== null) {
              seqStmt.run(String(item.name), Number(item.seq));
            }
          }
        }

        db.exec('COMMIT;');
      } catch (err) {
        try {
          db.exec('ROLLBACK;');
        } catch (_) {}
        throw err;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  });
}

function checkpointDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
}

module.exports = {
  db,
  DB_PATH,
  get,
  all,
  run,
  runUntracked,
  getWriteCounters,
  transaction,
  initSchema,
  getSetting,
  setSetting,
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  checkpointDatabase,
};
