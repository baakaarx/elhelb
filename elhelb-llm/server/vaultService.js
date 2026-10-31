const { db, get, all, run, CATEGORIES } = require('./db');
const { encryptText, decryptText } = require('./cryptoVault');
const { encryptField } = require('./secureFields');
const { chunkDocument, searchIndex } = require('./arabicRag');
const { parseTabularData, profileDataset } = require('./dataAnalytics');

const MAX_DOCUMENT_CHARS = 500_000;
const MAX_DATASET_ROWS = 20_000;
const MAX_DATASET_COLUMNS = 200;

function insertDocumentWithinTransaction({ cleanTitle, cleanContent, safeCat, sourceType, filename, isPublic }) {
  const encryptedDoc = encryptText(cleanContent);
  const chunks = chunkDocument(cleanContent, cleanTitle);
  const res = run(
    `INSERT INTO documents (
      title, category, source_type, filename,
      raw_ciphertext, raw_iv, raw_auth_tag, sha256_hash,
      chunk_count, char_count, is_public
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cleanTitle,
      safeCat,
      sourceType,
      filename,
      encryptedDoc.ciphertext,
      encryptedDoc.iv,
      encryptedDoc.authTag,
      encryptedDoc.sha256,
      chunks.length,
      cleanContent.length,
      isPublic ? 1 : 0,
    ]
  );

  const docId = Number(res.lastInsertRowid);
  for (const ch of chunks) {
    const encChunk = encryptText(ch.text);
    run(
      `INSERT INTO document_chunks (
        doc_id, chunk_index, section_title,
        text_ciphertext, text_iv, text_auth_tag,
        embedding_base64, token_meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        ch.chunkIndex,
        ch.sectionTitle,
        encChunk.ciphertext,
        encChunk.iv,
        encChunk.authTag,
        ch.embeddingBase64,
        ch.tokenMetaJson,
      ]
    );
  }
  return docId;
}

function ingestDocument({
  title,
  content,
  category = 'general',
  sourceType = 'manual',
  filename = null,
  isPublic = false,
}) {
  const cleanTitle = String(title || '').trim().slice(0, 200);
  const cleanContent = String(content || '').trim();
  if (!cleanTitle || cleanContent.length < 6) {
    throw new Error('عنوان البيانات ومحتواها مطلوبان.');
  }
  if (cleanContent.length > MAX_DOCUMENT_CHARS) {
    throw new Error(`حجم المستند يتجاوز الحد المسموح (${MAX_DOCUMENT_CHARS} حرف).`);
  }

  const safeCat = CATEGORIES[category] ? category : 'general';
  db.exec('BEGIN');
  try {
    const docId = insertDocumentWithinTransaction({
      cleanTitle,
      cleanContent,
      safeCat,
      sourceType: String(sourceType || 'manual').slice(0, 80),
      filename: filename ? String(filename).slice(0, 255) : null,
      isPublic: isPublic === true,
    });
    db.exec('COMMIT');
    return get('SELECT * FROM documents WHERE id = ?', [docId]);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function ingestDataset({ name, rawData, category = 'sales', description = '', filename = null, isPublic = false }) {
  const cleanName = String(name || '').trim().slice(0, 200);
  const inputSize = typeof rawData === 'string' ? rawData.length : JSON.stringify(rawData ?? null).length;
  if (inputSize > 5_000_000) throw new Error('حجم جدول البيانات يتجاوز الحد المسموح (5 ميجابايت).');

  const rows = parseTabularData(rawData);
  if (!cleanName || rows.length === 0) {
    throw new Error('يرجى إدخال جدول بيانات صالح (CSV أو JSON) يحتوي على صف واحد على الأقل.');
  }
  if (rows.length > MAX_DATASET_ROWS) throw new Error(`الحد الأقصى هو ${MAX_DATASET_ROWS} سجل لكل جدول.`);

  const safeCat = CATEGORIES[category] ? category : 'sales';
  const { columns, summaryText } = profileDataset(cleanName, rows);
  if (columns.length > MAX_DATASET_COLUMNS) throw new Error(`الحد الأقصى هو ${MAX_DATASET_COLUMNS} عموداً لكل جدول.`);
  const encRows = encryptText(JSON.stringify(rows));

  db.exec('BEGIN');
  try {
    const res = run(
      `INSERT INTO datasets (
        name, category, description, filename,
        columns_json, row_count,
        rows_ciphertext, rows_iv, rows_auth_tag, summary_text, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanName,
        safeCat,
        String(description || '').slice(0, 2000),
        filename ? String(filename).slice(0, 255) : null,
        JSON.stringify(columns),
        rows.length,
        encRows.ciphertext,
        encRows.iv,
        encRows.authTag,
        encryptField(summaryText),
        isPublic === true ? 1 : 0,
      ]
    );

    const cleanTitle = `[جدول تحليلي] ${cleanName}`;
    const summaryContent = `${description ? String(description).slice(0, 2000) + '\n\n' : ''}${summaryText}`;
    if (summaryContent.length > MAX_DOCUMENT_CHARS) throw new Error('ملخص جدول البيانات يتجاوز الحد المسموح.');
    insertDocumentWithinTransaction({
      cleanTitle,
      cleanContent: summaryContent,
      safeCat,
      sourceType: 'dataset_index',
      filename: filename ? String(filename).slice(0, 255) : null,
      isPublic: isPublic === true,
    });

    db.exec('COMMIT');
    return get('SELECT * FROM datasets WHERE id = ?', [Number(res.lastInsertRowid)]);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getDecryptedDatasets({ publicOnly = false } = {}) {
  const rows = all(`SELECT * FROM datasets ${publicOnly ? 'WHERE is_public = 1' : ''} ORDER BY id DESC`);
  return rows.map((ds) => {
    const parsedRows = JSON.parse(
      decryptText({
        ciphertext: ds.rows_ciphertext,
        iv: ds.rows_iv,
        authTag: ds.rows_auth_tag,
      })
    );
    return {
      id: ds.id,
      name: ds.name,
      category: ds.category,
      isPublic: Boolean(ds.is_public),
      categoryLabel: CATEGORIES[ds.category] || ds.category,
      description: ds.description,
      filename: ds.filename,
      rowCount: ds.row_count,
      columns: JSON.parse(ds.columns_json || '[]'),
      rows: parsedRows,
      created_at: ds.created_at,
    };
  });
}

function retrieveCompanyKnowledge(query, topK = 5) {
  const allIndexed = all(
    `SELECT
      c.id, c.doc_id, c.chunk_index, c.section_title,
      c.text_ciphertext, c.text_iv, c.text_auth_tag,
      c.embedding_base64, c.token_meta_json,
      d.title AS doc_title, d.category
     FROM document_chunks c
     JOIN documents d ON d.id = c.doc_id
     WHERE d.is_public = 1`
  );

  const searchResult = searchIndex(query, allIndexed, () => true, topK);
  const contexts = searchResult.matches.map((m) => {
    const ch = m.chunk;
    const decryptedText = decryptText({
      ciphertext: ch.text_ciphertext,
      iv: ch.text_iv,
      authTag: ch.text_auth_tag,
    });
    return {
      chunkId: ch.id,
      docId: ch.doc_id,
      docTitle: ch.doc_title,
      sectionTitle: ch.section_title,
      category: ch.category,
      categoryLabel: CATEGORIES[ch.category] || ch.category,
      decryptedText,
      score: m.score,
    };
  });

  return { contexts, queryAnalysis: searchResult.queryAnalysis };
}

module.exports = {
  ingestDocument,
  ingestDataset,
  getDecryptedDatasets,
  retrieveCompanyKnowledge,
};
