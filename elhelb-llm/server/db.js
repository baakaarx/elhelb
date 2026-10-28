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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instruction TEXT NOT NULL,
      input_context TEXT DEFAULT '',
      output_response TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
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
      dlp_mode TEXT NOT NULL DEFAULT 'warn',
      mask_phones INTEGER NOT NULL DEFAULT 0,
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
