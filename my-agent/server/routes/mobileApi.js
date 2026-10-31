const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { get } = require('../db');
const { requireAdminKey } = require('../adminAuth');
const { processCompanyQuery } = require('../companyBrainService');
const { ingestDocument, ingestDataset, getDecryptedDatasets } = require('../vaultService');
const { analyzeImageBuffer } = require('../visionEngine');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function checkMobileApiKey(req, res, next) {
  const settings = get('SELECT require_mobile_key, mobile_api_key FROM security_settings WHERE id = 1');
  if (!settings || !settings.require_mobile_key) {
    return next();
  }

  let provided = req.headers['x-api-key'] || '';
  if (!provided && req.headers.authorization?.startsWith('Bearer ')) {
    provided = req.headers.authorization.slice(7).trim();
  }

  if (provided !== settings.mobile_api_key) {
    return res.status(401).json({
      error: 'مفتاح API غير صالح.',
    });
  }
  next();
}

router.use(checkMobileApiKey);

// 1) حالة الموديل لتطبيق الموبايل
router.get('/status', (_req, res) => {
  const profile = get('SELECT model_name, display_name FROM model_profile WHERE id = 1');

  res.json({
    ok: true,
    model: profile?.model_name || 'elhelb-ai-v1',
    displayName: profile?.display_name || 'ELHELB GROUP AI',
    capabilities: {
      chat: true,
      vision: true,
      ocrLanguages: ['ara', 'eng'],
      tabularAnalytics: true,
    },
  });
});

// 2) نقطة المحادثة الموحدة للموبايل (نص + صور، مع عزل الجلسات)
router.post('/chat', upload.single('image'), async (req, res) => {
  try {
    const message = String(req.body?.message || req.body?.prompt || '').slice(0, 3000);
    const rawSession = String(req.body?.sessionId || '');
    const validSession = /^[a-zA-Z0-9_-]{16,80}$/.test(rawSession);
    const sessionId = validSession ? rawSession : 'mob_' + crypto.randomUUID();
    const imageInput = req.file ? req.file.buffer : req.body?.imageBase64 || null;

    const result = await processCompanyQuery({
      message,
      imageInput,
      sessionId,
      channel: 'mobile-app',
      persistChat: validSession,
    });

    res.json({
      ok: true,
      reply: result.reply,
      speechText: result.speechText,
      suggestions: result.suggestions,
      vision: result.vision,
      dataInsights: result.dataInsights,
      matchedRecords: result.matchedRecords,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 3) نقطة تحليل الصور المباشرة من كاميرا الموبايل
router.post('/vision/analyze', upload.single('image'), async (req, res) => {
  try {
    const imageInput = req.file ? req.file.buffer : req.body?.imageBase64 || null;
    if (!imageInput) {
      return res.status(400).json({
        ok: false,
        error: 'أرسل الصورة في الحقل image (multipart/form-data) أو الحقل imageBase64 (JSON).',
      });
    }

    const prompt = String(req.body?.prompt || 'حلل هذه الصورة واستخرج كافة البيانات وطابقها مع منتجات وتوصيات مجموعة الهلب').slice(0, 2000);
    const fullResult = await processCompanyQuery({
      message: prompt,
      imageInput,
      sessionId: 'vision_' + crypto.randomUUID(),
      channel: 'mobile-vision',
      persistChat: false,
    });

    const rawVision = await analyzeImageBuffer(imageInput);

    res.json({
      ok: true,
      analysisReply: fullResult.reply,
      documentType: rawVision.signals.docType,
      imageMeta: rawVision.imageMeta,
      extractedText: rawVision.ocr.text,
      ocrConfidence: rawVision.ocr.confidence,
      detectedSignals: rawVision.signals,
      matchedCompanyRecords: fullResult.matchedRecords,
      latencyMs: fullResult.latencyMs,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 4) تغذية بيانات جديدة عن بعد (محمية بمفتاح الإدارة X-Admin-Key لمنع أي تلاعب من الجمهور)
router.post('/data/ingest', requireAdminKey, (req, res) => {
  try {
    const type = req.body?.type === 'dataset' ? 'dataset' : 'document';
    if (type === 'dataset') {
      const ds = ingestDataset({
        name: req.body?.title || req.body?.name,
        rawData: req.body?.data || req.body?.content,
        category: req.body?.category || 'products',
        description: req.body?.description || '',
      });
      return res.status(201).json({ ok: true, type: 'dataset', id: ds.id, rowCount: ds.row_count });
    }

    const doc = ingestDocument({
      title: req.body?.title,
      content: req.body?.content,
      category: req.body?.category || 'general',
      sourceType: 'admin_api',
    });
    res.status(201).json({ ok: true, type: 'document', id: doc.id, chunks: doc.chunk_count });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/analytics/summary', requireAdminKey, (_req, res) => {
  const datasets = getDecryptedDatasets().map((d) => ({
    id: d.id,
    name: d.name,
    category: d.categoryLabel,
    rowCount: d.rowCount,
    metrics: d.columns.filter((c) => c.type === 'number'),
  }));
  res.json({ ok: true, datasets });
});

module.exports = {
  mobileRouter: router,
  checkMobileApiKey,
};
