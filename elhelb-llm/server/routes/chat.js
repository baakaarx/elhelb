const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { all, run } = require('../db');
const { processCompanyQuery } = require('../companyBrainService');

const router = express.Router();

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      return cb(new Error('يرجى إرفاق صورة بصيغة PNG أو JPG أو WebP فقط.'));
    }
    cb(null, true);
  },
});

function isValidPrivateSessionId(sid) {
  return typeof sid === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(sid);
}

router.get('/history', (req, res) => {
  const sessionId = String(req.query.sessionId || '');
  // حماية خصوصية الزوار: لا يتم استرجاع أي سجل إلا بمعرّف جلسة خاص عشوائي صالح
  if (!isValidPrivateSessionId(sessionId)) {
    return res.json({ messages: [] });
  }

  const rows = all(
    `SELECT id, role, content, image_thumb, meta_json, created_at
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY id ASC
     LIMIT 60`,
    [sessionId]
  );

  res.json({
    messages: rows.map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(r.meta_json || '{}');
      } catch {
        meta = {};
      }
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        imageThumb: r.image_thumb || null,
        suggestions: Array.isArray(meta.suggestions) ? meta.suggestions : [],
        created_at: r.created_at,
      };
    }),
  });
});

router.delete('/history', (req, res) => {
  const sessionId = String(req.query.sessionId || '');
  if (!isValidPrivateSessionId(sessionId)) {
    return res.json({ ok: true });
  }
  run('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]);
  res.json({ ok: true });
});

router.post('/ask', (req, res) => {
  upload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'تعذر رفع الصورة المرفقة.' });
    }

    try {
      const rawMessage = String(req.body?.message || '').slice(0, 3000);
      const rawSessionId = String(req.body?.sessionId || '');
      const sessionId = isValidPrivateSessionId(rawSessionId)
        ? rawSessionId
        : 'ephemeral_' + crypto.randomUUID();
      const shouldPersist = isValidPrivateSessionId(rawSessionId);

      const imageInput = req.file ? req.file.buffer : req.body?.imageBase64 || null;

      const result = await processCompanyQuery({
        message: rawMessage,
        imageInput,
        sessionId,
        channel: 'web',
        persistChat: shouldPersist,
      });

      res.json({
        reply: result.reply,
        speechText: result.speechText,
        suggestions: result.suggestions,
        userMessage: {
          id: result.userMessage.id,
          role: 'user',
          content: result.userMessage.content,
          imageThumb: result.userMessage.imageThumb,
        },
        assistantMessage: {
          id: result.assistantMessage.id,
          role: 'assistant',
          content: result.assistantMessage.content,
          speechText: result.speechText,
          suggestions: result.suggestions,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'تعذر معالجة الطلب.' });
    }
  });
});

module.exports = router;
