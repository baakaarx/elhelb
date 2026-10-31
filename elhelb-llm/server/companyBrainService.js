const { get, all, run } = require('./db');
const { inspectAndSanitize } = require('./dlpShield');
const { encryptField, decryptField, sanitizePublicValue, hasSensitiveValue } = require('./secureFields');
const { retrieveCompanyKnowledge, getDecryptedDatasets } = require('./vaultService');
const { analyzeDatasetsForQuery } = require('./dataAnalytics');
const { analyzeImageBuffer } = require('./visionEngine');
const { generateCompanyResponse } = require('./llmEngine');
const { analyzeHumanIntent, GENERAL_STARTER_SUGGESTIONS } = require('./conversationalNlu');

/**
 * تجهيز نص نظيف وسلس للنطق الصوتي بالعربية (بدون رموز ماركداون أو إيموجي أو أقواس برمجية)
 */
function formatForSpeech(text = '', language = 'ar') {
  const isEnglish = String(language).toLowerCase().startsWith('en');
  return String(text || '')
    .replace(/```[\s\S]*?```/g, isEnglish ? ' Text extracted from the image. ' : ' تم استخراج النص من الصورة بنجاح. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/[#>*_~|•]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, isEnglish ? '$1 percent' : '$1 بالمائة')
    .replace(/\b(?:EC|WP|SC|SL|WG|GR)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function processCompanyQuery({
  message = '',
  imageInput = null,
  sessionId = 'web-default',
  channel = 'web',
  customHistory = null,
  persistChat = true,
  language = 'ar',
}) {
  const responseLanguage = String(language).toLowerCase().startsWith('en') ? 'en' : 'ar';
  const rawMessage = String(message || '').trim();
  if (!rawMessage && !imageInput) {
    throw new Error('يرجى التحدث أو كتابة سؤالك أو إرفاق صورة لتحليلها.');
  }

  const settings = get('SELECT * FROM security_settings WHERE id = 1');
  const modelProfile = get('SELECT * FROM model_profile WHERE id = 1');

  const dlpOptions = {
    mode: settings.dlp_mode || 'mask',
    maskPhones: Boolean(settings.mask_phones),
  };
  const dlpResult = inspectAndSanitize(rawMessage, dlpOptions);
  if (dlpResult.blocked) {
    throw new Error('تم إيقاف الطلب لاحتوائه على بيانات حساسة. أزل البيانات الحساسة وحاول مرة أخرى.');
  }
  const cleanMessage = dlpResult.sanitizedText;

  const historyRows =
    customHistory ||
    all(
      `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 6`,
      [sessionId]
    )
      .map((row) => ({
        ...row,
        content: inspectAndSanitize(decryptField(row.content), dlpOptions).sanitizedText,
      }))
      .reverse();
  if (dlpOptions.mode === 'block' && hasSensitiveValue(historyRows, inspectAndSanitize, dlpOptions)) {
    throw new Error('تم إيقاف الطلب لاحتواء سجل المحادثة على بيانات حساسة.');
  }

  // 1) فهم كلام الناس باللهجة الطبيعية وسياق المحادثة المستمر (بدون صورة)
  const nlu = analyzeHumanIntent(cleanMessage, historyRows);
  if (imageInput && nlu.handledDirectly) {
    // نص المستخدم جزء من التشخيص البصري، ولا نُسقطه لمجرد إرفاق صورة.
    nlu.handledDirectly = false;
    nlu.expandedSearchTerms = cleanMessage;
  }

  // إذا كان حواراً بشرياً مباشراً (تحية، شكر، طلب مساعدة عامة، تشخيص تفاعلي خطوة بخطوة)
  if (nlu.handledDirectly && !imageInput && responseLanguage !== 'en') {
    const started = Date.now();
    const speechText = formatForSpeech(nlu.reply, responseLanguage);
    let userMsgId = started;
    let botMsgId = started + 1;

    if (persistChat) {
      const uIns = run(
        `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
         VALUES (?, ?, 'user', ?, NULL, '[]', '{}')`,
        [sessionId, channel, encryptField(cleanMessage)]
      );
      userMsgId = Number(uIns.lastInsertRowid);

      const bIns = run(
        `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
         VALUES (?, ?, 'assistant', ?, NULL, '[]', ?)`,
        [sessionId, channel, encryptField(nlu.reply), encryptField(JSON.stringify({ suggestions: nlu.suggestions }))]
      );
      botMsgId = Number(bIns.lastInsertRowid);
    }

    return {
      reply: nlu.reply,
      speechText,
      suggestions: nlu.suggestions || [],
      citations: [],
      vision: null,
      dataInsights: [],
      matchedRecords: [],
      engineUsed: 'elhelb-conversational-nlu',
      latencyMs: Math.max(1, Date.now() - started),
      userMessage: {
        id: userMsgId,
        role: 'user',
        content: cleanMessage,
        imageThumb: null,
      },
      assistantMessage: {
        id: botMsgId,
        role: 'assistant',
        content: nlu.reply,
        speechText,
        suggestions: nlu.suggestions || [],
      },
    };
  }

  // 2) إذا أُرفقت صورة -> تحليل بصري + استخراج النصوص (OCR)
  let visionReport = null;
  if (imageInput) {
    visionReport = await analyzeImageBuffer(imageInput);
    const ocrDlp = inspectAndSanitize(visionReport.ocr?.text || '', dlpOptions);
    if (ocrDlp.blocked) {
      throw new Error('تم إيقاف الصورة لاحتوائها على بيانات حساسة مقروءة. أرسل صورة منقّحة وحاول مرة أخرى.');
    }
    visionReport.ocr.text = ocrDlp.sanitizedText;
    const safeSignals = sanitizePublicValue(visionReport.signals, inspectAndSanitize, dlpOptions);
    const signalDlp = inspectAndSanitize(JSON.stringify(visionReport.signals || {}), dlpOptions);
    if (signalDlp.blocked) {
      throw new Error('تم إيقاف الصورة لاحتوائها على بيانات حساسة مقروءة. أرسل صورة منقّحة وحاول مرة أخرى.');
    }
    visionReport.signals = safeSignals;
    // لا نمرر بكسلات تحتوي على بيانات كشفها DLP إلى الموديل؛ نحتفظ بتحليل OCR المنقّح.
    if ((ocrDlp.findings.length > 0 || signalDlp.findings.length > 0) && dlpOptions.mode !== 'off') {
      visionReport.ollamaBase64 = null;
    }
  }

  // 3) دمج السؤال الموسّع باللهجة والسياق مع النص المقروء من الصورة للبحث في بيانات الشركة
  const combinedSearchQuery = [nlu.expandedSearchTerms || cleanMessage, visionReport?.ocr?.text]
    .filter(Boolean)
    .join('\n')
    .trim();

  const retrieval = combinedSearchQuery
    ? retrieveCompanyKnowledge(combinedSearchQuery, 5)
    : { contexts: [] };
  if (dlpOptions.mode === 'block' && hasSensitiveValue(retrieval.contexts, inspectAndSanitize, dlpOptions)) {
    throw new Error('تعذر تنفيذ الطلب لأن المحتوى العام المطابق يحتوي على بيانات حساسة.');
  }
  const publicContexts = sanitizePublicValue(retrieval.contexts, inspectAndSanitize, dlpOptions);

  const decryptedDatasets = getDecryptedDatasets({ publicOnly: true });
  const rawDataAnalysis = combinedSearchQuery
    ? analyzeDatasetsForQuery(combinedSearchQuery, decryptedDatasets)
    : null;
  if (dlpOptions.mode === 'block' && hasSensitiveValue(rawDataAnalysis, inspectAndSanitize, dlpOptions)) {
    throw new Error('تعذر تنفيذ الطلب لأن نتائج الجدول المطابقة تحتوي على بيانات حساسة.');
  }
  const dataAnalysis = sanitizePublicValue(rawDataAnalysis, inspectAndSanitize, dlpOptions);

  const rawTrainingExamples = all('SELECT * FROM training_examples WHERE is_public = 1 ORDER BY id DESC').map((example) => ({
    ...example,
    instruction: decryptField(example.instruction),
    input_context: decryptField(example.input_context),
    output_response: decryptField(example.output_response),
  }));
  if (dlpOptions.mode === 'block' && hasSensitiveValue(rawTrainingExamples, inspectAndSanitize, dlpOptions)) {
    throw new Error('تعذر تنفيذ الطلب لأن أمثلة المعرفة العامة تحتوي على بيانات حساسة.');
  }
  const trainingExamples = sanitizePublicValue(rawTrainingExamples, inspectAndSanitize, dlpOptions);

  // 4) توليد الرد الذكي الشامل (مع دعم التشخيص العامي المباشر إن وُجد)
  const completion = await generateCompanyResponse({
    query: nlu.expandedSearchTerms || cleanMessage,
    originalUserText: cleanMessage,
    colloquialRule: nlu.colloquialRule || null,
    conversationHistory: historyRows,
    contexts: publicContexts,
    dataAnalysis,
    visionReport,
    settings,
    modelProfile,
    trainingExamples,
    language: responseLanguage,
  });

  const answerDlp = inspectAndSanitize(completion.answer || '', dlpOptions);
  if (answerDlp.blocked) {
    throw new Error('تعذر عرض الرد لأنه يحتوي على بيانات حساسة.');
  }
  completion.answer = answerDlp.sanitizedText;

  const citations = sanitizePublicValue(
    publicContexts.slice(0, 4).map((ctx, idx) => ({
      index: idx + 1,
      docId: ctx.docId,
      docTitle: ctx.docTitle,
      sectionTitle: ctx.sectionTitle,
      category: ctx.category,
      categoryLabel: ctx.categoryLabel,
      score: ctx.score,
      snippet: ctx.decryptedText.slice(0, 240) + (ctx.decryptedText.length > 240 ? '...' : ''),
    })),
    inspectAndSanitize,
    dlpOptions
  );

  const speechText = formatForSpeech(completion.answer, responseLanguage);
  let suggestions;
  if (visionReport?.plantAnalysis?.isPlantPhoto && !visionReport?.ocr?.hasReadableText) {
    if (visionReport.plantAnalysis.plantCondition === 'blight_or_leaf_spot') {
      suggestions = [
        'المحصول بطاطس، ما الاحتمالات الأقرب؟',
        'المحصول طماطم، هل يختلف التشخيص؟',
        'كيف أميّز الندوة عن التبقع؟',
      ];
    } else {
      suggestions = [
        'المحصول بطاطس أو طماطم',
        'فيه حشرات وعنكبوت تحت الورقة',
        'إزاي أتواصل مع الدعم الفني؟',
      ];
    }
  } else if (completion.isFallbackGuide) {
    suggestions = GENERAL_STARTER_SUGGESTIONS.slice(0, 3);
  } else {
    suggestions = nlu.suggestions || [
      'إيه طريقة ومعدل الاستخدام الموصى به؟',
      'إيه أحجام العبوات المتوفرة؟',
      'عاوز أسأل عن آفة أو محصول تاني',
    ];
  }

  if (responseLanguage === 'en') {
    suggestions = [
      'What fertilizers does ELHELB offer?',
      'Help me identify this crop problem',
      'How can I contact ELHELB support?',
    ];
  }

  const assistantMeta = {
    engineUsed: completion.engineUsed,
    confidence: completion.confidence,
    latencyMs: completion.latencyMs,
    airgapVerified: completion.airgapVerified,
    suggestions,
    hasVision: Boolean(visionReport),
    visionSummary: visionReport
      ? {
          sceneHint: visionReport.imageMeta.sceneHint,
          dimensions: `${visionReport.imageMeta.width}x${visionReport.imageMeta.height}`,
          ocrConfidence: visionReport.ocr.confidence,
          extractedText: visionReport.ocr.text,
          signals: visionReport.signals,
        }
      : null,
  };

  const safeAssistantMeta = sanitizePublicValue(assistantMeta, inspectAndSanitize, dlpOptions);
  const publicDataInsights = sanitizePublicValue(dataAnalysis?.insights || [], inspectAndSanitize, dlpOptions);
  const publicMatchedRecords = sanitizePublicValue(dataAnalysis?.matchedRecords || [], inspectAndSanitize, dlpOptions);
  const publicVisionDetails = visionReport
    ? sanitizePublicValue(
        {
          documentType: visionReport.signals?.docType,
          imageMeta: visionReport.imageMeta,
          extractedText: visionReport.ocr?.text || '',
          ocrConfidence: visionReport.ocr?.confidence || 0,
          detectedSignals: visionReport.signals,
        },
        inspectAndSanitize,
        dlpOptions
      )
    : null;

  let userMsgId = Date.now();
  let botMsgId = Date.now() + 1;

  if (persistChat) {
    const uIns = run(
      `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
       VALUES (?, ?, 'user', ?, ?, '[]', '{}')`,
      [
        sessionId,
        channel,
        encryptField(cleanMessage || '📷 [صورة مرفقة للتحليل]'),
        encryptField(visionReport?.thumbnailDataUrl || null),
      ]
    );
    userMsgId = Number(uIns.lastInsertRowid);

    const bIns = run(
      `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
       VALUES (?, ?, 'assistant', ?, NULL, ?, ?)`,
      [
        sessionId,
        channel,
        encryptField(completion.answer),
        encryptField(JSON.stringify(citations)),
        encryptField(JSON.stringify(safeAssistantMeta)),
      ]
    );
    botMsgId = Number(bIns.lastInsertRowid);
  }

  run(
    `INSERT INTO api_logs (channel, event_type, preview, has_image, engine_used, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      channel,
      visionReport ? 'vision_chat' : 'text_chat',
      null,
      visionReport ? 1 : 0,
      completion.engineUsed,
      completion.latencyMs,
    ]
  );

  return {
    reply: completion.answer,
    speechText,
    suggestions,
    citations,
    vision: safeAssistantMeta.visionSummary,
    visionDetails: publicVisionDetails,
    dataInsights: publicDataInsights,
    matchedRecords: publicMatchedRecords,
    engineUsed: completion.engineUsed,
    latencyMs: completion.latencyMs,
    userMessage: {
      id: userMsgId,
      role: 'user',
      content: cleanMessage || '📷 [صورة مرفقة للتحليل]',
      imageThumb: visionReport?.thumbnailDataUrl || null,
    },
    assistantMessage: {
      id: botMsgId,
      role: 'assistant',
      content: completion.answer,
      speechText,
      suggestions,
    },
  };
}

module.exports = {
  processCompanyQuery,
  formatForSpeech,
};
