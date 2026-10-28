const crypto = require('crypto');
const zlib = require('zlib');
const {
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  runUntracked,
} = require('./db');
const { seedIfNeeded } = require('./seed');

const FETCH_TIMEOUT_MS = 4500;
const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

let syncedRev = '';
let lastPullCheckedAt = 0;
let inFlightPull = null;
let inFlightPush = Promise.resolve();
let detectedBlobAccessMode = 'private';
let tursoTableInitialized = false;
let lastSyncError = '';

function deriveCipherKey(secretMaterial) {
  const jwtPart = process.env.JWT_SECRET || 'elhelb-sovereign-v10-isolated-2026-secret';
  return crypto
    .createHash('sha256')
    .update(`elhelb-cloud-snapshot-v11:${secretMaterial}:${jwtPart}`)
    .digest();
}

function encodeSnapshot(snapshot, secretMaterial) {
  const jsonBuf = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const gzBuf = zlib.gzipSync(jsonBuf, { level: 6 });
  const key = deriveCipherKey(secretMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(gzBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('EHB1', 'utf8'), iv, authTag, encrypted]);
}

function decodeSnapshot(rawBuf, secretMaterial) {
  const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
  if (buf.length < 33 || buf.subarray(0, 4).toString('utf8') !== 'EHB1') {
    throw new Error('Invalid encrypted cloud snapshot header');
  }
  const iv = buf.subarray(4, 16);
  const authTag = buf.subarray(16, 32);
  const ciphertext = buf.subarray(32);
  const key = deriveCipherKey(secretMaterial);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const gzBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const jsonStr = zlib.gunzipSync(gzBuf).toString('utf8');
  return JSON.parse(jsonStr);
}

function resolveActiveProvider() {
  const kvUrl = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  ).trim();
  const kvToken = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim();
  if (kvUrl && kvToken) {
    return {
      type: 'upstash_kv',
      label: 'Upstash Serverless Redis (Vercel KV)',
      url: kvUrl.replace(/\/+$/, ''),
      token: kvToken,
      secretMaterial: kvToken,
      prefix: (process.env.ELHELB_CLOUD_PREFIX || 'elhelb:v11').trim(),
      checkIntervalMs: 120,
      syncAuxLogs: true,
    };
  }

  const blobToken = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (blobToken) {
    const parts = blobToken.split('_');
    const storeId = parts[3] || '';
    return {
      type: 'vercel_blob',
      label: 'Vercel Blob Cloud Storage',
      apiUrl: (process.env.VERCEL_BLOB_API_URL || 'https://vercel.com/api/blob').replace(
        /\/+$/,
        ''
      ),
      token: blobToken,
      storeId,
      secretMaterial: blobToken,
      prefix: (process.env.ELHELB_BLOB_PREFIX || 'elhelb-db-v11/snap-').trim(),
      checkIntervalMs: 900,
      syncAuxLogs: false,
    };
  }

  const tursoUrl = (process.env.TURSO_DATABASE_URL || '').trim();
  const tursoToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (tursoUrl && tursoToken) {
    const httpUrl = tursoUrl
      .replace(/^libsql:\/\//i, 'https://')
      .replace(/\/+$/, '');
    return {
      type: 'turso_http',
      label: 'Turso Cloud SQLite',
      httpUrl,
      token: tursoToken,
      secretMaterial: tursoToken,
      key: (process.env.ELHELB_CLOUD_PREFIX || 'elhelb_v11').trim(),
      checkIntervalMs: 150,
      syncAuxLogs: true,
    };
  }

  return null;
}

// ==========================================
// 1. UPSTASH REDIS / VERCEL KV ADAPTER
// ==========================================
async function kvCheckRev(cfg) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['GET', `${cfg.prefix}:rev`]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`KV rev HTTP ${res.status}`);
  }
  const data = await res.json();
  return data && data.result ? String(data.result) : null;
}

