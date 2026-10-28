import React, { useCallback, useEffect, useState } from 'react';
import {
  apiFetch,
  setApiHandlers,
  setStoredToken,
} from './api';
import LoginView from './components/LoginView';
import TopNavbar from './components/TopNavbar';
import BoardsDashboard from './components/BoardsDashboard';
import KanbanBoardView from './components/KanbanBoardView';
import PermissionRequestModal from './components/PermissionRequestModal';
import { ManagerInboxView, MyRequestsView } from './components/RequestsViews';
import AdminControlView from './components/AdminControlView';
import WaitingOnboardingView from './components/WaitingOnboardingView';
import DepartmentOnboardingView from './components/DepartmentOnboardingView';

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [oauthError, setOauthError] = useState('');

  const [activeTab, setActiveTab] = useState('boards');
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [initialCardId, setInitialCardId] = useState(null);

  const [requestModalContext, setRequestModalContext] = useState(null);
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/me', { suppressPermissionModal: true });
      setUser(res.user);
      return res.user;
    } catch (_) {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    setApiHandlers({
      onPermissionDenied: (payload) => {
        refreshMe();
        setRequestModalContext({
          ...payload,
          fromServerDeny: true,
        });
      },
      onSessionExpired: () => {
        setUser(null);
        setActiveBoardId(null);
      },
    });
  }, [refreshMe]);

  useEffect(() => {
    // Handle OAuth 2.0 callback token or error in URL query
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const oauthToken = params.get('oauth_token');
      const oauthErr = params.get('oauth_error');
      if (oauthToken) {
        setStoredToken(oauthToken);
      }
      if (oauthErr) {
        setOauthError('لم يكتمل تسجيل الدخول عبر المزود الخارجي، يمكنك المحاولة مرة أخرى.');
      }
      if (oauthToken || oauthErr) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    refreshMe().finally(() => setBooting(false));
  }, [refreshMe]);

  // Ensure activeTab remains authorized if user's role changed
  useEffect(() => {
    if (!user || user.onboardingStatus === 'pending') return;
    const perms = new Set(user.permissions || []);
    const canOnboard = perms.has('department.onboard_members') || perms.has('users.manage');
    const canReview = perms.has('requests.review_department') || perms.has('requests.review_all');
    const canAdmin =
      perms.has('roles.manage') ||
      perms.has('users.manage') ||
      perms.has('departments.manage') ||
      perms.has('audit.view');

    if (activeTab === 'onboarding' && !canOnboard) setActiveTab('boards');
    if (activeTab === 'requests' && !canReview) setActiveTab('boards');
    if (activeTab === 'admin' && !canAdmin) setActiveTab('boards');
  }, [user, activeTab]);

  function handleLoginSuccess(token, loggedUser) {
    setStoredToken(token);
    setUser(loggedUser);
    setActiveBoardId(null);
    setInitialCardId(null);
    setActiveTab('boards');
    if (!loggedUser.hasCustomCredentials) {
      showToast(
        `أهلاً بك ${loggedUser.fullName} — أنشئ الآن اسم المستخدم وكلمة المرور ثم حدد قسمك`,
        'info'
      );
    } else if (loggedUser.onboardingStatus === 'pending') {
      showToast(
        `أهلاً بك ${loggedUser.fullName} — حسابك جاهز وبانتظار ضم رئيس القسم`,
        'info'
      );
    } else {
      showToast(
        `مرحباً ${loggedUser.fullName} — دورك الحالي: ${loggedUser.roleName}`,
        'success'
      );
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', suppressPermissionModal: true });
    } catch (_) {}
    setStoredToken('');
    setUser(null);
    setActiveBoardId(null);
    setInitialCardId(null);
    setActiveTab('boards');
  }

  function handleSelectTab(tab) {
    setActiveTab(tab);
    setActiveBoardId(null);
    setInitialCardId(null);
  }

  function handleOpenBoard(boardId, cardId = null) {
    setActiveTab('boards');
    setActiveBoardId(boardId);
    setInitialCardId(cardId);
  }

  if (booting) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          background: '#071e14',
          color: '#fff',
        }}
      >
        <img
          src="/logo.gif"
          alt="ELHELB"
          style={{
            width: 112,
            height: 112,
            borderRadius: 20,
            border: '1px solid rgba(212,169,10,0.45)',
          }}
        />
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          جاري تحميل منصة مجموعة الهلب والتحقق من الصلاحيات...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginView
          onLoginSuccess={handleLoginSuccess}
          initialOAuthError={oauthError}
        />
        <ToastStack toasts={toasts} />
      </>
    );
  }

  // Gate newly registered employees in the Onboarding Wizard until credentials + department head approval!
  if (user.onboardingStatus === 'pending' || !user.hasCustomCredentials) {
    return (
      <>
        <WaitingOnboardingView
          user={user}
          onRefreshMe={refreshMe}
          onLogout={handleLogout}
          showToast={showToast}
        />
        <ToastStack toasts={toasts} />
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopNavbar
        user={user}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenBoard={handleOpenBoard}
        onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
        onLogout={handleLogout}
        onRefreshMe={refreshMe}
      />

      {activeTab === 'boards' && !activeBoardId && (
        <BoardsDashboard
          user={user}
          onOpenBoard={handleOpenBoard}
          onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
          onOpenOnboarding={() => handleSelectTab('onboarding')}
          showToast={showToast}
        />
      )}

      {activeTab === 'boards' && activeBoardId && (
        <KanbanBoardView
          boardId={activeBoardId}
          initialCardId={initialCardId}
          currentUser={user}
          onBack={() => {
            setActiveBoardId(null);
            setInitialCardId(null);
          }}
          onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
          onRefreshMe={refreshMe}
          showToast={showToast}
        />
      )}

      {activeTab === 'onboarding' && (
        <DepartmentOnboardingView
          user={user}
          onRefreshMe={refreshMe}
          showToast={showToast}
        />
      )}

      {activeTab === 'my-requests' && (
        <MyRequestsView
          user={user}
          onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
          onOpenBoard={handleOpenBoard}
          showToast={showToast}
        />
      )}

      {activeTab === 'requests' && (
        <ManagerInboxView
          user={user}
          onRefreshMe={refreshMe}
          showToast={showToast}
        />
      )}

      {activeTab === 'admin' && (
        <AdminControlView
          user={user}
          onRefreshMe={refreshMe}
          showToast={showToast}
        />
      )}

      {requestModalContext !== null && (
        <PermissionRequestModal
          user={user}
          initialContext={requestModalContext}
          onClose={() => setRequestModalContext(null)}
          onSubmitted={(res) => {
            setRequestModalContext(null);
            refreshMe();
            showToast(
              `تم إرسال طلب الصلاحية بنجاح إلى (${res.routedTo}) — سيصلك إشعار فور اعتماده!`,
              'success'
            );
          }}
        />
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}

function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item ${t.type}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
