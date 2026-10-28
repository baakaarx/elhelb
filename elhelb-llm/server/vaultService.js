const { db, get, all, run, CATEGORIES } = require('./db');
const { encryptText, decryptText } = require('./cryptoVault');
const { chunkDocument, searchIndex } = require('./arabicRag');
const { parseTabularData, profileDataset } = require('./dataAnalytics');

function ingestDocument({
  title,
  content,
  category = 'general',
  sourceType = 'manual',
  filename = null,
}) {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  if (!cleanTitle || cleanContent.length < 6) {
    throw new Error('عنوان البيانات ومحتواها مطلوبان.');
  }

  const safeCat = CATEGORIES[category] ? category : 'general';
  const encryptedDoc = encryptText(cleanContent);
  const chunks = chunkDocument(cleanContent, cleanTitle);

  db.exec('BEGIN');
  try {
    const res = run(
      `INSERT INTO documents (
        title, category, source_type, filename,
        raw_ciphertext, raw_iv, raw_auth_tag, sha256_hash,
        chunk_count, char_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    db.exec('COMMIT');
    return get('SELECT * FROM documents WHERE id = ?', [docId]);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function ingestDataset({ name, rawData, category = 'sales', description = '', filename = null }) {
  const cleanName = String(name || '').trim();
  const rows = parseTabularData(rawData);
  if (!cleanName || rows.length === 0) {
    throw new Error('يرجى إدخال جدول بيانات صالح (CSV أو JSON) يحتوي على صف واحد على الأقل.');
  }

  const safeCat = CATEGORIES[category] ? category : 'sales';
  const { columns, summaryText } = profileDataset(cleanName, rows);
  const encRows = encryptText(JSON.stringify(rows));

  const res = run(
    `INSERT INTO datasets (
      name, category, description, filename,
      columns_json, row_count,
      rows_ciphertext, rows_iv, rows_auth_tag, summary_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cleanName,
      safeCat,
      description,
      filename,
      JSON.stringify(columns),
      rows.length,
      encRows.ciphertext,
      encRows.iv,
      encRows.authTag,
      summaryText,
    ]
  );

  // فهرسة ملخص الجدول وسجلاته في محرك البحث الدلالي أيضاً لربط الأسئلة والأصناف فوراً
  ingestDocument({
    title: `[جدول تحليلي] ${cleanName}`,
    content: `${description ? description + '\n\n' : ''}${summaryText}`,
    category: safeCat,
    sourceType: 'dataset_index',
    filename,
  });

  return get('SELECT * FROM datasets WHERE id = ?', [Number(res.lastInsertRowid)]);
}

function getDecryptedDatasets() {
  const rows = all('SELECT * FROM datasets ORDER BY id DESC');
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
     JOIN documents d ON d.id = c.doc_id`
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

  return {
    contexts,
    queryAnalysis: searchResult.queryAnalysis,
  };
}

module.exports = {
  ingestDocument,
  ingestDataset,
  getDecryptedDatasets,
  retrieveCompanyKnowledge,
};
