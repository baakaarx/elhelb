export function isVoiceInputSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || window.MediaRecorder);
}

export function isVoiceOutputSupported() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

export function cleanTextForClientSpeech(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' تم قراءة النص من الصورة. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_~|•]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 في المائة')
    .replace(/\s+/g, ' ').trim();
}

function pickBestArabicVoice() {
  if (!isVoiceOutputSupported()) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((v) => /^ar[-_]eg/i.test(v.lang)) ||
    voices.find((v) => /^ar(?:[-_]|$)/i.test(v.lang)) ||
    voices.find((v) => v.default) || voices[0] || null;
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
    startWatchdog = setTimeout(() => finish(new Error('لم يبدأ الصوت في المتصفح. تحقق من مستوى الصوت أو جرّب متصفحاً آخر.')), 8000);
    utterance.lang = voice?.lang || 'ar-EG';
    utterance.rate = 0.94;
    utterance.pitch = 1;
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
      finish(event);
    };
    try { synth.speak(utterance); } catch (err) { finish(err); }
  };
  // Chromium may cancel a new utterance if cancel() and speak() occur in the same task.
  setTimeout(speakNext, 60);
}

export function startArabicRecognition({ onInterim, onFinal, onError, onEnd } = {}) {
  const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRec) {
    onError?.('التفريغ الصوتي غير مدعوم في هذا المتصفح. جرّب Safari أو Chrome مع السماح بالميكروفون، أو اكتب الشكوى.');
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
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') onError?.('يرجى السماح للمتصفح باستخدام الميكروفون. تأكد من فتح الموقع عبر HTTPS.');
    else if (event.error === 'no-speech') onError?.('لم أسمع كلاماً واضحاً؛ اضغط الميكروفون وتحدث مرة أخرى.');
    else if (!['aborted', 'network'].includes(event.error)) onError?.('تعذر التقاط الصوت؛ حاول مجدداً أو اكتب سؤالك.');
  };
  recognition.onend = () => {
    const text = [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join(' ').trim() || latest;
    if (!delivered && text) { delivered = true; onFinal?.(text); }
    onEnd?.(text);
  };
  try { recognition.start(); }
  catch (err) { onError?.('تعذر تشغيل الميكروفون. تحقق من إذن الميكروفون وأغلق أي تطبيق آخر يستخدمه.'); return null; }
  return {
    stop: () => { try { recognition.stop(); } catch {} },
    abort: () => { delivered = true; try { recognition.abort(); } catch {} },
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
