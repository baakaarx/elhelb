import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldOff,
  Plus,
  Inbox,
  UserCheck,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../api';
import {
  DURATION_NAMES,
  formatRemainingTime,
  formatSqliteDate,
  getInitials,
} from '../constants';

const STATUS_BADGES = {
  pending: { label: 'قيد مراجعة المدير', bg: '#fef3c7', color: '#92400e' },
  approved: { label: 'تمت الموافقة ✅', bg: '#dcfce7', color: '#166534' },
  rejected: { label: 'مرفوض', bg: '#fee2e2', color: '#991b1b' },
  revoked: { label: 'تم سحب التصريح', bg: '#f1f5f9', color: '#475569' },
};

export function MyRequestsView({
  user,
  onOpenRequestModal,
  onOpenBoard,
  showToast,
}) {
  const [data, setData] = useState({ requests: [], activeGrants: [] });
  const [loading, setLoading] = useState(true);

  async function loadMine() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/requests/mine');
      setData(res);
    } catch (err) {
      showToast(err.message || 'تعذر تحميل الطلبات', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMine();
  }, [user.id, user.activeGrants?.length]);

  return (
    <div className="page-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 22,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#0b2545' }}>
            طلباتي وتصاريحي الاستثنائية
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#64748b' }}>
            تابع حالة طلبات الصلاحيات المرفوعة للمدير والتصاريح المؤقتة النشطة على حسابك
          </p>
        </div>

        <button
          type="button"
          className="btn btn-gold"
          onClick={() => onOpenRequestModal({})}
        >
          <Plus size={16} />
          تقديم طلب صلاحية جديد للمدير
        </button>
      </div>

      {/* Active Temporary / One-Time Grants */}
      <div className="card-box" style={{ marginBottom: 24 }}>
        <h3
          style={{
            margin: '0 0 14px',
            fontSize: 16,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#0b2545',
          }}
        >
          <KeyRound size={18} color="#d97706" />
          التصاريح الاستثنائية النشطة حالياً ({data.activeGrants.length})
        </h3>

        {data.activeGrants.length === 0 ? (
          <div style={{ fontSize: 13.5, color: '#64748b', padding: '12px 0' }}>
            لا توجد تصاريح استثنائية نشطة حالياً — تعمل الحسابات وفق الصلاحيات الأساسية لدور ({user.roleName}).
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
            {data.activeGrants.map((g) => (
              <div
                key={g.id}
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="badge" style={{ background: '#d97706', color: '#fff' }}>
                      {g.permission_name}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: '#92400e' }}>
                      {formatRemainingTime(g.expires_at, g.uses_remaining)}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 8 }}>
                    النطاق:{' '}
                    {g.card_title
                      ? `كارت "${g.card_title}"`
                      : g.board_title
                      ? `لوحة "${g.board_title}"`
                      : g.department_name || 'عام'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                    معتمد بواسطة: {g.granted_by_name || 'الإدارة'}
                  </div>
                </div>

                {g.target_board_id && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onOpenBoard(g.target_board_id, g.target_card_id || null)}
                  >
                    <ExternalLink size={13} />
                    الانتقال إلى اللوحة لتنفيذ الإجراء
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History of My Requests */}
      <div className="card-box">
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: '#0b2545' }}>
          سجل طلبات الصلاحيات المقدمة ({data.requests.length})
        </h3>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>جاري التحميل...</div>
        ) : data.requests.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13.5 }}>
            لم تقم بتقديم أي طلبات استثناء بعد.
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصلاحية والإجراء</th>
                  <th>القسم المستهدف</th>
                  <th>المدة المطلوبة</th>
                  <th>السبب الموضح</th>
                  <th>الحالة ورد المدير</th>
                  <th>التوقيت</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => {
                  const st = STATUS_BADGES[r.status] || STATUS_BADGES.pending;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 800 }}>{r.permission_name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{r.action_summary}</div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: '#f1f5f9', color: '#0f172a' }}>
                          {r.target_department_name || 'عام'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, fontSize: 12.5 }}>
                        {DURATION_NAMES[r.approved_duration || r.requested_duration] || r.requested_duration}
                      </td>
                      <td style={{ maxWidth: 260, fontSize: 12.5, color: '#334155' }}>{r.reason}</td>
                      <td>
                        <span className="badge" style={{ background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                        {r.reviewer_name && (
                          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                            بواسطة: {r.reviewer_name}
                            {r.review_note ? ` — "${r.review_note}"` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {formatSqliteDate(r.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ManagerInboxView({ user, onRefreshMe, showToast }) {
  const [data, setData] = useState({ requests: [], activeGrants: [] });
  const [filterStatus, setFilterStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [durationDrafts, setDurationDrafts] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [processingId, setProcessingId] = useState(null);

  async function loadInbox() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/requests/inbox');
      setData(res);
      const nextDurations = {};
      for (const r of res.requests) {
        nextDurations[r.id] = r.requested_duration;
      }
      setDurationDrafts(nextDurations);
    } catch (err) {
      showToast(err.message || 'تعذر تحميل صندوق الطلبات', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInbox();
  }, [user.id]);

  async function handleReview(reqId, decision) {
    setProcessingId(reqId);
    try {
      await apiFetch(`/api/requests/${reqId}/review`, {
        method: 'POST',
        body: {
          decision,
          approvedDuration: durationDrafts[reqId] || 'once',
          reviewNote: noteDrafts[reqId] || '',
        },
      });
      showToast(
        decision === 'approved'
          ? 'تم اعتماد طلب الصلاحية وتفعيله في قاعدة البيانات فوراً'
          : 'تم رفض طلب الصلاحية وإشعار الموظف',
        'success'
      );
      await loadInbox();
      onRefreshMe();
    } catch (err) {
      showToast(err.message || 'تعذر تنفيذ القرار', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRevokeGrant(grantId) {
    try {
      await apiFetch(`/api/grants/${grantId}/revoke`, { method: 'POST' });
      showToast('تم سحب التصريح المؤقت وإيقافه من السيرفر فوراً', 'success');
      await loadInbox();
      onRefreshMe();
    } catch (err) {
      showToast(err.message || 'تعذر سحب التصريح', 'error');
    }
  }

  const filtered =
    filterStatus === 'ALL'
      ? data.requests
      : data.requests.filter((r) => r.status === filterStatus);

  const pendingCount = data.requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="page-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 22,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Inbox size={23} color="#0a6fa8" />
            مركز اعتماد طلبات الصلاحيات والاستثناءات
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#64748b' }}>
            مراجعة طلبات الموظفين الراغبين في تنفيذ إجراء يتجاوز صلاحيات دورهم، مع تحديد مدة التصريح أو سحبه في أي لحظة
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`btn btn-sm ${filterStatus === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterStatus('pending')}
          >
            بانتظار القرار ({pendingCount})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterStatus === 'approved' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterStatus('approved')}
          >
            المعتمدة
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterStatus === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterStatus('rejected')}
          >
            المرفوضة
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterStatus === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterStatus('ALL')}
          >
            كل السجل
          </button>
        </div>
      </div>

      {/* Pending / Filtered Requests Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 32 }}>
        {loading ? (
          <div className="card-box" style={{ textAlign: 'center', padding: 36, color: '#64748b' }}>
            جاري تحميل طلبات الموظفين...
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-box" style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
            لا توجد طلبات في هذا التصنيف حالياً.
          </div>
        ) : (
          filtered.map((reqItem) => {
            const st = STATUS_BADGES[reqItem.status] || STATUS_BADGES.pending;
            const isViewPerm = reqItem.permission_key === 'boards.view_department';

            return (
              <div key={reqItem.id} className="card-box">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 260 }}>
                    <div
                      className="avatar-circle"
                      style={{
                        width: 44,
                        height: 44,
                        fontSize: 14,
                        background: reqItem.requester_avatar_color,
                      }}
                    >
                      {getInitials(reqItem.requester_name)}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 900, fontSize: 15.5 }}>
                          {reqItem.requester_name}
                        </span>
                        <span
                          className="badge"
                          style={{ background: reqItem.requester_role_color, color: '#fff' }}
                        >
                          {reqItem.requester_role_name}
                        </span>
                        <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                          {reqItem.requester_department_name || 'عام'}
                        </span>
                        <span className="badge" style={{ background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </div>

                      <div style={{ marginTop: 8, fontWeight: 800, fontSize: 14.5, color: '#0a6fa8' }}>
                        يطلب صلاحية: [{reqItem.permission_name}] — {reqItem.action_summary}
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '9px 12px',
                          fontSize: 13.5,
                          color: '#1e293b',
                        }}
                      >
                        <strong>سبب الموظف:</strong> {reqItem.reason}
                      </div>

                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                        تاريخ الطلب: {formatSqliteDate(reqItem.created_at)} • القسم المستهدف:{' '}
                        <strong>{reqItem.target_department_name}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Review Action Box if Pending */}
                  {reqItem.status === 'pending' && reqItem.canReview && (
                    <div
                      style={{
                        width: 320,
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: 12,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
                        تحديد مدة الصلاحية عند الموافقة:
                      </div>
                      <select
                        className="form-select"
                        style={{ marginBottom: 8, fontSize: 13 }}
                        value={durationDrafts[reqItem.id] || reqItem.requested_duration}
                        onChange={(e) =>
                          setDurationDrafts((p) => ({ ...p, [reqItem.id]: e.target.value }))
                        }
                      >
                        {Object.entries(DURATION_NAMES)
                          .filter(([k]) => !(isViewPerm && k === 'once'))
                          .map(([val, label]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
                      </select>

                      <input
                        type="text"
                        className="form-input"
                        style={{ marginBottom: 10, fontSize: 12.5 }}
                        placeholder="ملاحظة للموظف (اختياري)..."
                        value={noteDrafts[reqItem.id] || ''}
                        onChange={(e) =>
                          setNoteDrafts((p) => ({ ...p, [reqItem.id]: e.target.value }))
                        }
                      />

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          style={{ flex: 1, background: '#059669' }}
                          disabled={processingId === reqItem.id}
                          onClick={() => handleReview(reqItem.id, 'approved')}
                        >
                          <CheckCircle2 size={15} />
                          موافقة وتفعيل
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-soft btn-sm"
                          disabled={processingId === reqItem.id}
                          onClick={() => handleReview(reqItem.id, 'rejected')}
                        >
                          <XCircle size={15} />
                          رفض
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Active Temporary Grants Monitor & Instant Revoke */}
      <div className="card-box">
        <h3
          style={{
            margin: '0 0 14px',
            fontSize: 16,
            fontWeight: 800,
            color: '#0b2545',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <UserCheck size={18} color="#059669" />
          التصاريح الاستثنائية النشطة حالياً للموظفين ({data.activeGrants.length})
        </h3>

        {data.activeGrants.length === 0 ? (
          <div style={{ fontSize: 13.5, color: '#64748b' }}>
            لا توجد تصاريح مؤقتة نشطة حالياً تحت إشرافك.
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الصلاحية الممنوحة</th>
                  <th>النطاق</th>
                  <th>الصلاحية المتبقية</th>
                  <th>معتمدة بواسطة</th>
                  <th>إجراء أمني</th>
                </tr>
              </thead>
              <tbody>
                {data.activeGrants.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div style={{ fontWeight: 800 }}>{g.user_name}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>{g.user_role_name}</div>
                    </td>
                    <td style={{ fontWeight: 800, color: '#0a6fa8' }}>{g.permission_name}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {g.target_card_title
                        ? `كارت: ${g.target_card_title}`
                        : g.target_board_title
                        ? `لوحة: ${g.target_board_title}`
                        : `قسم: ${g.target_department_name || 'عام'}`}
                    </td>
                    <td>
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                        <Clock size={12} />
                        {formatRemainingTime(g.expires_at, g.uses_remaining)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{g.granted_by_name}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-sm"
                        onClick={() => handleRevokeGrant(g.id)}
                      >
                        <ShieldOff size={13} />
                        سحب الصلاحية فوراً
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
