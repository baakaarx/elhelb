const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initSchema, get } = require('./db');
const { seedIfNeeded } = require('./seed');
const { getAdminKey, requireAdminKey } = require('./adminAuth');
const { processCompanyQuery } = require('./companyBrainService');

const chatRoutes = require('./routes/chat');
const vaultRoutes = require('./routes/vault');
const studioRoutes = require('./routes/studio');
const securityRoutes = require('./routes/security');
const { mobileRouter, checkMobileApiKey } = require('./routes/mobileApi');

initSchema();
seedIfNeeded();
getAdminKey();

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);

app.use(express.json({ limit: '10mb' }));

// حماية الواجهة العامة المفتوحة للجمهور من الإغراق (Rate Limiting)
const publicChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تم إرسال عدد كبير من الرسائل خلال دقيقة واحدة، يرجى الانتظار لحظات والمحاولة مجدداً.' },
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({
    ok: true,
    service: 'elhelb-public-chatbot',
  });
});

// بيانات عامة آمنة للواجهة بدون كشف أي مفاتيح أو إعدادات داخلية
app.get('/api/bootstrap', (_req, res) => {
  const modelProfile = get('SELECT display_name FROM model_profile WHERE id = 1');
  res.json({
    ok: true,
    displayName: modelProfile?.display_name || 'المساعد الذكي لمجموعة الهلب',
  });
});

// مسارات الشات العام للموقع والموبايل (مفتوحة للجمهور مع عزل الجلسات وحماية Rate Limit)
app.use('/api/chat', publicChatLimiter, chatRoutes);
app.use('/api/v1', publicChatLimiter, mobileRouter);

// واجهة متوافقة مع مكتبات OpenAI لتطبيق الموبايل
app.post('/v1/chat/completions', publicChatLimiter, checkMobileApiKey, async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    let textPrompt = '';
    let imageBase64 = null;

    if (typeof lastUser?.content === 'string') {
      textPrompt = lastUser.content;
    } else if (Array.isArray(lastUser?.content)) {
      for (const part of lastUser.content) {
        if (part.type === 'text' && part.text) {
          textPrompt += (textPrompt ? '\n' : '') + part.text;
        } else if (part.type === 'image_url' && part.image_url?.url) {
          imageBase64 = part.image_url.url;
        }
      }
    }

    const result = await processCompanyQuery({
      message: String(textPrompt).slice(0, 3000),
      imageInput: imageBase64,
      sessionId: 'oai_' + crypto.randomUUID(),
      channel: 'mobile-openai-sdk',
      persistChat: false,
    });

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.engineUsed,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.reply,
          },
          finish_reason: 'stop',
        },
      ],
    });
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

// المسارات الإدارية مغلقة تماماً أمام الجمهور ومحمية بمفتاح الإدارة السري (X-Admin-Key)
app.use('/api/vault', requireAdminKey, vaultRoutes);
app.use('/api/studio', requireAdminKey, studioRoutes);
app.use('/api/security', requireAdminKey, securityRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'مسار الـ API غير موجود.' });
});

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 ELHELB GROUP Public AI Chatbot running on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
