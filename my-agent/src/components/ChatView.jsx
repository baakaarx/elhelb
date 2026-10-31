import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  ImagePlus,
  X,
  Sparkles,
  Sprout,
  Bug,
  FlaskConical,
  Globe2,
  Mic,
  MicOff,
} from 'lucide-react';
import { apiRequest } from '../api';
import { startArabicRecognition, startVoiceRecorder } from '../voiceEngine';

const SUGGESTED_QUESTIONS = [
  {
    icon: Sprout,
    title: 'الزرع عندي تعبان ومحتاج مساعدة',
    prompt: 'البطاطس عندي فيها بقع بني على الورق وحاجة بتقرص الجدر تحت الأرض، أرش إيه؟',
  },
  {
    icon: Bug,
    title: 'عنكبوت أحمر وذبابة بيضا على الورق',
    prompt: 'عندي عنكبوت أحمر وناموس أبيض ومن على الطماطم والفراولة، إيه أفضل علاج؟',
  },
  {
    icon: FlaskConical,
    title: 'المواد الفعالة وأحجام العبوات',
    prompt: 'كلمني عن مبيد كابيتول 24% وجولد 1.8% وأحجام العبوات المتوفرة',
  },
  {
    icon: Globe2,
    title: 'التواصل والأسعار وطلب كميات',
    prompt: 'عاوز أعرف إزاي أطلب منتجات مجموعة الهلب أو أوصل لأقرب موزع معتمد',
  },
];

