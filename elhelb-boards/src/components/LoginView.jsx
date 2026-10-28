import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Users,
  Building2,
  LogIn,
  KeyRound,
  UserPlus,
  Eye,
  EyeOff,
  Crown,
  X,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../api';
import { getInitials } from '../constants';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export default function LoginView({ onLoginSuccess, initialOAuthError = '' }) {
  const [username, setUsername] = useState('chairman');
  const [password, setPassword] = useState('123456');
  const [showPass, setShowPass] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [oauthInfo, setOauthInfo] = useState({
    googleConfigured: false,
    facebookConfigured: false,
    departments: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialOAuthError || '');

  // Social Entry Modal state (used when external OAuth keys aren't configured yet, or for instant signup)
  const [socialModalProvider, setSocialModalProvider] = useState(null); // 'google' | 'facebook' | null
  const [socialFullName, setSocialFullName] = useState('');
  const [socialEmail, setSocialEmail] = useState('');
  const [socialDeptId, setSocialDeptId] = useState('');
  const [socialJobTitle, setSocialJobTitle] = useState('');
  const [socialSubmitting, setSocialSubmitting] = useState(false);
  const [socialError, setSocialError] = useState('');

  useEffect(() => {
    apiFetch('/api/auth/demo-accounts')
      .then((list) => setDemoAccounts(Array.isArray(list) ? list : []))
      .catch(() => {});

    apiFetch('/api/auth/oauth/providers')
      .then((info) => {
        if (info) {
          setOauthInfo(info);
          if (Array.isArray(info.departments) && info.departments.length > 0) {
            setSocialDeptId(info.departments[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  async function performLogin(u, p) {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username: u, password: p },
      });
      onLoginSuccess(res.token, res.user);
    } catch (err) {
      setError(err.message || 'تعذر تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    performLogin(username, password);
  }

  function handleSocialButtonClick(provider) {
    setError('');
    if (provider === 'google' && oauthInfo.googleConfigured) {
      window.location.href = '/api/auth/oauth/google/start';
      return;
    }
    if (provider === 'facebook' && oauthInfo.facebookConfigured) {
      window.location.href = '/api/auth/oauth/facebook/start';
      return;
    }
    setSocialError('');
    setSocialModalProvider(provider);
  }

  async function handleSocialSubmit(e) {
    e.preventDefault();
    setSocialError('');
    setSocialSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/social-entry', {
        method: 'POST',
        body: {
          provider: socialModalProvider,
          fullName: socialFullName,
          email: socialEmail,
          preferredDepartmentId: socialDeptId ? Number(socialDeptId) : null,
          jobTitle: socialJobTitle,
        },
      });
      setStoredToken(res.token);
      const me = await apiFetch('/api/auth/me', { suppressPermissionModal: true });
      setSocialModalProvider(null);
      onLoginSuccess(res.token, me.user);
    } catch (err) {
      setSocialError(err.message || 'تعذر إتمام تسجيل الدخول');
    } finally {
      setSocialSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card-panel">
        <div className="login-brand-header">
          <img src="/logo.png" alt="ELHELB GROUP" />
          <h1>مجموعة الهلب — ELHELB GROUP</h1>
          <p>منصة إدارة المهام والأقسام بنظام الصلاحيات الديناميكية</p>
          <div className="gold-divider" />
        </div>

        {/* Employee Social Login (Google & Facebook) */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: '#0b2545',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            تسجيل دخول الموظفين الجدد والحاليين بالاسم الحقيقي:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleSocialButtonClick('google')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 10px',
                borderRadius: 10,
                background: '#ffffff',
                border: '1.5px solid #cbd5e1',
                color: '#0f172a',
                fontWeight: 800,
                fontSize: 13,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <GoogleMark />
              <span>دخول بـ Google</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleSocialButtonClick('facebook')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 10px',
                borderRadius: 10,
                background: '#1877F2',
                border: '1.5px solid #1877F2',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 13,
                boxShadow: '0 1px 2px rgba(24,119,242,0.25)',
              }}
            >
              <FacebookMark />
              <span>دخول بـ Facebook</span>
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', marginTop: 6 }}>
            بعد التسجيل بـ Google أو Facebook يقوم <strong>رئيس القسم</strong> بضمك لقسمك بضغطة واحدة
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '12px 0 14px',
            color: '#94a3b8',
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          <span>أو الدخول بحسابات الإدارة ورؤساء الأقسام</span>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        </div>

        {/* Sovereign & Admin Ready Credentials Box */}
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 14,
            fontSize: 12,
            color: '#78350f',
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Crown size={14} color="#b45309" />
            حساب رئيس مجلس الإدارة السيادي (جاهز للدخول):
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>
              المستخدم: <strong dir="ltr">chairman</strong> | قسم الـ IT: <strong dir="ltr">it_mgr</strong>
            </span>
            <span>
              كلمة المرور الموحدة: <strong dir="ltr">123456</strong>
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">اسم المستخدم أو البريد الإلكتروني</label>
            <input
              type="text"
              className="form-input"
              placeholder="مثال: chairman أو it_mgr أو export_mgr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              dir="ltr"
              style={{ textAlign: 'left', fontWeight: 700 }}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">كلمة المرور</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                className="form-input"
                placeholder="123456"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                dir="ltr"
                style={{ textAlign: 'left', paddingRight: 38, fontWeight: 700 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  padding: 4,
                  display: 'flex',
                }}
                title={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                background: '#fee2e2',
                color: '#b91c1c',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 14,
                border: '1px solid #fecaca',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: 15 }}
            disabled={loading}
          >
            <LogIn size={18} />
            {loading ? 'جاري تسجيل الدخول...' : 'دخول فوري إلى المنصة'}
          </button>
        </form>

        {/* Compact Quick-Login Pills */}
        {demoAccounts.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
              دخول سريع بضغطة واحدة:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {demoAccounts.slice(0, 6).map((acc) => (
                <button
                  key={`quick-${acc.username}`}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword(acc.demoPassword);
                    performLogin(acc.username, acc.demoPassword);
                  }}
                  style={{
                    background: acc.roleSlug === 'chairman' ? '#fef3c7' : '#f1f5f9',
                    border: `1px solid ${acc.roleSlug === 'chairman' ? '#f59e0b' : '#cbd5e1'}`,
                    borderRadius: 8,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#0f172a',
                  }}
                >
                  {acc.roleSlug === 'chairman' ? '👑 ' : ''}
                  {acc.roleName} ({acc.username})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="login-showcase-panel">
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(212, 169, 10, 0.18)',
              border: '1px solid rgba(212, 169, 10, 0.45)',
              color: '#fde68a',
              padding: '5px 12px',
              borderRadius: 99,
              fontSize: 12.5,
              fontWeight: 700,
              marginBottom: 14,
            }}
          >
            <KeyRound size={14} />
            دليل الحسابات الجاهزة للتجربة (كلمة المرور الموحدة: 123456)
          </div>

          <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 900 }}>
            هيكل متكامل لمجلس الإدارة، الـ IT، التصدير، تسجيل المنتجات، وكافة أقسام الشركة
          </h2>
          <p style={{ margin: 0, color: '#cbd5e1', fontSize: 13.5, maxWidth: 760, lineHeight: 1.7 }}>
            اضغط على أي حساب بالأسفل للدخول مباشرة ومشاهدة صلاحياته الفعلية وعزل أقسام الشركة:
          </p>

          <div className="demo-accounts-grid">
            {demoAccounts.map((acc) => {
              const isSovereign = acc.roleSlug === 'chairman';
              return (
                <button
                  key={acc.username}
                  type="button"
                  className="demo-account-btn"
                  disabled={loading}
                  style={
                    isSovereign
                      ? {
                          border: '1.5px solid rgba(251, 191, 36, 0.75)',
                          background: 'rgba(180, 83, 9, 0.22)',
                        }
                      : undefined
                  }
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword(acc.demoPassword);
                    performLogin(acc.username, acc.demoPassword);
                  }}
                >
                  <div
                    className="avatar-circle"
                    style={{ background: acc.avatarColor, width: 40, height: 40, fontSize: 13 }}
                  >
                    {getInitials(acc.fullName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isSovereign && <Crown size={14} color="#fbbf24" />}
                        {acc.fullName}
                      </span>
                      <code
                        dir="ltr"
                        style={{
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fde68a',
                          padding: '1px 6px',
                          borderRadius: 5,
                          fontSize: 11,
                        }}
                      >
                        {acc.username} / 123456
                      </code>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#cbd5e1', marginBottom: 5 }}>
                      {acc.jobTitle}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      <span
                        style={{
                          background: acc.roleColor || '#0a6fa8',
                          color: '#fff',
                          padding: '1px 7px',
                          borderRadius: 99,
                          fontSize: 10.5,
                          fontWeight: 700,
                        }}
                      >
                        {acc.roleName}
                      </span>
                      <span
                        style={{
                          background: 'rgba(255,255,255,0.14)',
                          color: '#e2e8f0',
                          padding: '1px 7px',
                          borderRadius: 99,
                          fontSize: 10.5,
                          fontWeight: 600,
                        }}
                      >
                        {acc.departmentName}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.12)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            fontSize: 12.5,
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Crown size={17} color="#fbbf24" />
            <span>حساب سيادي أعلى لرئيس مجلس الإدارة + صلاحيات مشتركة لقسم الـ IT</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={17} color="#38bdf8" />
            <span>عزل كامل لأقسام التصدير، تسجيل المنتجات، الـ IT، المبيعات، المشتريات، والميديا</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={17} color="#34d399" />
            <span>تسجيل الموظفين بـ Google و Facebook وضمهم عبر رؤساء الأقسام</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={17} color="#c084fc" />
            <span>صلاحيات ديناميكية في قاعدة البيانات مع نظام طلبات إذن من المدير</span>
          </div>
        </div>
      </div>

      {/* Social Sign-In / Registration Modal */}
      {socialModalProvider && (
        <div className="modal-backdrop" onClick={() => setSocialModalProvider(null)}>
          <div
            className="modal-panel"
            style={{ maxWidth: 490 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 900, fontSize: 16 }}>
                {socialModalProvider === 'google' ? (
                  <GoogleMark />
                ) : (
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: '#1877F2',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FacebookMark />
                  </span>
                )}
                <span>
                  المتابعة بحساب {socialModalProvider === 'google' ? 'Google' : 'Facebook'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSocialModalProvider(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSocialSubmit}>
              <div className="modal-body">
                <div
                  style={{
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12.5,
                    color: '#0c4a6e',
                    marginBottom: 14,
                    lineHeight: 1.65,
                  }}
                >
                  سجّل اسمك الحقيقي وبريدك الإلكتروني ليصل إشعار فوري إلى{' '}
                  <strong>رئيس القسم</strong> فيضيفك إلى قسمك ولوحات العمل الخاصة بك.
                </div>

                {/* Quick Fill Demo Pending Employee */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', marginBottom: 5 }}>
                    أو جرّب بموظف جديد جاهز بضغطة واحدة:
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSocialFullName('أحمد حسام الدين');
                        setSocialEmail('ahmed.hossam@gmail.com');
                        setSocialJobTitle('أخصائي تصدير دولي');
                        const exp = oauthInfo.departments.find((d) => d.name.includes('التصدير'));
                        if (exp) setSocialDeptId(exp.id);
                      }}
                    >
                      أحمد حسام (التصدير)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSocialFullName('د. نهى فؤاد');
                        setSocialEmail('noha.fouad@facebook.com');
                        setSocialJobTitle('أخصائية تسجيل مستحضرات');
                        const reg = oauthInfo.departments.find((d) => d.name.includes('تسجيل'));
                        if (reg) setSocialDeptId(reg.id);
                      }}
                    >
                      د. نهى فؤاد (تسجيل المنتجات)
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">الاسم الثلاثي أو الكامل للموظف *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="مثال: كريم محمود عبد الرحمن"
                    value={socialFullName}
                    onChange={(e) => setSocialFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    البريد الإلكتروني لحساب {socialModalProvider === 'google' ? 'Google' : 'Facebook'} *
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder={
                      socialModalProvider === 'google'
                        ? 'name@gmail.com'
                        : 'name@facebook.com'
                    }
                    value={socialEmail}
                    onChange={(e) => setSocialEmail(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">القسم التابع له بالشركة</label>
                    <select
                      className="form-select"
                      value={socialDeptId}
                      onChange={(e) => setSocialDeptId(e.target.value)}
                    >
                      {oauthInfo.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">المسمى الوظيفي (اختياري)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="مثال: مسؤول تصدير"
                      value={socialJobTitle}
                      onChange={(e) => setSocialJobTitle(e.target.value)}
                    />
                  </div>
                </div>

                {socialError && (
                  <div
                    style={{
                      background: '#fee2e2',
                      color: '#b91c1c',
                      padding: '9px 12px',
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 700,
                      border: '1px solid #fecaca',
                    }}
                  >
                    {socialError}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSocialModalProvider(null)}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={
                    socialModalProvider === 'facebook'
                      ? { background: '#1877F2', borderColor: '#1877F2' }
                      : undefined
                  }
                  disabled={socialSubmitting}
                >
                  {socialSubmitting
                    ? 'جاري تسجيل الدخول...'
                    : `تسجيل الدخول عبر ${socialModalProvider === 'google' ? 'Google' : 'Facebook'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
