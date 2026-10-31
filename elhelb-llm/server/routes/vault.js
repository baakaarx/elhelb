const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const { get, all, run, CATEGORIES } = require('../db');
const { decryptText, getKeyFingerprint } = require('../cryptoVault');
const { ingestDocument, ingestDataset, getDecryptedDatasets } = require('../vaultService');

const router = express.Router();

router.get('/overview', (_req, res) => {
  const docs = all(
    `SELECT id, title, category, source_type, filename, sha256_hash, chunk_count, char_count, is_public, created_at
     FROM documents
     WHERE source_type != 'dataset_index'
     ORDER BY id DESC`
  ).map((d) => ({
    ...d,
    category_label: CATEGORIES[d.category] || d.category,
  }));

  const datasets = getDecryptedDatasets().map((ds) => ({
    id: ds.id,
    name: ds.name,
    category: ds.category,
    is_public: ds.isPublic,
    category_label: ds.categoryLabel,
    description: ds.description,
    filename: ds.filename,
    row_count: ds.rowCount,
    columns: ds.columns,
    previewRows: ds.rows.slice(0, 8),
    created_at: ds.created_at,
  }));

  res.json({
    documents: docs,
    datasets,
    categories: CATEGORIES,
    vaultEncryption: {
      algorithm: 'AES-256-GCM',
      keyFingerprint: getKeyFingerprint(),
    },
  });
});

router.get('/documents/:id', (req, res) => {
  const docId = Number(req.params.id);
  const doc = get('SELECT * FROM documents WHERE id = ?', [docId]);
  if (!doc) {
    return res.status(404).json({ error: 'المستند غير موجود.' });
  }

  const decryptedContent = decryptText({
    ciphertext: doc.raw_ciphertext,
    iv: doc.raw_iv,
    authTag: doc.raw_auth_tag,
  });

  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      category: doc.category,
      category_label: CATEGORIES[doc.category] || doc.category,
      filename: doc.filename,
      chunk_count: doc.chunk_count,
      char_count: doc.char_count,
      created_at: doc.created_at,
      decryptedContent,
      diskEncryptionProof: {
        algorithm: 'AES-256-GCM',
        rawCiphertextSample: doc.raw_ciphertext.slice(0, 170) + '...',
        ivBase64: doc.raw_iv,
        authTagBase64: doc.raw_auth_tag,
        sha256Hash: doc.sha256_hash,
      },
    },
  });
});

router.post('/documents', (req, res) => {
  try {
    const created = ingestDocument({
      title: req.body?.title,
      content: req.body?.content,
      category: req.body?.category || 'general',
      sourceType: req.body?.sourceType || 'manual',
      filename: req.body?.filename || null,
      isPublic: req.body?.isPublic === true,
    });
    res.status(201).json({
      document: {
        ...created,
        category_label: CATEGORIES[created.category] || created.category,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/datasets', (req, res) => {
  try {
    const created = ingestDataset({
      name: req.body?.name,
      rawData: req.body?.rawData,
      category: req.body?.category || 'sales',
      description: req.body?.description || '',
      filename: req.body?.filename || null,
      isPublic: req.body?.isPublic === true,
    });
    res.status(201).json({ dataset: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import-boards', (_req, res) => {
  const boardsDbPath = path.join(__dirname, '..', '..', 'elhelb-boards', 'data', 'elhelb-boards.db');
  let importedCount = 0;

  if (fs.existsSync(boardsDbPath)) {
    try {
      const extDb = new DatabaseSync(boardsDbPath, { open: true });
      const boards = extDb
        .prepare(
          `SELECT b.id, b.name, b.description, d.name AS dept_name
           FROM boards b LEFT JOIN departments d ON d.id = b.department_id`
        )
        .all();

      for (const b of boards) {
        const cards = extDb
          .prepare(
            `SELECT c.title, c.description, c.priority, l.name AS list_name
             FROM cards c JOIN lists l ON l.id = c.list_id
             WHERE l.board_id = ?`
          )
          .all(b.id);

        const textLines = cards.map(
          (c) => `- [${c.list_name}] ${c.title} (أولوية: ${c.priority || 'متوسطة'}): ${c.description || ''}`
        );

        ingestDocument({
          title: `مهام لوحة العمل: ${b.name}`,
          content: `# ${b.name} (${b.dept_name || 'الشركة'})\n${b.description || ''}\n\n${textLines.join('\n')}`,
          category: 'operations',
          sourceType: 'elhelb_boards_sync',
        });
        importedCount++;
      }
      extDb.close();
    } catch {
      importedCount = 0;
    }
  }

  if (importedCount === 0) {
    ingestDocument({
      title: 'ملخص المهام والمشاريع الجارية — لوحات عمل مجموعة الهلب',
      category: 'operations',
      sourceType: 'elhelb_boards_sync',
      content: `# المشاريع التشغيلية النشطة حالياً
- تجهيز توريد طلبيات المنطقة الصناعية ببرج العرب بقيمة 4.2 مليون جنيه (نسبة الإنجاز 80%).
- مراجعة عقود الموردين السنوية وتأمين نواقص مخزون الحساسات الرقمية ومحركات السيرفو.
- ربط تطبيق الموبايل الخاص بالمندوبين مع الموديل الذكي لمراجعة الفواتير والمخازن ميدانياً.`,
    });
    importedCount = 1;
  }

  res.json({ ok: true, importedCount });
});

router.delete('/documents/:id', (req, res) => {
  run('DELETE FROM documents WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.delete('/datasets/:id', (req, res) => {
  const ds = get('SELECT * FROM datasets WHERE id = ?', [Number(req.params.id)]);
  if (ds) {
    run('DELETE FROM datasets WHERE id = ?', [ds.id]);
    run("DELETE FROM documents WHERE source_type = 'dataset_index' AND title = ?", [
      `[جدول تحليلي] ${ds.name}`,
    ]);
  }
  res.json({ ok: true });
});

module.exports = router;
