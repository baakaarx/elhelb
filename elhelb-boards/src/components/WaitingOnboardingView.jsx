import React, { useEffect, useState } from 'react';
import {
  Clock,
  Building2,
  CheckCircle2,
  RefreshCw,
  LogOut,
  Users,
  Send,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  ArrowLeft,
  Edit3,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../api';
import { getInitials } from '../constants';

export default function WaitingOnboardingView({
  user,
  onRefreshMe,
  onLogout,
  showToast,
}) {
  const [departments, setDepartments] = useState([]);

  // Step 1 state: Create Username & Password
  const [fullName, setFullName] = useState(user.fullName || '');
  const [username, setUsername] = useState(user.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsError, setCredsError] = useState('');
  const [editingCreds, setEditingCreds] = useState(false);

  // Step 2 state: Choose Department
  const [prefDeptId, setPrefDeptId] = useState(user.preferredDepartmentId || '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle || '');
  const [savingDept, setSavingDept] = useState(false);
  const [editingDept, setEditingDept] = useState(false);

  // Step 3 state: Waiting room check
  const [checking, setChecking] = useState(false);

  // Determine active step
  const activeStep =
    !user.hasCustomCredentials || editingCreds
      ? 1
      : !user.departmentConfirmed || editingDept
      ? 2
      : 3;

  useEffect(() => {
    apiFetch('/api/auth/oauth/providers', { suppressPermissionModal: true })
      .then((res) => {
        if (res && Array.isArray(res.departments)) {
          setDepartments(res.departments);
          if (!prefDeptId && res.departments.length > 0) {
            setPrefDeptId(res.departments[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Poll automatically when waiting in Step 3 so once Department Head approves, boards open immediately!
  useEffect(() => {
    if (activeStep !== 3) return undefined;
    const timer = setInterval(() => {
      onRefreshMe();
    }, 6000);
    return () => clearInterval(timer);
  }, [activeStep, onRefreshMe]);

  async function handleSaveCredentials(e) {
    e.preventDefault();
    setCredsError('');

    if (password !== confirmPassword) {
      setCredsError('كلمتا المرور غير متطابقتين، يرجى التأكد من كتابتهما بشكل متطابق');
      return;
    }
    if (password.length < 10) {
      setCredsError('كلمة المرور يجب ألا تقل عن 10 أحرف أو أرقام لتأمين حسابك');
      return;
    }

    setSavingCreds(true);
    try {
      const res = await apiFetch('/api/onboarding/setup-credentials', {
        method: 'POST',
        body: {
          username: username.trim().toLowerCase(),
          currentPassword: user.hasCustomCredentials ? currentPassword : '',
          password,
          fullName: fullName.trim(),
        },
      });
      if (res && res.token) {
        setStoredToken(res.token);
      }
      setEditingCreds(false);
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      await onRefreshMe();
      showToast(
        'تم إنشاء اسم المستخدم وكلمة المرور بنجاح! اختر الآن القسم الذي تعمل به.',
        'success'
      );
    } catch (err) {
      setCredsError(err.message || 'تعذر حفظ اسم المستخدم وكلمة المرور');
    } finally {
      setSavingCreds(false);
    }
  }

  async function handleSaveDepartment(e) {
    e.preventDefault();
    if (!prefDeptId) {
      showToast('يرجى اختيار القسم الذي تعمل به', 'error');
      return;
    }
    setSavingDept(true);
    try {
      await apiFetch('/api/onboarding/my-preference', {
        method: 'PATCH',
        body: {
          preferredDepartmentId: Number(prefDeptId),
          jobTitle,
        },
      });
      setEditingDept(false);
      await onRefreshMe();
      showToast(
        'تم تسجيل قسمك وإرسال الطلب فوراً إلى إدارة الموارد البشرية (HR) للاعتماد والتسكين!',
        'success'
      );
    } catch (err) {
      showToast(err.message || 'تعذر حفظ القسم', 'error');
    } finally {
      setSavingDept(false);
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      const updated = await onRefreshMe();
      if (updated && updated.onboardingStatus === 'approved') {
        showToast(`تم اعتماد وتسكين حسابك في (${updated.departmentName}) بنجاح!`, 'success');
      } else {
        showToast('لا يزال حسابك بانتظار اعتماد وتسكين الموارد البشرية (HR)', 'info');
      }
    } finally {
      setChecking(false);
    }
  }

  const providerLabel =
    user.authProvider === 'google'
      ? 'حساب Google'
      : 'موظف جديد بانتظار التسكين';

  return (
    <div className="app-shell">
      <header className="top-navbar">
        <div className="nav-brand" style={{ cursor: 'default' }}>
          <img src="/logo.gif" alt="ELHELB GROUP" />
          <div>
            <div className="nav-brand-title">ELHELB GROUP</div>
            <div className="nav-brand-sub">إعداد حساب الموظف وتحديد القسم</div>
          </div>
        </div>

        <div className="nav-left">
          <div className="user-pill" style={{ cursor: 'default' }}>
            <div className="avatar-circle" style={{ background: user.avatarColor }}>
              {getInitials(user.fullName)}
            </div>
            <div className="user-pill-meta" style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{user.fullName}</div>
              <div style={{ fontSize: 10.5, color: '#fde68a', fontWeight: 700 }}>
                {providerLabel}
              </div>
            </div>
          </div>

          <button type="button" className="icon-btn-dark" onClick={onLogout}>
            <LogOut size={15} />
            <span className="cta-label-text">تسجيل خروج</span>
          </button>
        </div>
      </header>

      <div className="page-container" style={{ maxWidth: 850, marginTop: 14 }}>
        {/* 3-Step Visual Stepper */}
        <div className="onboarding-stepper">
          {[
            { num: 1, title: '1. إنشاء اسم وباسورد', done: user.hasCustomCredentials && activeStep > 1 },
            { num: 2, title: '2. تحديد القسم بالشركة', done: user.departmentConfirmed && activeStep > 2 },
            { num: 3, title: '3. اعتماد الموارد البشرية (HR)', done: false },
          ].map((st) => {
            const isCurrent = activeStep === st.num;
            return (
              <div
                key={st.num}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: isCurrent
                    ? '#0b2545'
                    : st.done
                    ? '#ecfdf5'
                    : '#ffffff',
                  color: isCurrent ? '#ffffff' : st.done ? '#065f46' : '#64748b',
                  border: isCurrent
                    ? '2px solid #d4a90a'
                    : st.done
                    ? '1px solid #6ee7b7'
                    : '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {st.done ? (
                  <CheckCircle2 size={17} color="#059669" />
                ) : (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: isCurrent ? '#d4a90a' : '#e2e8f0',
                      color: isCurrent ? '#0b2545' : '#475569',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    {st.num}
                  </span>
                )}
                <span>{st.title}</span>
              </div>
            );
          })}
        </div>

        {/* ============================================================
            STEP 1: CREATE USERNAME & PASSWORD PAGE
           ============================================================ */}
        {activeStep === 1 && (
          <div className="card-box onboarding-card" style={{ borderTop: '4px solid #0a6fa8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: '#eff6ff',
                  color: '#0a6fa8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <KeyRound size={26} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    className="badge"
                    style={{
                      background: '#15803d',
                      color: '#fff',
                    }}
                  >
                    تسجيل موظف جديد
                  </span>
                  {user.email && (
                    <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }} dir="ltr">
                      {user.email}
                    </span>
                  )}
                </div>
                <h2 style={{ margin: '8px 0 4px', fontSize: 21, fontWeight: 900, color: '#0b2545' }}>
                  أنشئ اسم المستخدم وكلمة المرور الخاصة بك
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, color: '#475569' }}>
                  اختر اسم مستخدم وكلمة مرور ليسهل عليك الدخول مباشرة إلى المنصة في أي وقت، ثم انتقل لتحديد القسم الذي تعمل به.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveCredentials}>
              <div className="form-group">
                <label className="form-label">الاسم الكامل للموظف (كما يظهر لرئيس القسم) *</label>
                <input
                  type="text"
                  className="form-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  اسم المستخدم للدخول (حروف إنجليزية أو أرقام بدون مسافات) *
                </label>
                <input
                  type="text"
                  className="form-input"
                  dir="ltr"
                  style={{ textAlign: 'left', fontWeight: 800, fontFamily: 'monospace' }}
                  placeholder="مثال: ahmed.ali"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())
                  }
                  required
                />
              </div>

              {user.hasCustomCredentials && (
                <div className="form-group">
                  <label className="form-label">كلمة المرور الحالية (لتأكيد التعديل) *</label>
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder="أدخل كلمة المرور الحالية"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">كلمة المرور الجديدة *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="form-input"
                      dir="ltr"
                      style={{ textAlign: 'left', paddingRight: 38 }}
                      placeholder="10 أحرف أو أرقام على الأقل"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
                      }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">تأكيد كلمة المرور *</label>
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder="أعد كتابة كلمة المرور"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {credsError && (
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
                  {credsError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                {editingCreds && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditingCreds(false)}
                  >
                    إلغاء
                  </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={savingCreds}>
                  <span>{savingCreds ? 'جاري الحفظ...' : 'حفظ والمتابعة لاختيار القسم'}</span>
                  <ArrowLeft size={16} />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ============================================================
            STEP 2: CHOOSE YOUR DEPARTMENT PAGE
           ============================================================ */}
        {activeStep === 2 && (
          <div className="card-box onboarding-card" style={{ borderTop: '4px solid #059669' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: '#ecfdf5',
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Building2 size={26} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#059669' }}>
                  تم حفظ اسم المستخدم (@{user.username}) بنجاح ✅
                </div>
                <h2 style={{ margin: '4px 0', fontSize: 21, fontWeight: 900, color: '#0b2545' }}>
                  اختر القسم الذي تعمل به في مجموعة الهلب
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, color: '#475569' }}>
                  حدد قسمك بالأسفل ليصل طلبك فوراً إلى <strong>إدارة الموارد البشرية (HR)</strong> والإدارة العليا لاعتماد حسابك وتسكينك في قسمك.
                </p>
              </div>
            </div>

            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              💡 إذا كنت من فريق <strong>الموارد البشرية (HR)</strong>، اختر <strong>«قسم الموارد البشرية»</strong> ليقوم رئيس مجلس الإدارة باعتماد صلاحيات الـ HR لحسابك.
            </div>

            <form onSubmit={handleSaveDepartment}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                  marginBottom: 18,
                }}
              >
                {departments.map((d) => {
                  const selected = Number(prefDeptId) === Number(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setPrefDeptId(d.id)}
                      style={{
                        textAlign: 'right',
                        padding: '13px 14px',
                        borderRadius: 12,
                        border: selected
                          ? `2.5px solid ${d.color || '#0a6fa8'}`
                          : '1px solid #cbd5e1',
                        background: selected ? '#f0f9ff' : '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: d.color || '#0a6fa8',
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontWeight: 800, fontSize: 13.5, color: '#0f172a' }}>
                            {d.name}
                          </span>
                          {Boolean(d.is_chairman_exclusive) && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#b45309' }}>
                              👑 يتبع مكتب رئيس مجلس الإدارة مباشرةً
                            </span>
                          )}
                        </div>
                      </div>
                      {selected && <CheckCircle2 size={17} color={d.color || '#0a6fa8'} />}
                    </button>
                  );
                })}
              </div>

              <div className="form-group">
                <label className="form-label">المسمى الوظيفي داخل القسم (اختياري)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="مثال: أخصائي تصدير دولي / مسؤول تسجيل منتجات"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 14,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingCreds(true)}
                >
                  <Edit3 size={14} />
                  تعديل اسم المستخدم / الباسورد
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#059669', borderColor: '#059669' }}
                  disabled={savingDept}
                >
                  <Send size={15} />
                  {savingDept ? 'جاري إرسال الطلب...' : 'تأكيد القسم وإرسال الطلب للـ HR'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ============================================================
            STEP 3: WAITING FOR DEPARTMENT HEAD APPROVAL
           ============================================================ */}
        {activeStep === 3 && (
          <div className="card-box onboarding-card" style={{ borderTop: '4px solid #d4a90a' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Clock size={28} />
              </div>

              <div style={{ flex: 1, minWidth: 'min(100%, 240px)' }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 900, color: '#0b2545' }}>
                  تم إرسال طلبك بنجاح يا {user.fullName}!
                </h2>
                <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.75 }}>
                  تم حفظ بيانات دخولك وإرسال طلب التسكين إلى <strong>إدارة الموارد البشرية (HR)</strong> والإدارة العليا. بمجرد اعتماد حسابك وتسكينك في قسمك ستُفتح لك لوحات العمل تلقائياً.
                </p>

                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 12,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 10,
                    fontSize: 13,
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b' }}>اسم المستخدم الخاص بك: </span>
                    <strong dir="ltr">@{user.username}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>القسم المطلوب: </span>
                    <strong style={{ color: '#0a6fa8' }}>
                      {user.preferredDepartmentName || 'قيد التحديد'}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingDept(true)}
                    >
                      <Building2 size={14} />
                      تغيير القسم المختار
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingCreds(true)}
                    >
                      <KeyRound size={14} />
                      تعديل اسم المستخدم / الباسورد
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCheckNow}
                    disabled={checking}
                  >
                    <RefreshCw size={14} />
                    {checking ? 'جاري التحقق...' : 'تحديث الحالة الآن'}
                  </button>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShieldCheck size={15} color="#15803d" />
              يمكنك الدخول في أي وقت باستخدام اسم المستخدم{' '}
              <strong dir="ltr">@{user.username}</strong> وكلمة المرور التي اخترتها.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
