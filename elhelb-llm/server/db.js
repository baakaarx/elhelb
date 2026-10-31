const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./dataDir');

const CATEGORIES = {
  general: 'هوية وفروع وتصدير مجموعة الهلب',
  products: 'كتالوج المبيدات والمغذيات الزراعية',
  agri_clinic: 'العيادة الزراعية وتوصيات المكافحة (Agri-Clinic)',
  sales: 'المبيعات والتسعير والموزعين والتصدير',
  inventory: 'المخازن وخطوط الإنتاج والتصنيع للغير',
  hr: 'الإدارة وشؤون العاملين',
  private: 'بيانات خاصة غير متاحة للشات العام',
};

function resolveDbPath() {
  if (process.env.LLM_DB_PATH) return process.env.LLM_DB_PATH;
  return path.join(DATA_DIR, 'elhelb-company-ai.db');
}

const DB_PATH = resolveDbPath();
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA secure_delete = ON;
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

function run(sql, params = []) {
  return db.prepare(sql).run(...params.map(normalizeParam));
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      source_type TEXT NOT NULL DEFAULT 'manual',
      filename TEXT,
      raw_ciphertext TEXT NOT NULL,
      raw_iv TEXT NOT NULL,
      raw_auth_tag TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      char_count INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      section_title TEXT NOT NULL,
      text_ciphertext TEXT NOT NULL,
      text_iv TEXT NOT NULL,
      text_auth_tag TEXT NOT NULL,
      embedding_base64 TEXT NOT NULL,
      token_meta_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(doc_id);

    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'sales',
      description TEXT DEFAULT '',
      filename TEXT,
      columns_json TEXT NOT NULL DEFAULT '[]',
      row_count INTEGER NOT NULL DEFAULT 0,
      rows_ciphertext TEXT NOT NULL,
      rows_iv TEXT NOT NULL,
      rows_auth_tag TEXT NOT NULL,
      summary_text TEXT NOT NULL DEFAULT '',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instruction TEXT NOT NULL,
      input_context TEXT DEFAULT '',
      output_response TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model_name TEXT NOT NULL DEFAULT 'elhelb-ai-v1',
      display_name TEXT NOT NULL DEFAULT 'ELHELB Company AI',
      base_model TEXT NOT NULL DEFAULT 'qwen2.5:7b',
      vision_model TEXT NOT NULL DEFAULT 'llama3.2-vision',
      system_prompt TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.2,
      context_length INTEGER NOT NULL DEFAULT 8192,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'auto',
      ollama_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434',
      local_openai_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8080/v1',
      airgap_lock INTEGER NOT NULL DEFAULT 1,
      dlp_mode TEXT NOT NULL DEFAULT 'mask',
      mask_phones INTEGER NOT NULL DEFAULT 1,
      require_mobile_key INTEGER NOT NULL DEFAULT 0,
      mobile_api_key TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL DEFAULT 'web-default',
      source_channel TEXT NOT NULL DEFAULT 'web',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      image_thumb TEXT,
      citations_json TEXT DEFAULT '[]',
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'web',
      event_type TEXT NOT NULL,
      preview TEXT,
      has_image INTEGER DEFAULT 0,
      engine_used TEXT,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe, additive migrations for databases created by earlier releases.
  const ensureColumn = (table, column, definition) => {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
    if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('documents', 'is_public', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('datasets', 'is_public', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('training_examples', 'is_public', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON api_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_public_docs ON documents(is_public, category);
    CREATE INDEX IF NOT EXISTS idx_public_datasets ON datasets(is_public, category);
  `);

  if (!get('SELECT version FROM schema_migrations WHERE version = ?', ['secure-public-data-v2'])) {
    // Only repository-curated content is grandfathered in; admin uploads stay private by default.
    run(`UPDATE documents SET is_public = 1
         WHERE source_type = 'company_data_folder'
           AND filename IN (
             '01-elhelb-company-profile.md',
             '02-elhelb-products-guide.md',
             '03-elhelb-agri-clinic.md',
             '04-elhelb-products-catalog.csv',
             '05-elhelb-crop-programs.csv',
             '06-elhelb-herbicides-and-nutrition.md'
           )`);
    run("UPDATE security_settings SET dlp_mode = 'mask' WHERE dlp_mode = 'warn'");
    run('UPDATE security_settings SET mask_phones = 1 WHERE mask_phones = 0');
    const settings = get('SELECT mobile_api_key FROM security_settings WHERE id = 1');
    if (settings?.mobile_api_key && !settings.mobile_api_key.startsWith('sha256:')) {
      run('UPDATE security_settings SET mobile_api_key = ? WHERE id = 1', [require('./mobileKey').hashMobileKey(settings.mobile_api_key)]);
    }
    require('./secureFields').migrateSensitiveFields(db);
    // Remove pre-migration plaintext from freed SQLite pages and the WAL file.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    run('INSERT INTO schema_migrations (version) VALUES (?)', ['secure-public-data-v2']);
  }
}

module.exports = {
  db,
  DB_PATH,
  CATEGORIES,
  get,
  all,
  run,
  initSchema,
};
