const { tokenize, computeLocalEmbedding } = require('./arabicRag');
const agriKnowledge = require('../shared/agriKnowledgeBase.json');

function validateAirGapUrl(rawUrl, airgapLock = true) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      reason: 'صيغة الرابط غير صالحة. استخدم عنواناً محلياً مثل http://127.0.0.1:11434',
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'البروتوكول غير مدعوم.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === 'host.docker.internal';

  const isPrivateLan =
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal');

  const isLocal = isLoopback || isPrivateLan;

  if (airgapLock && !isLocal) {
    return {
      allowed: false,
      isLocal: false,
      host,
      reason: `حظر جدار العزل الأمني (Air-Gap Lock): النطاق الخارجي (${host}) مرفوض للحفاظ على سرية بيانات الشركة.`,
    };
  }

  return {
    allowed: true,
    isLocal,
    host,
    normalizedUrl: parsed.origin + parsed.pathname.replace(/\/+$/, ''),
  };
}

async function probeLocalProvider(settings) {
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const check = validateAirGapUrl(ollamaUrl, Boolean(settings.airgap_lock));
  if (!check.allowed) {
    return { reachable: false, models: [], error: check.reason };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${check.normalizedUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { reachable: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = (data.models || []).map((m) => ({
      name: m.name,
      sizeGb: m.size ? Number((m.size / 1e9).toFixed(2)) : null,
      family: m.details?.family || 'local',
    }));
    return { reachable: true, endpoint: check.normalizedUrl, models };
  } catch {
    return {
      reachable: false,
      endpoint: check.normalizedUrl,
      models: [],
      error: 'خادم Ollama غير مشغّل حالياً — يعمل النظام تلقائياً بمحرك الهلب الذكي المدمج (نصوص + تحليل جداول + قراءة صور OCR).',
    };
  }
}

function cosineVec(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

function buildSystemPrompt({ modelProfile, contexts, dataAnalysis, visionReport }) {
  const base =
    modelProfile.system_prompt ||
    'أنت الموديل الذكي الشامل الخاص بشركة مجموعة الهلب. تحلل جميع بيانات الشركة والجداول والصور وتجيب بدقة باللغة العربية.';

  const docsBlock =
    contexts.length > 0
      ? contexts
          .map((c, i) => `[مصدر ${i + 1}: ${c.docTitle} — ${c.sectionTitle}]\n${c.decryptedText}`)
          .join('\n\n---\n\n')
      : 'لا توجد مقاطع نصية مطابقة مباشرة.';

  let analyticsBlock = '';
  if (dataAnalysis?.insights?.length) {
    analyticsBlock =
      '\n\n=== نتائج التحليل الرقمي لجداول الشركة ===\n' +
      dataAnalysis.insights
        .map((ins) => {
          const mStr = ins.metrics
            .map((m) => `${m.name}: المجموع=${m.sum}، المتوسط=${m.avg}، الأعلى=${m.max}`)
            .join(' | ');
          const topStr = ins.topBreakdown.map((t) => `${t.label}: ${t.value}`).join(' ، ');
          return `جدول (${ins.datasetName}) [${ins.rowCount} سجل]: ${mStr}\nالأعلى ترتيباً: ${topStr}`;
        })
        .join('\n');
  }

  let visionBlock = '';
  if (visionReport) {
    visionBlock = `\n\n=== بيانات الصورة المرفقة من المستخدم ===
- نوع الصورة المرصود: ${visionReport.imageMeta.sceneHint}
- الأبعاد: ${visionReport.imageMeta.width}x${visionReport.imageMeta.height} (${visionReport.imageMeta.format}) — ${visionReport.imageMeta.lightingQuality}
- النص المستخرج من الصورة (OCR):
${visionReport.ocr.text || '(صورة بصرية بدون نصوص مطبوعة واضحة)'}`;
  }

  const clinicBlock = `\n\n=== قاعدة المعرفة الزراعية المعتمدة (21 محصولاً + مبيدات الحشائش والتوصيات) ===\nالمحاصيل: ${agriKnowledge.crops.join('، ')}\nمبيدات الحشائش: ${agriKnowledge.herbicides.map((h) => `${h.name} — ${h.active} — ${h.target} — ${h.rate}`).join('\n')}\nتوصيات الآفات: ${agriKnowledge.protocols.map((p) => `${p.issue}: ${p.products}; ${p.rate}`).join('\n')}`;
  const voiceStyle = '\n\n=== أسلوب الإجابة الصوتية والحوار ===\nخاطب المستخدم باللهجة المصرية الطبيعية والمهذبة كمهندس زراعي متعاون. استخدم جملاً قصيرة وسهلة النطق، واشرح المصطلح الإنجليزي بالعربية ولا تنطق الاختصارات أو الشرطات المائلة حرفياً. لا تخترع جرعات، واسأل سؤالاً توضيحياً واحداً عند نقص بيانات المحصول أو الإصابة.';
  return `${base}${voiceStyle}\n\n=== وثائق ومعرفة الشركة ===\n${docsBlock}${clinicBlock}${analyticsBlock}${visionBlock}`;
}

/**
 * فحص ذكي لمطابقة الأرقام والنسب والأصناف المقروءة من الصورة مع قواعد وجداول الشركة
 */
function buildVisionCrossCheck(visionReport, contexts, dataAnalysis) {
  const checks = [];
  if (!visionReport) return checks;

  // فحص نسب الخصم في الفواتير والعروض المصورة مقابل سياسة الشركة
  for (const pctStr of visionReport.signals.percentages || []) {
    const pctVal = parseFloat(pctStr.replace('%', '').trim());
    if (!Number.isNaN(pctVal) && /فاتور|عرض|خصم|discount|invoice|total/i.test(visionReport.ocr.text)) {
      if (pctVal > 12) {
        checks.push(
          `⚠️ **مراجعة سياسة الخصومات:** رصدت في الصورة نسبة **(${pctVal}%)**؛ وحسب لائحة الشركة، الحد الأقصى لمندوب المبيعات 5% ولمدير المبيعات 12%، لذا تتطلب هذه النسبة **اعتماد الإدارة العليا**.`
        );
      } else if (pctVal > 5) {
        checks.push(
          `ℹ️ **مراجعة صلاحية الخصم:** النسبة المرصودة **(${pctVal}%)** تتجاوز صلاحية المندوب المباشرة (5%) وتتطلب اعتماد مشرف أو مدير المبيعات.`
        );
      } else if (pctVal > 0) {
        checks.push(`✅ **مطابقة الخصم:** النسبة المرصودة **(${pctVal}%)** تقع ضمن الصلاحية المعتمدة فورا.`);
      }
    }
  }

  // مطابقة الأصناف أو الفروع المذكورة في الصورة مع سجلات جداول الشركة
  if (dataAnalysis?.matchedRecords?.length > 0) {
    for (const rec of dataAnalysis.matchedRecords.slice(0, 3)) {
      const summary = Object.entries(rec.row)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      checks.push(`📦 **مطابقة مع قاعدة بيانات (${rec.datasetName}):** ${summary}`);
    }
  }

  return checks;
}

function runBuiltInCompanyBrain({
  query,
  originalUserText = '',
  colloquialRule = null,
  contexts = [],
  dataAnalysis = null,
  visionReport = null,
  modelProfile,
  trainingExamples = [],
}) {
  const trimmedQ = String(query || '').trim();
  const effectiveQuery = visionReport?.ocr?.text
    ? `${trimmedQ}\n${visionReport.ocr.text}`.trim()
    : trimmedQ;

  const qVec = computeLocalEmbedding(effectiveQuery || 'تحليل عام');
  const { stems: qStems, concepts: qConcepts } = tokenize(effectiveQuery);

  // 1) إذا كانت الرسالة تحتوي على صورة مرفقة -> تحليل زراعي بصري للنباتات والأوراق أو قراءة العبوات والمستندات
  if (visionReport) {
    const sections = [];
    const { imageMeta, ocr, signals, plantAnalysis } = visionReport;

    // أ) إذا كانت صورة ميدانية لنبات / ورقة محصول (بدون نص عبوة مطبوع)
    if (plantAnalysis?.isPlantPhoto && !ocr.hasReadableText) {
      const userCue = String(originalUserText || '').toLowerCase();
      const cueMap = [
        { pattern: /(?:صدأ|rust)/i, term: 'الصدأ الأصفر' },
        { pattern: /(?:البياض الزغبي|بياض زغبي|downy)/i, term: 'البياض الزغبي' },
        { pattern: /(?:التوتا|صانعات الأنفاق|leafminer)/i, term: 'التوتا أبسلوتا' },
        { pattern: /(?:البياض الدقيقي|powdery)/i, term: 'البياض الدقيقي' },
        { pattern: /(?:عنكبوت أحمر|أكاروس|spider mite)/i, term: 'العنكبوت الأحمر' },
      ].find((cue) => cue.pattern.test(userCue));
      if (cueMap) {
        const protocol = agriKnowledge.protocols.find((item) => item.issue.includes(cueMap.term));
        return {
          answer: `🌿 **دمجت الصورة مع وصفك المكتوب:** ذكرتَ احتمال «${cueMap.term}». الصورة وحدها لا تؤكد المسبب، لذا اعتبر التالي خيارات أولية للتحقق لا تشخيصاً نهائياً.\\n- **خيارات مجموعة الهلب:** ${protocol?.products || 'أرسل صورة أقرب للعلامات واسم المحصول لأحدد الخيارات المسجلة.'}\\n- **الإرشاد:** ${protocol?.rate || 'الجرعة تتحدد من ملصق المنتج المسجل للمحصول.'}\\nاذكر المحصول ومرحلة نموه، وتحقق من العلامات المميزة قبل الرش.`,
          engineUsed: 'elhelb-plant-pathology-text-vision-fusion',
          confidence: 0.7,
        };
      }
      if (plantAnalysis.plantCondition === 'blight_or_leaf_spot') {
        return {
          answer:
            `🌿 **فحص الصورة في عيادة الهلب الزراعية (ELHELB Agri-Clinic):**\n\n` +
            `- **الملاحظة البصرية:** ${plantAnalysis.symptomLabel || 'مناطق داكنة قريبة من نسيج أخضر'}؛ لا يُحسم المرض من الصورة وحدها.\n` +
            `- **قراءة الصورة:** رُصدت مناطق داكنة قريبة من نسيج أخضر؛ اللون وحده لا يؤكد الندوة وقد يشير إلى تبقع أو تلف أو ظل. لا أفترض نوع المحصول دون تأكيد.\n` +
            (originalUserText ? `- **السياق الذي ذكرته:** ${originalUserText}\n` : '') +
            `- **احتمالات تحتاج فحصاً ميدانياً:** تبقع ورقي أو ندوة مبكرة/متأخرة؛ صوّر وجهي الورقة وأخبرني بالمحصول والرطوبة وسرعة انتشار البقع.\n\n` +
            `💊 **برنامج العلاج السريع المعتمد من مجموعة الهلب:**\n` +
            `1. **رش علاجي فوري لوقف انتشار البقع:**\n` +
            `   • مبيد **تازولين 72% WP** بمعدل **250 جرام / 100 لتر ماء**\n` +
            `   • أو مبيد **دودجو 68% WG** بمعدل **200 جرام / 100 لتر ماء**\n` +
            `   • أو مبيد **توربو 72% WP** (` +
            `150 جم / 100 لتر ماء) أو **مولر 69% WP** (250 جم / 100 لتر ماء).\n` +
            `2. **رش وقائي لحماية الأوراق السليمة الجديدة:** مبيد **أنادول 80% WP** (` +
            `250 جم / 100 لتر ماء) أو **رولكس 50% WP** (150 جم / 100 لتر ماء).\n\n` +
            `💬 **سؤال للتأكيد:** ما اسم المحصول؟ وهل البقع جافة أم طرية، وهل تنتشر بسرعة بعد الندى؟`,
          engineUsed: 'elhelb-plant-pathology-vision',
          confidence: 0.94,
        };
      }

      if (plantAnalysis.plantCondition === 'chlorosis_or_mites') {
        return {
          answer:
            `🌿 **فحص الصورة في عيادة الهلب الزراعية:**\n\n` +
            `- **الملاحظة البصرية:** يظهر في الصورة **اصفرار وشحوب على الأوراق الخضراء**.\n` +
            `- **التشخيص المرجّح:** غالباً يكون بسبب **إصابة بالعنكبوت الأحمر (الأكاروس) / الحشرات الثاقبة الماصة** على ظهر الورقة، أو نقص عناصر وإجهاد.\n\n` +
            `💊 **التوصية المعتمدة من مجموعة الهلب:**\n` +
            `- افحص ظهر الورقة؛ لو لاحظت نقط دقيقة متحركة أو خيوط عنكبوت، استخدم **جولد 1.8% EC** أو **كابيتول 24% SC** أو **هلب ستار 20% EC**.\n` +
            `- ولو فيه ذبابة بيضاء أو من، استخدم **بيست 25% WP** مع دعم النبات بمغذيات وعناصر صغرى من مجموعة الهلب.\n\n` +
            `قولي نوع المحصول وهل الاصفرار في الأوراق السفلية ولا القمة النامية؟`,
          engineUsed: 'elhelb-plant-pathology-vision',
          confidence: 0.89,
        };
      }

      if (plantAnalysis.plantCondition === 'powdery_mildew') {
        return {
          answer:
            `🌿 **فحص الصورة في عيادة الهلب الزراعية:**\n\n` +
            `- **الملاحظة البصرية:** يظهر مظهر **طبقة أو بقع فاتحة بيضاء على سطح الأوراق الخضراء**.\n` +
            `- **التشخيص المرجّح:** اشتباه إصابة بـ **البياض الدقيقي** (أو تجمع للذبابة البيضاء / البق الدقيقي).\n\n` +
            `💊 **التوصية المعتمدة من مجموعة الهلب:**\n` +
            `- لعلاج البياض الدقيقي: الرش بمستحضر **إتش سلفر 80% WP** أو **سولي سلفر 80% WG** بمعدل **250 جم / 100 لتر ماء**.\n` +
            `- وإذا كانت حشرات بيضاء تطير عند لمس الورقة: الرش بمبيد **بيست 25% WP**.\n\n` +
            `قولي اسم المحصول عشان أأكدلك البرنامج الأنسب!`,
          engineUsed: 'elhelb-plant-pathology-vision',
          confidence: 0.88,
        };
      }

      return {
        answer:
          `🌿 **فحص صورة النبات في عيادة الهلب الزراعية:**\n\n` +
          `شايف قدامي صورة أوراق نبات خضراء، وعشان أشخّصلك الحالة بدقة 100%:\n` +
          `- قولي **اسم المحصول** اللي في الصورة وإيه العرض اللي مضايقك فيه (هل فيه بقع، حشرات تحت الورقة، ولا ذبول في الساق والجذور)؟\n` +
          `- أو صوّر الجزء المصاب من الورقة عن قرب أكتر في إضاءة واضحة وابعتهالي فوراً!`,
        engineUsed: 'elhelb-plant-pathology-vision',
        confidence: 0.82,
      };
    }

    sections.push(
      `🖼️ **نتيجة قراءة وفحص الصورة:**\n` +
        `- **نوع الصورة:** ${imageMeta.sceneHint}`
    );

    if (ocr.hasReadableText) {
      sections.push(`📝 **البيانات المقروءة من الصورة:**\n\`\`\`\n${ocr.text}\n\`\`\``);

      const extractedBullets = [];
      if (signals.refCodes.length > 0) {
        extractedBullets.push(`- **أكواد مرجعية:** ${signals.refCodes.join(' ، ')}`);
      }
      if (signals.percentages.length > 0) {
        extractedBullets.push(`- **تركيزات / نسب مرصودة:** ${signals.percentages.join(' ، ')}`);
      }
      if (extractedBullets.length > 0) {
        sections.push(`🔍 **تفاصيل مستخرجة:**\n${extractedBullets.join('\n')}`);
      }
    } else {
      sections.push(
        `👁️ **ملاحظة بصرية:** الصورة لا تحتوي على نص مطبوع واضح لاسم مستحضر — لو دي صورة لمحصول أو إصابة زراعية، اكتبلي اسم المحصول أو العرض اللي شايفه تحت الصورة وهساعدك بالعلاج فوراً!`
      );
    }

    const crossChecks = buildVisionCrossCheck(visionReport, contexts, dataAnalysis);
    if (crossChecks.length > 0) {
      sections.push(`📦 **مطابقة مع كتالوج منتجات مجموعة الهلب:**\n${crossChecks.join('\n')}`);
    } else if (contexts.length > 0) {
      const topCtx = contexts[0];
      const firstLine = topCtx.decryptedText
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 15 && !l.startsWith('#'));
      if (firstLine) {
        sections.push(`📌 **معلومة مرتبطة من دليل مجموعة الهلب:**\n- ${firstLine}`);
      }
    }

    return {
      answer: sections.join('\n\n'),
      engineUsed: ocr.hasReadableText ? 'elhelb-vision-ocr+rag' : 'elhelb-vision-inspector',
      confidence: ocr.hasReadableText ? Math.max(0.75, ocr.confidence / 100) : 0.72,
    };
  }

  // 2) ترحيب سريع بالأسئلة التعريفية للجمهور والعملاء (بدون \b لأنها لا تدعم الحروف العربية في JS)
  if (
    /^(?:هلا|يا هلا|اهلا|أهلا|مرحبا|السلام عليكم|سلام عليكم|سلام|ازيك|عامل ايه|صباح الخير|مساء الخير|الو|هاي|hello|hi)(?=\s|$|[؟?!.,،])/i.test(
      trimmedQ
    ) &&
    qStems.length <= 4
  ) {
    return {
      answer: `أهلاً بك في **المساعد الذكي لمجموعة الهلب (ELHELB GROUP)** 👋🌱\n\nيسعدني مساعدتك على مدار الساعة في كل ما يخص منتجات وحلول مجموعة الهلب للكيماويات الزراعية:\n- 🌱 **العيادة الزراعية (Agri-Clinic):** تشخيص وعلاج الآفات الحشرية والفطرية والأكاروس والنيماتودا ومعدلات الاستخدام.\n- 🧪 **دليل المستحضرات والمبيدات والأسمدة:** المواد الفعالة، التركيزات، وأحجام العبوات المتوفرة.\n- 📷 **قراءة وتحليل الصور:** يمكنك إرفاق صورة عبوة أو استفسار مصوّر أو مستند وسأقوم بقراءته وتحليله فوراً.\n- 🌍 **التواصل والتصدير والتصنيع للغير:** معلومات قطاعات المجموعة وقنوات التواصل الرسمية.`,
      engineUsed: 'elhelb-company-brain',
      confidence: 0.99,
    };
  }

  // قائمة الأسمدة تعرض فقط عند السؤال عن منتجات الشركة، لا عند طلب تشخيص نقص عنصر بعينه.
  const fertilizerQuestion = String(originalUserText || trimmedQ)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه');
  const asksForFertilizerCatalog = /(?:سماد|اسمده|الاسمده|السماد|مغذيات)/i.test(fertilizerQuestion) &&
    /(?:الشركه|الهلب|عندكم|المتوفر|المتاح|منتجات|انواع|ايه|ما هي|قائمة|كتالوج)/i.test(fertilizerQuestion);
  if (asksForFertilizerCatalog && Array.isArray(agriKnowledge.fertilizers)) {
    const productNames = agriKnowledge.fertilizers.map((item) => item.arabic || item.name);
    return {
      answer: `🌱 منتجات الأسمدة والمغذيات المسجلة لدى مجموعة الهلب (${productNames.length} منتج):\n${productNames.map((name) => `• ${name}`).join('، ')}.\n\nقولي اسم المحصول ومرحلة نموه أو المشكلة اللي عندك، وأساعدك تختار من غير ما أخمّن جرعة؛ الجرعة تتحدد من ملصق المنتج.`,
      engineUsed: 'elhelb-fertilizer-catalog',
      confidence: 0.99,
    };
  }

  // 2.5) إذا وصف المستخدم المشكلة باللهجة اليومية ("كلام الناس") نرد عليه بأسلوب حواري بشري مباشر وواضح
  if (colloquialRule) {
    return {
      answer: `🌱 **${colloquialRule.diagnosisTitle}:**\n\n${colloquialRule.directAdvice}`,
      engineUsed: 'elhelb-colloquial-advisor',
      confidence: 0.97,
    };
  }

  // 3) فحص أمثلة التدريب المخصصة عالية التطابق
  let bestTraining = null;
  for (const ex of trainingExamples) {
    const exVec = computeLocalEmbedding(`${ex.instruction} ${ex.input_context || ''}`);
    const sim = cosineVec(qVec, exVec);
    if (sim >= 0.62 && (!bestTraining || sim > bestTraining.sim)) {
      bestTraining = { ex, sim };
    }
  }
  if (bestTraining && bestTraining.sim >= 0.74) {
    return {
      answer: bestTraining.ex.output_response,
      engineUsed: 'elhelb-trained-memory',
      confidence: Number(Math.min(0.99, bestTraining.sim + 0.15).toFixed(2)),
    };
  }

  const parts = [];

  // 4) إذا كان السؤال تحليلياً إحصائياً صريحاً عن أرقام وجداول المبيعات أو المخزون
  if (dataAnalysis && (dataAnalysis.insights.length > 0 || dataAnalysis.matchedRecords.length > 0)) {
    const asksAnalyticalSummary =
      /(?:^|\s)(?:حلل|تحليل|اجمالي|إجمالي|المجموع|متوسط|ترتيب|مقارنه|مقارنة|نواقص|مخزون|ارباح|أرباح|مبيعات|تقرير)(?:\s|$)/i.test(
        trimmedQ
      );

    if (asksAnalyticalSummary && dataAnalysis.insights.length > 0) {
      for (const ins of dataAnalysis.insights) {
        const lines = [`📊 **تحليل بيانات «${ins.datasetName}» (${ins.rowCount} سجل):**`];
        for (const m of ins.metrics) {
          lines.push(
            `- **${m.name}:** الإجمالي = **${m.sum.toLocaleString('en-US')}** | المتوسط = **${m.avg.toLocaleString('en-US')}** | الأعلى = **${m.max.toLocaleString('en-US')}**`
          );
        }
        if (ins.topBreakdown.length > 0) {
          lines.push(
            `- **الترتيب الأعلى (${ins.topBreakdown[0].metric}):** ` +
              ins.topBreakdown
                .map((b, idx) => `${idx + 1}. **${b.label}** (${b.value.toLocaleString('en-US')})`)
                .join(' — ')
          );
        }
        if (ins.lowStockItems.length > 0) {
          const itemLabels = ins.lowStockItems.map((r) => {
            const vals = Object.entries(r)
              .slice(0, 4)
              .map(([k, v]) => `${k}: ${v}`)
              .join('، ');
            return `  • ⚠️ ${vals}`;
          });
          lines.push(`- **تنبيهات الأصناف التي وصلت لحد الطلب (تحتاج توريد عاجل):**\n${itemLabels.join('\n')}`);
        }
        parts.push(lines.join('\n'));
      }
    } else if (dataAnalysis.matchedRecords.length > 0) {
      const recLines = dataAnalysis.matchedRecords.slice(0, 4).map((rec) => {
        const kv = Object.entries(rec.row)
          .map(([k, v]) => `**${k}:** ${v}`)
          .join(' | ');
        return `- [${rec.datasetName}] ${kv}`;
      });
      parts.push(`📋 **السجلات المطابقة من جداول بيانات الشركة:**\n${recLines.join('\n')}`);
    }
  }

  // 5) استخلاص الإجابات الدقيقة من وثائق الشركة
  if (contexts.length > 0) {
    const asksNumeric = /(?:كم|كام|نسبه|نسبة|مبلغ|قيمة|سعر|راتب|مرتب|حد|عدد|خصم|عموله|عمولة|يوم|ساعه|ساعة)/i.test(
      trimmedQ
    );
    const qStemSet = new Set(qStems);
    const qConceptSet = new Set(qConcepts);

    const scoredLines = [];
    contexts.forEach((ctx, idx) => {
      // نتفادى تكرار جدول قمنا بتحليله للتو بالتفصيل في الأعلى
      if (parts.length > 0 && ctx.docTitle.startsWith('[جدول تحليلي]')) return;

      const citationNum = idx + 1;
      const lines = ctx.decryptedText
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 10 && !/^#{1,4}\s+/.test(l));

      lines.forEach((line, lineIdx) => {
        const lineVec = computeLocalEmbedding(line);
        const cos = Math.max(0, cosineVec(qVec, lineVec));
        const { stems: lStems, concepts: lConcepts } = tokenize(line);
        let stemHits = 0;
        for (const s of lStems) if (qStemSet.has(s)) stemHits++;
        let conceptHits = 0;
        for (const c of lConcepts) if (qConceptSet.has(c)) conceptHits++;

        const numBoost = asksNumeric && /\d+/.test(line) ? 0.14 : 0;
        const rankBoost = idx === 0 ? 0.12 : 0;

        const score =
          cos * 0.45 +
          (qStemSet.size ? (stemHits / qStemSet.size) * 0.35 : 0) +
          (qConceptSet.size ? (conceptHits / qConceptSet.size) * 0.12 : 0) +
          numBoost +
          rankBoost;

        scoredLines.push({
          line: line.replace(/^[-*•]\s*/, ''),
          score,
          citationNum,
          lineOrder: idx * 100 + lineIdx,
        });
      });
    });

    scoredLines.sort((a, b) => b.score - a.score);
    const picked = [];
    const seen = new Set();
    for (const item of scoredLines) {
      if (picked.length >= 5) break;
      if (item.score < 0.13 && picked.length >= 2) break;
      const key = item.line.slice(0, 55);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(item);
    }

    if (picked.length > 0) {
      picked.sort((a, b) => (Math.abs(b.score - a.score) < 0.16 ? a.lineOrder - b.lineOrder : b.score - a.score));
      parts.push(
        `📌 **من بيانات وتوصيات مجموعة الهلب المعتمدة:**\n` +
          picked.map((p) => `- ${p.line}`).join('\n')
      );
    }
  }

  if (parts.length === 0) {
    if (bestTraining) {
      return {
        answer: bestTraining.ex.output_response,
        engineUsed: 'elhelb-trained-memory',
        confidence: 0.78,
      };
    }
    return {
      answer:
        `أنا معاك عشان أساعدك في أي حاجة تخص زراعتك ومنتجات **مجموعة الهلب** 🌱\n\n` +
        `عشان أفيدك بأدق إجابة، قولي بكلامك العادي:\n` +
        `- **زارع محصول إيه وإيه المشكلة أو العرض اللي ملاحظه في الأرض؟** (مثلاً بقع على الورق، ذبول، حشرات، عنكبوت، أو ضعف في الجذور)\n` +
        `- أو **اسم المبيد** اللي حابب تعرف مادته الفعالة ومعدل رشه وأحجام عبواته؟\n` +
        `- أو تقدر تتواصل مباشرة مع الدعم الفني على الرقم: \`201011112221\`.`,
      engineUsed: 'elhelb-conversational-guide',
      isFallbackGuide: true,
      confidence: 0.5,
    };
  }

  return {
    answer: parts.join('\n\n'),
    engineUsed: dataAnalysis?.insights?.length ? 'elhelb-analytics+rag' : 'elhelb-local-rag',
    confidence: 0.94,
  };
}

async function generateCompanyResponse({
  query,
  originalUserText = '',
  colloquialRule = null,
  conversationHistory = [],
  contexts = [],
  dataAnalysis = null,
  visionReport = null,
  settings,
  modelProfile,
  trainingExamples = [],
}) {
  const startedAt = Date.now();
  const provider = settings.provider || 'auto';
  const airgapLock = Boolean(settings.airgap_lock);

  // استدعاء Ollama المحلي (يدعم الموديل النصي وموديل الرؤية Vision مع الصور!)
  if (provider === 'ollama' || provider === 'auto') {
    const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
    const check = validateAirGapUrl(ollamaUrl, airgapLock);

    if (check.allowed) {
      try {
        const systemPrompt = buildSystemPrompt({
          modelProfile,
          contexts,
          dataAnalysis,
          visionReport,
        });
        const targetModel = visionReport
          ? modelProfile.vision_model || 'llama3.2-vision'
          : modelProfile.base_model || 'qwen2.5:7b';

        const userMsg = {
          role: 'user',
          content: originalUserText || query || 'قم بتحليل هذه الصورة بالتفصيل ومطابقتها مع بيانات الشركة.',
        };
        if (visionReport?.ollamaBase64) {
          userMsg.images = [visionReport.ollamaBase64];
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), provider === 'ollama' ? 50000 : 2000);
        const res = await fetch(`${check.normalizedUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: targetModel,
            stream: false,
            options: {
              temperature: Number(modelProfile.temperature ?? 0.2),
              num_ctx: Number(modelProfile.context_length ?? 8192),
            },
            messages: [
              { role: 'system', content: systemPrompt },
              ...conversationHistory.slice(-6).map((m) => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
              })),
              userMsg,
            ],
          }),
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json();
          const content = data.message?.content?.trim();
          if (content) {
            return {
              answer: content,
              engineUsed: `ollama:${targetModel}`,
              confidence: 0.95,
              latencyMs: Date.now() - startedAt,
              airgapVerified: check.isLocal,
            };
          }
        } else if (provider === 'ollama') {
          throw new Error(`فشل الاتصال بموديل Ollama (${targetModel}) — HTTP ${res.status}`);
        }
      } catch (err) {
        if (provider === 'ollama') {
          throw new Error(`خادم Ollama غير متصل (${ollamaUrl}): ${err.message}`);
        }
      }
    } else if (provider === 'ollama') {
      throw new Error(check.reason);
    }
  }

  const localRes = runBuiltInCompanyBrain({
    query,
    originalUserText,
    colloquialRule,
    contexts,
    dataAnalysis,
    visionReport,
    modelProfile,
    trainingExamples,
  });

  return {
    ...localRes,
    latencyMs: Math.max(1, Date.now() - startedAt),
    airgapVerified: true,
  };
}

module.exports = {
  validateAirGapUrl,
  probeLocalProvider,
  generateCompanyResponse,
};
