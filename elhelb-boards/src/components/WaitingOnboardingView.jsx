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
} from 'lucide-react';
import { apiFetch } from '../api';
import { getInitials } from '../constants';

export default function WaitingOnboardingView({
  user,
  onRefreshMe,
  onQuickSwitchAccount,
  onLogout,
  showToast,
}) {
  const [departments, setDepartments] = useState([]);
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [prefDeptId, setPrefDeptId] = useState(user.preferredDepartmentId || '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle || '');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

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

    apiFetch('/api/auth/demo-accounts', { suppressPermissionModal: true })
      .then((list) => setDemoAccounts(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  // Poll automatically every 6 seconds so as soon as the Department Head clicks "ضمه إلى قسمي",
  // the employee immediately enters their department boards!
  useEffect(() => {
    const timer = setInterval(() => {
      onRefreshMe();
    }, 6000);
    return () => clearInterval(timer);
  }, [onRefreshMe]);

  async function handleSavePreference(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/onboarding/my-preference', {
        method: 'PATCH',
        body: {
          preferredDepartmentId: prefDeptId ? Number(prefDeptId) : null,
          jobTitle,
        },
      });
      await onRefreshMe();
      showToast(
        'تم حفظ قسمك وإرسال إشعار فوري إلى رئيس القسم لإضافتك!',
        'success'
      );
    } catch (err) {
      showToast(err.message || 'تعذر حفظ القسم', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      const updated = await onRefreshMe();
      if (updated && updated.onboardingStatus === 'approved') {
        showToast(`تم ضمك إلى (${updated.departmentName}) بنجاح!`, 'success');
      } else {
        showToast('لا يزال حسابك بانتظار اعتماد رئيس القسم', 'info');
      }
    } finally {
      setChecking(false);
    }
  }

  const providerLabel =
    user.authProvider === 'facebook'
      ? 'Facebook'
      : user.authProvider === 'google'
      ? 'Google'
      : 'الشركة';

  return (
    <div className="app-shell">
      <header className="top-navbar">
        <div className="nav-right">
          <div className="nav-brand" style={{ cursor: 'default' }}>
            <img src="/logo.png" alt="ELHELB GROUP" />
            <div>
              <div className="nav-brand-title">ELHELB GROUP</div>
              <div className="nav-brand-sub">بوابة ضم الموظفين للأقسام</div>
            </div>
          </div>
        </div>

        <div className="nav-left">
          <div className="user-pill" style={{ cursor: 'default' }}>
            <div className="avatar-circle" style={{ background: user.avatarColor }}>
              {getInitials(user.fullName)}
            </div>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{user.fullName}</div>
              <div style={{ fontSize: 10.5, color: '#fde68a', fontWeight: 700 }}>
                مسجل عبر {providerLabel} • بانتظار رئيس القسم
              </div>
            </div>
          </div>

          <button type="button" className="icon-btn-dark" onClick={onLogout}>
            <LogOut size={15} />
            <span>تسجيل خروج</span>
          </button>
        </div>
      </header>

      <div className="page-container" style={{ maxWidth: 820, marginTop: 24 }}>
        <div
          className="card-box"
          style={{
            padding: 28,
            borderTop: '4px solid #d4a90a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 58,
                height: 58,
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
              <Clock size={30} />
            </div>

            <div style={{ flex: 1, minWidth: 250 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  className="badge"
                  style={{
                    background: user.authProvider === 'facebook' ? '#1877f2' : '#ea4335',
                    color: '#fff',
                  }}
                >
                  تم التحقق عبر {providerLabel}
                </span>
                {user.email && (
                  <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }} dir="ltr">
                    {user.email}
                  </span>
                )}
              </div>

              <h2 style={{ margin: '10px 0 6px', fontSize: 22, fontWeight: 900, color: '#0b2545' }}>
                أهلاً بك يا {user.fullName} في منصة مجموعة الهلب!
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.75 }}>
                تم إنشاء حسابك باسمك الحقيقي بنجاح. حفاظاً على سرية لوحات كل قسم، حسابك الآن في{' '}
                <strong>غرفة انتظار التسكين</strong> حتى يقوم <strong>رئيس القسم</strong> التابع له
                (أو إدارة الـ IT) بإضافتك إلى قسمك بضغطة واحدة.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleSavePreference}
            style={{
              marginTop: 22,
              padding: 18,
              borderRadius: 12,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14.5, color: '#0b2545', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Building2 size={17} color="#0a6fa8" />
              حدد القسم الذي تعمل به ليظهر اسمك فوراً أمام رئيس القسم:
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">القسم التابع له بالشركة</label>
                <select
                  className="form-select"
                  value={prefDeptId}
                  onChange={(e) => setPrefDeptId(e.target.value)}
                  required
                >
                  <option value="">-- اختر القسم --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">المسمى الوظيفي (اختياري)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="مثال: أخصائي تصدير / مسؤول تسجيل منتجات"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12.5, color: '#059669', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={15} />
                {user.preferredDepartmentName
                  ? `طلبك موجه حالياً إلى: (${user.preferredDepartmentName})`
                  : 'اختر قسمك واضغط حفظ لإشعار رئيس القسم'}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCheckNow}
                  disabled={checking}
                >
                  <RefreshCw size={14} />
                  {checking ? 'جاري التحقق...' : 'تحديث الحالة الآن'}
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  <Send size={14} />
                  {saving ? 'جاري الإرسال...' : 'حفظ وإبلاغ رئيس القسم'}
                </button>
              </div>
            </div>
          </form>

          <div
            style={{
              marginTop: 16,
              fontSize: 12.5,
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ShieldCheck size={15} color="#0a6fa8" />
            تتحدث هذه الصفحة تلقائياً كل بضع ثوانٍ، وبمجرد موافقة رئيس القسم ستفتح لك لوحات قسمك مباشرة دون الحاجة لإعادة تسجيل الدخول.
          </div>
        </div>

        {/* Helpful Manager Quick-Switch Box for testing the approval flow live! */}
        {demoAccounts.length > 0 && (
          <div className="card-box" style={{ marginTop: 18, padding: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: '#0b2545', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Users size={16} color="#0a6fa8" />
              لتجربة خطوة الاعتماد الآن: انتقل بضغطة واحدة إلى حساب رئيس القسم أو الـ IT لضم هذا الموظف:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {demoAccounts
                .filter((a) =>
                  ['chairman', 'it_mgr', 'export_mgr', 'reg_mgr', 'sales_mgr', 'media_mgr'].includes(
                    a.username
                  )
                )
                .map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onQuickSwitchAccount(acc.username, acc.demoPassword)}
                  >
                    الدخول كـ {acc.fullName} ({acc.roleName})
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
