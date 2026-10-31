const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { all, run } = require('../db');
const { processCompanyQuery } = require('../companyBrainService');
const { decryptField } = require('../secureFields');
const { isValidPrivateSessionId } = require('../sessionId');

const router = express.Router();

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav',
  'audio/x-wav', 'audio/aac', 'audio/3gpp', 'audio/3gpp2', 'audio/x-m4a',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'image' && ALLOWED_IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
    if (file.fieldname === 'voice' && (ALLOWED_AUDIO_MIMES.has(file.mimetype) || file.mimetype.startsWith('audio/'))) return cb(null, true);
    if (file.fieldname === 'image') return cb(new Error('يرجى إرفاق صورة بصيغة PNG أو JPG أو WebP فقط.'));
    if (file.fieldname === 'voice') return cb(new Error('يرجى إرفاق تسجيل صوتي بصيغة مدعومة.'));
    return cb(new Error('نوع المرفق غير مدعوم.'));
  },
});

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
     ORDER BY id DESC
     LIMIT 60`,
    [sessionId]
  );

  res.json({
    messages: rows.reverse().map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(decryptField(r.meta_json) || '{}');
      } catch {
        meta = {};
      }
      return {
        id: r.id,
        role: r.role,
        content: decryptField(r.content),
        imageThumb: decryptField(r.image_thumb) || null,
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
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'voice', maxCount: 1 }])(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'تعذر رفع المرفق.' });
    }

    try {
      const rawMessage = String(req.body?.message || '').slice(0, 3000);
      const voiceFile = req.files?.voice?.[0] || null;
      if (voiceFile && !rawMessage.trim()) {
        return res.status(400).json({ error: 'تعذر تفريغ الفويس نوت إلى نص؛ اكتب ملخصاً قصيراً وأعد الإرسال.' });
      }
      const requestedLanguage = String(req.body?.language || 'ar').toLowerCase();
      const language = requestedLanguage.startsWith('en') ? 'en' : 'ar';
      const rawSessionId = String(req.body?.sessionId || '');
      const sessionId = isValidPrivateSessionId(rawSessionId)
        ? rawSessionId
        : 'ephemeral_' + crypto.randomUUID();
      const shouldPersist = isValidPrivateSessionId(rawSessionId);

      const imageFile = req.files?.image?.[0] || null;
      const imageInput = imageFile ? imageFile.buffer : req.body?.imageBase64 || null;

      const result = await processCompanyQuery({
        message: rawMessage,
        imageInput,
        sessionId,
        channel: 'web',
        persistChat: shouldPersist,
        language,
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
      res.status(err.status || 400).json({ error: err.message || 'تعذر معالجة الطلب.' });
    }
  });
});

module.exports = router;
