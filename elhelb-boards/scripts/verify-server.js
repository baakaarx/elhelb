const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function verifyServer() {
  // 1. Verify production server REFUSES to initialize a fresh DB without ADMIN_INIT_PASSWORD
  const noPwDb = path.join(os.tmpdir(), `elhelb-verify-nopw-${Date.now()}.db`);
  try {
    let failedWithoutAdminPw = false;
    try {
      await execFileAsync(
        process.execPath,
        ['--no-warnings', '-e', 'require("./server/index.js")'],
        {
          cwd: path.join(__dirname, '..'),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DB_PATH: noPwDb,
            JWT_SECRET: crypto.randomBytes(48).toString('hex'),
            ADMIN_INIT_PASSWORD: '',
          },
        }
      );
    } catch (err) {
      failedWithoutAdminPw = String(err.stderr || err.message || '').includes('ADMIN_INIT_PASSWORD');
    }
    assert.equal(
      failedWithoutAdminPw,
      true,
      'Production boot on fresh DB must refuse startup without ADMIN_INIT_PASSWORD'
    );
  } finally {
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${noPwDb}${ext}`); } catch (_) {}
    }
  }

  // 2. Verify full production boot with valid secrets
  const tmpDb = path.join(os.tmpdir(), `elhelb-verify-${Date.now()}.db`);
  const verifyAdminPw = `Verify#${crypto.randomBytes(12).toString('hex')}`;
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_IFRAME_PREVIEW = '0';
  delete process.env.E2B_SANDBOX_ID;
  process.env.DB_PATH = tmpDb;
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.ADMIN_INIT_PASSWORD = verifyAdminPw;

  const app = require('../server/index');
  const { all: dbAll } = require('../server/db');
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
      13,
      'Public providers endpoint must return ONLY the 13 non-sovereign departments'
    );
    assert.equal(
      providersBody.departments.some((d) => d.is_chairman_exclusive || d.slug === 'ai_systems'),
      false,
      'Public providers endpoint must NEVER expose sovereign departments'
    );
    assert.equal(
      dbAll('SELECT id FROM departments').length,
      14,
      'Database must seed all 14 official ELHELB GROUP departments (13 regular + 1 sovereign)'
    );

    const uiRes = await fetch(`${base}/`);
    assert.equal(uiRes.status, 200, 'Pre-built production frontend must serve 200 OK');

    console.log('✅ ELHELB BOARDS Production Self-Test Passed 100% (Mandatory Secrets + 14 Depts + Sovereign Privacy + CSP/Clickjacking + UI)!');
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
