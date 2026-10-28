const { get, all, run } = require('./db');
const { inspectAndSanitize } = require('./dlpShield');
const { retrieveCompanyKnowledge, getDecryptedDatasets } = require('./vaultService');
const { analyzeDatasetsForQuery } = require('./dataAnalytics');
const { analyzeImageBuffer } = require('./visionEngine');
const { generateCompanyResponse } = require('./llmEngine');
const { analyzeHumanIntent, GENERAL_STARTER_SUGGESTIONS } = require('./conversationalNlu');

/**
 * تجهيز نص نظيف وسلس للنطق الصوتي بالعربية (بدون رموز ماركداون أو إيموجي أو أقواس برمجية)
 */
function formatForSpeech(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' تم استخراج النص من الصورة بنجاح. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/[#>*_~|•]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 في المائة')
    .replace(/\bEC\b/g, '')
    .replace(/\bWP\b/g, '')
    .replace(/\bSC\b/g, '')
    .replace(/\bSL\b/g, '')
    .replace(/\bWG\b/g, '')
    .replace(/\bGR\b/g, '')
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
}) {
  const rawMessage = String(message || '').trim();
  if (!rawMessage && !imageInput) {
    throw new Error('يرجى التحدث أو كتابة سؤالك أو إرفاق صورة لتحليلها.');
  }

  const settings = get('SELECT * FROM security_settings WHERE id = 1');
  const modelProfile = get('SELECT * FROM model_profile WHERE id = 1');

  const dlpResult = inspectAndSanitize(rawMessage, {
    mode: settings.dlp_mode || 'warn',
    maskPhones: Boolean(settings.mask_phones),
  });
  const cleanMessage = dlpResult.sanitizedText;

  const historyRows =
    customHistory ||
    all(
      `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 6`,
      [sessionId]
    ).reverse();

  // 1) فهم كلام الناس باللهجة الطبيعية وسياق المحادثة المستمر (بدون صورة)
  const nlu = !imageInput
    ? analyzeHumanIntent(cleanMessage, historyRows)
    : {
        handledDirectly: false,
        colloquialRule: null,
        expandedSearchTerms: cleanMessage,
        suggestions: ['إيه طريقة الاستخدام الموصى بها؟', 'عاوز أسأل عن آفة تانية'],
      };

  // إذا كان حواراً بشرياً مباشراً (تحية، شكر، طلب مساعدة عامة، تشخيص تفاعلي خطوة بخطوة)
  if (nlu.handledDirectly && !imageInput) {
    const started = Date.now();
    const speechText = formatForSpeech(nlu.reply);
    let userMsgId = started;
    let botMsgId = started + 1;

    if (persistChat) {
      const uIns = run(
        `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
         VALUES (?, ?, 'user', ?, NULL, '[]', '{}')`,
        [sessionId, channel, cleanMessage]
      );
      userMsgId = Number(uIns.lastInsertRowid);

      const bIns = run(
        `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
         VALUES (?, ?, 'assistant', ?, NULL, '[]', ?)`,
        [sessionId, channel, nlu.reply, JSON.stringify({ suggestions: nlu.suggestions })]
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
  }

  // 3) دمج السؤال الموسّع باللهجة والسياق مع النص المقروء من الصورة للبحث في بيانات الشركة
  const combinedSearchQuery = [nlu.expandedSearchTerms || cleanMessage, visionReport?.ocr?.text]
    .filter(Boolean)
    .join('\n')
    .trim();

  const retrieval = combinedSearchQuery
    ? retrieveCompanyKnowledge(combinedSearchQuery, 5)
    : { contexts: [] };

  const decryptedDatasets = getDecryptedDatasets();
  const dataAnalysis = combinedSearchQuery
    ? analyzeDatasetsForQuery(combinedSearchQuery, decryptedDatasets)
    : null;

  const trainingExamples = all('SELECT * FROM training_examples ORDER BY id DESC');

  // 4) توليد الرد الذكي الشامل (مع دعم التشخيص العامي المباشر إن وُجد)
  const completion = await generateCompanyResponse({
    query: nlu.expandedSearchTerms || cleanMessage,
    originalUserText: cleanMessage,
    colloquialRule: nlu.colloquialRule || null,
    conversationHistory: historyRows,
    contexts: retrieval.contexts,
    dataAnalysis,
    visionReport,
    settings,
    modelProfile,
    trainingExamples,
  });

  const citations = retrieval.contexts.slice(0, 4).map((ctx, idx) => ({
    index: idx + 1,
    docId: ctx.docId,
    docTitle: ctx.docTitle,
    sectionTitle: ctx.sectionTitle,
    category: ctx.category,
    categoryLabel: ctx.categoryLabel,
    score: ctx.score,
    snippet: ctx.decryptedText.slice(0, 240) + (ctx.decryptedText.length > 240 ? '...' : ''),
  }));

  const speechText = formatForSpeech(completion.answer);
  let suggestions;
  if (visionReport?.plantAnalysis?.isPlantPhoto && !visionReport?.ocr?.hasReadableText) {
    if (visionReport.plantAnalysis.plantCondition === 'blight_or_leaf_spot') {
      suggestions = [
        'أيوه المحصول بطاطس، أكرر الرش كل كام يوم؟',
        'إيه أهم نصائح الرش السليم للندوة؟',
        'إزاي أتواصل لطلب تازولين ودودجو؟',
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

  let userMsgId = Date.now();
  let botMsgId = Date.now() + 1;

  if (persistChat) {
    const uIns = run(
      `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
       VALUES (?, ?, 'user', ?, ?, '[]', '{}')`,
      [
        sessionId,
        channel,
        cleanMessage || '📷 [صورة مرفقة للتحليل]',
        visionReport?.thumbnailDataUrl || null,
      ]
    );
    userMsgId = Number(uIns.lastInsertRowid);

    const bIns = run(
      `INSERT INTO chat_messages (session_id, source_channel, role, content, image_thumb, citations_json, meta_json)
       VALUES (?, ?, 'assistant', ?, NULL, ?, ?)`,
      [
        sessionId,
        channel,
        completion.answer,
        JSON.stringify(citations),
        JSON.stringify(assistantMeta),
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
      (cleanMessage || visionReport?.imageMeta?.sceneHint || 'محادثة').slice(0, 120),
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
    vision: assistantMeta.visionSummary,
    dataInsights: dataAnalysis?.insights || [],
    matchedRecords: dataAnalysis?.matchedRecords || [],
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
