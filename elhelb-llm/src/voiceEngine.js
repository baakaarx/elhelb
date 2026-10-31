const BRAND_SPEECH_ALIASES = [
  ['Bromo Plus', 'برومو بلس'], ['H-Sulphur', 'إتش سلفر'], ['Soli-Sulphur', 'سولي سلفر'],
  ['Super-Alpha', 'سوبر ألفا'], ['HelbStar', 'هلب ستار'], ['Nemaprobe', 'نيما بروب'],
  ['Pyriban', 'بيريبان'], ['Tafaban', 'تافابان'], ['Helban', 'هلبان'],
  ['Tazolen', 'تازولين'], ['Anadol', 'أنادول'], ['Capitol', 'كابيتول'],
  ['Developer', 'ديفيلوبر'], ['Dimetox', 'ديميتوكس'], ['Malatox', 'مالاتوكس'],
  ['Roksan', 'روكسان'], ['Tornado', 'تورنادو'], ['Resolve', 'ريزولف'],
  ['Solibal', 'سوليبال'], ['Arsenol', 'أرسينول'], ['Avoid', 'أفويد'],
  ['Diamond', 'دايموند'], ['Fenox', 'فينوكس'], ['Aldo', 'ألدو'],
  ['Pasha', 'باشا'], ['Ferari', 'فيراري'], ['Caprice', 'كابريس'],
  ['Keynot', 'كي نوت'], ['Crown', 'كراون'], ['Copral', 'كوبـرال'],
  ['Hesta', 'هيستا'], ['Mouler', 'مولر'], ['Peak', 'بيك'], ['Dodjo', 'دودجو'],
  ['Turbo', 'توربو'], ['Rolex', 'رولكس'], ['Index', 'إندكس'],
  ['Best', 'بيست'], ['Gold', 'جولد'], ['Fabyan', 'فابيان'],
  ['Outlock', 'أوتلوك'], ['Venol', 'فينول'], ['Imopk', 'إيموبك'],
  ['Grendo', 'جريندو'], ['Novo', 'نوفو'], ['Cord', 'كورد'],
  ['Master', 'ماستر'], ['Smart', 'سمارت'], ['Ragno', 'راجنو'],
  ['Prince', 'برنس'], ['Solano', 'سولانو'], ['Diver', 'دايفر'],
  ['Tiger', 'تايجر'], ['New Fruity', 'نيو فروتي'], ['New Fruit Star', 'نيو فروت ستار'],
  ['Super Plant Care', 'سوبر بلانت كير'], ['Super Boost', 'سوبر بوست'],
  ['Alpha Green', 'ألفا جرين'], ['Top Film', 'توب فيلم'], ['Fine', 'فاين'], ['Leader', 'ليدر'],
  ['Right', 'رايت'], ['Gruna', 'جرونا'], ['Zanden', 'زاندن'], ['Mertan', 'ميرتان'],
  ['New Vertac', 'نيو فيرتاك'], ['Super Vertac', 'سوبر فيرتاك'], ['New Catro', 'نيو كاترو'],
  ['Bloom Ca-B', 'بلوم كا بي'], ['Super Potassium', 'سوبر بوتاسيوم'], ['Petunia', 'بيتونيا'],
  ['Built-up', 'بيلت أب'], ['Besiege', 'بيسيج'], ['ELHELB GROUP', 'مجموعة الهلب'],
];

