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

const EGYPTIAN_NUMBERS = ['صفر', 'واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة'];
const EGYPTIAN_TEENS = { 10: 'عشرة', 11: 'حداشر', 12: 'اتناشر', 13: 'تلتاشر', 14: 'أربعتاشر', 15: 'خمستاشر', 16: 'ستاشر', 17: 'سبعتاشر', 18: 'تمنتاشر', 19: 'تسعتاشر' };
const EGYPTIAN_TENS = ['', '', 'عشرين', 'تلاتين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'تمانين', 'تسعين'];
const EGYPTIAN_HUNDREDS = ['', 'مية', 'ميتين', 'تلتمية', 'أربعمية', 'خمسمية', 'ستمِية', 'سبعمية', 'تمنمية', 'تسعمية'];

function numberToEgyptianArabic(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (raw.includes('.')) {
    const [whole, fraction] = raw.split('.');
    const decimals = fraction.split('').map((digit) => EGYPTIAN_NUMBERS[Number(digit)]).join(' ');
    return `${numberToEgyptianArabic(whole)} فاصلة ${decimals}`;
  }
  if (value < 10) return EGYPTIAN_NUMBERS[value];
  if (value < 20) return EGYPTIAN_TEENS[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return ones ? `${EGYPTIAN_NUMBERS[ones]} و${EGYPTIAN_TENS[tens]}` : EGYPTIAN_TENS[tens];
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return rest ? `${EGYPTIAN_HUNDREDS[hundreds]} و${numberToEgyptianArabic(String(rest))}` : EGYPTIAN_HUNDREDS[hundreds];
  }
  if (value < 1000000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return rest ? `${numberToEgyptianArabic(String(thousands))} ألف و${numberToEgyptianArabic(String(rest))}` : `${numberToEgyptianArabic(String(thousands))} ألف`;
  }
  return raw.split('').map((digit) => EGYPTIAN_NUMBERS[Number(digit)]).join(' ');
}

export function isVoiceInputSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || window.MediaRecorder);
}

export function isVoiceOutputSupported() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

