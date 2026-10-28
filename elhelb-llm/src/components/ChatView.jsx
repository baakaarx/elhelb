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
  Volume2,
  VolumeX,
  AudioLines,
  PhoneOff,
} from 'lucide-react';
import { apiRequest } from '../api';
import {
  isVoiceOutputSupported,
  speakArabic,
  stopSpeaking,
  startArabicRecognition,
} from '../voiceEngine';

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
    <div className="formatted-content">
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

export default function ChatView({
  sessionId,
  voiceCallOpen,
  onOpenVoiceCall,
  onCloseVoiceCall,
  onMessagesCountChange,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [pendingImagePreview, setPendingImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // حالات الصوت في شريط الكتابة وقراءة الردود
  const [isMicListening, setIsMicListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState(null);
  const micHandleRef = useRef(null);

  // حالات وضع المكالمة / المحادثة الصوتية المباشرة
  const [callStage, setCallStage] = useState('idle'); // 'listening' | 'thinking' | 'speaking' | 'ready'
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastBotSubtitle, setLastBotSubtitle] = useState('');
  const [callError, setCallError] = useState('');
  const callActiveRef = useRef(false);
  const callRecRef = useRef(null);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

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

  // إدارة دورة حياة وضع التحدث الصوتي المباشر (Hands-Free Voice Assistant)
  useEffect(() => {
    if (voiceCallOpen) {
      callActiveRef.current = true;
      setCallError('');
      setLastBotSubtitle('أهلاً بيك! اتفضل اتكلم بكلامك العادي واحكيلي مشكلة زرعك أو سؤالك وأنا سامعك...');
      startCallListeningCycle();
    } else {
      callActiveRef.current = false;
      callRecRef.current?.abort();
      callRecRef.current = null;
      stopSpeaking();
      setCallStage('idle');
      setLiveTranscript('');
    }

    return () => {
      callActiveRef.current = false;
      callRecRef.current?.abort();
    };
  }, [voiceCallOpen]);

  function startCallListeningCycle() {
    if (!callActiveRef.current) return;
    stopSpeaking();
    setCallError('');
    setLiveTranscript('');
    setCallStage('listening');

    const handle = startArabicRecognition({
      onInterim: (txt) => {
        if (callActiveRef.current) setLiveTranscript(txt);
      },
      onFinal: async (finalText) => {
        if (!callActiveRef.current) return;
        setLiveTranscript(finalText);
        setCallStage('thinking');
        const replyData = await sendTurn(finalText, { fromVoiceCall: true });
        if (!callActiveRef.current) return;

        if (replyData?.assistantMessage) {
          const toSpeak = replyData.speechText || replyData.assistantMessage.content;
          setLastBotSubtitle(replyData.assistantMessage.content);
          setCallStage('speaking');
          speakArabic(toSpeak, {
            onEnd: () => {
              if (callActiveRef.current) {
                startCallListeningCycle();
              }
            },
          });
        } else {
          setCallStage('ready');
        }
      },
      onError: (errMsg) => {
        if (!callActiveRef.current) return;
        setCallError(errMsg);
        setCallStage('ready');
      },
      onEnd: (resolvedText) => {
        if (!callActiveRef.current) return;
        if (!resolvedText) {
          setCallStage((prev) => (prev === 'listening' ? 'ready' : prev));
        }
      },
    });

    callRecRef.current = handle;
  }

  function toggleInlineMic() {
    if (isMicListening) {
      micHandleRef.current?.stop();
      setIsMicListening(false);
      return;
    }

    setError('');
    setIsMicListening(true);
    const handle = startArabicRecognition({
      onInterim: (txt) => {
        setInput(txt);
      },
      onFinal: (finalText) => {
        setIsMicListening(false);
        setInput('');
        sendTurn(finalText, { autoSpeakReply: true });
      },
      onError: (errMsg) => {
        setIsMicListening(false);
        setError(errMsg);
      },
      onEnd: () => {
        setIsMicListening(false);
      },
    });

    if (!handle) {
      setIsMicListening(false);
    } else {
      micHandleRef.current = handle;
    }
  }

  function toggleSpeakMessage(msg) {
    if (speakingMsgId === msg.id) {
      stopSpeaking();
      setSpeakingMsgId(null);
      return;
    }
    const textToRead = msg.speechText || msg.content;
    setSpeakingMsgId(msg.id);
    speakArabic(textToRead, {
      onEnd: () => setSpeakingMsgId(null),
    });
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

  async function sendTurn(customPrompt, opts = {}) {
    const { autoSpeakReply = false, fromVoiceCall = false } = opts;
    const textToSend = customPrompt !== undefined ? customPrompt : input.trim();
    const hasImg = Boolean(pendingImageFile || pendingImagePreview);
    if ((!textToSend && !hasImg) || loading) return null;

    stopSpeaking();
    setSpeakingMsgId(null);

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
    if (customPrompt === undefined) setInput('');
    clearPendingImage();
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      let res;
      if (fileToSend) {
        const fd = new FormData();
        fd.append('message', textToSend);
        fd.append('sessionId', sessionId);
        fd.append('image', fileToSend);
        res = await apiRequest('/api/chat/ask', { method: 'POST', formData: fd });
      } else {
        res = await apiRequest('/api/chat/ask', {
          method: 'POST',
          body: {
            message: textToSend,
            sessionId,
            imageBase64: base64ToSend || null,
          },
        });
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        res.userMessage,
        res.assistantMessage,
      ]);

      if (autoSpeakReply && !fromVoiceCall && res.assistantMessage) {
        setSpeakingMsgId(res.assistantMessage.id);
        speakArabic(res.speechText || res.assistantMessage.content, {
          onEnd: () => setSpeakingMsgId(null),
        });
      }

      return res;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      const msg = err.message || 'تعذر إرسال الرسالة، يرجى المحاولة مرة أخرى.';
      if (fromVoiceCall) {
        setCallError(msg);
      } else {
        setError(msg);
      }
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

  const lastMessage = messages[messages.length - 1];

  return (
    <div className="chat-stage" onPaste={handlePaste}>
      <div className="messages-viewport">
        <div className="messages-column">
          {messages.length === 0 ? (
            <div className="welcome-hero">
              <div className="welcome-logo-badge">
                <img src="/logo.png" alt="ELHELB GROUP" />
              </div>

              <h1 className="welcome-title">أهلاً بك في المساعد الذكي لمجموعة الهلب</h1>
              <p className="welcome-subtitle">
                اتكلم بصوتك أو اكتب بكلامك العادي عن <strong>مشكلة محصولك، علاج الآفات، أو المبيدات المتوفرة</strong>، وهنساعدك خطوة بخطوة.
              </p>

              <button type="button" className="hero-voice-cta" onClick={onOpenVoiceCall}>
                <AudioLines size={20} />
                <span>ابدأ محادثة صوتية مباشرة الآن</span>
              </button>

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
                          <img src="/logo.png" alt="ELHELB" />
                        </div>
                      )}

                      <div className="turn-bubble">
                        {m.imageThumb && (
                          <img src={m.imageThumb} alt="مرفق" className="attached-photo" />
                        )}
                        {m.role === 'assistant' ? (
                          <>
                            <FormattedMessage text={m.content} />
                            {isVoiceOutputSupported() && (
                              <div className="bubble-actions">
                                <button
                                  type="button"
                                  className={`speak-reply-btn ${speakingMsgId === m.id ? 'active' : ''}`}
                                  onClick={() => toggleSpeakMessage(m)}
                                >
                                  {speakingMsgId === m.id ? (
                                    <>
                                      <VolumeX size={14} /> إيقاف الصوت
                                    </>
                                  ) : (
                                    <>
                                      <Volume2 size={14} /> استمع للرد بالصوت
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="user-text">{m.content}</div>
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
                    <img src="/logo.png" alt="ELHELB" />
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

          {isMicListening && (
            <div className="listening-banner">
              <div className="voice-wave-bars">
                <span />
                <span />
                <span />
                <span />
              </div>
              <span>جاري الاستماع لصوتك... اتكلم براحتك وسيتم الإرسال تلقائياً</span>
            </div>
          )}

          {pendingImagePreview && (
            <div className="image-preview-strip">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={pendingImagePreview} alt="معاينة" className="preview-mini-thumb" />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
                  الصورة جاهزة للتحليل — اكتب أو اتكلم أو اضغط إرسال
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
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => handleSelectImageFile(e.target.files?.[0])}
            />

            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="إرفاق صورة عبوة أو محصول"
              disabled={loading || isMicListening}
            >
              <ImagePlus size={20} />
            </button>

            <button
              type="button"
              className={`mic-btn ${isMicListening ? 'recording' : ''}`}
              onClick={toggleInlineMic}
              title={isMicListening ? 'إيقاف التسجيل' : 'تكلم بصوتك بالعامية'}
              disabled={loading}
            >
              {isMicListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <textarea
              className="composer-textarea"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isMicListening
                  ? 'أنا سامعك... اتفضل اتكلم'
                  : 'اكتب بكلامك العادي أو اضغط المايك 🎙️ وتكلم بصوتك...'
              }
              disabled={loading}
            />

            <button
              type="submit"
              className="send-btn"
              disabled={loading || (!input.trim() && !pendingImagePreview)}
              aria-label="إرسال"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>

      {/* شاشة المحادثة الصوتية التفاعلية المباشرة (Hands-Free Voice Call Mode) */}
      {voiceCallOpen && (
        <div className="voice-call-overlay">
          <div className="voice-call-card">
            <div className="voice-call-top">
              <span className="voice-live-badge">
                <span className="online-dot" /> محادثة صوتية مباشرة — ELHELB AI
              </span>
            </div>

            <div className={`voice-orb-container ${callStage}`}>
              <div className="orb-ring ring-1" />
              <div className="orb-ring ring-2" />
              <div className="voice-orb-core">
                <img src="/logo.png" alt="ELHELB GROUP" />
              </div>
            </div>

            <div className="voice-stage-label">
              {callStage === 'listening' && '🎙️ أنا سامعك... اتفضل اتكلم براحتك'}
              {callStage === 'thinking' && '⏳ ثواني، بحلل كلامك وبجهز التوصية...'}
              {callStage === 'speaking' && '🔊 المساعد الذكي يرد عليك الآن...'}
              {callStage === 'ready' && 'اضغط «تحدث الآن» للتكلم مرة أخرى'}
            </div>

            {liveTranscript && (
              <div className="voice-user-transcript">«{liveTranscript}»</div>
            )}

            {callError && <div className="voice-error-box">{callError}</div>}

            {!callError && lastBotSubtitle && (
              <div className="voice-bot-subtitle">
                <FormattedMessage text={lastBotSubtitle} />
              </div>
            )}

            <div className="voice-call-controls">
              {callStage === 'speaking' && (
                <button
                  type="button"
                  className="voice-action-btn secondary"
                  onClick={startCallListeningCycle}
                >
                  <Mic size={18} /> مقاطعة والتحدث الآن
                </button>
              )}

              {callStage === 'ready' && (
                <button
                  type="button"
                  className="voice-action-btn primary"
                  onClick={startCallListeningCycle}
                >
                  <Mic size={18} /> تحدث الآن
                </button>
              )}

              <button
                type="button"
                className="voice-action-btn end-call"
                onClick={onCloseVoiceCall}
              >
                <PhoneOff size={18} /> إنهاء المحادثة الصوتية
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
