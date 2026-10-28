const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./dataDir');

const KEY_FILE = path.join(DATA_DIR, '.vault.key');
const ALGORITHM = 'aes-256-gcm';

let cachedKey = null;

function ensureVaultKey() {
  if (cachedKey) return cachedKey;

  if (process.env.ELHELB_VAULT_KEY) {
    const raw = process.env.ELHELB_VAULT_KEY.trim();
    cachedKey =
      raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
        ? Buffer.from(raw, 'hex')
        : crypto.createHash('sha256').update(raw).digest();
    return cachedKey;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    cachedKey = Buffer.from(hex, 'hex');
    return cachedKey;
  }

  const freshKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, freshKey.toString('hex'), { mode: 0o600 });
  cachedKey = freshKey;
  return cachedKey;
}

function encryptText(plainText) {
  const key = ensureVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    sha256: crypto.createHash('sha256').update(String(plainText), 'utf8').digest('hex'),
  };
}

function decryptText({ ciphertext, iv, authTag }) {
  const key = ensureVaultKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function getKeyFingerprint() {
  const key = ensureVaultKey();
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16).toUpperCase();
}

module.exports = {
  encryptText,
  decryptText,
  getKeyFingerprint,
};