export function cleanTextForClientSpeech(text = '') {
  let clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' تم استخراج النص من الصورة بنجاح. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' رابط الموقع الرسمي ')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, ' ');

  for (const [english, arabic] of BRAND_SPEECH_ALIASES) {
    clean = clean.replace(new RegExp(`\\b${english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), arabic);
  }

  return clean
    .replace(/\b(?:ELHELB|EC|WP|SC|SL|WG|GR|UL|DP|NPK|K2O|USD|EGP)\b/gi, ' ')
    .replace(/\b[A-Z][A-Z0-9+.-]{2,}\b/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 في المية')
    .replace(/(\d)\s*\/\s*(?=\d|[\u0600-\u06FF])/g, '$1 لكل ')
    .replace(/\s*\/\s*(?=[\u0600-\u06FF])/g, ' لكل ')
    .replace(/\s*\/\s*/g, ' لكل ')
    .replace(/(?<=\d)\.(?=\d)/g, ' فاصلة ')
    .replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, ' لحد ')
    .replace(/(?<=\d)\s*-\s*(?=\d)/g, '، ')
    .replace(/\b[A-Za-z][A-Za-z0-9+._%-]*\b/g, ' ')
    .replace(/(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu, (_match, number) => numberToEgyptianArabic(number))
    .replace(/[|#*_~<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestArabicVoice() {
  if (!isVoiceOutputSupported()) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((v) => /^ar[-_]eg/i.test(v.lang)) ||
    voices.find((v) => /^ar(?:[-_]|$)/i.test(v.lang)) || null;
}

let activeSpeechCleanup = null;
let voicesReadyPromise = null;

function waitForVoices() {
  if (!isVoiceOutputSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const current = synth.getVoices() || [];
  if (current.length) return Promise.resolve(current);
  if (!voicesReadyPromise) {
    voicesReadyPromise = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        const voices = synth.getVoices() || [];
        if (voices.length) {
          done = true;
          clearTimeout(timer);
          synth.removeEventListener?.('voiceschanged', finish);
          resolve(voices);
        }
      };
      const timer = setTimeout(() => {
        done = true;
        synth.removeEventListener?.('voiceschanged', finish);
        resolve(synth.getVoices() || []);
      }, 1200);
      synth.addEventListener?.('voiceschanged', finish);
      finish();
    });
  }
  return voicesReadyPromise;
}

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

export function speakArabic(text, { onStart, onEnd, onError } = {}) {
  if (!isVoiceOutputSupported()) {
    onError?.(new Error('ميزة النطق الصوتي غير متاحة في هذا المتصفح.'));
    onEnd?.();
    return;
  }
  const clean = cleanTextForClientSpeech(text);
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
    const voice = pickBestArabicVoice();
    // لا نختار صوتاً إنجليزياً صراحةً؛ نترك المحرك يختار أفضل صوت متاح مع تعيين ar-EG.
    // الأرقام والاختصارات حُوّلت إلى ألفاظ عربية قبل الوصول إلى المحرك.
    startWatchdog = setTimeout(() => finish(new Error('لم يبدأ الصوت العربي. فعّل صوت العربية في إعدادات الجهاز ثم حاول مرة أخرى.')), 8000);
    utterance.lang = voice?.lang || 'ar-EG';
    utterance.rate = 0.9;
    utterance.pitch = 1.04;
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
        finish(new Error('لا يوجد صوت عربي مفعّل على الجهاز. نزّل صوت العربية من إعدادات تحويل النص إلى كلام.'));
        return;
      }
      finish(event);
    };
    try { synth.speak(utterance); } catch (err) { finish(err); }
  };
  waitForVoices().finally(() => setTimeout(speakNext, 60));
}

export function startArabicRecognition({ onInterim, onFinal, onError, onEnd } = {}) {
  const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRec) {
    onError?.('تحويل الصوت إلى نص غير مدعوم في هذا المتصفح. افتح الموقع في Chrome أو Safari، واسمح باستخدام الميكروفون.');
    return null;
  }
  const recognition = new SpeechRec();
  recognition.lang = 'ar-EG';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  const finals = new Map();
  let latest = '';
  let delivered = false;
  let pauseTimer = null;
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = String(result?.[0]?.transcript || '').trim();
      if (result.isFinal && transcript) finals.set(i, transcript);
      else interim += `${transcript} `;
    }
    latest = [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).concat(interim.trim() ? [interim.trim()] : []).join(' ').trim();
    onInterim?.(latest);
    clearTimeout(pauseTimer);
    if (latest) pauseTimer = setTimeout(() => { try { recognition.stop(); } catch {} }, 3200);
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') onError?.('يرجى السماح للمتصفح باستخدام الميكروفون، وتأكد من فتح الموقع عبر HTTPS.');
    else if (event.error === 'no-speech') onError?.('لم أسمع كلاماً واضحاً؛ اضغط الميكروفون وتحدث مرة أخرى.');
    else if (event.error === 'network') onError?.('خدمة التفريغ الصوتي غير متاحة من هذا المتصفح أو الشبكة. افتح الموقع في Chrome أو Safari واتصل بالإنترنت ثم حاول مجدداً.');
    else if (event.error !== 'aborted') onError?.('تعذر التقاط الصوت؛ حاول مجدداً أو اكتب سؤالك.');
  };
  recognition.onend = () => {
    clearTimeout(pauseTimer);
    const text = [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join(' ').trim() || latest;
    if (!delivered && text) { delivered = true; onFinal?.(text); }
    onEnd?.(text);
  };
  try { recognition.start(); }
  catch { onError?.('تعذر تشغيل الميكروفون. تحقق من الإذن وأغلق أي تطبيق آخر يستخدمه.'); return null; }
  return {
    stop: () => { try { recognition.stop(); } catch {} },
    abort: () => { delivered = true; clearTimeout(pauseTimer); try { recognition.abort(); } catch {} },
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
