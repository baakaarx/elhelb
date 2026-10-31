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
import { mergeTranscriptParts, startArabicRecognition } from '../voiceEngine';

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

  // الكلام من الميكروفون يتحول إلى نص قابل للمراجعة؛ لا نرفع أو نخزّن ملفاً صوتياً.
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isFinalizingVoice, setIsFinalizingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const voiceTranscriptRef = useRef('');
  const voiceInputPrefixRef = useRef('');
  const voiceRecognitionErrorRef = useRef('');
  const recordingRef = useRef(false);
  const micHandleRef = useRef(null);
  const voiceRetryTimerRef = useRef(null);

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

  function applyVoiceTranscript() {
    const recognizedText = voiceTranscriptRef.current.trim();
    setVoiceTranscript('');
    setIsRecordingVoice(false);
    setIsFinalizingVoice(false);
    if (recognizedText) {
      setInput([voiceInputPrefixRef.current, recognizedText].filter(Boolean).join(' ').trim());
      setError('');
      voiceRecognitionErrorRef.current = '';
      return;
    }
    if (!voiceRecognitionErrorRef.current) {
      setError('ما وصلنيش نص واضح. اضغط داخل خانة الكتابة واستخدم ميكروفون لوحة مفاتيح الموبايل؛ هيتبعت الكلام كنص فقط.');
    }
  }

  function showKeyboardDictationFallback(message = '') {
    const fallback = 'لو التفريغ الصوتي مش متاح في المتصفح، اضغط داخل خانة الكتابة واستخدم زر الميكروفون في لوحة مفاتيح الموبايل. الكلام هيتبعت كنص فقط.';
    setError([message, fallback].filter(Boolean).join(' '));
    textareaRef.current?.focus();
  }

  function updateVoiceTranscript(finalText = '', interimText = '') {
    const cleanedFinal = String(finalText || '').trim();
    if (cleanedFinal) {
      voiceTranscriptRef.current = mergeTranscriptParts([voiceTranscriptRef.current, cleanedFinal]);
    }
    setVoiceTranscript([voiceTranscriptRef.current, String(interimText || '').trim()].filter(Boolean).join(' '));
  }

  function startVoiceRecognitionCycle() {
    if (!recordingRef.current || micHandleRef.current) return;
    const handle = startArabicRecognition({
      lang: 'ar-EG',
      onInterim: (text) => updateVoiceTranscript('', text),
      onFinal: (text) => updateVoiceTranscript(text),
      onError: (message, code) => {
        if (code === 'no-speech' || code === 'aborted') return;
        voiceRecognitionErrorRef.current = message;
        recordingRef.current = false;
        setIsRecordingVoice(false);
        if (voiceTranscriptRef.current.trim()) applyVoiceTranscript();
        else showKeyboardDictationFallback(message);
      },
      onEnd: () => {
        micHandleRef.current = null;
        if (recordingRef.current) {
          voiceRetryTimerRef.current = window.setTimeout(startVoiceRecognitionCycle, 250);
        } else {
          applyVoiceTranscript();
        }
      },
    });
    micHandleRef.current = handle;
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
    else applyVoiceTranscript();
  }

  function toggleVoiceRecording() {
    if (recordingRef.current) {
      stopVoiceRecording();
      return;
    }
    if (isFinalizingVoice) return;
    setError('');
    voiceTranscriptRef.current = '';
    voiceRecognitionErrorRef.current = '';
    voiceInputPrefixRef.current = input.trim();
    setVoiceTranscript('');

    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      showKeyboardDictationFallback('المتصفح الحالي لا يدعم تحويل الكلام تلقائياً.');
      return;
    }

    recordingRef.current = true;
    setIsRecordingVoice(true);
    setIsFinalizingVoice(false);
    startVoiceRecognitionCycle();
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
    const textToSend = customPrompt !== undefined ? customPrompt : input.trim();
    const hasImg = Boolean(pendingImageFile || pendingImagePreview);
    if ((!textToSend && !hasImg) || loading) return null;

    const optimisticUser = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: textToSend || '📷 صورة مرفقة للتحليل',
      imageThumb: pendingImagePreview || null,
    };
    const fileToSend = pendingImageFile;
    const base64ToSend = pendingImagePreview;

    setError('');
    setLoading(true);
    setInput('');
    clearPendingImage();
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      let res;
      if (fileToSend) {
        const fd = new FormData();
        fd.append('message', textToSend);
        fd.append('sessionId', sessionId);
        fd.append('language', 'ar');
        fd.append('image', fileToSend);
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
        res.userMessage,
        res.assistantMessage,
      ]);
      return res;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(err.message || 'تعذر إرسال الرسالة، يرجى المحاولة مرة أخرى.');
      setInput(textToSend);
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
                اكتب سؤالك أو اتكلم بالميكروفون عن <strong>محصولك أو مشكلة زراعية أو منتج من منتجات الهلب</strong>، وهنتابع معاك خطوة بخطوة.
              </p>
              <p className="voice-input-note">كلامك بيتحوّل لنص تراجعه في خانة الكتابة قبل الإرسال؛ التسجيل الصوتي نفسه لا يُرسل ولا يُحفظ.</p>

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
              <span>جاري تحويل كلامك إلى نص · {String(Math.floor(voiceSeconds / 60)).padStart(2, '0')}:{String(voiceSeconds % 60).padStart(2, '0')} — اضغط المايك للإيقاف</span>
            </div>
          )}
          {isRecordingVoice && voiceTranscript && (
            <div className="voice-note-transcript-live" dir="auto">{voiceTranscript}</div>
          )}
          {isFinalizingVoice && !isRecordingVoice && (
            <div className="listening-banner">⏳ بنجهّز النص للإرسال...</div>
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
              title={isRecordingVoice ? 'إيقاف تحويل الكلام إلى نص' : 'تحويل الكلام إلى نص'}
              aria-label={isRecordingVoice ? 'إيقاف تحويل الكلام إلى نص' : 'تحويل الكلام إلى نص'}
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
              placeholder="اكتب سؤالك أو اضغط الميكروفون لتحويل كلامك إلى نص..."
              disabled={loading}
            />

            <button
              type="submit"
              className="send-btn"
              disabled={loading || isRecordingVoice || isFinalizingVoice || (!input.trim() && !pendingImagePreview)}
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
