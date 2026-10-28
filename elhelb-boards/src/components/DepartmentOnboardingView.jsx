import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Users,
  Building2,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../api';
import { formatSqliteDate, getInitials } from '../constants';

export default function DepartmentOnboardingView({ user, onRefreshMe, showToast }) {
  const [data, setData] = useState({
    pendingUsers: [],
    assignableDepartments: [],
    assignableRoles: [],
    teamMembers: [],
    canManageAll: false,
  });
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [claimingId, setClaimingId] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/onboarding/pending');
      setData(res);

      // Initialize per-user assignment defaults
      const defaultRole =
        res.assignableRoles.find((r) => r.slug === 'staff') || res.assignableRoles[0];
      const nextDrafts = {};
      for (const pu of res.pendingUsers) {
        const defaultDept = res.canManageAll
          ? pu.preferred_department_id || res.assignableDepartments[0]?.id || ''
          : user.departmentId || res.assignableDepartments[0]?.id || '';
        nextDrafts[pu.id] = {
          departmentId: defaultDept,
          roleId: defaultRole ? defaultRole.id : '',
          jobTitle: pu.job_title || '',
        };
      }
      setDrafts((prev) => ({ ...nextDrafts, ...prev }));
    } catch (err) {
      showToast(err.message || 'تعذر تحميل قائمة الموظفين الجدد', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [user.id, user.departmentId]);

  function updateDraft(userId, patch) {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), ...patch },
    }));
  }

  async function handleClaim(pendingUser) {
    const draft = drafts[pendingUser.id] || {};
    if (!draft.departmentId) {
      showToast('يرجى تحديد القسم أولاً', 'error');
      return;
    }
    if (!draft.roleId) {
      showToast('يرجى اختيار الدور الوظيفي داخل القسم', 'error');
      return;
    }

    setClaimingId(pendingUser.id);
    try {
      const res = await apiFetch(`/api/onboarding/${pendingUser.id}/claim`, {
        method: 'POST',
        body: {
          departmentId: Number(draft.departmentId),
          roleId: Number(draft.roleId),
          jobTitle: draft.jobTitle || pendingUser.job_title || '',
        },
      });
      showToast(res.message || 'تم ضم الموظف للقسم بنجاح', 'success');
      await loadData();
      onRefreshMe();
    } catch (err) {
      showToast(err.message || 'تعذر ضم الموظف', 'error');
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="page-container">
      {/* Header Banner */}
      <div className="isolation-banner" style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#059669',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <UserPlus size={25} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#0b2545' }}>
              {data.canManageAll
                ? 'بوابة ضم وتسكين الموظفين الجدد عبر كل أقسام الشركة'
                : `ضم الموظفين الجدد إلى (${user.departmentName})`}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>
              كل موظف يؤكد بريده الإلكتروني وينشئ بيانات دخوله يظهر هنا باسمه الحقيقي ليقوم رئيس القسم بإضافته إلى قسمه وتحديد صلاحيته بضغطة واحدة.
            </div>
          </div>
        </div>

        <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
          <RefreshCw size={14} />
          تحديث القائمة
        </button>
      </div>

      {/* Pending Signups Section */}
      <div className="card-box" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 900, color: '#071e14', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="#d97706" />
            موظفون مؤكد بريدهم الإلكتروني بانتظار الضم للأقسام ({data.pendingUsers.length})
          </h3>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
            جاري تحميل طلبات الانضمام...
          </div>
        ) : data.pendingUsers.length === 0 ? (
          <div
            style={{
              padding: 34,
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: 12,
              border: '1px dashed #cbd5e1',
              color: '#64748b',
            }}
          >
            <CheckCircle2 size={28} color="#10b981" style={{ marginBottom: 8 }} />
            <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
              لا يوجد موظفون في قائمة الانتظار حالياً
            </div>
            <div style={{ fontSize: 13 }}>
              بمجرد تسجيل أي موظف جديد وتأكيد بريده الإلكتروني من شاشة الدخول، سيظهر اسمه هنا فوراً لتضمه إلى قسمك.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.pendingUsers.map((pu) => {
              const draft = drafts[pu.id] || {};
              const isMatchingMyDept =
                user.departmentId &&
                Number(pu.preferred_department_id) === Number(user.departmentId);

              const providerBadgeBg =
                pu.auth_provider === 'google' ? '#ea4335' : '#15803d';
              const providerLabel =
                pu.auth_provider === 'google' ? 'Google' : 'بريد مؤكد ✓';

              return (
                <div
                  key={pu.id}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    border: isMatchingMyDept
                      ? '2px solid #10b981'
                      : '1px solid #e2e8f0',
                    background: isMatchingMyDept ? '#f0fdf4' : '#ffffff',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 16,
                    alignItems: 'center',
                  }}
                >
                  {/* Employee Identity */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div
                      className="avatar-circle"
                      style={{
                        width: 44,
                        height: 44,
                        fontSize: 14,
                        background: pu.avatar_color || providerBadgeBg,
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(pu.full_name)}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 900, fontSize: 15, color: '#0f172a' }}>
                          {pu.full_name}
                        </span>
                        <span
                          className="badge"
                          style={{ background: providerBadgeBg, color: '#fff', fontSize: 10.5 }}
                        >
                          {providerLabel}
                        </span>
                        {isMatchingMyDept && (
                          <span
                            className="badge"
                            style={{ background: '#dcfce7', color: '#166534', fontSize: 11 }}
                          >
                            <Sparkles size={11} />
                            يطلب الانضمام لقسمك
                          </span>
                        )}
                      </div>

                      <div
                        dir="ltr"
                        style={{
                          textAlign: 'right',
                          fontSize: 12,
                          color: '#475569',
                          fontFamily: 'monospace',
                          marginTop: 2,
                        }}
                      >
                        @{pu.username} {pu.email ? `• ${pu.email}` : ''}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 12 }}>
                        {pu.preferred_department_name ? (
                          <span
                            className="badge"
                            style={{
                              background: `${pu.preferred_department_color || '#0a6fa8'}18`,
                              color: pu.preferred_department_color || '#0a6fa8',
                            }}
                          >
                            <Building2 size={12} />
                            القسم المختار: {pu.preferred_department_name}
                          </span>
                        ) : (
                          <span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>
                            لم يحدد قسماً بعد
                          </span>
                        )}
                        <span style={{ color: '#94a3b8', fontSize: 11.5 }}>
                          سجّل: {formatSqliteDate(pu.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Assignment Controls */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 10,
                      alignItems: 'end',
                    }}
                  >
                    <div>
                      <label className="form-label" style={{ fontSize: 11.5 }}>
                        القسم الذي سينضم إليه
                      </label>
                      <select
                        className="form-select"
                        disabled={!data.canManageAll}
                        value={draft.departmentId || ''}
                        onChange={(e) =>
                          updateDraft(pu.id, { departmentId: Number(e.target.value) })
                        }
                      >
                        {data.assignableDepartments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: 11.5 }}>
                        الدور والصلاحية بالقسم
                      </label>
                      <select
                        className="form-select"
                        value={draft.roleId || ''}
                        onChange={(e) =>
                          updateDraft(pu.id, { roleId: Number(e.target.value) })
                        }
                      >
                        {data.assignableRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: 11.5 }}>
                        المسمى الوظيفي
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="مثال: أخصائي تصدير"
                        value={draft.jobTitle ?? ''}
                        onChange={(e) =>
                          updateDraft(pu.id, { jobTitle: e.target.value })
                        }
                      />
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ background: '#059669', borderColor: '#059669', height: 39 }}
                      disabled={claimingId === pu.id}
                      onClick={() => handleClaim(pu)}
                    >
                      <UserPlus size={15} />
                      {claimingId === pu.id
                        ? 'جاري الضم...'
                        : data.canManageAll
                        ? 'ضمه للقسم الآن'
                        : 'ضمه إلى قسمي الآن'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current Department Team Roster */}
      <div className="card-box">
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} color="#0a6fa8" />
          {data.canManageAll
            ? `أعضاء الأقسام المعتمدون حالياً (${data.teamMembers.length})`
            : `فريق العمل الحالي في (${user.departmentName}) (${data.teamMembers.length})`}
        </h3>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>اسم الموظف</th>
                <th>وسيلة الدخول</th>
                <th>المسمى الوظيفي</th>
                <th>الدور الوظيفي</th>
                <th>القسم</th>
              </tr>
            </thead>
            <tbody>
              {data.teamMembers.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span
                        className="avatar-circle"
                        style={{ width: 30, height: 30, background: m.avatar_color }}
                      >
                        {getInitials(m.full_name)}
                      </span>
                      <div>
                        <div style={{ fontWeight: 800 }}>{m.full_name}</div>
                        {m.email && (
                          <div style={{ fontSize: 11, color: '#64748b' }} dir="ltr">
                            {m.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.auth_provider === 'google' ? (
                      <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                        Google
                      </span>
                    ) : m.auth_provider === 'email' ? (
                      <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                        بريد مؤكد ✓
                      </span>
                    ) : (
                      <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                        حساب الشركة
                      </span>
                    )}
                  </td>
                  <td>{m.job_title || '—'}</td>
                  <td>
                    <span className="badge" style={{ background: m.role_color, color: '#fff' }}>
                      {m.role_name}
                    </span>
                  </td>
                  <td>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#0f172a' }}>
                      {m.department_name || 'الإدارة العليا (عام)'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
