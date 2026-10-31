export function isVoiceInputSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
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
      const maxPhrase = Math.min(8, Math.floor(output.length / 2));
      for (let size = maxPhrase; size >= 2 && !collapsed; size--) {
        // بعض خدمات الهاتف تعيد مقاطع كاملة وبين النسخ كلمات حشو أو جزءاً ناقصاً؛ افحص فجوة أوسع.
        for (let gap = 0; gap <= 4; gap++) {
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

function transcriptOverlapMatches(left, right) {
  const leftKeys = left.map(speechTokenKey);
  const rightKeys = right.map(speechTokenKey);
  if (leftKeys.every((word, index) => word === rightKeys[index])) return true;
  if (leftKeys.length < 4 || leftKeys.length !== rightKeys.length) return false;
  const mismatches = leftKeys.reduce((count, word, index) => count + (word === rightKeys[index] ? 0 : 1), 0);
  return mismatches <= Math.max(1, Math.floor(leftKeys.length * 0.2));
}

export function mergeTranscriptParts(parts = []) {
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
      const left = merged.slice(-overlap);
      const right = next.slice(0, overlap);
      if (transcriptOverlapMatches(left, right)) break;
      overlap--;
    }
    merged.push(...next.slice(overlap));
  }
  return deduplicateSpeechTranscript(merged.join(' '));
}

export function startArabicRecognition({ onInterim, onFinal, onError, onEnd, onStatus, lang = 'ar-SA' } = {}) {
  const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRec) {
    onError?.('المتصفح لا يدعم التعرف على الكلام. استخدم ميكروفون لوحة مفاتيح الهاتف لإملاء النص في خانة الكتابة.', 'unsupported');
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
      network: 'المتصفح لم يتمكن من تشغيل خدمة تحويل الكلام إلى نص. تأكد من الإنترنت، أو استخدم ميكروفون لوحة مفاتيح الهاتف لإملاء النص.',
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
