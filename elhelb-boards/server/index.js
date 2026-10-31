const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { initSchema, runUntracked, getWriteCounters, checkpointDatabase } = require('./db');
const { seedIfNeeded } = require('./seed');
const { extractCandidateTokens } = require('./rbac');
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
if (process.env.TRUST_PROXY === '1' || process.env.VERCEL) {
  app.set('trust proxy', 1);
}
app.set('etag', false);

const allowIframePreview =
  process.env.FORCE_STRICT_HEADERS !== '1' &&
  (process.env.ALLOW_IFRAME_PREVIEW === '1' || Boolean(process.env.E2B_SANDBOX_ID));

// Production Clickjacking & CSP protection (CSP stays 100% enforced at all times; preview mode only scopes frame-ancestors)
app.use(
  helmet({
    frameguard: allowIframePreview ? false : { action: 'deny' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: allowIframePreview
          ? ["'self'", 'https://*.arena.ai', 'https://*.lmarena.ai', 'https://*.e2b.app']
          : ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: allowIframePreview ? 'cross-origin' : 'same-origin' },
  })
);
app.use(cookieParser());

const standardJsonParser = express.json({ limit: '256kb' });
app.use((req, res, next) => {
  // Defer 5MB JSON parsing on /api/admin/backup/import until AFTER authenticate + Chairman check!
  if (req.path === '/api/admin/backup/import') return next();
  return standardJsonParser(req, res, next);
});

const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد الطلبات مرتفع جداً، يرجى الانتظار لحظات والمحاولة مجدداً' },
});
app.use('/api', globalApiLimiter);

const PUBLIC_API_SUBPATHS = new Set([
  '/health',
  '/auth/login',
  '/auth/register',
  '/auth/oauth/providers',
  '/auth/oauth/google/start',
  '/auth/oauth/google/callback',
]);
const PUBLIC_MUTATING_SUBPATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/oauth/google/callback',
]);

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

  const hasAuthCandidate = extractCandidateTokens(req).length > 0;
  const subPath = String(req.path || '');
  if (hasAuthCandidate || PUBLIC_API_SUBPATHS.has(subPath)) {
    const forceFreshPull =
      (req.method !== 'GET' && req.method !== 'HEAD' && hasAuthCandidate) ||
      PUBLIC_MUTATING_SUBPATHS.has(subPath);
    await cloudSync.syncBeforeRequest(forceFreshPull);
  }

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

app.get(['/health', '/api/health'], (req, res) => {
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
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    return res.status(413).json({ error: 'حجم البيانات المرسلة أكبر من الحد المسموح به أمنياً' });
  }
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400)) {
    return res.status(400).json({ error: 'صيغة بيانات الطلب (JSON) غير صالحة' });
  }
  console.error('Server error:', err);
  if (err && err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  res.status(500).json({ error: 'حدث خطأ داخلي في السيرفر' });
});

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`ELHELB Boards RBAC Server listening on http://${HOST}:${PORT}`);
  });

  let shuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ELHELB] Received ${signal} — flushing SQLite WAL & closing HTTP server cleanly...`);
    server.close(() => {
      checkpointDatabase();
      process.exit(0);
    });
    setTimeout(() => {
      checkpointDatabase();
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
