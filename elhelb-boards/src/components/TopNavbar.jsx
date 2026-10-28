import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid,
  KeyRound,
  Inbox,
  Shield,
  Bell,
  Search,
  LogOut,
  Users,
  UserPlus,
  ChevronDown,
  CheckCheck,
  Crown,
} from 'lucide-react';
import { apiFetch } from '../api';
import { formatSqliteDate, getInitials } from '../constants';

export default function TopNavbar({
  user,
  activeTab,
  onSelectTab,
  onOpenBoard,
  onOpenRequestModal,
  onLogout,
  onRefreshMe,
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const searchRef = useRef(null);
  const notifRef = useRef(null);
  const accRef = useRef(null);

  const permSet = new Set(user.permissions || []);
  const canOnboardMembers =
    permSet.has('department.onboard_members') || permSet.has('users.manage');
  const canReviewRequests =
    permSet.has('requests.review_department') || permSet.has('requests.review_all');
  const canAccessAdmin =
    permSet.has('roles.manage') ||
    permSet.has('users.manage') ||
    permSet.has('departments.manage') ||
    permSet.has('audit.view');

  const isChairman = user.roleSlug === 'chairman';

  useEffect(() => {
    function onDocClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchResults(null);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
      if (accRef.current && !accRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch(`/api/search?q=${encodeURIComponent(q)}`, { suppressPermissionModal: true })
        .then((res) => setSearchResults(res))
        .catch(() => setSearchResults({ boards: [], cards: [] }));
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQ]);

  async function toggleNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      try {
        const list = await apiFetch('/api/auth/notifications');
        setNotifications(list);
      } catch (_) {}
    }
  }

  async function markAllNotificationsRead() {
    try {
      await apiFetch('/api/auth/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
      onRefreshMe();
    } catch (_) {}
  }

  function openAccountMenu() {
    setAccountMenuOpen((prev) => !prev);
  }

  return (
    <header className="top-navbar">
      <div className="nav-right">
        <div
          className="nav-brand"
          onClick={() => onSelectTab('boards')}
          title="العودة إلى لوحات العمل"
        >
          <img src="/logo.gif" alt="ELHELB GROUP" />
          <div>
            <div className="nav-brand-title">ELHELB GROUP</div>
            <div className="nav-brand-sub">إدارة المهام والقطاعات</div>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'boards' ? 'active' : ''}`}
            onClick={() => onSelectTab('boards')}
          >
            <LayoutGrid size={15} />
            لوحات العمل
          </button>

          {canOnboardMembers && (
            <button
              type="button"
              className={`nav-tab ${activeTab === 'onboarding' ? 'active' : ''}`}
              onClick={() => onSelectTab('onboarding')}
            >
              <UserPlus size={15} />
              ضم الموظفين للقسم
              {user.pendingOnboardingCount > 0 && (
                <span className="nav-badge" title="موظفون مسجلون بانتظار الضم">
                  {user.pendingOnboardingCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            className={`nav-tab ${activeTab === 'my-requests' ? 'active' : ''}`}
            onClick={() => onSelectTab('my-requests')}
          >
            <KeyRound size={15} />
            طلباتي وتصاريحي
            {user.activeGrants && user.activeGrants.length > 0 && (
              <span className="nav-badge gold" title="تصاريح مؤقتة نشطة">
                {user.activeGrants.length}
              </span>
            )}
          </button>

          {canReviewRequests && (
            <button
              type="button"
              className={`nav-tab ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => onSelectTab('requests')}
            >
              <Inbox size={15} />
              طلبات الصلاحيات
              {user.reviewableRequestsCount > 0 && (
                <span className="nav-badge">{user.reviewableRequestsCount}</span>
              )}
            </button>
          )}

          {canAccessAdmin && (
            <button
              type="button"
              className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => onSelectTab('admin')}
            >
              <Shield size={15} />
              إدارة الصلاحيات والنظام
            </button>
          )}
        </nav>
      </div>

      <div className="nav-left">
        {/* Global Authorized Search */}
        <div className="nav-search-wrap" ref={searchRef}>
          <Search
            size={14}
            color="#94a3b8"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            className="nav-search-input"
            placeholder="بحث في لوحاتك ومهامك..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          {searchResults && (
            <div className="search-dropdown">
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', marginBottom: 6 }}>
                نتائج البحث المصرح لك بها فقط:
              </div>
              {searchResults.boards.length === 0 && searchResults.cards.length === 0 ? (
                <div style={{ padding: '12px 6px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                  لا توجد نتائج مطابقة ضمن صلاحياتك
                </div>
              ) : (
                <>
                  {searchResults.boards.map((b) => (
                    <div
                      key={`b-${b.id}`}
                      onClick={() => {
                        setSearchResults(null);
                        setSearchQ('');
                        onOpenBoard(b.id);
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{b.title}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>لوحة عمل — {b.department_name}</div>
                    </div>
                  ))}
                  {searchResults.cards.map((c) => (
                    <div
                      key={`c-${c.id}`}
                      onClick={() => {
                        setSearchResults(null);
                        setSearchQ('');
                        onOpenBoard(c.board_id, c.id);
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>
                        كارت في ({c.list_title}) — {c.board_title}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Request Elevation Button (hidden for top global executives who already hold all permissions) */}
        {!permSet.has('boards.view_all') && (
          <button
            type="button"
            className="icon-btn-dark gold-cta"
            onClick={() => onOpenRequestModal({})}
            title="طلب صلاحية إضافية أو وصول مؤقت من المدير"
          >
            <KeyRound size={14} />
            <span>طلب صلاحية</span>
          </button>
        )}

        {/* Notifications Bell */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button
            type="button"
            className="icon-btn-dark"
            onClick={toggleNotifications}
            title="الإشعارات"
          >
            <Bell size={16} />
            {user.unreadNotificationsCount > 0 && (
              <span className="nav-badge" style={{ marginRight: 2 }}>
                {user.unreadNotificationsCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="popover-menu" style={{ width: 350 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 14 }}>الإشعارات والتنبيهات</span>
                {user.unreadNotificationsCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={markAllNotificationsRead}
                  >
                    <CheckCheck size={13} />
                    تحديد كمقروء
                  </button>
                )}
              </div>

              <div style={{ maxHeight: 330, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: 18, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                    لا توجد إشعارات حتى الآن
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        setNotifOpen(false);
                        if (n.link_board_id) onOpenBoard(n.link_board_id);
                        else if (n.link_tab) onSelectTab(n.link_tab);
                      }}
                      style={{
                        padding: '9px 11px',
                        borderRadius: 8,
                        background: n.is_read ? '#f8fafc' : '#eff6ff',
                        border: `1px solid ${n.is_read ? '#e2e8f0' : '#bfdbfe'}`,
                        cursor: n.link_board_id || n.link_tab ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 12.5, color: '#0f172a' }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{n.message}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                        {formatSqliteDate(n.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Fast Account Switcher */}
        <div style={{ position: 'relative' }} ref={accRef}>
          <div
            className="user-pill"
            onClick={openAccountMenu}
            style={
              isChairman
                ? { border: '1px solid rgba(251, 191, 36, 0.65)', background: 'rgba(180, 83, 9, 0.28)' }
                : undefined
            }
          >
            <div className="avatar-circle" style={{ background: user.avatarColor }}>
              {getInitials(user.fullName)}
            </div>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                {isChairman && <Crown size={13} color="#fbbf24" />}
                {user.fullName}
              </div>
              <div style={{ fontSize: 10.5, color: '#fde68a', fontWeight: 700 }}>
                {user.roleName} • {user.departmentName}
              </div>
            </div>
            <ChevronDown size={14} color="#cbd5e1" />
          </div>

          {accountMenuOpen && (
            <div className="popover-menu" style={{ width: 350 }}>
              <div
                style={{
                  padding: '10px 12px',
                  background: '#f8fafc',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {isChairman && <Crown size={15} color="#d97706" />}
                  {user.fullName}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  @{user.username} — {user.jobTitle}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <span
                    className="badge"
                    style={{ background: user.roleColor || '#0a6fa8', color: '#fff' }}
                  >
                    الدور: {user.roleName}
                  </span>
                  <span
                    className="badge"
                    style={{ background: '#e0f2fe', color: '#0369a1' }}
                  >
                    {user.departmentName}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: '#475569', marginTop: 8 }}>
                  عدد الصلاحيات المفعلة بدورك: <strong>{user.permissions.length}</strong> صلاحية
                </div>
              </div>

              <button
                type="button"
                className="btn btn-danger-soft"
                style={{ width: '100%' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={15} />
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
