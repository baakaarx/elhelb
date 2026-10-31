const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function verifyServer() {
  const tmpDb = path.join(os.tmpdir(), `elhelb-verify-${Date.now()}.db`);
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_IFRAME_PREVIEW = '0';
  delete process.env.E2B_SANDBOX_ID;
  process.env.DB_PATH = tmpDb;
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

  const app = require('../server/index');
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200, 'Health endpoint must return 200');
    assert.equal(
      healthRes.headers.get('x-frame-options'),
      'DENY',
      'Production server must enforce X-Frame-Options: DENY against clickjacking'
    );
    assert.ok(
      (healthRes.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"),
      'Production server must enforce Content-Security-Policy frame-ancestors none'
    );

    const providersRes = await fetch(`${base}/api/auth/oauth/providers`);
    assert.equal(providersRes.status, 200);
    const providersBody = await providersRes.json();
    assert.equal(
      providersBody.departments.length,
      14,
      'Database must seed all 14 official ELHELB GROUP departments'
    );

    const uiRes = await fetch(`${base}/`);
    assert.equal(uiRes.status, 200, 'Pre-built production frontend must serve 200 OK');

    console.log('✅ ELHELB BOARDS Production Self-Test Passed 100% (DB + 14 Depts + CSP/Clickjacking + UI)!');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const ext of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(`${tmpDb}${ext}`);
      } catch (_) {}
    }
  }
}

verifyServer().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
