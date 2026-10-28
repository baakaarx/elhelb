const assert = require('node:assert/strict');
const http = require('node:http');
const sharp = require('sharp');
const app = require('../server/index');
const { all } = require('../server/db');
const { getAdminKey } = require('../server/adminAuth');
const { analyzePlantPathologyPixels } = require('../server/visionEngine');
const agriKnowledge = require('../shared/agriKnowledgeBase.json');

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
    console.log('✅ [6/6] الصوت واللهجة + 12 مبيد حشائش + 21 محصولاً + بدائل الآفات + منع تصنيف التربة كمرض');
    console.log('');

    console.log('🎉 اجتازت جميع اختبارات الشات بوت ونظام التحدث والأمان بنجاح 100%!');
  } finally {
    server.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ فشل أحد الاختبارات:', err);
  process.exit(1);
});