const ARABIC_NUMBERS = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const ARABIC_TEENS = { 10: 'عشرة', 11: 'أحد عشر', 12: 'اثنا عشر', 13: 'ثلاثة عشر', 14: 'أربعة عشر', 15: 'خمسة عشر', 16: 'ستة عشر', 17: 'سبعة عشر', 18: 'ثمانية عشر', 19: 'تسعة عشر' };
const ARABIC_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const ARABIC_HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function numberToArabicWords(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (raw.includes('.')) {
    const [whole, fraction] = raw.split('.');
    const decimals = fraction.split('').map((digit) => ARABIC_NUMBERS[Number(digit)]).join(' ');
    return `${numberToArabicWords(whole)} فاصلة ${decimals}`;
  }
  if (value < 10) return ARABIC_NUMBERS[value];
  if (value < 20) return ARABIC_TEENS[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return ones ? `${ARABIC_NUMBERS[ones]} و${ARABIC_TENS[tens]}` : ARABIC_TENS[tens];
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return rest ? `${ARABIC_HUNDREDS[hundreds]} و${numberToArabicWords(String(rest))}` : ARABIC_HUNDREDS[hundreds];
  }
  if (value < 1000000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return rest ? `${numberToArabicWords(String(thousands))} ألف و${numberToArabicWords(String(rest))}` : `${numberToArabicWords(String(thousands))} ألف`;
  }
  return raw.split('').map((digit) => ARABIC_NUMBERS[Number(digit)]).join(' ');
}

export function isVoiceInputSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || window.MediaRecorder);
}

export function isVoiceOutputSupported() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

export function getVoiceDiagnostics(language = 'ar-SA') {
  if (typeof window === 'undefined') {
    return { secureContext: false, recognition: false, synthesis: false, languageVoiceAvailable: false, voices: [] };
  }
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const prefix = String(language).toLowerCase().startsWith('en') ? 'en' : 'ar';
  const languageVoices = voices.filter((voice) => String(voice.lang).toLowerCase().startsWith(prefix));
  return {
    secureContext: Boolean(window.isSecureContext),
    recognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    synthesis: isVoiceOutputSupported(),
    languageVoiceAvailable: languageVoices.length > 0,
    voices: languageVoices.map((voice) => `${voice.name} (${voice.lang})`),
  };
}

