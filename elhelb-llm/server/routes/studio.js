const express = require('express');
const { get, all, run, CATEGORIES } = require('../db');
const { decryptText } = require('../cryptoVault');
const { encryptField, decryptField } = require('../secureFields');

const router = express.Router();

function buildOllamaModelfile(profile) {
  const escapedSystem = String(profile.system_prompt || '').replace(/"""/g, '\\"\\"\\"');
  return `# ====================================================================
# Ollama Modelfile — الموديل الخاص بشركتك (ELHELB Company AI)
# 1) للمحادثة وتحليل البيانات بالعربية:
#    ollama pull ${profile.base_model || 'qwen2.5:7b'}
#    ollama create ${profile.model_name || 'elhelb-ai-v1'} -f Modelfile
#
# 2) لدعم تحليل الصور العميق (Vision):
#    ollama pull ${profile.vision_model || 'llama3.2-vision'}
# ====================================================================

FROM ${profile.base_model || 'qwen2.5:7b'}

PARAMETER temperature ${Number(profile.temperature ?? 0.2)}
PARAMETER num_ctx ${Number(profile.context_length ?? 8192)}
PARAMETER top_p 0.9

SYSTEM """
${escapedSystem}
"""
`;
}

router.get('/overview', (_req, res) => {
  const profile = get('SELECT * FROM model_profile WHERE id = 1');
  const examples = all('SELECT * FROM training_examples ORDER BY id DESC').map((ex) => ({
    ...ex,
    instruction: decryptField(ex.instruction),
    input_context: decryptField(ex.input_context),
    output_response: decryptField(ex.output_response),
    category_label: CATEGORIES[ex.category] || ex.category,
  }));

  res.json({
    modelProfile: profile,
    examples,
    modelfile: buildOllamaModelfile(profile),
    categories: CATEGORIES,
  });
});

router.put('/model-profile', (req, res) => {
  const current = get('SELECT * FROM model_profile WHERE id = 1');
  const modelName = String(req.body?.model_name || current.model_name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '-');
  const displayName = String(req.body?.display_name || current.display_name).trim();
  const baseModel = String(req.body?.base_model || current.base_model).trim();
  const visionModel = String(req.body?.vision_model || current.vision_model || 'llama3.2-vision').trim();
  const systemPrompt = String(req.body?.system_prompt || current.system_prompt).trim();
  const temperature = Math.max(0, Math.min(1.2, Number(req.body?.temperature ?? current.temperature)));
  const contextLength = Math.max(2048, Math.min(32768, Number(req.body?.context_length ?? current.context_length)));

  run(
    `UPDATE model_profile
     SET model_name = ?, display_name = ?, base_model = ?, vision_model = ?,
         system_prompt = ?, temperature = ?, context_length = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [modelName, displayName, baseModel, visionModel, systemPrompt, temperature, contextLength]
  );

  const updated = get('SELECT * FROM model_profile WHERE id = 1');
  res.json({
    modelProfile: updated,
    modelfile: buildOllamaModelfile(updated),
  });
});

router.post('/examples', (req, res) => {
  const instruction = String(req.body?.instruction || '').trim();
  const inputContext = String(req.body?.input_context || '').trim();
  const outputResponse = String(req.body?.output_response || '').trim();
  const category = CATEGORIES[req.body?.category] ? req.body.category : 'general';
  const isPublic = req.body?.is_public === true;

  if (!instruction || !outputResponse) {
    return res.status(400).json({ error: 'السؤال والإجابة النموذجية مطلوبان.' });
  }

  const ins = run(
    `INSERT INTO training_examples (instruction, input_context, output_response, category, is_public)
     VALUES (?, ?, ?, ?, ?)`,
    [
      encryptField(instruction),
      encryptField(inputContext),
      encryptField(outputResponse),
      category,
      isPublic ? 1 : 0,
    ]
  );
  res.status(201).json({
    example: get('SELECT * FROM training_examples WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.post('/auto-generate', (_req, res) => {
  const chunkRows = all(
    `SELECT c.section_title, c.text_ciphertext, c.text_iv, c.text_auth_tag,
            d.title AS doc_title, d.category, d.source_type
     FROM document_chunks c
     JOIN documents d ON d.id = c.doc_id
     WHERE d.source_type != 'dataset_index'
     ORDER BY c.id DESC`
  );

  const existing = new Set(all('SELECT instruction FROM training_examples').map((r) => decryptField(r.instruction).trim()));
  let generatedCount = 0;

  for (const ch of chunkRows) {
    if (generatedCount >= 6) break;
    const plain = decryptText({
      ciphertext: ch.text_ciphertext,
      iv: ch.text_iv,
      authTag: ch.text_auth_tag,
    }).trim();
    const cleanBody = plain.replace(/^#{1,4}\s+[^\n]+\n?/, '').trim();
    if (cleanBody.length < 35) continue;

    const instruction = `ما هي تفاصيل وقواعد الشركة بخصوص «${ch.section_title}»؟`;
    if (existing.has(instruction)) continue;

    run(
      `INSERT INTO training_examples (instruction, input_context, output_response, category)
       VALUES (?, ?, ?, ?)`,
      [encryptField(instruction), encryptField(ch.doc_title), encryptField(cleanBody), ch.category]
    );
    existing.add(instruction);
    generatedCount++;
  }

  res.json({ ok: true, generatedCount });
});

router.delete('/examples/:id', (req, res) => {
  run('DELETE FROM training_examples WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.get('/export-jsonl', (req, res) => {
  const format = req.query.format === 'alpaca' ? 'alpaca' : 'sharegpt';
  const profile = get('SELECT * FROM model_profile WHERE id = 1');
  const rows = all('SELECT * FROM training_examples ORDER BY id ASC').map((ex) => ({
    ...ex,
    instruction: decryptField(ex.instruction),
    input_context: decryptField(ex.input_context),
    output_response: decryptField(ex.output_response),
  }));

  const lines = rows.map((ex) => {
    if (format === 'alpaca') {
      return JSON.stringify({
        instruction: ex.instruction,
        input: ex.input_context || '',
        output: ex.output_response,
        system: profile.system_prompt,
      });
    }
    return JSON.stringify({
      conversations: [
        { from: 'system', value: profile.system_prompt },
        { from: 'human', value: ex.instruction },
        { from: 'gpt', value: ex.output_response },
      ],
    });
  });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="elhelb_finetune_${format}.jsonl"`);
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
