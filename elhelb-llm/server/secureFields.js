const { encryptText, decryptText } = require('./cryptoVault');

const ENCRYPTED_FIELD_PREFIX = 'ELHELB_ENC_V1:';

function encryptField(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!text) return text;
  return ENCRYPTED_FIELD_PREFIX + JSON.stringify(encryptText(text));
}

function decryptField(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!text.startsWith(ENCRYPTED_FIELD_PREFIX)) return text;
  const envelope = JSON.parse(text.slice(ENCRYPTED_FIELD_PREFIX.length));
  return decryptText(envelope);
}

function isEncryptedField(value) {
  const text = String(value || '');
  if (!text.startsWith(ENCRYPTED_FIELD_PREFIX)) return false;
  try {
    decryptText(JSON.parse(text.slice(ENCRYPTED_FIELD_PREFIX.length)));
    return true;
  } catch {
    return false;
  }
}

function migrateSensitiveFields(db) {
  const migrations = [
    { table: 'chat_messages', columns: ['content', 'image_thumb', 'citations_json', 'meta_json'] },
    { table: 'api_logs', columns: ['preview'] },
    { table: 'datasets', columns: ['summary_text'] },
    { table: 'training_examples', columns: ['instruction', 'input_context', 'output_response'] },
  ];

  for (const { table, columns } of migrations) {
    const available = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name));
    for (const column of columns) {
      if (!available.has(column)) continue;
      const selectBatch = db.prepare(
        `SELECT rowid, ${column} AS value FROM ${table}
         WHERE rowid > ? AND ${column} IS NOT NULL AND ${column} != '' ORDER BY rowid LIMIT 100`
      );
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
      let lastRowId = 0;
      while (true) {
        const rows = selectBatch.all(lastRowId);
        if (rows.length === 0) break;
        for (const row of rows) {
          if (!isEncryptedField(row.value)) update.run(encryptField(String(row.value)), row.rowid);
          lastRowId = Number(row.rowid);
        }
      }
    }
  }
}

function purgeExpiredSensitiveData(db, retentionDays = Number(process.env.ELHELB_CHAT_RETENTION_DAYS || 30)) {
  const days = Number.isFinite(retentionDays) ? Math.max(1, Math.min(365, Math.floor(retentionDays))) : 30;
  const modifier = `-${days} days`;
  db.prepare("DELETE FROM chat_messages WHERE created_at < datetime('now', ?)").run(modifier);
  db.prepare("DELETE FROM api_logs WHERE created_at < datetime('now', ?)").run(modifier);
  return days;
}

function sanitizePublicValue(value, inspectAndSanitize, options) {
  if (typeof value === 'string') return inspectAndSanitize(value, options).sanitizedText;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const inspected = inspectAndSanitize(String(value), options);
    return inspected.sanitizedText === String(value) ? value : inspected.sanitizedText;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, inspectAndSanitize, options));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizePublicValue(item, inspectAndSanitize, options)])
    );
  }
  return value;
}

function hasSensitiveValue(value, inspectAndSanitize, options) {
  if (typeof value === 'string' || typeof value === 'number') {
    return inspectAndSanitize(String(value), options).findings.length > 0;
  }
  if (Array.isArray(value)) return value.some((item) => hasSensitiveValue(item, inspectAndSanitize, options));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasSensitiveValue(item, inspectAndSanitize, options));
  }
  return false;
}

module.exports = {
  ENCRYPTED_FIELD_PREFIX,
  encryptField,
  decryptField,
  migrateSensitiveFields,
  purgeExpiredSensitiveData,
  sanitizePublicValue,
  hasSensitiveValue,
};