async function kvPull(cfg) {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['GET', `${cfg.prefix}:rev`],
      ['GET', `${cfg.prefix}:state`],
    ]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`KV pull HTTP ${res.status}`);
  }
  const items = await res.json();
  const rev = items?.[0]?.result ? String(items[0].result) : null;
  const stateB64 = items?.[1]?.result ? String(items[1].result) : null;
  if (!rev || !stateB64) return null;
  return {
    rev,
    buf: Buffer.from(stateB64, 'base64'),
  };
}

async function kvPush(cfg, rev, buf) {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['SET', `${cfg.prefix}:state`, buf.toString('base64')],
      ['SET', `${cfg.prefix}:rev`, rev],
    ]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`KV push HTTP ${res.status}`);
  }
  return rev;
}

// ==========================================
// 2. VERCEL BLOB REST v13 ADAPTER (Zero-Dep, Encrypted)
// ==========================================
function blobApiHeaders(cfg, extra = {}) {
  return {
    authorization: `Bearer ${cfg.token}`,
    'x-api-version': '13',
    'x-vercel-blob-store-id': cfg.storeId,
    'x-api-blob-request-id': `${cfg.storeId}:${Date.now()}:${Math.random()
      .toString(16)
      .slice(2, 8)}`,
    'x-api-blob-request-attempt': '0',
    ...extra,
  };
}

