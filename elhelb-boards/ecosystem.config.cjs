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

function resolvePm2JwtSecret(dbPath) {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 32) {
    return process.env.JWT_SECRET.trim();
  }
  const secretFile = path.join(path.dirname(dbPath), '.jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    return generated;
  } catch (_) {
    return crypto.randomBytes(48).toString('hex');
  }
}

const resolvedDbPath = resolvePm2DbPath();
const resolvedJwtSecret = resolvePm2JwtSecret(resolvedDbPath);

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
        HOST: process.env.HOST || '0.0.0.0',
        PORT: process.env.PORT || 3000,
        DB_PATH: resolvedDbPath,
        JWT_SECRET: resolvedJwtSecret,
        TRUST_PROXY: process.env.TRUST_PROXY || '0',
      },
    },
  ],
};
