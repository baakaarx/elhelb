const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const sharp = require('sharp');
const app = require('../server/index');
const { all } = require('../server/db');
const { getAdminKey } = require('../server/adminAuth');
const { analyzePlantPathologyPixels } = require('../server/visionEngine');
const agriKnowledge = require('../shared/agriKnowledgeBase.json');

const voiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voiceEngine.js'), 'utf8');
const voiceCommonJs = esbuild.transformSync(voiceSource, { format: 'cjs' }).code;
const voiceModule = { exports: {} };
new Function('module', 'exports', voiceCommonJs)(voiceModule, voiceModule.exports);
const speechFixture = voiceModule.exports.cleanTextForClientSpeech('استخدم Tazolen 72% WP بمعدل 1.5 لتر/فدان.');
assert.match(speechFixture, /تازولين اثنان وسبعون في المئة/);
assert.match(speechFixture, /واحد فاصلة خمسة لتر لكل فدان/);
assert.doesNotMatch(speechFixture, /[A-Za-z/]/, 'يجب ألا يقرأ الصوت اختصارات لاتينية أو slash في نص عربي');
const englishSpeechFixture = voiceModule.exports.cleanTextForClientSpeech('Use product 72% at 1.5 L/ha.', { lang: 'en-US' });
assert.match(englishSpeechFixture, /72 percent/);
assert.match(englishSpeechFixture, /1 point 5 L per ha/);
assert.doesNotMatch(englishSpeechFixture, /في المية|[\u0600-\u06FF]/);
const fertilizerSpeechFixture = voiceModule.exports.cleanTextForClientSpeech('New Fruity 10-10-40، بمعدل 250 جم/100 لتر.');
assert.match(fertilizerSpeechFixture, /نيو فروتي عشرة، عشرة، أربعون/);
assert.match(fertilizerSpeechFixture, /لكل مئة لتر/);
assert.doesNotMatch(fertilizerSpeechFixture, /[A-Za-z/]/);
const offlineBundle = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'offlineStaticBrain.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  loader: { '.json': 'json' },
}).outputFiles[0].text;
const offlineModule = { exports: {} };
new Function('module', 'exports', offlineBundle)(offlineModule, offlineModule.exports);
assert.match(offlineModule.exports.expandDialect('يا باشا الورق بيصفر'), /اصفرار/);
assert.doesNotMatch(offlineModule.exports.expandDialect('يا باشا الورق بيصفر'), /باشا/);
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