async function blobListSnapshots(cfg) {
  const qs = new URLSearchParams({
    prefix: cfg.prefix,
    limit: '25',
  });
  const res = await fetch(`${cfg.apiUrl}?${qs.toString()}`, {
    method: 'GET',
    headers: blobApiHeaders(cfg),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Vercel Blob list HTTP ${res.status}`);
  }
  const data = await res.json();
  const blobs = Array.isArray(data?.blobs) ? data.blobs : [];
  blobs.sort((a, b) =>
    String(b.pathname || '').localeCompare(String(a.pathname || ''))
  );
  return blobs;
}

async function blobDownload(cfg, blobItem) {
  const rawUrl = blobItem.url || blobItem.downloadUrl;
  const u = new URL(rawUrl);
  u.searchParams.set('cache', '0');

  let res = await fetch(u.toString(), {
    method: 'GET',
    headers: { authorization: `Bearer ${cfg.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Public Vercel Blob stores serve directly without Authorization header
    res = await fetch(rawUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  }

  if (!res.ok) {
    throw new Error(`Vercel Blob download HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function blobPutRaw(cfg, pathname, buf, accessMode) {
  const qs = new URLSearchParams({ pathname });
  return fetch(`${cfg.apiUrl}/?${qs.toString()}`, {
    method: 'PUT',
    headers: blobApiHeaders(cfg, {
      'x-vercel-blob-access': accessMode,
      'x-content-type': 'application/octet-stream',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '0',
      'x-content-length': String(buf.length),
    }),
    body: buf,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function blobPush(cfg, buf) {
  const pathname = `${cfg.prefix}${String(Date.now()).padStart(15, '0')}-${INSTANCE_ID}-${crypto
    .randomBytes(3)
    .toString('hex')}.bin`;

  let res = await blobPutRaw(cfg, pathname, buf, detectedBlobAccessMode);
  if (!res.ok && (res.status === 400 || res.status === 403)) {
    const altMode = detectedBlobAccessMode === 'private' ? 'public' : 'private';
    const retryRes = await blobPutRaw(cfg, pathname, buf, altMode);
    if (retryRes.ok) {
      detectedBlobAccessMode = altMode;
      res = retryRes;
    }
  }

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`Vercel Blob put HTTP ${res.status}: ${errTxt.slice(0, 140)}`);
  }

  // Prune older snapshots keeping the newest 2 so usage stays ~30 KB forever
  try {
    const allBlobs = await blobListSnapshots(cfg);
    if (allBlobs.length > 2) {
      const staleUrls = allBlobs.slice(2).map((b) => b.url);
      await fetch(`${cfg.apiUrl}/delete`, {
        method: 'POST',
        headers: blobApiHeaders(cfg, { 'content-type': 'application/json' }),
        body: JSON.stringify({ urls: staleUrls }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    }
  } catch (_) {}

  return pathname;
}

// ==========================================
// 3. TURSO CLOUD SQLITE HTTP ADAPTER
// ==========================================
async function tursoPipeline(cfg, requests) {
  const res = await fetch(`${cfg.httpUrl}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [...requests, { type: 'close' }],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Turso HTTP ${res.status}`);
  }
  return res.json();
}

async function ensureTursoTable(cfg) {
  if (tursoTableInitialized) return;
  await tursoPipeline(cfg, [
    {
      type: 'execute',
      stmt: {
        sql: `CREATE TABLE IF NOT EXISTS elhelb_cloud_snapshots (
                k TEXT PRIMARY KEY,
                rev TEXT NOT NULL,
                state_b64 TEXT NOT NULL,
                updated_at TEXT NOT NULL
              )`,
      },
    },
  ]);
  tursoTableInitialized = true;
}

async function tursoCheckRev(cfg) {
  await ensureTursoTable(cfg);
  const data = await tursoPipeline(cfg, [
    {
      type: 'execute',
      stmt: {
        sql: `SELECT rev FROM elhelb_cloud_snapshots WHERE k = ?`,
        args: [{ type: 'text', value: cfg.key }],
      },
    },
  ]);
  const rows = data?.results?.[0]?.response?.result?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0]?.[0]?.value ? String(rows[0][0].value) : null;
}

async function tursoPull(cfg) {
  await ensureTursoTable(cfg);
  const data = await tursoPipeline(cfg, [
    {
      type: 'execute',
      stmt: {
        sql: `SELECT rev, state_b64 FROM elhelb_cloud_snapshots WHERE k = ?`,
        args: [{ type: 'text', value: cfg.key }],
      },
    },
  ]);
  const rows = data?.results?.[0]?.response?.result?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const rev = rows[0]?.[0]?.value ? String(rows[0][0].value) : null;
  const stateB64 = rows[0]?.[1]?.value ? String(rows[0][1].value) : null;
  if (!rev || !stateB64) return null;
  return {
    rev,
    buf: Buffer.from(stateB64, 'base64'),
  };
}

async function tursoPush(cfg, rev, buf) {
  await ensureTursoTable(cfg);
  await tursoPipeline(cfg, [
    {
      type: 'execute',
      stmt: {
        sql: `INSERT INTO elhelb_cloud_snapshots (k, rev, state_b64, updated_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(k) DO UPDATE SET
                rev = excluded.rev,
                state_b64 = excluded.state_b64,
                updated_at = excluded.updated_at`,
        args: [
          { type: 'text', value: cfg.key },
          { type: 'text', value: rev },
          { type: 'text', value: buf.toString('base64') },
        ],
      },
    },
  ]);
  return rev;
}

// ==========================================
// UNIFIED SYNC ORCHESTRATOR
// ==========================================
async function performCloudPush(cfg) {
  const snapshot = exportDatabaseSnapshot();
  const encryptedBuf = encodeSnapshot(snapshot, cfg.secretMaterial);
  const candidateRev = `${String(Date.now()).padStart(15, '0')}-${INSTANCE_ID}-${crypto
    .randomBytes(3)
    .toString('hex')}`;

  if (cfg.type === 'upstash_kv') {
    syncedRev = await kvPush(cfg, candidateRev, encryptedBuf);
  } else if (cfg.type === 'vercel_blob') {
    syncedRev = await blobPush(cfg, encryptedBuf);
  } else if (cfg.type === 'turso_http') {
    syncedRev = await tursoPush(cfg, candidateRev, encryptedBuf);
  }
  lastPullCheckedAt = Date.now();
  lastSyncError = '';
  return syncedRev;
}

async function performCloudPullInternal(cfg, force = false) {
  const now = Date.now();
  if (!force && syncedRev && now - lastPullCheckedAt < cfg.checkIntervalMs) {
    return syncedRev;
  }

  if (cfg.type === 'upstash_kv') {
    const remoteRev = await kvCheckRev(cfg);
    lastPullCheckedAt = Date.now();
    if (!remoteRev) {
      // Cloud store is brand-new & empty: seed it with our current initialized DB
      return performCloudPush(cfg);
    }
    if (remoteRev === syncedRev) {
      return syncedRev;
    }
    const pulled = await kvPull(cfg);
    if (pulled && pulled.buf) {
      const decoded = decodeSnapshot(pulled.buf, cfg.secretMaterial);
      importDatabaseSnapshot(decoded);
      runUntracked(() => seedIfNeeded());
      syncedRev = pulled.rev;
      lastSyncError = '';
    }
    return syncedRev;
  }

  if (cfg.type === 'vercel_blob') {
    const blobs = await blobListSnapshots(cfg);
    lastPullCheckedAt = Date.now();
    if (blobs.length === 0) {
      return performCloudPush(cfg);
    }
    const latest = blobs[0];
    if (latest.pathname === syncedRev) {
      return syncedRev;
    }
    const buf = await blobDownload(cfg, latest);
    const decoded = decodeSnapshot(buf, cfg.secretMaterial);
    importDatabaseSnapshot(decoded);
    runUntracked(() => seedIfNeeded());
    syncedRev = latest.pathname;
    lastSyncError = '';
    return syncedRev;
  }

  if (cfg.type === 'turso_http') {
    const remoteRev = await tursoCheckRev(cfg);
    lastPullCheckedAt = Date.now();
    if (!remoteRev) {
      return performCloudPush(cfg);
    }
    if (remoteRev === syncedRev) {
      return syncedRev;
    }
    const pulled = await tursoPull(cfg);
    if (pulled && pulled.buf) {
      const decoded = decodeSnapshot(pulled.buf, cfg.secretMaterial);
      importDatabaseSnapshot(decoded);
      runUntracked(() => seedIfNeeded());
      syncedRev = pulled.rev;
      lastSyncError = '';
    }
    return syncedRev;
  }

  return syncedRev;
}

async function syncBeforeRequest(force = false) {
  const cfg = resolveActiveProvider();
  if (!cfg) return null;

  if (inFlightPull) {
    return inFlightPull;
  }

  inFlightPull = performCloudPullInternal(cfg, force)
    .catch((err) => {
      lastSyncError = err.message || String(err);
      console.error('[CloudSync] Pull error:', lastSyncError);
      return null;
    })
    .finally(() => {
      inFlightPull = null;
    });

  return inFlightPull;
}

async function syncAfterMutation({ coreChanged = true } = {}) {
  const cfg = resolveActiveProvider();
  if (!cfg) return null;
  if (!coreChanged && !cfg.syncAuxLogs) {
    return syncedRev;
  }

  const nextTask = inFlightPush.then(async () => {
    try {
      return await performCloudPush(cfg);
    } catch (err) {
      lastSyncError = err.message || String(err);
      console.error('[CloudSync] Push error:', lastSyncError);
      return null;
    }
  });
  inFlightPush = nextTask.catch(() => null);
  return nextTask;
}

function getStorageStatus() {
  const cfg = resolveActiveProvider();
  const isServerless = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  );

  if (cfg) {
    return {
      persistent: true,
      provider: cfg.type,
      label: cfg.label,
      ephemeralWarning: false,
      syncedRev: syncedRev || null,
      lastSyncError: lastSyncError || null,
    };
  }

  if (isServerless) {
    return {
      persistent: false,
      provider: 'ephemeral_tmp',
      label: 'ذاكرة Vercel المؤقتة (/tmp) — بانتظار ربط Storage المجاني',
      ephemeralWarning: true,
      syncedRev: null,
      lastSyncError: null,
    };
  }

  return {
    persistent: true,
    provider: 'local_disk',
    label: 'قرص السيرفر المحلي الدائم (SQLite Disk)',
    ephemeralWarning: false,
    syncedRev: null,
    lastSyncError: null,
  };
}

function resetCloudSyncStateForTests() {
  syncedRev = '';
  lastPullCheckedAt = 0;
  inFlightPull = null;
  inFlightPush = Promise.resolve();
  detectedBlobAccessMode = 'private';
  tursoTableInitialized = false;
  lastSyncError = '';
}

module.exports = {
  encodeSnapshot,
  decodeSnapshot,
  resolveActiveProvider,
  syncBeforeRequest,
  syncAfterMutation,
  getStorageStatus,
  resetCloudSyncStateForTests,
};
