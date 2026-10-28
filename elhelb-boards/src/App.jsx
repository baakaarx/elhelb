import React, { useCallback, useEffect, useState } from 'react';
import {
  apiFetch,
  getStoredToken,
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
import SecurityTesterView from './components/SecurityTesterView';

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

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
    refreshMe().finally(() => setBooting(false));
  }, [refreshMe]);

  // Ensure activeTab remains authorized if user's role changed
  useEffect(() => {
    if (!user) return;
    const perms = new Set(user.permissions || []);
    const canReview = perms.has('requests.review_department') || perms.has('requests.review_all');
    const canAdmin =
      perms.has('roles.manage') ||
      perms.has('users.manage') ||
      perms.has('departments.manage') ||
      perms.has('audit.view');

    if (activeTab === 'requests' && !canReview) setActiveTab('boards');
    if (activeTab === 'admin' && !canAdmin) setActiveTab('boards');
  }, [user, activeTab]);

  function handleLoginSuccess(token, loggedUser) {
    setStoredToken(token);
    setUser(loggedUser);
    setActiveBoardId(null);
    setInitialCardId(null);
    setActiveTab('boards');
    showToast(`مرحباً ${loggedUser.fullName} — دورك الحالي: ${loggedUser.roleName}`, 'success');
  }

  async function handleQuickSwitchAccount(username, password) {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setStoredToken(res.token);
      setUser(res.user);
      setActiveBoardId(null);
      setInitialCardId(null);
      setActiveTab('boards');
      showToast(
        `تم التبديل إلى حساب (${res.user.fullName}) — ${res.user.roleName} (${res.user.departmentName})`,
        'success'
      );
    } catch (err) {
      showToast(err.message || 'تعذر تبديل الحساب', 'error');
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
    if (tab !== 'boards') {
      setActiveBoardId(null);
      setInitialCardId(null);
    } else {
      setActiveBoardId(null);
      setInitialCardId(null);
    }
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
          background: '#06182c',
          color: '#fff',
        }}
      >
        <img src="/logo.png" alt="ELHELB" style={{ width: 72 }} />
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          جاري تحميل منصة مجموعة الهلب والتحقق من الصلاحيات...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginView onLoginSuccess={handleLoginSuccess} />
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
        onQuickSwitchAccount={handleQuickSwitchAccount}
        onLogout={handleLogout}
        onRefreshMe={refreshMe}
      />

      {activeTab === 'boards' && !activeBoardId && (
        <BoardsDashboard
          user={user}
          onOpenBoard={handleOpenBoard}
          onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
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

      {activeTab === 'security-lab' && (
        <SecurityTesterView
          user={user}
          onOpenRequestModal={(ctx) => setRequestModalContext(ctx || {})}
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
              `تم إرسال طلب الصلاحية بنجاح إلى (${res.routedTo}) — ستصلك إشعار فور اعتماده!`,
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