function FormattedMessage({ text }) {
  if (!text) return null;
  const blocks = String(text).split(/(```[\s\S]*?```)/g);

  return (
    <div className="formatted-content" dir="auto">
      {blocks.map((block, bIdx) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const cleanCode = block.replace(/^```\w*\n?/, '').replace(/```$/, '');
          return (
            <pre key={bIdx} className="ocr-pre">
              {cleanCode}
            </pre>
          );
        }

        const lines = block.split('\n');
        return (
          <React.Fragment key={bIdx}>
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lIdx} style={{ height: 6 }} />;
              }
              return (
                <div key={lIdx} className="msg-line">
                  {renderInlineTokens(line)}
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function renderInlineTokens(line) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="inline-code" dir="ltr">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export default function ChatView({ sessionId, onMessagesCountChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [pendingImagePreview, setPendingImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // التسجيل الصوتي مخصص لإرسال ملاحظة صوتية واردة فقط؛ لا يوجد نطق لردود المساعد.
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isFinalizingVoice, setIsFinalizingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [pendingVoiceFile, setPendingVoiceFile] = useState(null);
  const [pendingVoiceUrl, setPendingVoiceUrl] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const voiceTranscriptRef = useRef('');
  const recordingRef = useRef(false);
  const micHandleRef = useRef(null);
  const recorderRef = useRef(null);
  const voiceRetryTimerRef = useRef(null);
  const voiceBlobReadyRef = useRef(false);
  const voiceRecognitionEndedRef = useRef(true);
  const voiceObjectUrlsRef = useRef(new Set());

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // ضبط ارتفاع مربع الكتابة تلقائياً ليتمدد بنعومة على الموبايل والكمبيوتر
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    if (!isRecordingVoice) { setVoiceSeconds(0); return undefined; }
    const timer = window.setInterval(() => setVoiceSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecordingVoice]);

  useEffect(() => () => {
    recordingRef.current = false;
    clearTimeout(voiceRetryTimerRef.current);
    micHandleRef.current?.abort();
    recorderRef.current?.cancel();
    voiceObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    apiRequest(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`)
      .then((d) => {
        const list = d.messages || [];
        setMessages(list);
        onMessagesCountChange?.(list.length);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    onMessagesCountChange?.(messages.length);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function updateVoiceTranscript(finalText = '', interimText = '') {
    const cleanedFinal = String(finalText || '').trim();
    if (cleanedFinal && !voiceTranscriptRef.current.endsWith(cleanedFinal)) {
      voiceTranscriptRef.current = [voiceTranscriptRef.current, cleanedFinal].filter(Boolean).join(' ').trim();
    }
    setVoiceTranscript([voiceTranscriptRef.current, String(interimText || '').trim()].filter(Boolean).join(' ').trim());
  }

  function startVoiceRecognitionCycle() {
    if (!recordingRef.current || micHandleRef.current) return;
    const handle = startArabicRecognition({
      lang: 'ar-EG',
      onInterim: (text) => updateVoiceTranscript('', text),
      onFinal: (text) => updateVoiceTranscript(text),
      onError: (message, code) => {
        if (code === 'no-speech' || code === 'aborted') return;
        setError(message);
        recordingRef.current = false;
        setIsRecordingVoice(false);
        setIsFinalizingVoice(true);
        recorderRef.current?.stop();
      },
      onEnd: () => {
        micHandleRef.current = null;
        if (recordingRef.current) {
          voiceRetryTimerRef.current = window.setTimeout(startVoiceRecognitionCycle, 250);
        } else {
          voiceRecognitionEndedRef.current = true;
          setVoiceTranscript(voiceTranscriptRef.current);
          if (voiceBlobReadyRef.current) setIsFinalizingVoice(false);
        }
      },
    });
    micHandleRef.current = handle;
  }

  function clearPendingVoice({ keepUrl = false } = {}) {
    if (pendingVoiceUrl && !keepUrl) {
      URL.revokeObjectURL(pendingVoiceUrl);
      voiceObjectUrlsRef.current.delete(pendingVoiceUrl);
    }
    setPendingVoiceFile(null);
    setPendingVoiceUrl('');
    setVoiceTranscript('');
    voiceTranscriptRef.current = '';
    voiceBlobReadyRef.current = false;
    voiceRecognitionEndedRef.current = true;
  }

  function stopVoiceRecording() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecordingVoice(false);
    setIsFinalizingVoice(true);
    clearTimeout(voiceRetryTimerRef.current);
    voiceRetryTimerRef.current = null;
    const recognition = micHandleRef.current;
    micHandleRef.current = null;
    if (recognition) recognition.stop();
    else voiceRecognitionEndedRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) recorder.stop();
    else voiceBlobReadyRef.current = true;
    window.setTimeout(() => setIsFinalizingVoice(false), 2500);
  }

  async function toggleVoiceRecording() {
    if (recordingRef.current) {
      stopVoiceRecording();
      return;
    }
    if (isFinalizingVoice) return;
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setError('تسجيل الفويس نوت غير متاح في المتصفح الحالي. افتح الموقع عبر HTTPS واستخدم Chrome أو Safari حديثاً.');
      return;
    }
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      setError('المتصفح لا يدعم تفريغ الفويس نوت إلى نص. جرّب Chrome محدّثاً مع تفعيل إذن الميكروفون وخدمة التعرف على الكلام.');
      return;
    }

    clearPendingVoice();
    setError('');
    recordingRef.current = true;
    voiceBlobReadyRef.current = false;
    voiceRecognitionEndedRef.current = false;
    setIsRecordingVoice(true);
    setIsFinalizingVoice(false);
    startVoiceRecognitionCycle();

    const handle = await startVoiceRecorder({
      onReady: (blob) => {
        if (!blob?.size) {
          setError('التسجيل الصوتي فارغ؛ جرّب التسجيل مرة أخرى.');
          setIsFinalizingVoice(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        voiceObjectUrlsRef.current.add(url);
        setPendingVoiceFile(blob);
        setPendingVoiceUrl(url);
        voiceBlobReadyRef.current = true;
        if (voiceRecognitionEndedRef.current) setIsFinalizingVoice(false);
      },
      onError: (message) => {
        recordingRef.current = false;
        setIsRecordingVoice(false);
        setIsFinalizingVoice(false);
        micHandleRef.current?.abort();
        micHandleRef.current = null;
        setError(message);
      },
      onStop: () => {
        setIsRecordingVoice(false);
      },
    });

    if (!handle) {
      recordingRef.current = false;
      setIsRecordingVoice(false);
      micHandleRef.current?.abort();
      micHandleRef.current = null;
      return;
    }
    if (!recordingRef.current) handle.cancel();
    else recorderRef.current = handle;
  }

  function handleSelectImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('يرجى اختيار ملف صورة صالح (PNG أو JPG أو WebP).');
      return;
    }
    setError('');
    setPendingImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setPendingImagePreview(String(reader.result));
    reader.readAsDataURL(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleSelectImageFile(file);
          e.preventDefault();
          break;
        }
      }
    }
  }

  function clearPendingImage() {
    setPendingImageFile(null);
    setPendingImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendTurn(customPrompt) {
    const voiceFileToSend = customPrompt === undefined ? pendingVoiceFile : null;
    const transcript = voiceFileToSend ? (voiceTranscriptRef.current || voiceTranscript).trim() : '';
    const typedText = customPrompt !== undefined ? customPrompt : input.trim();
    const textToSend = [typedText, transcript].filter(Boolean).join(typedText && transcript ? '\n\n' : '');
    const hasImg = Boolean(pendingImageFile || pendingImagePreview);
    if ((!textToSend && !hasImg && !voiceFileToSend) || loading) return null;
    if (voiceFileToSend && !transcript) {
      setError('سجلت الفويس نوت، لكن المتصفح لم يستطع تفريغ الكلام. جرّب التسجيل مرة أخرى أو اكتب ملخصاً قصيراً.');
      return null;
    }

    const optimisticUser = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: textToSend || '📷 صورة مرفقة للتحليل',
      imageThumb: pendingImagePreview || null,
      voiceNoteUrl: voiceFileToSend ? pendingVoiceUrl : null,
    };

    const fileToSend = pendingImageFile;
    const base64ToSend = pendingImagePreview;
    const voiceUrlToKeep = voiceFileToSend ? pendingVoiceUrl : '';

    setError('');
    setLoading(true);
    setInput('');
    clearPendingImage();
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      let res;
      if (fileToSend || voiceFileToSend) {
        const fd = new FormData();
        fd.append('message', textToSend);
        fd.append('sessionId', sessionId);
        fd.append('language', 'ar');
        if (fileToSend) fd.append('image', fileToSend);
        if (voiceFileToSend) {
          const extension = voiceFileToSend.type?.includes('mp4') ? 'm4a' : voiceFileToSend.type?.includes('ogg') ? 'ogg' : 'webm';
          fd.append('voice', voiceFileToSend, `voice-note.${extension}`);
        }
        res = await apiRequest('/api/chat/ask', { method: 'POST', formData: fd });
      } else {
        res = await apiRequest('/api/chat/ask', {
          method: 'POST',
          body: {
            message: textToSend,
            sessionId,
            language: 'ar',
            imageBase64: base64ToSend || null,
          },
        });
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        { ...res.userMessage, voiceNoteUrl: voiceUrlToKeep || null },
        res.assistantMessage,
      ]);
      if (voiceFileToSend) clearPendingVoice({ keepUrl: true });
      return res;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(err.message || 'تعذر إرسال الرسالة، يرجى المحاولة مرة أخرى.');
      setInput(typedText);
      return null;
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTurn();
    }
  }

  return (
    <div className="chat-stage" onPaste={handlePaste}>
      <div className="messages-viewport">
        <div className="messages-column">
          {messages.length === 0 ? (
            <div className="welcome-hero">
              <div className="welcome-logo-badge">
                <img src="./logo.png" alt="ELHELB GROUP" />
              </div>

              <h1 className="welcome-title">أهلاً بك في المساعد الذكي لمجموعة الهلب</h1>
              <p className="welcome-subtitle">
                اكتب سؤالك أو سجّل فويس نوت عن <strong>محصولك أو مشكلة زراعية أو منتج من منتجات الهلب</strong>، وهنتابع معاك خطوة بخطوة.
              </p>
              <p className="voice-input-note">الفويس نوت بيتفرّغ لنص بمساعدة خدمة المتصفح؛ ردود المساعد كتابة فقط.</p>

              <div className="suggestions-grid">
                {SUGGESTED_QUESTIONS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="suggestion-card"
                      disabled={loading}
                      onClick={() => sendTurn(item.prompt)}
                    >
                      <div className="suggestion-icon">
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="suggestion-title">{item.title}</div>
                        <div className="suggestion-desc">{item.prompt}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((m, idx) => {
                const isLatestAssistant = m.role === 'assistant' && idx === messages.length - 1;
                return (
                  <div key={m.id} className={`chat-turn-wrap ${m.role}`}>
                    <div className={`chat-turn ${m.role}`}>
                      {m.role === 'assistant' && (
                        <div className="bot-avatar">
                          <img src="./logo.png" alt="ELHELB" />
                        </div>
                      )}

                      <div className="turn-bubble">
                        {m.imageThumb && (
                          <img src={m.imageThumb} alt="مرفق" className="attached-photo" />
                        )}
                        {m.voiceNoteUrl && (
                          <div className="sent-voice-note">
                            <span>🎙️ فويس نوت</span>
                            <audio controls preload="metadata" src={m.voiceNoteUrl} />
                          </div>
                        )}
                        {m.role === 'assistant' ? (
                          <FormattedMessage text={m.content} />
                        ) : (
                          <div className="user-text" dir="auto">{m.content}</div>
                        )}
                      </div>
                    </div>

                    {/* اقتراحات المتابعة التفاعلية لاستكمال الحوار بسهولة */}
                    {isLatestAssistant &&
                      !loading &&
                      Array.isArray(m.suggestions) &&
                      m.suggestions.length > 0 && (
                        <div className="followup-chips">
                          {m.suggestions.map((sug, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              className="followup-chip"
                              onClick={() => sendTurn(sug)}
                            >
                              {sug}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                );
              })}

              {loading && (
                <div className="chat-turn assistant">
                  <div className="bot-avatar">
                    <img src="./logo.png" alt="ELHELB" />
                  </div>
                  <div className="turn-bubble typing-bubble">
                    <Sparkles size={16} />
                    <span>جاري فهم سؤالك وتجهيز الإجابة...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* شريط الكتابة والتسجيل الصوتي السفلي */}
      <div className="composer-dock">
        <div className="composer-inner">
          {error && <div className="error-toast">{error}</div>}

          {isRecordingVoice && (
            <div className="listening-banner">
              <div className="voice-wave-bars"><span /><span /><span /><span /></div>
              <span>جاري تسجيل الفويس نوت وتفريغ الكلام · {String(Math.floor(voiceSeconds / 60)).padStart(2, '0')}:{String(voiceSeconds % 60).padStart(2, '0')} — اضغط المايك للإيقاف</span>
            </div>
          )}
          {isFinalizingVoice && !isRecordingVoice && (
            <div className="listening-banner">⏳ بنجهّز الفويس نوت والتفريغ النصي...</div>
          )}
          {pendingVoiceUrl && (
            <div className="image-preview-strip voice-note-strip">
              <div className="voice-note-preview-content">
                <strong>الفويس نوت جاهز</strong>
                <audio controls preload="metadata" src={pendingVoiceUrl} />
                {voiceTranscript && <div className="voice-note-transcript" dir="auto">التفريغ اللي هيوصل للمساعد: {voiceTranscript}</div>}
                <small className="voice-note-transcript">المساعد يفهم التفريغ النصي فقط؛ التسجيل لا يُحفظ في سجل المحادثة. التفريغ قد يعتمد على خدمة المتصفح.</small>
              </div>
              <button type="button" className="remove-img-btn" onClick={() => clearPendingVoice()} aria-label="حذف الفويس نوت"><X size={16} /></button>
            </div>
          )}

          {pendingImagePreview && (
            <div className="image-preview-strip">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={pendingImagePreview} alt="معاينة" className="preview-mini-thumb" />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
                  الصورة جاهزة للتحليل — اكتب سؤالك واضغط إرسال
                </span>
              </div>
              <button type="button" className="remove-img-btn" onClick={clearPendingImage}>
                <X size={16} />
              </button>
            </div>
          )}

          <form
            className="composer-box"
            onSubmit={(e) => {
              e.preventDefault();
              sendTurn();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleSelectImageFile(e.target.files?.[0])}
            />

            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="تصوير بالكاميرا أو إرفاق صورة عبوة أو محصول"
              aria-label="إرفاق صورة"
              disabled={loading || isRecordingVoice || isFinalizingVoice}
            >
              <ImagePlus size={20} />
            </button>

            <button
              type="button"
              className={`mic-btn ${isRecordingVoice ? 'recording' : ''}`}
              onClick={toggleVoiceRecording}
              title={isRecordingVoice ? 'إيقاف تسجيل الفويس نوت' : 'تسجيل فويس نوت'}
              aria-label={isRecordingVoice ? 'إيقاف تسجيل الفويس نوت' : 'تسجيل فويس نوت'}
              disabled={loading || isFinalizingVoice}
            >
              {isRecordingVoice ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <textarea
              ref={textareaRef}
              className="composer-textarea"
              rows={1}
              enterKeyHint="send"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setTimeout(() => {
                  bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }, 260);
              }}
              placeholder={pendingVoiceFile ? 'أضف توضيحاً مكتوباً (اختياري)...' : 'اكتب سؤالك أو سجّل فويس نوت 🎙️...'}
              disabled={loading}
            />

            <button
              type="submit"
              className="send-btn"
              disabled={loading || isRecordingVoice || isFinalizingVoice || (!input.trim() && !pendingImagePreview && !pendingVoiceFile)}
              aria-label="إرسال"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}
