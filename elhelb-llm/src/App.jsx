import React, { useMemo, useState } from 'react';
import { RotateCcw, AudioLines, X } from 'lucide-react';
import { getVisitorSessionId, resetVisitorSessionId, apiRequest } from './api';
import { stopSpeaking } from './voiceEngine';
import ChatView from './components/ChatView';

export default function App() {
  const [sessionId, setSessionId] = useState(() => getVisitorSessionId());
  const [hasMessages, setHasMessages] = useState(false);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);

  const isEmbeddedWidget = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === '1';
  }, []);

  async function handleNewChat() {
    stopSpeaking();
    try {
      await apiRequest(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
    const freshSid = resetVisitorSessionId();
    setSessionId(freshSid);
    setHasMessages(false);
  }

  function handleCloseWidgetPopup() {
    stopSpeaking();
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ELHELB_WIDGET_CLOSE' }, '*');
    }
  }

  return (
    <div className={`chatbot-shell ${isEmbeddedWidget ? 'embedded-widget' : ''}`}>
      <header className="chatbot-header">
        <div className="chatbot-header-inner">
          <div className="brand-identity">
            <img src="/logo.png" alt="ELHELB GROUP" className="brand-crest" />
            <div>
              <div className="brand-name">ELHELB GROUP</div>
              <div className="brand-tagline">المساعد الذكي والعيادة الزراعية</div>
            </div>
          </div>

          <div className="header-right-controls">
            <button
              type="button"
              className="voice-mode-header-btn"
              onClick={() => setVoiceCallOpen(true)}
              title="بدء محادثة صوتية مباشرة"
            >
              <AudioLines size={15} />
              <span>{isEmbeddedWidget ? 'صوت' : 'تحدث بالصوت'}</span>
            </button>

            {hasMessages && (
              <button
                type="button"
                className="new-chat-btn"
                onClick={handleNewChat}
                title="محادثة جديدة"
              >
                <RotateCcw size={14} />
                {!isEmbeddedWidget && <span>محادثة جديدة</span>}
              </button>
            )}

            {isEmbeddedWidget && (
              <button
                type="button"
                className="widget-close-header-btn"
                onClick={handleCloseWidgetPopup}
                aria-label="إغلاق النافذة"
                title="تصغير الشات"
              >
                <X size={17} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="chatbot-main">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          voiceCallOpen={voiceCallOpen}
          onOpenVoiceCall={() => setVoiceCallOpen(true)}
          onCloseVoiceCall={() => {
            stopSpeaking();
            setVoiceCallOpen(false);
          }}
          onMessagesCountChange={(count) => setHasMessages(count > 0)}
        />
      </main>
    </div>
  );
}
