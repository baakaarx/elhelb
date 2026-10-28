import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Users,
  Building2,
  LogIn,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { apiFetch } from '../api';
import { getInitials } from '../constants';

export default function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('123456');
  const [showPass, setShowPass] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/auth/demo-accounts')
      .then((list) => setDemoAccounts(Array.isArray(list) ? list : []))
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

  return (
    <div className="login-shell">
      <div className="login-card-panel">
        <div className="login-brand-header">
          <img src="/logo.png" alt="ELHELB GROUP" />
          <h1>مجموعة الهلب — ELHELB GROUP</h1>
          <p>منصة إدارة المهام واللوحات بنظام الصلاحيات الديناميكية</p>
          <div className="gold-divider" />
        </div>

        {/* Ready Credentials Box right above the form */}
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 16,
            fontSize: 12.5,
            color: '#78350f',
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            بيانات الدخول الجاهزة (تمت تعبئتها تلقائياً):
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>
              المستخدم: <strong dir="ltr">admin</strong> (المدير العام)
            </span>
            <span>
              كلمة المرور الموحدة للتجربة: <strong dir="ltr">123456</strong>
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">اسم المستخدم</label>
            <input
              type="text"
              className="form-input"
              placeholder="مثال: admin أو sales_emp"
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

        {/* Compact Quick-Login Pills visible immediately without scrolling */}
        {demoAccounts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 8 }}>
              أو ادخل بضغطة واحدة بأحد حسابات الأقسام:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '5px 9px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  {acc.roleName} ({acc.username})
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 18,
            padding: '10px 12px',
            background: '#f8fafc',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            fontSize: 12,
            color: '#475569',
            lineHeight: 1.65,
          }}
        >
          <div style={{ fontWeight: 800, color: '#0b2545', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={15} color="#0a6fa8" />
            تأمين كامل على مستوى السيرفر (Zero-Trust RBAC)
          </div>
          بعد الدخول يمكنك أيضاً إنشاء حسابك الخاص بأي اسم مستخدم وباسورد من تبويب <strong>إدارة الصلاحيات والنظام ← الموظفين</strong>.
        </div>
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
            جميع الحسابات التجريبية الجاهزة (كلمة المرور للجميع: 123456)
          </div>

          <h2 style={{ margin: '0 0 8px', fontSize: 25, fontWeight: 900 }}>
            جرّب عزل الأقسام، الأدوار، وطلبات الاستثناء من المدير بضغطة واحدة
          </h2>
          <p style={{ margin: 0, color: '#cbd5e1', fontSize: 14, maxWidth: 740, lineHeight: 1.7 }}>
            اضغط على أي موظف أو مدير بالأسفل للدخول مباشرة بحسابه ومشاهدة صلاحياته الفعلية على اللوحات:
          </p>

          <div className="demo-accounts-grid">
            {demoAccounts.map((acc) => (
              <button
                key={acc.username}
                type="button"
                className="demo-account-btn"
                disabled={loading}
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
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{acc.fullName}</span>
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
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,0.12)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            fontSize: 12.5,
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={17} color="#fbbf24" />
            <span>عزل صارم للوحات كل قسم (مبيعات، ميديا، مشتريات، HR)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={17} color="#38bdf8" />
            <span>تعديل الصلاحيات مباشرة من شاشة الإدارة في قاعدة البيانات</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={17} color="#34d399" />
            <span>نظام طلبات إذن من المدير (لمرة واحدة أو بمدة محددة)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={17} color="#c084fc" />
            <span>سجل مراقبة أمنية ومختبر فحص حي لصلاحيات السيرفر</span>
          </div>
        </div>
      </div>
    </div>
  );
}