async function testBrowserVoiceEngineWiring() {
  const previousWindow = global.window;
  const recognitionInstances = [];
  class MockRecognition {
    constructor() { recognitionInstances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  global.window = { SpeechRecognition: MockRecognition, isSecureContext: true };
  const transcript = [];
  const statuses = [];
  const recHandle = voiceModule.exports.startArabicRecognition({
    onInterim: (value) => transcript.push(value),
    onFinal: (value) => transcript.push(`final:${value}`),
    onStatus: (value) => statuses.push(value),
  });
  const recognition = recognitionInstances[0];
  assert.ok(recHandle && recognition.started);
  assert.equal(recognition.lang, 'ar-SA');
  recognition.onstart();
  const makeResult = (value, isFinal = true) => {
    const item = [{ transcript: value }];
    item.isFinal = isFinal;
    return item;
  };
  recognition.onresult({ resultIndex: 0, results: [makeResult('ازيك')] });
  recognition.onresult({ resultIndex: 1, results: [makeResult('ازيك'), makeResult('ازيك يا هندسة')] });
  recognition.onend();
  assert.ok(transcript.includes('final:ازيك يا هندسة'), 'يجب دمج نتائج التعرف التراكمية بدون تكرار الكلام');
  assert.equal(voiceModule.exports.deduplicateSpeechTranscript('عندي عندي عندي مشكلة عندي مشكلة عندي مشكلة'), 'عندي مشكلة');
  assert.equal(voiceModule.exports.deduplicateSpeechTranscript('عندي مشكلة عايزك عندي مشكلة'), 'عندي مشكلة عايزك');
  const screenshotTranscript = 'عندي عندي عندي مشكله عندي مشكله عندي مشكله عندي مشكله عايزك مشكله عندي مشكله عايزك عندي مشكله عايزك مشكله عندي مشكله عايزك تحل عندي مشكله عايزك تحل بقى';
  assert.equal(
    voiceModule.exports.deduplicateSpeechTranscript(screenshotTranscript),
    'عندي مشكله عايزك تحل بقى',
    'يجب ضغط التكرار الشديد الظاهر في لقطة الهاتف إلى العبارة الأساسية',
  );
  assert.equal(
    voiceModule.exports.mergeTranscriptParts(['عندي عندي مشكلة في ورق البطاطس', 'في ورق البطاطس تالف']),
    'عندي مشكلة في ورق البطاطس تالف',
    'يجب دمج مقاطع التعرف المتداخلة دون تكرار النص السابق',
  );
  assert.ok(statuses.includes('listening'));
  const alternateRecognition = voiceModule.exports.startArabicRecognition({ lang: 'en-US' });
  assert.equal(recognitionInstances[1].lang, 'en-US', 'يجب تمرير اختيار اللغة الإنجليزية إلى محرك الميكروفون');
  alternateRecognition.abort();

  const utterances = [];
  const synth = {
    speaking: false,
    paused: false,
    cancel() {},
    getVoices: () => [
      { name: 'Arabic', lang: 'ar-SA', voiceURI: 'ar-sa-local', localService: true },
      { name: 'Google Arabic', lang: 'ar-EG', voiceURI: 'ar-eg-online', localService: false },
      { name: 'English Standard', lang: 'en-US', voiceURI: 'en-standard', localService: true },
      { name: 'English Natural', lang: 'en-US', voiceURI: 'en-natural', localService: true },
      { name: 'Remote English', lang: 'en-US', voiceURI: 'en-remote', localService: false },
    ],
    speak(utterance) {
      utterances.push(utterance);
      this.speaking = true;
      utterance.onstart?.();
      queueMicrotask(() => { this.speaking = false; utterance.onend?.(); });
    },
    resume() {},
  };
  function MockUtterance(text) { this.text = text; }
  global.window = { speechSynthesis: synth, SpeechSynthesisUtterance: MockUtterance, isSecureContext: true };
  const voiceCounts = voiceModule.exports.getSpeechVoiceCounts('ar-SA');
  assert.equal(voiceCounts.local, 1);
  assert.equal(voiceCounts.remote, 1);
  assert.ok(!voiceModule.exports.getAvailableSpeechVoices('ar-SA').some((voice) => voice.localService === false));
  assert.ok(voiceModule.exports.getAvailableSpeechVoices('ar-SA', { allowRemote: true }).some((voice) => voice.voiceURI === 'ar-eg-online'));
  const availableEnglishVoices = voiceModule.exports.getAvailableSpeechVoices('en-US');
  assert.equal(availableEnglishVoices[0].name, 'English Natural', 'يجب تفضيل الصوت المحلي الأحدث عند توفره');
  assert.ok(!availableEnglishVoices.some((voice) => voice.localService === false), 'يجب عدم إرسال النص إلى صوت خارجي');
  const arabicSpeechDone = new Promise((resolve, reject) => {
    voiceModule.exports.speakArabic('رد صوتي عربي 72%', {
      onStart: () => {},
      onError: reject,
      onEnd: resolve,
    });
  });
  assert.equal(utterances.length, 1, 'يجب بدء النطق فوراً دون مؤقت يؤخره خارج نقرة المستخدم');
  await arabicSpeechDone;
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].voice.lang, 'ar-SA', 'يجب اختيار صوت العربية الرسمية عند توفره');
  assert.match(utterances[0].text, /اثنان وسبعون في المئة/);
  await new Promise((resolve, reject) => {
    voiceModule.exports.speakArabic('English reply 72%', {
      lang: 'en-US',
      onError: reject,
      onEnd: resolve,
    });
  });
  assert.equal(utterances[1].lang, 'en-US');
  assert.equal(utterances[1].voice.name, 'English Natural', 'يجب اختيار الصوت الإنجليزي المحلي الأحدث افتراضياً');
  assert.match(utterances[1].text, /72 percent/);
  await new Promise((resolve, reject) => {
    voiceModule.exports.speakArabic('Selected device voice test.', {
      lang: 'en-US',
      voiceURI: 'en-standard',
      onError: reject,
      onEnd: resolve,
    });
  });
  assert.equal(utterances[2].voice.voiceURI, 'en-standard', 'يجب احترام اختيار المستخدم للصوت المثبت');
  await new Promise((resolve, reject) => {
    voiceModule.exports.speakArabic('Arabic device fallback test.', {
      lang: 'ar-SA',
      voiceURI: 'ar-eg-online',
      allowRemote: true,
      onError: reject,
      onEnd: resolve,
    });
  });
  assert.equal(utterances[3].voice.voiceURI, 'ar-eg-online', 'يجب استخدام صوت المتصفح الأونلاين عند السماح بذلك');
  const savedGetVoices = synth.getVoices;
  synth.getVoices = () => [];
  let missingArabicVoiceError = '';
  voiceModule.exports.speakArabic('اختبار عربي', {
    lang: 'ar-SA',
    onError: (error) => { missingArabicVoiceError = error.message; },
  });
  assert.match(missingArabicVoiceError, /لا يوجد صوت محلي مثبت للغة العربية/);
  assert.equal(utterances.length, 4, 'لا يُسمح بالرجوع إلى صوت غير محلي عند غياب العربية');
  synth.getVoices = savedGetVoices;
  global.window = previousWindow;
}

