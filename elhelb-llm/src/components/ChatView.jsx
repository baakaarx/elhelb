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
  getVoiceDiagnostics,
  speakArabic,
  stopSpeaking,
  startArabicRecognition,
  startVoiceRecorder,
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
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceNoteUrl, setVoiceNoteUrl] = useState('');
  const [speakingMsgId, setSpeakingMsgId] = useState(null);
  const micHandleRef = useRef(null);
  const recorderRef = useRef(null);
  const voiceCallStartedRef = useRef(false);

  // حالات وضع المكالمة / المحادثة الصوتية المباشرة
  const [callStage, setCallStage] = useState('idle'); // 'listening' | 'thinking' | 'speaking' | 'ready'
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastBotSubtitle, setLastBotSubtitle] = useState('');
  const [callError, setCallError] = useState('');
  const callActiveRef = useRef(false);
  const callRecRef = useRef(null);
  const callRetryTimerRef = useRef(null);
  const callGenerationRef = useRef(0);
  const callFatalErrorRef = useRef(false);

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
    if (!isMicListening && !isRecordingVoice) { setVoiceSeconds(0); return undefined; }
    const timer = window.setInterval(() => setVoiceSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isMicListening, isRecordingVoice]);

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

  // إدارة دورة حياة وضع المكالمة: استمع، أرسل بعد الوقفة، انطق الرد، ثم استأنف الاستماع.
  useEffect(() => {
    if (voiceCallOpen) {
      callActiveRef.current = true;
      setCallError('');
      setLastBotSubtitle('أهلاً بيك! اتفضل اتكلم بكلامك العادي؛ هبعت كلامك بعد ما تسكت لحظة، وبعدها هرد عليك بصوت.');
      if (!voiceCallStartedRef.current) setCallStage('ready');
    } else {
      callActiveRef.current = false;
      voiceCallStartedRef.current = false;
      callGenerationRef.current += 1;
      clearTimeout(callRetryTimerRef.current);
      callRetryTimerRef.current = null;
      callRecRef.current?.abort();
      callRecRef.current = null;
      stopSpeaking();
      setCallStage('idle');
      setLiveTranscript('');
    }

  }, [voiceCallOpen]);

  useEffect(() => () => {
    callActiveRef.current = false;
    callGenerationRef.current += 1;
    clearTimeout(callRetryTimerRef.current);
    callRetryTimerRef.current = null;
    callRecRef.current?.abort();
    stopSpeaking();
  }, []);

  function scheduleCallRetry(delay = 700) {
    if (!callActiveRef.current || callRetryTimerRef.current) return;
    callRetryTimerRef.current = window.setTimeout(() => {
      callRetryTimerRef.current = null;
      if (callActiveRef.current) startCallListeningCycle();
    }, delay);
  }

  function openVoiceCall() {
    voiceCallStartedRef.current = true;
    callActiveRef.current = true;
    setCallError('');
    onOpenVoiceCall?.();
    startCallListeningCycle();
  }

  function startCallListeningCycle({ preserveError = false } = {}) {
    if (!callActiveRef.current) return;
    clearTimeout(callRetryTimerRef.current);
    callRetryTimerRef.current = null;
    const generation = ++callGenerationRef.current;
    callRecRef.current?.abort();
    callRecRef.current = null;
    stopSpeaking();
    callFatalErrorRef.current = false;
    if (!preserveError) setCallError('');
    setLiveTranscript('');
    setCallStage('starting');

    const handle = startArabicRecognition({
      onStatus: (status) => {
        if (!callActiveRef.current || generation !== callGenerationRef.current) return;
        if (status === 'starting') setCallStage('starting');
        if (status === 'listening' || status === 'audio') setCallStage('listening');
        if (status === 'processing') setCallStage('thinking');
      },
      onInterim: (txt) => {
        if (callActiveRef.current && generation === callGenerationRef.current) setLiveTranscript(txt);
      },
      onFinal: async (finalText) => {
        if (!callActiveRef.current || generation !== callGenerationRef.current) return;
        setLiveTranscript(finalText);
        setCallStage('thinking');
        const replyData = await sendTurn(finalText, { fromVoiceCall: true });
        if (!callActiveRef.current || generation !== callGenerationRef.current) return;

        if (replyData?.assistantMessage) {
          const toSpeak = replyData.speechText || replyData.assistantMessage.content;
          setLastBotSubtitle(replyData.assistantMessage.content);
          setCallStage('speaking');
          let speechFailed = false;
          speakArabic(toSpeak, {
            onStart: () => {
              if (callActiveRef.current && generation === callGenerationRef.current) setCallStage('speaking');
            },
            onError: (err) => {
              speechFailed = true;
              if (callActiveRef.current && generation === callGenerationRef.current) {
                setCallError(err?.message || 'تعذر تشغيل الرد الصوتي. اضغط «اختبار الصوت» لمعرفة السبب.');
              }
            },
            onEnd: () => {
              if (callActiveRef.current && generation === callGenerationRef.current) {
                startCallListeningCycle({ preserveError: speechFailed });
              }
            },
          });
        } else {
          setCallStage('ready');
          if (callActiveRef.current && !callFatalErrorRef.current) scheduleCallRetry(900);
        }
      },
      onError: (errMsg, code) => {
        if (!callActiveRef.current || generation !== callGenerationRef.current) return;
        setCallError(errMsg);
        if (code === 'no-speech') {
          // بعض هواتف أندرويد توقف جلسة التعرف بعد الصمت؛ أعد فتح الميكروفون تلقائياً.
          scheduleCallRetry(800);
        } else {
          callFatalErrorRef.current = true;
          setCallStage('ready');
        }
      },
      onEnd: (resolvedText) => {
        if (!callActiveRef.current || generation !== callGenerationRef.current) return;
        if (!resolvedText && !callFatalErrorRef.current) scheduleCallRetry(500);
      },
    });

    callRecRef.current = handle;
  }

  function testCallSpeaker() {
    if (!callActiveRef.current) return;
    const generation = ++callGenerationRef.current;
    callRecRef.current?.abort();
    callRecRef.current = null;
    callFatalErrorRef.current = false;
    setCallError('');
    setLastBotSubtitle('ده اختبار للصوت. لو سامعني، اتكلم بعد ما أخلص.');
    setCallStage('speaking');
    let speechFailed = false;
    speakArabic('ده اختبار للصوت. لو سامعني، اتكلم بعد ما أخلص.', {
      onStart: () => {
        if (callActiveRef.current && generation === callGenerationRef.current) setCallStage('speaking');
      },
      onError: (err) => {
        speechFailed = true;
        if (callActiveRef.current && generation === callGenerationRef.current) {
          setCallError(err?.message || 'تعذر تشغيل صوت الجهاز. تأكد من رفع صوت الوسائط وتفعيل صوت عربي.');
          setCallStage('ready');
        }
      },
      onEnd: () => {
        if (callActiveRef.current && generation === callGenerationRef.current) {
          startCallListeningCycle({ preserveError: speechFailed });
        }
      },
    });
  }

  function toggleInlineMic() {
    if (!isVoiceInputSupported() || (!window.SpeechRecognition && !window.webkitSpeechRecognition)) {
      if (isRecordingVoice) {
        recorderRef.current?.stop();
        recorderRef.current = null;
        setIsRecordingVoice(false);
        return;
      }
      setError('المتصفح الحالي لا يوفّر تفريغ الكلام العربي. افتح الموقع في Chrome أو Safari واسمح بالميكروفون؛ التسجيل الاحتياطي يُحفظ للاستماع فقط ولا يتحول لنص.');
      startVoiceRecorder({
        onReady: (blob) => {
          setVoiceNoteUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); });
          setError('تم تسجيل الملاحظة الصوتية. يمكنك الاستماع إليها، ثم اكتب ملخصها في مربع الرسالة لإرسالها للمساعد.');
        },
        onError: (message) => { setError(message); setIsRecordingVoice(false); },
        onStop: () => setIsRecordingVoice(false),
      }).then((handle) => {
        recorderRef.current = handle;
        if (handle) setIsRecordingVoice(true);
      });
      return;
    }
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
        setInput(finalText);
        sendTurn(finalText, { autoSpeakReply: true, fromVoiceInput: true });
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
      onError: (err) => setError(err?.message || 'تعذر تشغيل الصوت؛ يمكنك قراءة الرد على الشاشة.'),
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
    const { autoSpeakReply = false, fromVoiceCall = false, fromVoiceInput = false } = opts;
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
    if (customPrompt === undefined || fromVoiceInput) setInput('');
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
          onError: (err) => setError(err?.message || 'تعذر تشغيل الصوت؛ يمكنك قراءة الرد على الشاشة.'),
          onEnd: () => setSpeakingMsgId(null),
        });
      }

      return res;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      const msg = err.message || 'تعذر إرسال الرسالة، يرجى المحاولة مرة أخرى.';
      if (fromVoiceInput) setInput(textToSend);
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
                <img src="./logo.png" alt="ELHELB GROUP" />
              </div>

              <h1 className="welcome-title">أهلاً بك في المساعد الذكي لمجموعة الهلب</h1>
              <p className="welcome-subtitle">
                اتكلم بصوتك أو اكتب بكلامك العادي عن <strong>مشكلة محصولك، علاج الآفات، أو المبيدات المتوفرة</strong>، وهنساعدك خطوة بخطوة.
              </p>

              <button type="button" className="hero-voice-cta" onClick={openVoiceCall}>
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
                          <img src="./logo.png" alt="ELHELB" />
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

          {(isMicListening || isRecordingVoice) && (
            <div className="listening-banner">
              <div className="voice-wave-bars"><span /><span /><span /><span /></div>
              <span>{`${isRecordingVoice ? 'جاري تسجيل الملاحظة' : 'جاري الاستماع'} · ${String(Math.floor(voiceSeconds / 60)).padStart(2, '0')}:${String(voiceSeconds % 60).padStart(2, '0')} — ${isRecordingVoice ? 'اضغط لإيقاف التسجيل' : 'سيُرسل النص تلقائياً بعد التوقف'}`}</span>
            </div>
          )}
          {voiceNoteUrl && (
            <div className="image-preview-strip voice-note-strip">
              <div><div style={{fontWeight:700, marginBottom:6}}>ملاحظة صوتية مسجلة</div><audio controls src={voiceNoteUrl} /></div>
              <button type="button" className="remove-img-btn" onClick={() => { URL.revokeObjectURL(voiceNoteUrl); setVoiceNoteUrl(''); }} aria-label="حذف التسجيل"><X size={16} /></button>
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
              disabled={loading || isMicListening}
            >
              <ImagePlus size={20} />
            </button>

            <button
              type="button"
              className={`mic-btn ${(isMicListening || isRecordingVoice) ? 'recording' : ''}`}
              onClick={toggleInlineMic}
              title={(isMicListening || isRecordingVoice) ? 'إيقاف التسجيل' : 'تكلم بصوتك بالعامية'}
              aria-label={(isMicListening || isRecordingVoice) ? 'إيقاف التسجيل' : 'التحدث بالصوت'}
              disabled={loading}
            >
              {(isMicListening || isRecordingVoice) ? <MicOff size={20} /> : <Mic size={20} />}
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
              placeholder={
                isMicListening
                  ? 'أنا سامعك... اتفضل اتكلم'
                  : 'اكتب سؤالك أو اضغط المايك 🎙️ وتكلم...'
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
              <div className="voice-privacy-note">
                تحويل كلامك لنص يعتمد على المتصفح والجهاز، وقد يستخدم خدمة النظام؛ تجنّب ذكر بيانات سرية.
              </div>
            </div>

            <div className={`voice-orb-container ${callStage}`}>
              <div className="orb-ring ring-1" />
              <div className="orb-ring ring-2" />
              <div className="voice-orb-core">
                <img src="./logo.png" alt="ELHELB GROUP" />
              </div>
            </div>

            <div className="voice-stage-label">
              {callStage === 'starting' && '⏳ بفتح الميكروفون... اسمح للمتصفح لو طلب الإذن'}
              {callStage === 'listening' && '🎙️ سامعك... اتكلم براحتك، وهبعت كلامك بعد الوقفة'}
              {callStage === 'thinking' && '⏳ ثواني، بحلل كلامك وبجهز الرد...'}
              {callStage === 'speaking' && '🔊 المساعد بيرد عليك بصوت'}
              {callStage === 'ready' && 'اضغط «تحدث الآن» علشان أسمعك'}
            </div>

            {liveTranscript && (
              <div className="voice-user-transcript">«{liveTranscript}»</div>
            )}

            {callError && (
              <div className="voice-error-box">
                <div>{callError}</div>
                <div className="voice-device-check">
                  حالة الجهاز: {getVoiceDiagnostics().secureContext ? 'اتصال آمن' : 'افتح الرابط عبر HTTPS'}،{' '}
                  {getVoiceDiagnostics().recognition ? 'التعرف على الكلام متاح' : 'التعرف على الكلام غير مدعوم'}،{' '}
                  {getVoiceDiagnostics().synthesis ? 'النطق متاح' : 'النطق غير متاح'}،{' '}
                  {getVoiceDiagnostics().arabicVoice ? 'صوت عربي موجود' : 'لم يظهر صوت عربي مثبت'}.
                </div>
              </div>
            )}

            {!callError && lastBotSubtitle && (
              <div className="voice-bot-subtitle">
                <FormattedMessage text={lastBotSubtitle} />
              </div>
            )}

            <div className="voice-call-controls">
              {(callStage === 'speaking' || callStage === 'thinking') && (
                <button
                  type="button"
                  className="voice-action-btn secondary"
                  onClick={() => {
                    stopSpeaking();
                    startCallListeningCycle();
                  }}
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
                className="voice-action-btn secondary"
                onClick={testCallSpeaker}
              >
                <Volume2 size={18} /> اختبار الصوت
              </button>

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
