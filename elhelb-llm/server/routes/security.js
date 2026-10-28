const crypto = require('node:crypto');
const express = require('express');
const { get, all, run } = require('../db');
const { getKeyFingerprint } = require('../cryptoVault');
const { validateAirGapUrl, probeLocalProvider } = require('../llmEngine');

const router = express.Router();

router.get('/status', async (_req, res) => {
  const settings = get('SELECT * FROM security_settings WHERE id = 1');
  const docCount = get("SELECT COUNT(*) AS c FROM documents WHERE source_type != 'dataset_index'")?.c || 0;
  const datasetCount = get('SELECT COUNT(*) AS c FROM datasets')?.c || 0;
  const chunkCount = get('SELECT COUNT(*) AS c FROM document_chunks')?.c || 0;
  const probe = await probeLocalProvider(settings);
  const recentLogs = all('SELECT * FROM api_logs ORDER BY id DESC LIMIT 30');

  res.json({
    settings: {
      provider: settings.provider,
      ollama_url: settings.ollama_url,
      local_openai_url: settings.local_openai_url,
      airgap_lock: Boolean(settings.airgap_lock),
      dlp_mode: settings.dlp_mode,
      mask_phones: Boolean(settings.mask_phones),
      require_mobile_key: Boolean(settings.require_mobile_key),
      mobile_api_key: settings.mobile_api_key,
    },
    vaultStats: {
      algorithm: 'AES-256-GCM',
      keyFingerprint: getKeyFingerprint(),
      encryptedDocuments: docCount,
      encryptedDatasets: datasetCount,
      encryptedChunks: chunkCount,
    },
    localServerProbe: probe,
    recentLogs,
  });
});

router.put('/settings', (req, res) => {
  const current = get('SELECT * FROM security_settings WHERE id = 1');
  const airgapLock =
    req.body?.airgap_lock !== undefined ? Boolean(req.body.airgap_lock) : Boolean(current.airgap_lock);
  const provider = ['auto', 'local_engine', 'ollama', 'local_openai'].includes(req.body?.provider)
    ? req.body.provider
    : current.provider;
  const ollamaUrl = String(req.body?.ollama_url || current.ollama_url).trim();
  const localOpenaiUrl = String(req.body?.local_openai_url || current.local_openai_url).trim();
  const dlpMode = ['mask', 'warn', 'off'].includes(req.body?.dlp_mode)
    ? req.body.dlp_mode
    : current.dlp_mode;
  const maskPhones =
    req.body?.mask_phones !== undefined ? Boolean(req.body.mask_phones) : Boolean(current.mask_phones);
  const requireMobileKey =
    req.body?.require_mobile_key !== undefined
      ? Boolean(req.body.require_mobile_key)
      : Boolean(current.require_mobile_key);

  const checkOllama = validateAirGapUrl(ollamaUrl, airgapLock);
  if (!checkOllama.allowed) {
    return res.status(403).json({ error: checkOllama.reason });
  }

  const checkOpenai = validateAirGapUrl(localOpenaiUrl, airgapLock);
  if (!checkOpenai.allowed) {
    return res.status(403).json({ error: checkOpenai.reason });
  }

  run(
    `UPDATE security_settings
     SET provider = ?, ollama_url = ?, local_openai_url = ?, airgap_lock = ?,
         dlp_mode = ?, mask_phones = ?, require_mobile_key = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [
      provider,
      checkOllama.normalizedUrl,
      checkOpenai.normalizedUrl,
      airgapLock ? 1 : 0,
      dlpMode,
      maskPhones ? 1 : 0,
      requireMobileKey ? 1 : 0,
    ]
  );

  const updated = get('SELECT * FROM security_settings WHERE id = 1');
  res.json({
    settings: {
      provider: updated.provider,
      ollama_url: updated.ollama_url,
      local_openai_url: updated.local_openai_url,
      airgap_lock: Boolean(updated.airgap_lock),
      dlp_mode: updated.dlp_mode,
      mask_phones: Boolean(updated.mask_phones),
      require_mobile_key: Boolean(updated.require_mobile_key),
      mobile_api_key: updated.mobile_api_key,
    },
  });
});

router.post('/regenerate-key', (_req, res) => {
  const freshKey = 'elhelb_live_' + crypto.randomBytes(16).toString('hex');
  run("UPDATE security_settings SET mobile_api_key = ?, updated_at = datetime('now') WHERE id = 1", [
    freshKey,
  ]);
  res.json({ mobile_api_key: freshKey });
});

module.exports = router;
