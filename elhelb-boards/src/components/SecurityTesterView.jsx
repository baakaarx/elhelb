import React, { useState } from 'react';
import { ShieldAlert, Play, CheckCircle2, XCircle, KeyRound, Terminal } from 'lucide-react';
import { rawServerProbe } from '../api';

const SCENARIOS = [
  {
    id: 'cross-dept-board',
    title: 'اختبار اختراق قسم آخر (قراءة لوحة قسم الميديا مباشرة عبر الـ API)',
    description:
      'يرسل طلب GET مباشر للسيرفر لقراءة لوحة رقم #3 (قسم الميديا والتسويق) متجاوزاً واجهة المستخدم.',
    method: 'GET',
    path: '/api/boards/3',
  },
  {
    id: 'cross-dept-proc',
    title: 'اختبار الوصول المباشر للوحة قسم المشتريات والتوريدات (#4)',
    description:
      'يرسل طلب GET مباشر لقراءة بيانات لوحة المشتريات (#4) للتحقق من عزل الأقسام على السيرفر.',
    method: 'GET',
    path: '/api/boards/4',
  },
  {
    id: 'idor-card-edit',
    title: 'هجوم IDOR: محاولة تعديل كارت مهمة في قسم آخر مباشرة برقم الكارت',
    description:
      'يرسل طلب PATCH مباشر لتعديل عنوان كارت رقم #6 (التابع لقسم الميديا) دون المرور باللوحة.',
    method: 'PATCH',
    path: '/api/cards/6',
    body: { title: 'محاولة تعديل غير مصرح بها عبر الـ API' },
  },
  {
    id: 'unauth-delete-card',
    title: 'محاولة حذف كارت مهمة بدون صلاحية (DELETE /api/cards/3)',
    description:
      'يرسل طلب DELETE مباشر لحذف الكارت رقم #3 لاختبار تحقق السيرفر من صلاحية (cards.delete).',
    method: 'DELETE',
    path: '/api/cards/3',
  },
  {
    id: 'unauth-admin-roles',
    title: 'محاولة فتح وقراءة مصفوفة الصلاحيات الإدارية بدون صلاحية الإدارة',
    description:
      'يرسل طلب GET مباشر إلى (/api/admin/roles) للتحقق من حماية مسارات الإدارة على السيرفر.',
    method: 'GET',
    path: '/api/admin/roles',
  },
];

export default function SecurityTesterView({ user, onOpenRequestModal }) {
  const [result, setResult] = useState(null);
  const [runningId, setRunningId] = useState(null);

  async function runScenario(sc) {
    setRunningId(sc.id);
    try {
      const res = await rawServerProbe(sc.method, sc.path, sc.body);
      setResult({ ...res, scenarioTitle: sc.title });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="page-container">
      <div className="isolation-banner" style={{ borderRightColor: '#d97706' }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={22} color="#d97706" />
            مختبر فحص حماية السيرفر العملي (Live Backend RBAC Verifier)
          </div>
          <div style={{ fontSize: 13.5, color: '#475569', marginTop: 4 }}>
            أنت تختبر الآن بحساب: <strong>{user.fullName}</strong> — الدور:{' '}
            <strong>{user.roleName}</strong> — القسم: <strong>{user.departmentName}</strong>.
            اضغط على أي اختبار بالأسفل لإرسال طلب HTTP حقيقي مباشرة إلى السيرفر (تخطياً للواجهة) ومشاهدة رد السيرفر الفعلي وتسجيله في سجل المراقبة الأمنية!
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SCENARIOS.map((sc) => (
            <div key={sc.id} className="card-box" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span
                  className="badge"
                  style={{
                    background: '#0f172a',
                    color: '#38bdf8',
                    fontFamily: 'monospace',
                    direction: 'ltr',
                  }}
                >
                  {sc.method} {sc.path}
                </span>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={runningId === sc.id}
                  onClick={() => runScenario(sc)}
                >
                  <Play size={13} />
                  {runningId === sc.id ? 'جاري الإرسال...' : 'إرسال طلب مباشر للسيرفر'}
                </button>
              </div>

              <div style={{ fontWeight: 800, fontSize: 14.5, marginTop: 10, color: '#0b2545' }}>
                {sc.title}
              </div>
              <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4, lineHeight: 1.6 }}>
                {sc.description}
              </div>
            </div>
          ))}
        </div>

        {/* Live Server Raw Response Inspector */}
        <div
          className="card-box"
          style={{
            background: '#0b192c',
            color: '#e2e8f0',
            borderColor: '#1e3a5f',
            position: 'sticky',
            top: 84,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingBottom: 12,
              marginBottom: 14,
              borderBottom: '1px solid rgba(255,255,255,0.12)',
              fontWeight: 800,
              fontSize: 15,
            }}
          >
            <Terminal size={18} color="#38bdf8" />
            رد السيرفر الحقيقي (Express + SQLite RBAC Response)
          </div>

          {!result ? (
            <div style={{ padding: '36px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
              اضغط على أي سيناريو على اليمين لإرسال طلب HTTP حقيقي ومشاهدة كيف يتحقق السيرفر من قاعدة البيانات لحظياً.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: '#93c5fd', fontWeight: 700, marginBottom: 10 }}>
                {result.scenarioTitle}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background:
                    result.status === 403
                      ? 'rgba(239, 68, 68, 0.18)'
                      : result.ok
                      ? 'rgba(16, 185, 129, 0.18)'
                      : 'rgba(245, 158, 11, 0.18)',
                  border: `1px solid ${
                    result.status === 403 ? '#ef4444' : result.ok ? '#10b981' : '#f59e0b'
                  }`,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                  {result.status === 403 ? (
                    <>
                      <XCircle size={18} color="#f87171" />
                      <span style={{ color: '#fca5a5' }}>
                        HTTP {result.status} — مرفوض أمنياً من السيرفر (Blocked!)
                      </span>
                    </>
                  ) : result.ok ? (
                    <>
                      <CheckCircle2 size={18} color="#34d399" />
                      <span style={{ color: '#6ee7b7' }}>
                        HTTP {result.status} — مصرح به لحسابك الحالي
                      </span>
                    </>
                  ) : (
                    <span>HTTP {result.status}</span>
                  )}
                </div>

                <span style={{ fontSize: 11.5, color: '#cbd5e1' }}>{result.elapsedMs}ms</span>
              </div>

              <pre
                dir="ltr"
                style={{
                  background: '#06101d',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 12,
                  lineHeight: 1.6,
                  overflowX: 'auto',
                  maxHeight: 320,
                  color: '#bae6fd',
                  margin: 0,
                }}
              >
                {JSON.stringify(result.response, null, 2)}
              </pre>

              {result.status === 403 && result.response?.canRequestElevation && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn btn-gold"
                    style={{ width: '100%' }}
                    onClick={() =>
                      onOpenRequestModal({
                        ...result.response,
                        fromServerDeny: true,
                      })
                    }
                  >
                    <KeyRound size={15} />
                    اطلب إذن هذه الصلاحية من المدير الآن
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
