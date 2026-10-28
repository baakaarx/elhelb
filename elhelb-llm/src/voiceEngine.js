export function isVoiceInputSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isVoiceOutputSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

export function cleanTextForClientSpeech(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' تم قراءة النص من الصورة. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_~|•]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 في المائة')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestArabicVoice() {
  if (!isVoiceOutputSupported()) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  return (
    voices.find((v) => /ar[-_]?EG/i.test(v.lang)) ||
    voices.find((v) => /ar[-_]?SA/i.test(v.lang)) ||
    voices.find((v) => /^ar\b/i.test(v.lang)) ||
    null
  );
}

// تهيئة الأصوات المتاحة في المتصفح مسبقاً
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  if ('onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
}

export function stopSpeaking() {
  if (isVoiceOutputSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function speakArabic(text, { onStart, onEnd, onError } = {}) {
  if (!isVoiceOutputSupported()) {
    onEnd?.();
    return;
  }

  stopSpeaking();
  const clean = cleanTextForClientSpeech(text);
  if (!clean) {
    onEnd?.();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'ar-EG';
  utterance.rate = 1.02;
  utterance.pitch = 1.0;

  const voice = pickBestArabicVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = (e) => {
    onError?.(e);
    onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
}

export function startArabicRecognition({ onInterim, onFinal, onError, onEnd } = {}) {
  const SpeechRec =
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!SpeechRec) {
    onError?.('متصفحك الحالي لا يدعم المايكروفون المباشر — يُفضل فتح الموقع بمتصفح Chrome أو Safari للتحدث بالصوت.');
    return null;
  }

  stopSpeaking();

  const recognition = new SpeechRec();
  recognition.lang = 'ar-EG';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  let latestInterim = '';
  let delivered = false;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript + ' ';
      } else {
        interim += res[0].transcript;
      }
    }
    latestInterim = (finalTranscript + interim).trim();
    onInterim?.(latestInterim);
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      onError?.('يرجى السماح للمتصفح باستخدام المايكروفون لتتمكن من التحدث بالصوت.');
    } else if (event.error === 'no-speech') {
      onError?.('لم أسمع صوتاً واضحاً — اضغط المايكروفون وتحدث مرة أخرى.');
    } else if (event.error !== 'aborted') {
      onError?.('تعذر التقاط الصوت حالياً، حاول مرة أخرى أو اكتب سؤالك.');
    }
  };

  recognition.onend = () => {
    const resolvedText = (finalTranscript || latestInterim).trim();
    if (!delivered && resolvedText) {
      delivered = true;
      onFinal?.(resolvedText);
    }
    onEnd?.(resolvedText);
  };

  try {
    recognition.start();
  } catch {
    onError?.('تعذر تشغيل المايكروفون، حاول مجدداً.');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    },
    abort: () => {
      delivered = true;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}
