const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { initSchema, runUntracked, getWriteCounters } = require('./db');
const { seedIfNeeded } = require('./seed');
const cloudSync = require('./cloudSync');

const authRoutes = require('./routes/auth');
const { router: oauthRoutes } = require('./routes/oauth');
const onboardingRoutes = require('./routes/onboarding');
const boardsRoutes = require('./routes/boards');
const kanbanRoutes = require('./routes/kanban');
const requestsRoutes = require('./routes/requests');
const adminRoutes = require('./routes/admin');

runUntracked(() => {
  initSchema();
  seedIfNeeded();
});

const app = express();
app.set('trust proxy', 1);
app.set('etag', false);

// Configured for both production security and seamless iframe Live Preview embedding
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '256kb' }));

// Strict zero-caching on ALL API endpoints + Cloud Persistent DB Sync across Serverless containers
app.use('/api', async (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'private, no-store, no-cache, max-age=0, must-revalidate, proxy-revalidate'
  );
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Authorization, X-Elhelb-Token, Cookie');

  const forceFreshPull = req.method !== 'GET' && req.method !== 'HEAD';
  await cloudSync.syncBeforeRequest(forceFreshPull);

  const beforeCounters = getWriteCounters();
  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);
  const origRedirect = res.redirect.bind(res);
  let flushed = false;

  res.json = function patchedJson(body) {
    const afterCounters = getWriteCounters();
    if (flushed || afterCounters.total === beforeCounters.total) {
      flushed = true;
      return origJson(body);
    }
    flushed = true;
    const coreChanged = afterCounters.core !== beforeCounters.core;
    cloudSync
      .syncAfterMutation({ coreChanged })
      .finally(() => origJson(body));
    return res;
  };

  res.send = function patchedSend(body) {
    if (flushed) {
      return origSend(body);
    }
    const afterCounters = getWriteCounters();
    if (afterCounters.total === beforeCounters.total) {
      flushed = true;
      return origSend(body);
    }
    flushed = true;
    const coreChanged = afterCounters.core !== beforeCounters.core;
    cloudSync
      .syncAfterMutation({ coreChanged })
      .finally(() => origSend(body));
    return res;
  };

  res.redirect = function patchedRedirect(...args) {
    if (flushed) {
      return origRedirect(...args);
    }
    const afterCounters = getWriteCounters();
    if (afterCounters.total === beforeCounters.total) {
      flushed = true;
      return origRedirect(...args);
    }
    flushed = true;
    const coreChanged = afterCounters.core !== beforeCounters.core;
    cloudSync
      .syncAfterMutation({ coreChanged })
      .finally(() => origRedirect(...args));
    return res;
  };

  next();
});

app.get('/health', (req, res) => {
  const st = cloudSync.getStorageStatus();
  res.json({
    ok: true,
    service: 'elhelb-boards',
    storage: {
      persistent: st.persistent,
      provider: st.provider,
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api', boardsRoutes);
app.use('/api', kanbanRoutes);
app.use('/api', requestsRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'نقطة الاتصال البرمجية غير موجودة' });
});

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      etag: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    })
  );
  app.get('*', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.sendFile(indexPath);
    }
    res.status(503).send('يرجى بناء الواجهة أولاً عبر npm run build');
  });
}

// Central error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err && err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  res.status(500).json({ error: 'حدث خطأ داخلي في السيرفر' });
});

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`ELHELB Boards RBAC Server listening on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
