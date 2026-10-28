import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Building2,
  LogIn,
  UserPlus,
  Eye,
  EyeOff,
  Mail,
  X,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../api';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [oauthInfo, setOauthInfo] = useState({
    googleConfigured: false,
    facebookConfigured: false,
    departments: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialOAuthError || '');

  // Social Entry Dialog (when external redirect keys aren't set yet)
  const [socialModalProvider, setSocialModalProvider] = useState(null);
  const [socialFullName, setSocialFullName] = useState('');
  const [socialEmail, setSocialEmail] = useState('');
  const [socialSubmitting, setSocialSubmitting] = useState(false);
  const [socialError, setSocialError] = useState('');

  useEffect(() => {
    apiFetch('/api/auth/oauth/providers')
      .then((info) => {
        if (info) setOauthInfo(info);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      onLoginSuccess(res.token, res.user);
    } catch (err) {
      setError(err.message || 'تعذر تسجيل الدخول');
    } finally {
      setLoading(false);
    }
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
          <p>بوابة إدارة الأعمال واللوحات للأقسام والقطاعات</p>
          <div className="gold-divider" />
        </div>

        {/* Standard Username & Password Login */}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">اسم المستخدم أو البريد الإلكتروني</label>
            <input
              type="text"
              className="form-input"
              placeholder="أدخل اسم المستخدم"
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
                placeholder="••••••••"
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
            {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '18px 0 14px',
            color: '#94a3b8',
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          <span>تسجيل موظف جديد لأول مرة</span>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        </div>

        {/* Employee Registration / Sign-In via Google & Facebook */}
        <div>
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
          <div style={{ fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 1.6 }}>
            عند التسجيل عبر Google أو Facebook تقوم بإنشاء <strong>اسم مستخدم وباسورد خاص بك</strong> ثم اختيار قسمك ليقوم <strong>رئيس القسم</strong> بضمك.
          </div>
        </div>
      </div>

      {/* Corporate Overview Panel (Zero Demo Accounts) */}
      <div className="login-showcase-panel">
        <div style={{ margin: 'auto 0' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(212, 169, 10, 0.18)',
              border: '1px solid rgba(212, 169, 10, 0.45)',
              color: '#fde68a',
              padding: '6px 14px',
              borderRadius: 99,
              fontSize: 13,
              fontWeight: 800,
              marginBottom: 18,
            }}
          >
            <ShieldCheck size={16} />
            المنصة الرقمية الموحدة — ELHELB GROUP
          </div>

          <h2 style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 900, lineHeight: 1.4 }}>
            نظام متابعة المهام وإدارة قطاعات وأقسام مجموعة الهلب
          </h2>
          <p style={{ margin: '0 0 28px', color: '#cbd5e1', fontSize: 15, maxWidth: 680, lineHeight: 1.8 }}>
            منصة عمل مؤسسية مؤمّنة بالكامل لتنظيم لوحات المهام اليومية عبر قطاعات الشركة مع عزل كامل لبيانات كل قسم ونظام صلاحيات وإشعارات بريدية فورية.
          </p>

          {/* Company Departments Strip */}
          {oauthInfo.departments && oauthInfo.departments.length > 0 && (
            <div style={{ marginBottom: 30 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fde68a', marginBottom: 10 }}>
                الأقسام والقطاعات العاملة على المنصة:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {oauthInfo.departments.map((d) => (
                  <span
                    key={d.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '7px 13px',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.14)',
                      color: '#f8fafc',
                      fontSize: 12.5,
                      fontWeight: 700,
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: d.color || '#38bdf8',
                      }}
                    />
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* How Employee Onboarding Works */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 14,
            }}
          >
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#fde68a', marginBottom: 6 }}>
                <UserPlus size={17} />
                <span>1. تسجيل الموظف الجديد</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
                يسجل الموظف عبر Google أو Facebook ثم يُنشئ لنفسه اسم مستخدم وباسورد خاصاً به.
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#38bdf8', marginBottom: 6 }}>
                <Building2 size={17} />
                <span>2. اختيار القسم واعتماد المدير</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
                يحدد الموظف قسمه ليصل طلب انضمامه إلى رئيس القسم لاعتماده وتسكينه في لوحات قسمه.
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#34d399', marginBottom: 6 }}>
                <Mail size={17} />
                <span>3. إشعارات فورية على Gmail</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
                ترسل المنصة تنبيهات مباشرة على البريد الإلكتروني عند طلبات الانضمام والصلاحيات والمهام.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Social Sign-In Identity Dialog */}
      {socialModalProvider && (
        <div className="modal-backdrop" onClick={() => setSocialModalProvider(null)}>
          <div
            className="modal-panel"
            style={{ maxWidth: 440 }}
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
                  تسجيل الدخول بحساب {socialModalProvider === 'google' ? 'Google' : 'Facebook'}
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
                  بعد المتابعة، ستنتقل مباشرة إلى <strong>صفحة إنشاء اسم المستخدم وكلمة المرور</strong> الخاصة بك ثم <strong>تحديد القسم</strong> الذي تعمل به.
                </div>

                <div className="form-group">
                  <label className="form-label">الاسم الكامل للموظف *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="اكتب اسمك الكامل"
                    value={socialFullName}
                    onChange={(e) => setSocialFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: socialError ? 12 : 4 }}>
                  <label className="form-label">
                    البريد الإلكتروني لحساب {socialModalProvider === 'google' ? 'Google (Gmail)' : 'Facebook'} *
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder="name@gmail.com"
                    value={socialEmail}
                    onChange={(e) => setSocialEmail(e.target.value)}
                    required
                  />
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
                    ? 'جاري المتابعة...'
                    : `متابعة بحساب ${socialModalProvider === 'google' ? 'Google' : 'Facebook'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