function request(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep text
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function generateTestProductLabelPngBuffer() {
  const svg = `
    <svg width="760" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="40" y="75" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="bold" fill="#000000">
        ELHELB GROUP - PRODUCT INQUIRY
      </text>
      <text x="40" y="135" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#000000">
        SKU: ELH-101 Capitol 24% SC (Chlorfenapyr)
      </text>
      <text x="40" y="190" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#000000">
        SKU: ELH-103 Pyriban 48% EC - Pack 1L
      </text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function runTests() {
  await testBrowserVoiceEngineWiring();
  console.log('🧪 بدء اختبار الشات بوت العام لمجموعة الهلب (حماية الجمهور + عزل الجلسات + العيادة الزراعية + تحليل الصور + Mobile API)...\n');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. عدم كشف أي مفاتيح أو إعدادات داخلية للجمهور + تشفير البيانات على القرص
    const boot = await request(baseUrl, '/api/bootstrap');
    assert.equal(boot.status, 200);
    assert.equal(boot.data.securitySummary, undefined, 'لا يجوز كشف أي مفاتيح أو إعدادات داخلية للجمهور');

    const rawChunks = all('SELECT text_ciphertext FROM document_chunks');
    assert.ok(rawChunks.length > 0);
    assert.ok(!rawChunks[0].text_ciphertext.includes('الهلب'), 'يجب تشفير النصوص على القرص');
    console.log('✅ [1/5] حماية البيانات العامة + تشفير قاعدة المعرفة على القرص (AES-256-GCM)');

    // 2. حظر أي محاولة تعديل أو مسح أو قراءة إدارية من الجمهور بدون X-Admin-Key
    const anonDelete = await request(baseUrl, '/api/vault/documents/1', { method: 'DELETE' });
    assert.equal(anonDelete.status, 403);

    const anonIngest = await request(baseUrl, '/api/v1/data/ingest', {
      method: 'POST',
      body: { type: 'document', title: 'اختراق', content: 'بيانات مزيفة' },
    });
    assert.equal(anonIngest.status, 403);

    const adminIngest = await request(baseUrl, '/api/v1/data/ingest', {
      method: 'POST',
      headers: { 'X-Admin-Key': getAdminKey() },
      body: {
        type: 'document',
        title: 'توصية تسميد القمح',
        category: 'agri_clinic',
        content: 'يوصى برش المغذيات الورقية المعتمدة من مجموعة الهلب في مرحلة طرد السنابل.',
      },
    });
    assert.equal(adminIngest.status, 201);
    console.log('✅ [2/5] إغلاق كامل لمسارات التعديل والإدارة أمام الجمهور (HTTP 403) وقبول مفتاح الإدارة فقط');

    // 3. عزل جلسات المحادثة بين الزوار (لا يمكن لزائر قراءة محادثة زائر آخر)
    const sidVisitorA = 'vis_aaaaaaaaaaaaaaaaaaaaaaaa1111';
    const sidVisitorB = 'vis_bbbbbbbbbbbbbbbbbbbbbbbb2222';

    const askA = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: {
        sessionId: sidVisitorA,
        message: 'عندي إصابة بالحفار في البطاطس، إيه المبيد الموصى به؟',
      },
    });
    assert.equal(askA.status, 200);
    assert.ok(askA.data.reply.includes('بيريبان') || askA.data.reply.includes('Pyriban'));

    const histB = await request(baseUrl, `/api/chat/history?sessionId=${sidVisitorB}`);
    assert.equal(histB.data.messages.length, 0, 'يجب ألا يرى الزائر (ب) رسائل الزائر (أ)');

    const histInvalid = await request(baseUrl, '/api/chat/history?sessionId=web-default');
    assert.equal(histInvalid.data.messages.length, 0, 'رفض المعرفات العامة المشتركة');
    console.log('✅ [3/5] عزل تام لخصوصية محادثات الزوار + دقة إجابات العيادة الزراعية');

    // 4. اختبار استقبال وتحليل الصور (Vision OCR) ومطابقتها مع مستحضرات الهلب
    const imgBuf = await generateTestProductLabelPngBuffer();
    const base64Img = `data:image/png;base64,${imgBuf.toString('base64')}`;

    const visionRes = await request(baseUrl, '/api/v1/vision/analyze', {
      method: 'POST',
      body: {
        prompt: 'استخرج أكواد وأسماء المبيدات الموجودة في الصورة وطابقها مع كتالوج مجموعة الهلب',
        imageBase64: base64Img,
      },
    });
    assert.equal(visionRes.status, 200);
    assert.ok(visionRes.data.ok);
    assert.ok(/Capitol|ELH-101/i.test(visionRes.data.extractedText));
    assert.ok(visionRes.data.matchedCompanyRecords.length >= 1);
    const englishVisionTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: {
        sessionId: 'vis_english_image_test_0001',
        language: 'en',
        message: 'Please review this product image',
        imageBase64: base64Img,
      },
    });
    assert.equal(englishVisionTurn.status, 200);
    assert.match(englishVisionTurn.data.reply, /I reviewed the image/i);
    assert.ok(!/[\u0600-\u06FF]/.test(englishVisionTurn.data.reply), 'يجب أن يظل رد تحليل الصورة باللغة الإنجليزية');
    console.log('✅ [4/5] استقبال وقراءة الصور أوفلاين (OCR Vision) ومطابقتها مع كتالوج مستحضرات الهلب');

    // 5. اختبار توافق واجهة تطبيق الموبايل (/api/v1/chat و /v1/chat/completions)
    const oaiCompat = await request(baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'elhelb-ai-v1',
        messages: [{ role: 'user', content: 'ما هي مبيدات النيماتودا المتوفرة في مجموعة الهلب؟' }],
      },
    });
    assert.equal(oaiCompat.status, 200);
    assert.ok(
      oaiCompat.data.choices[0].message.content.includes('لافيدا') ||
        oaiCompat.data.choices[0].message.content.includes('Laveda')
    );
    console.log('✅ [5/6] جاهزية واجهات ربط تطبيق الموبايل (/api/v1/chat + /v1/chat/completions)');

    // 6. اختبار نظام التحدث وفهم «كلام الناس العامي» والتحيات ("هلا" / "السلام عليكم" / "ازيك") وسياق المحادثة
    const convSid = 'vis_colloquial_test_session_9999';

    // اختبار التحيات العربية القصيرة مثل "هلا" و"السلام عليكم" و"ازيك"
    for (const greetWord of ['هلا', 'السلام عليكم', 'ازيك يا هندسة', 'تمام']) {
      const gRes = await request(baseUrl, '/api/chat/ask', {
        method: 'POST',
        body: { sessionId: 'vis_greet_check_session_12345', message: greetWord },
      });
      assert.equal(gRes.status, 200);
      assert.ok(!gRes.data.reply.includes('لم أجد'), `يجب أن يرد بودّ وطبيعية على "${greetWord}"`);
      assert.ok(!gRes.data.suggestions.includes('إيه طريقة ومعدل الاستخدام الموصى به؟'));
    }

    // أ) شكوى عامة بالعامية -> تشخيص تفاعلي خطوة بخطوة
    const vagueTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: convSid, message: 'يا بشمهندس البطاطس عندي تعبانة ومش عارف أرش إيه' },
    });
    assert.equal(vagueTurn.status, 200);
    assert.ok(vagueTurn.data.suggestions.length >= 3);
    assert.ok(!vagueTurn.data.speechText.includes('**'), 'يجب تنظيف النص الصوتي من رموز الماركداون');

    // ب) وصف عامي للأعراض بدون اسم المرض -> فهم الحفار وترشيح بيريبان
    const symptomTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: convSid, message: 'الزرع بيدبل وحاجة بتاكل الجدر تحت الأرض' },
    });
    assert.equal(symptomTurn.status, 200);
    assert.ok(symptomTurn.data.reply.includes('بيريبان'));

    // ج) سؤال متابعة بالضمير ("طب العبوات المتوفرة منه إيه؟") بدون ذكر اسم المبيد!
    const followUpTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: convSid, message: 'طب العبوات المتوفرة منه إيه؟' },
    });
    assert.equal(followUpTurn.status, 200);
    assert.ok(
      followUpTurn.data.reply.includes('بيريبان') && followUpTurn.data.reply.includes('5 لتر'),
      'يجب أن يتذكر سياق المحادثة السابق (بيريبان) تلقائياً'
    );

    // د) رد الشكر الطبيعي
    const thanksTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: convSid, message: 'تسلم ايدك يا هندسة ربنا يباركلك' },
    });
    assert.equal(thanksTurn.status, 200);
    assert.ok(thanksTurn.data.reply.includes('العفو'));

    const herbicideTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: 'vis_herbicide_test_session_001', message: 'عاوز مبيد حشائش للقمح' },
    });
    assert.equal(herbicideTurn.status, 200);
    assert.ok(herbicideTurn.data.reply.includes('ألدو') && herbicideTurn.data.reply.includes('برومو بلس'));
    assert.equal(agriKnowledge.herbicides.length, 12, 'يجب أن يتضمن الدليل جميع مبيدات الحشائش الاثني عشر');

    const cropsTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: 'vis_crops_test_session_0001', message: 'ما المحاصيل التي تدعمها العيادة؟' },
    });
    assert.equal(cropsTurn.status, 200);
    assert.ok(cropsTurn.data.reply.includes('البسلة') && cropsTurn.data.reply.includes('الفول السوداني'));
    assert.ok(agriKnowledge.crops.length >= 21);

    const fertilizersTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: 'vis_fertilizers_test_session_0001', message: 'إيه الأسمدة المتاحة عندكم في شركة الهلب؟' },
    });
    assert.equal(fertilizersTurn.status, 200);
    assert.ok(fertilizersTurn.data.reply.includes('نيو فروتي') && fertilizersTurn.data.reply.includes('توب فيلم'));
    const englishServerTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: 'vis_english_fertilizer_test_0001', language: 'en', message: 'What fertilizers does ELHELB offer?' },
    });
    assert.equal(englishServerTurn.status, 200);
    assert.ok(englishServerTurn.data.reply.includes('ELHELB has') && englishServerTurn.data.reply.includes('New Fruity'));
    assert.equal(agriKnowledge.fertilizers.length, 20, 'يجب أن يتضمن الدليل جميع منتجات الأسمدة والمغذيات العشرين');
    const offlineFertilizers = await offlineModule.exports.runStandaloneClientTurn({
      sessionId: 'offline_fertilizer_test',
      message: 'إيه الأسمدة المتاحة عندكم في شركة الهلب؟',
    });
    assert.ok(offlineFertilizers.reply.includes('نيو فروتي') && offlineFertilizers.reply.includes('توب فيلم'));
    const dialectTurn = await offlineModule.exports.runStandaloneClientTurn({
      sessionId: 'offline_dialect_yellow_test',
      message: 'يا باشا الورق بيصفر',
    });
    assert.match(dialectTurn.reply, /الاصفرار والذبول ليهم أسباب كتير/);
    const englishTurn = await offlineModule.exports.runStandaloneClientTurn({
      sessionId: 'offline_english_test',
      language: 'en',
      message: 'What fertilizers does ELHELB offer?',
    });
    assert.ok(englishTurn.reply.includes('ELHELB has') && englishTurn.reply.includes('New Fruity'));
    assert.ok(!/[\u0600-\u06FF]/.test(englishTurn.reply), 'يجب أن يكون الرد في وضع الإنجليزية بالإنجليزية');

    const mitesTurn = await request(baseUrl, '/api/chat/ask', {
      method: 'POST',
      body: { sessionId: 'vis_protocol_test_session_001', message: 'ما بدائل العنكبوت الأحمر؟' },
    });
    assert.equal(mitesTurn.status, 200);
    assert.ok(mitesTurn.data.reply.includes('HelbStar') && mitesTurn.data.reply.includes('Developer'));

    const soilLeafSvg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#704020"/><ellipse cx="160" cy="120" rx="70" ry="100" fill="#2c9b36"/></svg>`;
    const soilLeaf = await sharp(Buffer.from(soilLeafSvg)).png().toBuffer();
    const soilCheck = await analyzePlantPathologyPixels(soilLeaf);
    assert.ok(soilCheck.isPlantPhoto);
    assert.notEqual(soilCheck.plantCondition, 'blight_or_leaf_spot', 'يجب ألا تُصنّف التربة البنية حول ورقة سليمة كندوة/لفحة');
    console.log('✅ [6/6] تجهيز نص النطق (اختبار نصي فقط) + 20 سماداً + 12 مبيد حشائش + 21 محصولاً + منع تصنيف التربة كمرض');
    console.log('');

    console.log('🎉 اجتازت جميع اختبارات الشات بوت والأمان وتجهيز النص الصوتي. النطق الفعلي يحتاج تجربة على جهاز حقيقي.');
  } finally {
    server.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ فشل أحد الاختبارات:', err);
  process.exit(1);
});
