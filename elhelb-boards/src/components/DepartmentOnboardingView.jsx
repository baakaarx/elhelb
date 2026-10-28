import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Users,
  Building2,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Trash2,
  Plus,
  X,
  AlertTriangle,
  Crown,
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

  // Direct HR Employee Creation Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uForm, setUForm] = useState({
    fullName: '',
    username: '',
    password: '',
    email: '',
    jobTitle: '',
    departmentId: '',
    roleId: '',
  });

  // Delete / Reject Confirmation Modal
  const [confirmDelete, setConfirmDelete] = useState(null); // { mode: 'pending' | 'member', target }
  const [deleting, setDeleting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/onboarding/pending');
      setData(res);

      const staffRole =
        res.assignableRoles.find((r) => r.slug === 'staff') || res.assignableRoles[0];
      const hrRole = res.assignableRoles.find((r) => r.slug === 'hr_manager');

      if (!uForm.roleId && staffRole) {
        setUForm((p) => ({
          ...p,
          roleId: staffRole.id,
          departmentId: res.assignableDepartments[0]?.id || '',
        }));
      }

      const nextDrafts = {};
      for (const pu of res.pendingUsers) {
        const defaultDept = res.canManageAll
          ? pu.preferred_department_id || res.assignableDepartments[0]?.id || ''
          : user.departmentId || res.assignableDepartments[0]?.id || '';

        const preferredRole =
          pu.preferred_department_slug === 'hr' && hrRole
            ? hrRole
            : staffRole;

        nextDrafts[pu.id] = {
          departmentId: defaultDept,
          roleId: preferredRole ? preferredRole.id : '',
          jobTitle: pu.job_title || '',
        };
      }
      setDrafts((prev) => {
        const merged = { ...nextDrafts };
        for (const k of Object.keys(merged)) {
          if (prev[k]) merged[k] = prev[k];
        }
        return merged;
      });
    } catch (err) {
      showToast(err.message || 'تعذر تحميل قائمة الموظفين', 'error');
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
      showToast('يرجى اختيار الدور الوظيفي للموظف', 'error');
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
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[pendingUser.id];
        return copy;
      });
      showToast(res.message || 'تم قبول وتسكين الموظف بالقسم بنجاح', 'success');
      await loadData();
      onRefreshMe();
    } catch (err) {
      showToast(err.message || 'تعذر تسكين الموظف', 'error');
    } finally {
      setClaimingId(null);
    }
  }

  async function handleDirectCreateEmployee(e) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: {
          fullName: uForm.fullName.trim(),
          username: uForm.username.trim().toLowerCase(),
          password: uForm.password,
          email: uForm.email.trim(),
          jobTitle: uForm.jobTitle.trim(),
          roleId: Number(uForm.roleId),
          departmentId: uForm.departmentId ? Number(uForm.departmentId) : null,
        },
      });
      setCreateOpen(false);
      setUForm((p) => ({
        ...p,
        fullName: '',
        username: '',
        password: '',
        email: '',
        jobTitle: '',
      }));
      await loadData();
      onRefreshMe();
      showToast('تم تسجيل وتسكين الموظف الجديد بنجاح ويمكنه الدخول فوراً', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر تسجيل الموظف الجديد', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmDeleteAction() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { mode, target } = confirmDelete;
      const endpoint =
        mode === 'pending'
          ? `/api/onboarding/${target.id}`
          : `/api/admin/users/${target.id}`;
      const res = await apiFetch(endpoint, { method: 'DELETE' });
      setConfirmDelete(null);
      await loadData();
      onRefreshMe();
      showToast(
        res.message ||
          (mode === 'pending'
            ? 'تم رفض وحذف طلب التسجيل نهائياً'
            : 'تم حذف حساب الموظف نهائياً من النظام'),
        'success'
      );
    } catch (err) {
      showToast(err.message || 'تعذر إتمام عملية الحذف', 'error');
    } finally {
      setDeleting(false);
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
                ? 'بوابة الموارد البشرية (HR) والإدارة — قبول وتسكين وتسجيل الموظفين'
                : `تسكين الموظفين الجدد في (${user.departmentName})`}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>
              {data.canManageAll
                ? 'اعتماد وتسكين المسجلين الجدد في كافة أقسام الشركة، أو تسجيل حساب موظف جديد مباشرةً، أو الحذف النهائي لمن يترك العمل.'
                : 'مراجعة واعتماد طلبات الانضمام الموجهة إلى قسمك.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {data.canManageAll && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ background: '#059669', borderColor: '#059669' }}
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} />
              تسجيل موظف جديد مباشرةً (HR)
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
            <RefreshCw size={14} />
            تحديث القائمة
          </button>
        </div>
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
            طلبات تسجيل موظفين جدد بانتظار القبول والتسكين ({data.pendingUsers.length})
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
              أي موظف يسجل حساباً جديداً يظهر هنا فوراً لاعتماده وتسكينه، أو يمكنك الضغط على «تسجيل موظف جديد مباشرةً (HR)» بالأعلى.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.pendingUsers.map((pu) => {
              const draft = drafts[pu.id] || {};
              const isHrSignup = pu.preferred_department_slug === 'hr';

              const providerBadgeBg =
                pu.auth_provider === 'google' ? '#ea4335' : '#15803d';
              const providerLabel =
                pu.auth_provider === 'google' ? 'Google' : 'تسجيل جديد';

              return (
                <div
                  key={pu.id}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    border: isHrSignup ? '2px solid #d97706' : '1px solid #e2e8f0',
                    background: isHrSignup ? '#fffbeb' : '#ffffff',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
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
                        {isHrSignup && (
                          <span
                            className="badge"
                            style={{ background: '#fef3c7', color: '#92400e', fontSize: 11 }}
                          >
                            <Sparkles size={11} />
                            طلب انضمام للموارد البشرية (HR)
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
                      gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                      gap: 10,
                      alignItems: 'end',
                    }}
                  >
                    <div>
                      <label className="form-label" style={{ fontSize: 11.5 }}>
                        القسم المعتمد
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
                        الدور الوظيفي والصلاحية
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

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{
                          flex: 1,
                          background: '#059669',
                          borderColor: '#059669',
                          height: 39,
                        }}
                        disabled={claimingId === pu.id}
                        onClick={() => handleClaim(pu)}
                      >
                        <UserPlus size={15} />
                        {claimingId === pu.id ? 'جاري التسكين...' : 'قبول وتسكين'}
                      </button>

                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        style={{ height: 39, padding: '0 10px' }}
                        title="رفض وحذف طلب التسجيل نهائياً"
                        onClick={() =>
                          setConfirmDelete({ mode: 'pending', target: pu })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current Company / Department Team Roster */}
      <div className="card-box">
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} color="#0a6fa8" />
          {data.canManageAll
            ? `سجل موظفي الشركة المعتمدين حالياً (${data.teamMembers.length})`
            : `فريق العمل الحالي في (${user.departmentName}) (${data.teamMembers.length})`}
        </h3>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>اسم الموظف</th>
                <th>اسم المستخدم</th>
                <th>المسمى الوظيفي</th>
                <th>الدور الوظيفي</th>
                <th>القسم</th>
                {data.canManageAll && <th>حذف عند ترك العمل</th>}
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
                        <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {m.role_slug === 'chairman' && <Crown size={13} color="#d97706" />}
                          {m.full_name}
                        </div>
                        {m.email && (
                          <div style={{ fontSize: 11, color: '#64748b' }} dir="ltr">
                            {m.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                    @{m.username}
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
                  {data.canManageAll && (
                    <td>
                      {m.can_caller_delete ? (
                        <button
                          type="button"
                          className="btn btn-danger-soft btn-sm"
                          onClick={() =>
                            setConfirmDelete({ mode: 'member', target: m })
                          }
                        >
                          <Trash2 size={13} />
                          حذف نهائي
                        </button>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Direct HR Employee Registration Modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                تسجيل وتسكين موظف جديد مباشرةً (HR)
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCreateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleDirectCreateEmployee}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">الاسم الكامل للموظف *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="مثال: أ. سارة محمود"
                    value={uForm.fullName}
                    onChange={(e) => setUForm({ ...uForm, fullName: e.target.value })}
                    required
                  />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">اسم المستخدم للدخول (إنجليزي) *</label>
                    <input
                      type="text"
                      className="form-input"
                      dir="ltr"
                      style={{ textAlign: 'left', fontWeight: 700 }}
                      placeholder="sara.hr"
                      value={uForm.username}
                      onChange={(e) =>
                        setUForm({
                          ...uForm,
                          username: e.target.value.replace(/\s+/g, '').toLowerCase(),
                        })
                      }
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">كلمة المرور *</label>
                    <input
                      type="password"
                      className="form-input"
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                      placeholder="4+ أحرف أو أرقام"
                      value={uForm.password}
                      onChange={(e) => setUForm({ ...uForm, password: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">القسم التابع له *</label>
                    <select
                      className="form-select"
                      value={uForm.departmentId}
                      onChange={(e) => setUForm({ ...uForm, departmentId: e.target.value })}
                      required
                    >
                      {data.assignableDepartments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">الدور الوظيفي والصلاحية *</label>
                    <select
                      className="form-select"
                      value={uForm.roleId}
                      onChange={(e) => setUForm({ ...uForm, roleId: e.target.value })}
                      required
                    >
                      {data.assignableRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">المسمى الوظيفي</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="مثال: أخصائي موارد بشرية / محاسب"
                    value={uForm.jobTitle}
                    onChange={(e) => setUForm({ ...uForm, jobTitle: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">البريد الإلكتروني (اختياري)</label>
                  <input
                    type="email"
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder="name@gmail.com"
                    value={uForm.email}
                    onChange={(e) => setUForm({ ...uForm, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreateOpen(false)}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  <UserPlus size={15} />
                  {creating ? 'جاري التسجيل...' : 'إنشاء الحساب وتسكينه فوراً'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permanent Delete / Reject Confirmation Modal */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="modal-panel" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 900, fontSize: 16, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} color="#dc2626" />
                {confirmDelete.mode === 'pending'
                  ? 'رفض وحذف طلب تسجيل موظف'
                  : 'تأكيد الحذف النهائي لحساب الموظف'}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: '0 0 10px', fontSize: 14, color: '#0f172a', lineHeight: 1.7 }}>
                هل أنت متأكد من حذف حساب{' '}
                <strong>{confirmDelete.target.full_name}</strong> (
                <span dir="ltr" style={{ fontFamily: 'monospace' }}>
                  @{confirmDelete.target.username}
                </span>
                ) نهائياً من النظام؟
              </p>
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 12.5,
                  color: '#991b1b',
                  lineHeight: 1.65,
                }}
              >
                • سيتم مسح حساب الموظف وإلغاء دخوله فوراً من النظام.
                <br />• جميع لوحات العمل والكروت والمهام الخاصة بالقسم ستظل محفوظة وآمنة بالكامل دون مسح أي مهام.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={handleConfirmDeleteAction}
                disabled={deleting}
              >
                <Trash2 size={15} />
                {deleting ? 'جاري الحذف...' : 'نعم، حذف نهائي من النظام'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
