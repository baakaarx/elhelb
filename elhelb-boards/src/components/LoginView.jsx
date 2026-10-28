import React, { useEffect, useState } from 'react';
import {
  LogIn,
  UserPlus,
  Eye,
  EyeOff,
  Sprout,
  Globe2,
  ArrowLeft,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../api';

const FARM_SLIDES = [
  {
    id: 0,
    image: '/farms/hero-farm-1.jpg',
    tag: 'Plant Care • وقاية المزروعات',
    title: 'وقاية متكاملة للمحاصيل',
    subtitle: 'حلول مبتكرة وموثوقة لحماية المزارع ومكافحة الآفات من البذرة حتى الحصاد.',
  },
  {
    id: 1,
    image: '/farms/hero-farm-2.jpg',
    tag: 'Crop Enhancement • تغذية النبات',
    title: 'تعزيز الإنتاجية وخصوبة التربة',
    subtitle: 'أسمدة متطورة وتقنيات زراعية حديثة تضمن أعلى عائد وجودة للمحاصيل.',
  },
  {
    id: 2,
    image: '/farms/hero-farm-3.jpg',
    tag: 'Global Presence • +22 دولة',
    title: 'التصنيع والتصدير الدولي',
    subtitle: 'ريادة صناعية مصرية منذ 1993 تصل بمنتجات مجموعة الهلب إلى أكثر من 22 دولة حول العالم.',
  },
];

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

export default function LoginView({ onLoginSuccess, initialOAuthError = '' }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [activeSlide, setActiveSlide] = useState(0);

  // Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialOAuthError || '');

  // Direct Registration state (no OTP / no email verification block)
  const [regFullName, setRegFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [showRegPass, setShowRegPass] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');

  const [oauthInfo, setOauthInfo] = useState({
    googleConfigured: false,
    departments: [],
  });

  useEffect(() => {
    apiFetch('/api/auth/oauth/providers')
      .then((info) => {
        if (info) setOauthInfo(info);
      })
      .catch(() => {});
  }, []);

  // Auto-advance farm background slides every 6 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % FARM_SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  async function handleLoginSubmit(e) {
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

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    setRegError('');

    if (regPassword !== regConfirmPassword) {
      setRegError('كلمتا المرور غير متطابقتين — يرجى التأكد من كتابتهما بشكل متطابق');
      return;
    }

    setRegLoading(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: regFullName.trim(),
          username: regUsername.trim().toLowerCase(),
          password: regPassword,
          email: regEmail.trim(),
        },
      });
      setStoredToken(res.token);
      onLoginSuccess(res.token, res.user);
    } catch (err) {
      setRegError(err.message || 'تعذر إنشاء الحساب');
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="login-shell">
      {/* Right Panel: Animated Official GIF Logo + Clean Login / Direct Employee Registration */}
      <div className="login-card-panel">
        <div className="login-brand-header">
          <div className="prime-logo-crest">
            <img src="/logo.gif" alt="ELHELB GROUP Official Animated Logo" />
          </div>
          <h1>مجموعة الهلب — ELHELB GROUP</h1>
          <p>Manufacturers of Pesticides & Agrochemicals • Since 1993</p>
          <div className="gold-divider" />
        </div>

        <div className="prime-auth-card">
          <div className="prime-mode-tabs">
            <button
              type="button"
              className={`prime-mode-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              <LogIn size={15} />
              <span>تسجيل الدخول</span>
            </button>
            <button
              type="button"
              className={`prime-mode-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => {
                setMode('register');
                setRegError('');
              }}
            >
              <UserPlus size={15} />
              <span>تسجيل موظف جديد</span>
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label className="form-label">اسم المستخدم</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Username"
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
                    borderRadius: 10,
                    fontSize: 12.5,
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
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: 15,
                  background: 'linear-gradient(135deg, #15803d 0%, #0c3120 100%)',
                }}
                disabled={loading}
              >
                <LogIn size={18} />
                {loading ? 'جاري تسجيل الدخول...' : 'دخول إلى المنصة'}
              </button>

              {oauthInfo.googleConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/api/auth/oauth/google/start';
                  }}
                  style={{
                    marginTop: 10,
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    color: '#0f172a',
                    fontWeight: 800,
                    fontSize: 13.5,
                  }}
                >
                  <GoogleMark />
                  <span>المتابعة بحساب Google</span>
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">الاسم الكامل للموظف *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="مثال: م. محمد عبد الرحمن"
                  value={regFullName}
                  onChange={(e) => setRegFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">اسم المستخدم للدخول (بالإنجليزية) *</label>
                <input
                  type="text"
                  className="form-input"
                  dir="ltr"
                  style={{ textAlign: 'left', fontWeight: 700 }}
                  placeholder="mohamed.export"
                  value={regUsername}
                  onChange={(e) =>
                    setRegUsername(e.target.value.replace(/\s+/g, '').toLowerCase())
                  }
                  autoComplete="username"
                  required
                />
              </div>

              <div className="form-grid-2" style={{ marginBottom: 12 }}>
                <div>
                  <label className="form-label">كلمة المرور *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showRegPass ? 'text' : 'password'}
                      className="form-input"
                      dir="ltr"
                      style={{ textAlign: 'left', paddingRight: 32, fontWeight: 700 }}
                      placeholder="6+ أحرف"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPass((s) => !s)}
                      style={{
                        position: 'absolute',
                        right: 6,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        padding: 3,
                        display: 'flex',
                      }}
                    >
                      {showRegPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="form-label">تأكيد كلمة المرور *</label>
                  <input
                    type={showRegPass ? 'text' : 'password'}
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left', fontWeight: 700 }}
                    placeholder="إعادة الكتابة"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">البريد الإلكتروني (اختياري)</label>
                <input
                  type="email"
                  className="form-input"
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                  placeholder="name@gmail.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
              </div>

              {regError && (
                <div
                  style={{
                    background: '#fee2e2',
                    color: '#b91c1c',
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 12.5,
                    fontWeight: 700,
                    marginBottom: 14,
                    border: '1px solid #fecaca',
                  }}
                >
                  {regError}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: 14.5,
                  background: 'linear-gradient(135deg, #15803d 0%, #0c3120 100%)',
                }}
                disabled={regLoading}
              >
                <span>
                  {regLoading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب والانتقال لاختيار القسم'}
                </span>
                <ArrowLeft size={16} />
              </button>
            </form>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            textAlign: 'center',
            fontSize: 11.5,
            color: 'rgba(255,255,255,0.62)',
          }}
        >
          © ELHELB GROUP •{' '}
          <a
            href="https://elhelbgroup.com/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#fde68a', textDecoration: 'none', fontWeight: 700 }}
          >
            elhelbgroup.com
          </a>
        </div>
      </div>

      {/* Left Panel: Prime Full-Bleed Farm Photography Showcase (elhelbgroup.com Identity) */}
      <div className="login-showcase-panel">
        {FARM_SLIDES.map((slide, idx) => (
          <div
            key={slide.id}
            className="farm-slide-bg"
            style={{
              backgroundImage: `url(${slide.image})`,
              opacity: activeSlide === idx ? 1 : 0,
            }}
          />
        ))}
        <div className="farm-hero-overlay" />

        <div className="farm-hero-content">
          {/* Top Brand Identity Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(212, 169, 10, 0.2)',
                border: '1px solid rgba(250, 204, 21, 0.5)',
                color: '#fde68a',
                padding: '7px 16px',
                borderRadius: 99,
                fontSize: 13,
                fontWeight: 800,
                backdropFilter: 'blur(8px)',
              }}
            >
              <Sprout size={16} />
              <span>تأسست عام 1993 • ريادة الكيماويات الزراعية ووقاية المزروعات</span>
            </div>

            <a
              href="https://elhelbgroup.com/"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: 99,
                fontSize: 12.5,
                fontWeight: 700,
                textDecoration: 'none',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Globe2 size={15} color="#4ade80" />
              <span>الموقع الرسمي للمجموعة</span>
            </a>
          </div>

          {/* Center Hero Statement */}
          <div style={{ maxWidth: 740, margin: 'auto 0' }}>
            <div
              style={{
                color: '#4ade80',
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: 0.4,
                marginBottom: 8,
              }}
            >
              “A brand that brings smiles at harvest time…”
            </div>
            <h2 className="farm-hero-heading">
              علامة تجارية ترسم الابتسامة وقت الحصاد
            </h2>
            <p
              style={{
                margin: 0,
                color: '#e2f5ea',
                fontSize: 15.5,
                lineHeight: 1.85,
                textShadow: '0 2px 10px rgba(0,0,0,0.4)',
              }}
            >
              تقف <strong>مجموعة الهلب (ELHELB Group)</strong> في طليعة صناعة المبيدات والأسمدة والكيماويات الزراعية، لتمكين المزارعين وحماية المحاصيل وتعزيز الإنتاجية الزراعية المستدامة في مصر وأكثر من <strong>22 دولة حول العالم</strong>.
            </p>
          </div>

          {/* Bottom Interactive Farm Gallery Cards */}
          <div>
            <div className="prime-pillar-grid">
              {FARM_SLIDES.map((slide, idx) => (
                <div
                  key={slide.id}
                  className={`prime-pillar-card ${activeSlide === idx ? 'active' : ''}`}
                  onClick={() => setActiveSlide(idx)}
                >
                  <img
                    src={slide.image}
                    alt={slide.title}
                    className="prime-pillar-thumb"
                  />
                  <div style={{ padding: '12px 14px' }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: '#fde68a',
                        marginBottom: 3,
                      }}
                    >
                      {slide.tag}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 900,
                        color: '#ffffff',
                        marginBottom: 4,
                      }}
                    >
                      {slide.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#d1fae5',
                        lineHeight: 1.55,
                      }}
                    >
                      {slide.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