export function cleanTextForClientSpeech(text = '', { lang = 'ar-SA' } = {}) {
  const isEnglish = String(lang).toLowerCase().startsWith('en');
  let clean = String(text || '')
    .replace(/```[\s\S]*?```/g, isEnglish ? ' Text extracted from the image. ' : ' تم استخراج النص من الصورة بنجاح. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, isEnglish ? ' the official website ' : ' رابط الموقع الرسمي ')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, ' ');

  if (isEnglish) {
    return clean
      .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
      .replace(/\b(?:EC|WP|SC|SL|WG|GR|UL|DP|NPK|K2O)\b/gi, ' ')
      .replace(/\s*\/\s*/g, ' per ')
      .replace(/(?<=\d)\.(?=\d)/g, ' point ')
      .replace(/(?<=\d)\s*[–—-]\s*(?=\d)/g, ', ')
      .replace(/[|#*_~<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  for (const [english, arabic] of BRAND_SPEECH_ALIASES) {
    clean = clean.replace(new RegExp(`\\b${english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), arabic);
  }

  return clean
    .replace(/\b(?:ELHELB|EC|WP|SC|SL|WG|GR|UL|DP|NPK|K2O|USD|EGP)\b/gi, ' ')
    .replace(/\b[A-Z][A-Z0-9+.-]{2,}\b/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 في المئة')
    .replace(/(\d)\s*\/\s*(?=\d|[\u0600-\u06FF])/g, '$1 لكل ')
    .replace(/\s*\/\s*(?=[\u0600-\u06FF])/g, ' لكل ')
    .replace(/\s*\/\s*/g, ' لكل ')
    .replace(/(?<=\d)\.(?=\d)/g, ' فاصلة ')
    .replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, ' لحد ')
    .replace(/(?<=\d)\s*-\s*(?=\d)/g, '، ')
    .replace(/\b[A-Za-z][A-Za-z0-9+._%-]*\b/g, ' ')
    .replace(/(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu, (_match, number) => numberToArabicWords(number))
    .replace(/[|#*_~<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestVoice(language = 'ar-SA') {
  if (!isVoiceOutputSupported()) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const requested = String(language).replace('_', '-').toLowerCase();
  const prefix = requested.split('-')[0];
  return voices.find((voice) => String(voice.lang).replace('_', '-').toLowerCase() === requested) ||
    voices.find((voice) => String(voice.lang).replace('_', '-').toLowerCase().startsWith(`${prefix}-`)) || null;
}

function speechTokenKey(token) {
  return String(token || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[\p{P}\p{S}]/gu, '');
}

export function deduplicateSpeechTranscript(text = '') {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const output = [];
  for (const token of tokens) {
    const key = speechTokenKey(token);
    if (!key) continue;
    if (output.length && speechTokenKey(output[output.length - 1]) === key) continue;
    output.push(token);
    let collapsed = true;
    while (collapsed) {
      collapsed = false;
      const maxSize = Math.min(8, Math.floor(output.length / 2));
      for (let size = maxSize; size >= 2; size--) {
        const start = output.length - size * 2;
        const left = output.slice(start, start + size).map(speechTokenKey);
        const right = output.slice(start + size).map(speechTokenKey);
        if (left.every((word, index) => word === right[index])) {
          output.splice(start + size, size);
          collapsed = true;
          break;
        }
      }
      if (collapsed) continue;
      // خفّف تكرار المقاطع القصيرة التي يعيدها أحياناً محرك التعرّف مع كلمة أو كلمتين فاصلتين.
      const maxPhrase = Math.min(5, Math.floor(output.length / 2));
      for (let size = maxPhrase; size >= 2 && !collapsed; size--) {
        for (let gap = 1; gap <= 2; gap++) {
          const rightStart = output.length - size;
          const leftStart = rightStart - gap - size;
          if (leftStart < 0) continue;
          const left = output.slice(leftStart, leftStart + size).map(speechTokenKey);
          const right = output.slice(rightStart).map(speechTokenKey);
          if (left.every((word, index) => word === right[index])) {
            output.splice(rightStart, size);
            collapsed = true;
            break;
          }
        }
      }
    }
  }
  return output.join(' ');
}

function mergeTranscriptParts(parts = []) {
  let merged = [];
  for (const part of parts) {
    const next = String(part || '').trim().split(/\s+/).filter(Boolean);
    if (!next.length) continue;
    const mergedKeys = merged.map(speechTokenKey);
    const nextKeys = next.map(speechTokenKey);
    // بعض محركات الهاتف تعيد النص السابق كله مع كل نتيجة نهائية؛ استبدل النسخة الأقدم بالمحدّثة.
    if (merged.length && nextKeys.length > mergedKeys.length && mergedKeys.every((word, index) => word === nextKeys[index])) {
      merged = next;
      continue;
    }
    if (merged.length && nextKeys.length <= mergedKeys.length && nextKeys.every((word, index) => word === mergedKeys[index])) continue;
    let overlap = Math.min(12, merged.length, next.length);
    while (overlap > 0) {
      const left = merged.slice(-overlap).map(speechTokenKey);
      const right = next.slice(0, overlap).map(speechTokenKey);
      if (left.every((word, index) => word === right[index])) break;
      overlap--;
    }
    merged.push(...next.slice(overlap));
  }
  return deduplicateSpeechTranscript(merged.join(' '));
}

let activeSpeechCleanup = null;
export function stopSpeaking() {
  if (activeSpeechCleanup) {
    activeSpeechCleanup();
    activeSpeechCleanup = null;
  }
  if (isVoiceOutputSupported()) window.speechSynthesis.cancel();
}

function splitSpeech(text, maxLength = 150) {
  const sentences = text.match(/[^.!?؟。]+[.!?؟。]?/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;
    if ((current + ' ' + clean).trim().length <= maxLength) {
      current = (current + ' ' + clean).trim();
      continue;
    }
    if (current) chunks.push(current);
    if (clean.length <= maxLength) current = clean;
    else {
      const words = clean.split(/\s+/);
      current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxLength) {
          if (current) chunks.push(current);
          current = word;
        } else current = (current + ' ' + word).trim();
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function speakArabic(text, { onStart, onEnd, onError, lang = 'ar-SA' } = {}) {
  if (!isVoiceOutputSupported()) {
    onError?.(new Error('ميزة النطق الصوتي غير متاحة في هذا المتصفح.'));
    onEnd?.();
    return;
  }
  const clean = cleanTextForClientSpeech(text, { lang });
  if (!clean) { onEnd?.(); return; }

  const synth = window.speechSynthesis;
  activeSpeechCleanup?.();
  synth.cancel();
  const chunks = splitSpeech(clean);
  let index = 0;
  let finished = false;
  let started = false;
  let keepAlive;
  let startWatchdog;
  const finish = (err, notifyEnd = true) => {
    if (finished) return;
    finished = true;
    clearInterval(keepAlive);
    clearTimeout(startWatchdog);
    if (activeSpeechCleanup === cleanupRun) activeSpeechCleanup = null;
    if (err) onError?.(err);
    if (notifyEnd) onEnd?.();
  };
  const cleanupRun = () => finish(null, false);
  activeSpeechCleanup = cleanupRun;
  const speakNext = () => {
    if (finished) return;
    if (index >= chunks.length) { finish(); return; }
    const utterance = new window.SpeechSynthesisUtterance(chunks[index++]);
    const voice = pickBestVoice(lang);
    // ابدأ النطق فوراً داخل نقرة المستخدم قدر الإمكان؛ تأخير SpeechSynthesis قد يمنعه على متصفحات الهاتف.
    const languageName = String(lang).toLowerCase().startsWith('en') ? 'الإنجليزية' : 'العربية';
    startWatchdog = setTimeout(() => finish(new Error(`لم يبدأ الصوت ${languageName}. افحص محرك تحويل النص إلى كلام والصوت المثبت في إعدادات الجهاز.`)), 8000);
    utterance.lang = voice?.lang || lang || 'ar-SA';
    utterance.rate = 0.9;
    utterance.pitch = 1.04;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      clearTimeout(startWatchdog);
      if (!started) { started = true; onStart?.(); }
      clearInterval(keepAlive);
      keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) synth.resume(); }, 8000);
    };
    utterance.onend = () => { clearTimeout(startWatchdog); if (!finished) setTimeout(speakNext, 35); };
    utterance.onerror = (event) => {
      clearTimeout(startWatchdog);
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      if (event.error === 'language-unavailable' || event.error === 'voice-unavailable') {
        finish(new Error(`لا يوجد صوت ${languageName} مفعّل على الجهاز. نزّل صوت اللغة المطلوبة من إعدادات تحويل النص إلى كلام.`));
        return;
      }
      if (event.error === 'not-allowed') {
        finish(new Error('المتصفح منع تشغيل الصوت تلقائياً. اضغط «اختبار الصوت» أو «استمع للرد بالصوت» مرة واحدة، وافحص صوت الوسائط.'));
        return;
      }
      finish(event);
    };
    try {
      synth.speak(utterance);
      if (synth.paused) synth.resume();
    } catch (err) { finish(err); }
  };
  speakNext();
}

export function startArabicRecognition({ onInterim, onFinal, onError, onEnd, onStatus, lang = 'ar-SA' } = {}) {
  const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRec) {
    onError?.('المتصفح لا يدعم الاستماع المباشر. افتح الموقع في Chrome المحدّث، واسمح بالميكروفون.', 'unsupported');
    return null;
  }
  let recognition;
  try {
    recognition = new SpeechRec();
  } catch {
    onError?.('تعذر تهيئة خدمة الميكروفون في المتصفح. جرّب Chrome المحدّث وافحص إذن الميكروفون.', 'init-failed');
    return null;
  }
  recognition.lang = lang || 'ar-SA';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  const finals = new Map();
  let latest = '';
  let delivered = false;
  let ended = false;
  let pauseTimer = null;
  let startTimer = null;
  const clearTimers = () => {
    clearTimeout(pauseTimer);
    clearTimeout(startTimer);
  };
  recognition.onstart = () => {
    clearTimeout(startTimer);
    onStatus?.('listening');
  };
  recognition.onaudiostart = () => onStatus?.('audio');
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = String(result?.[0]?.transcript || '').trim();
      if (result.isFinal && transcript) finals.set(i, transcript);
      else interim += `${transcript} `;
    }
    latest = mergeTranscriptParts(
      [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).concat(interim.trim() ? [interim.trim()] : [])
    );
    onInterim?.(latest);
    clearTimeout(pauseTimer);
    if (latest) pauseTimer = setTimeout(() => {
      onStatus?.('processing');
      try { recognition.stop(); } catch { finish(); }
    }, 2400);
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimers();
    const text = mergeTranscriptParts([...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value)) ||
      deduplicateSpeechTranscript(latest);
    if (!delivered && text) {
      delivered = true;
      onFinal?.(text);
    }
    onStatus?.('ended');
    onEnd?.(text);
  };
  recognition.onerror = (event) => {
    clearTimeout(startTimer);
    const code = event?.error || 'unknown';
    const messages = {
      'not-allowed': 'إذن الميكروفون مرفوض. من إعدادات الموقع في Chrome فعّل الميكروفون، ثم أعد المحاولة.',
      'service-not-allowed': 'خدمة التعرف على الكلام محظورة. اسمح لـ Chrome باستخدام الميكروفون وخدمات الصوت.',
      'no-speech': 'ما وصلنيش كلام واضح؛ هحاول أفتح الميكروفون تاني.',
      network: 'المتصفح لم يتمكن من تشغيل خدمة تحويل الكلام إلى نص. تأكد من الإنترنت وإعدادات «الكتابة بالصوت» في الجهاز، ثم جرّب Chrome.',
      'audio-capture': 'لم أجد ميكروفوناً متاحاً. افصل سماعة البلوتوث أو أغلق التطبيق الذي يستخدم الميكروفون.',
      'language-not-supported': 'التعرف على العربية غير متاح في خدمة الصوت على هذا الجهاز.',
    };
    if (code !== 'aborted') {
      onStatus?.('error');
      onError?.(messages[code] || `تعذر التقاط الصوت (${code}). افحص إذن الميكروفون ثم أعد المحاولة.`, code);
    }
  };
  recognition.onend = finish;
  onStatus?.('starting');
  try {
    recognition.start();
    startTimer = setTimeout(() => {
      if (!ended) {
        onError?.('المتصفح لم يبدأ الاستماع. تأكد أن إذن الميكروفون مسموح وأن «الكتابة بالصوت» مفعلة في الجهاز.', 'start-timeout');
        try { recognition.abort(); } catch {}
      }
    }, 9000);
  } catch {
    clearTimers();
    onError?.('تعذر بدء الميكروفون. أعد تحميل الصفحة، واسمح بالميكروفون، ثم حاول مرة واحدة أخرى.', 'start-failed');
    return null;
  }
  return {
    stop: () => {
      if (ended) return;
      onStatus?.('processing');
      try { recognition.stop(); } catch { finish(); }
    },
    abort: () => {
      delivered = true;
      clearTimers();
      try { recognition.abort(); } catch {}
    },
  };
}

export async function startVoiceRecorder({ onReady, onError, onStop } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    onError?.('تسجيل الصوت غير متاح هنا. افتح الصفحة عبر HTTPS واستخدم متصفحاً حديثاً.');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      onReady?.(blob);
      stream.getTracks().forEach((track) => track.stop());
      onStop?.();
    };
    recorder.start(250);
    return { stop: () => { if (recorder.state !== 'inactive') recorder.stop(); }, cancel: () => { if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach((track) => track.stop()); } };
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    onError?.('لم أستطع فتح الميكروفون. اسمح بالوصول إليه من إعدادات المتصفح ثم حاول مجدداً.');
    return null;
  }
}
