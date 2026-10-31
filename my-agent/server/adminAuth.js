const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./dataDir');

const ADMIN_KEY_PATH = path.join(DATA_DIR, '.admin.key');

let cachedAdminKey = null;

function getAdminKey() {
  if (process.env.ELHELB_ADMIN_KEY && process.env.ELHELB_ADMIN_KEY.trim().length >= 16) {
    return process.env.ELHELB_ADMIN_KEY.trim();
  }
  if (cachedAdminKey) return cachedAdminKey;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(ADMIN_KEY_PATH)) {
    const existing = fs.readFileSync(ADMIN_KEY_PATH, 'utf8').trim();
    if (existing.length >= 16) {
      cachedAdminKey = existing;
      return cachedAdminKey;
    }
  }

  const generated = 'elhelb_admin_' + crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(ADMIN_KEY_PATH, generated, { mode: 0o600 });
  cachedAdminKey = generated;
  return cachedAdminKey;
}

function requireAdminKey(req, res, next) {
  const expected = getAdminKey();
  const provided = String(req.headers['x-admin-key'] || '').trim();

  if (!provided || provided.length !== expected.length) {
    return res.status(403).json({
      error: 'هذا المسار مخصص لمدير النظام فقط (يتطلب ترويسة X-Admin-Key). واجهة الشات العامة متاحة للقراءة والاستفسار فقط.',
    });
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({
      error: 'مفتاح الإدارة X-Admin-Key غير صالح.',
    });
  }

  next();
}

module.exports = {
  getAdminKey,
  requireAdminKey,
};
