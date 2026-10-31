import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { getVisitorSessionId, resetVisitorSessionId, apiRequest } from './api';
import ChatView from './components/ChatView';

export default function App() {
  const [sessionId, setSessionId] = useState(() => getVisitorSessionId());
  const [hasMessages, setHasMessages] = useState(false);

  const isEmbeddedWidget = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === '1';
  }, []);

  // مزامنة الارتفاع الفعلي للشاشة على الموبايل (iOS Safari + Android) عند فتح أو إغلاق لوحة المفاتيح
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const rootEl = document.documentElement;
    const syncViewportHeight = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      if (height && height > 0) {
        rootEl.style.setProperty('--app-height', `${Math.round(height)}px`);
      }
      // منع انزلاق الصفحة للأعلى في متصفح سفاري عند فتح الكيبورد
      if (vv && vv.offsetTop > 0) {
        window.scrollTo(0, 0);
      }
    };

    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportHeight);
      window.visualViewport.addEventListener('scroll', syncViewportHeight);
    }

    return () => {
      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', syncViewportHeight);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', syncViewportHeight);
        window.visualViewport.removeEventListener('scroll', syncViewportHeight);
      }
    };
  }, []);

  async function handleNewChat() {
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
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ELHELB_WIDGET_CLOSE' }, '*');
    }
  }

  return (
    <div className={`chatbot-shell ${isEmbeddedWidget ? 'embedded-widget' : ''}`}>
      <header className="chatbot-header">
        <div className="chatbot-header-inner">
          <div className="brand-identity">
            <img src="./logo.png" alt="ELHELB GROUP" className="brand-crest" />
            <div className="brand-text-wrap">
              <div className="brand-name">ELHELB GROUP</div>
              <div className="brand-tagline">المساعد الذكي والعيادة الزراعية</div>
            </div>
          </div>

          <div className="header-right-controls">
            {hasMessages && (
              <button
                type="button"
                className="new-chat-btn"
                onClick={handleNewChat}
                title="محادثة جديدة"
                aria-label="محادثة جديدة"
              >
                <RotateCcw size={15} />
                {!isEmbeddedWidget && <span className="new-chat-label">محادثة جديدة</span>}
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
          onMessagesCountChange={(count) => setHasMessages(count > 0)}
        />
      </main>
    </div>
  );
}
