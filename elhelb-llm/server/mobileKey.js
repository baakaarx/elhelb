const crypto = require('node:crypto');

const HASH_PREFIX = 'sha256:';

function hashMobileKey(value) {
  return HASH_PREFIX + crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function matchesMobileKey(provided, stored) {
  const expected = String(stored || '');
  const expectedHash = expected.startsWith(HASH_PREFIX) ? expected : hashMobileKey(expected);
  const providedHash = hashMobileKey(provided);
  const a = Buffer.from(providedHash);
  const b = Buffer.from(expectedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { HASH_PREFIX, hashMobileKey, matchesMobileKey };
