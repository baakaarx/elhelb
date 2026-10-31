const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolvePm2DbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  try {
    if (fs.existsSync('/opt/elhelb-data')) {
      fs.accessSync('/opt/elhelb-data', fs.constants.W_OK);
      return '/opt/elhelb-data/elhelb-boards.db';
    }
  } catch (_) {}
  const localDir = path.join(__dirname, 'data');
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch (_) {}
  return path.join(localDir, 'elhelb-boards.db');
}

function resolveOrGenerateSecretFile(filePath, generatorFn, minLen = 16) {
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8').trim();
      if (existing.length >= minLen) return existing;
    }
    const generated = generatorFn();
    fs.writeFileSync(filePath, generated, { mode: 0o600 });
    return generated;
  } catch (_) {
    return generatorFn();
  }
}

const resolvedDbPath = resolvePm2DbPath();
const dataDir = path.dirname(resolvedDbPath);

const resolvedJwtSecret =
  process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 32
    ? process.env.JWT_SECRET.trim()
    : resolveOrGenerateSecretFile(
        path.join(dataDir, '.jwt_secret'),
        () => crypto.randomBytes(48).toString('hex'),
        32
      );

const resolvedAdminInitPassword =
  process.env.ADMIN_INIT_PASSWORD && process.env.ADMIN_INIT_PASSWORD.trim().length >= 10
    ? process.env.ADMIN_INIT_PASSWORD.trim()
    : !fs.existsSync(resolvedDbPath)
    ? resolveOrGenerateSecretFile(
        path.join(dataDir, '.admin_init_password'),
        () => `Adm-${crypto.randomBytes(12).toString('base64url')}`,
        10
      )
    : '';

module.exports = {
  apps: [
    {
      name: 'elhelb-boards',
      cwd: __dirname,
      script: 'server/index.js',
      node_args: '--no-warnings',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: process.env.HOST || '127.0.0.1',
        PORT: process.env.PORT || 3000,
        DB_PATH: resolvedDbPath,
        JWT_SECRET: resolvedJwtSecret,
        ADMIN_INIT_PASSWORD: resolvedAdminInitPassword,
        TRUST_PROXY: process.env.TRUST_PROXY || '1',
      },
    },
  ],
};
