import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert, X, Send, Info } from 'lucide-react';
import { apiFetch } from '../api';

export default function PermissionRequestModal({
  user,
  initialContext,
  onClose,
  onSubmitted,
}) {
  const [catalog, setCatalog] = useState({ permissions: [], departments: [], durations: [] });
  const [permissionKey, setPermissionKey] = useState(
    initialContext?.missingPermission || initialContext?.permissionKey || 'cards.delete'
  );
  const [targetDepartmentId, setTargetDepartmentId] = useState(
    initialContext?.targetDepartmentId || user.departmentId || ''
  );
  const [requestedDuration, setRequestedDuration] = useState(
    initialContext?.missingPermission === 'boards.view_department' ||
      initialContext?.permissionKey === 'boards.view_department'
      ? '24h'
      : 'once'
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/requests/catalog', { suppressPermissionModal: true })
      .then((data) => {
        setCatalog(data);
        if (!targetDepartmentId && data.departments.length > 0) {
          setTargetDepartmentId(data.departments[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const isViewPerm = permissionKey === 'boards.view_department';
  useEffect(() => {
    if (isViewPerm && requestedDuration === 'once') {
      setRequestedDuration('8h');
    }
  }, [isViewPerm, requestedDuration]);

  const selectedPerm = catalog.permissions.find((p) => p.key === permissionKey);
  const isCrossDept =
    !user.departmentId || Number(targetDepartmentId) !== Number(user.departmentId);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        permissionKey,
        targetDepartmentId: Number(targetDepartmentId),
        targetBoardId: initialContext?.targetBoardId || null,
        targetCardId: initialContext?.targetCardId || null,
        requestedDuration,
        reason,
        actionSummary: initialContext?.actionLabel || '',
      };
      const res = await apiFetch('/api/requests', {
        method: 'POST',
        body: payload,
        suppressPermissionModal: true,
      });
      onSubmitted(res);
    } catch (err) {
      setError(err.message || 'تعذر إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#fef3c7',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <KeyRound size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                طلب صلاحية استثنائية من المدير
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                عند الحاجة لتنفيذ إجراء يتجاوز صلاحيات دورك الحالي ({user.roleName})
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {initialContext?.fromServerDeny && (
              <div
                style={{
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRight: '4px solid #e11d48',
                  borderRadius: 10,
                  padding: '11px 14px',
                  marginBottom: 16,
                  fontSize: 13,
                  color: '#9f1239',
                }}
              >
                <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldAlert size={16} />
                  تم إيقاف العملية أمنياً من السيرفر (HTTP 403)
                </div>
                <div style={{ marginTop: 3 }}>{initialContext.error}</div>
              </div>
            )}

            {(initialContext?.targetCardTitle || initialContext?.targetBoardTitle) && (
              <div
                style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 14,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 800, color: '#0369a1' }}>نطاق الطلب المحدد:</div>
                {initialContext.targetCardTitle && (
                  <div>• الكارت: <strong>{initialContext.targetCardTitle}</strong></div>
                )}
                {initialContext.targetBoardTitle && (
                  <div>• اللوحة: <strong>{initialContext.targetBoardTitle}</strong></div>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">القسم المستهدف</label>
              <select
                className="form-select"
                value={targetDepartmentId}
                disabled={Boolean(initialContext?.targetBoardId || initialContext?.targetCardId)}
                onChange={(e) => setTargetDepartmentId(Number(e.target.value))}
              >
                {catalog.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} {Number(d.id) === Number(user.departmentId) ? '(قسمك الحالي)' : '(قسم آخر — يتطلب اعتماد الإدارة العليا)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">الصلاحية المطلوبة</label>
              <select
                className="form-select"
                value={permissionKey}
                onChange={(e) => setPermissionKey(e.target.value)}
              >
                {catalog.permissions.map((p) => (
                  <option key={p.key} value={p.key}>
                    [{p.category_label}] {p.name}
                  </option>
                ))}
              </select>
              {selectedPerm && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {selectedPerm.description}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">مدة التصريح المطلوبة</label>
              <select
                className="form-select"
                value={requestedDuration}
                onChange={(e) => setRequestedDuration(e.target.value)}
              >
                {catalog.durations
                  .filter((d) => !(isViewPerm && d.value === 'once'))
                  .map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">سبب الطلب وتوضيح الحاجة للعمل</label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="اكتب للمدير سبب احتياجك لهذه الصلاحية بشكل واضح..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: 12,
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Info size={16} color="#0a6fa8" style={{ flexShrink: 0 }} />
              <span>
                جهة المراجعة:{' '}
                <strong>
                  {isCrossDept
                    ? 'المدير العام (لأن الطلب عابر للأقسام)'
                    : 'مدير القسم المختص أو المدير العام'}
                </strong>
                . بمجرد الموافقة سيتحقق السيرفر تلقائياً ويسمح لك بالتنفيذ طوال المدة المعتمدة.
              </span>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              إلغاء
            </button>
            <button type="submit" className="btn btn-gold" disabled={submitting}>
              <Send size={15} />
              {submitting ? 'جاري إرسال الطلب...' : 'إرسال الطلب للمدير'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
