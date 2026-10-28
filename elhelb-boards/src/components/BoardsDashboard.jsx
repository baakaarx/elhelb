import React, { useEffect, useState } from 'react';
import {
  Plus,
  Star,
  Lock,
  Building2,
  Clock,
  CheckCircle2,
  Layers,
  KeyRound,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import { BOARD_THEMES, formatRemainingTime } from '../constants';

export default function BoardsDashboard({
  user,
  onOpenBoard,
  onOpenRequestModal,
  showToast,
}) {
  const [boards, setBoards] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newBg, setNewBg] = useState('ocean');
  const [newDeptId, setNewDeptId] = useState(user.departmentId || '');
  const [creating, setCreating] = useState(false);

  const permSet = new Set(user.permissions || []);
  const hasViewAll = permSet.has('boards.view_all');
  const canCreateBoardInOwnDept =
    permSet.has('boards.create') ||
    (user.activeGrants || []).some((g) => g.permission_key === 'boards.create');

  async function loadWorkspace() {
    setLoading(true);
    try {
      const [boardsList, deptDir] = await Promise.all([
        apiFetch('/api/boards'),
        apiFetch('/api/departments/directory'),
      ]);
      setBoards(boardsList);
      setDepartments(deptDir);
      if (!newDeptId && deptDir.length > 0) {
        const myD = deptDir.find((d) => d.isMyDepartment) || deptDir[0];
        setNewDeptId(myD.id);
      }
    } catch (err) {
      showToast(err.message || 'تعذر تحميل اللوحات', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, [user.id, user.roleId, user.departmentId, user.permissions?.length, user.activeGrants?.length]);

  async function toggleStar(e, boardId) {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/boards/${boardId}/star`, { method: 'POST' });
      setBoards((prev) =>
        prev.map((b) => (b.id === boardId ? { ...b, is_starred: res.is_starred } : b))
      );
    } catch (_) {}
  }

  async function handleCreateBoard(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await apiFetch('/api/boards', {
        method: 'POST',
        body: {
          title: newTitle,
          description: newDesc,
          background: newBg,
          departmentId: Number(newDeptId),
        },
      });
      setCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      showToast('تم إنشاء لوحة العمل الجديدة بنجاح', 'success');
      onOpenBoard(created.id);
    } catch (err) {
      if (err.status === 403) {
        setCreateOpen(false);
      } else {
        showToast(err.message || 'تعذر إنشاء اللوحة', 'error');
      }
    } finally {
      setCreating(false);
    }
  }

  const visibleDepartmentsInBoards = Array.from(
    new Map(
      boards.map((b) => [
        b.department_id,
        { id: b.department_id, name: b.department_name, color: b.department_color },
      ])
    ).values()
  );

  const filteredBoards =
    selectedDeptFilter === 'ALL'
      ? boards
      : boards.filter((b) => Number(b.department_id) === Number(selectedDeptFilter));

  const starredBoards = filteredBoards.filter((b) => b.is_starred);
  const lockedDepartments = departments.filter((d) => !d.canViewBoards);

  return (
    <div className="page-container">
      {/* Department Isolation Banner */}
      <div className="isolation-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: '#0a6fa8',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: '#0b2545' }}>
              {hasViewAll
                ? 'عرض الإدارة العليا — جميع لوحات أقسام الشركة'
                : `مساحة عمل (${user.departmentName})`}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>
              {hasViewAll
                ? 'بصفتك تملك صلاحية (عرض جميع الأقسام) يمكنك متابعة كافة اللوحات عبر أقسام الشركة.'
                : 'يطبق السيرفر نظام عزل الأقسام: تظهر لك فقط اللوحات المرتبطة بقسمك أو اللوحات الممنوحة لك بتصريح مؤقت من المدير.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canCreateBoardInOwnDept ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={16} />
              إنشاء لوحة عمل جديدة
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-locked"
              onClick={() =>
                onOpenRequestModal({
                  permissionKey: 'boards.create',
                  targetDepartmentId: user.departmentId,
                  actionLabel: `إنشاء لوحة عمل جديدة في (${user.departmentName})`,
                })
              }
            >
              <Lock size={15} />
              إنشاء لوحة جديدة (طلب إذن المدير)
            </button>
          )}
        </div>
      </div>

      {/* Department Filter Pills when viewing multiple departments */}
      {visibleDepartmentsInBoards.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          <button
            type="button"
            className={`btn btn-sm ${selectedDeptFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedDeptFilter('ALL')}
          >
            كل الأقسام المتاحة ({boards.length})
          </button>
          {visibleDepartmentsInBoards.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`btn btn-sm ${
                Number(selectedDeptFilter) === Number(d.id) ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => setSelectedDeptFilter(d.id)}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: d.color,
                  display: 'inline-block',
                }}
              />
              {d.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card-box" style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>
          جاري تحميل لوحات العمل والتحقق من صلاحيات القسم...
        </div>
      ) : (
        <>
          {/* Starred Boards */}
          {starredBoards.length > 0 && (
            <section style={{ marginBottom: 30 }}>
              <h3
                style={{
                  margin: '0 0 12px',
                  fontSize: 16,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  color: '#0b2545',
                }}
              >
                <Star size={18} fill="#f59e0b" color="#f59e0b" />
                اللوحات المفضلة السريعة
              </h3>
              <div className="boards-grid">
                {starredBoards.map((board) => (
                  <BoardTile
                    key={`star-${board.id}`}
                    board={board}
                    onOpen={() => onOpenBoard(board.id)}
                    onToggleStar={(e) => toggleStar(e, board.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* All Authorized Boards */}
          <section style={{ marginBottom: 36 }}>
            <h3
              style={{
                margin: '0 0 12px',
                fontSize: 16,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                color: '#0b2545',
              }}
            >
              <Layers size={18} color="#0a6fa8" />
              لوحات العمل المتاحة لك ({filteredBoards.length})
            </h3>

            {filteredBoards.length === 0 ? (
              <div className="card-box" style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                لا توجد لوحات متاحة حالياً في هذا القسم.
              </div>
            ) : (
              <div className="boards-grid">
                {filteredBoards.map((board) => (
                  <BoardTile
                    key={board.id}
                    board={board}
                    onOpen={() => onOpenBoard(board.id)}
                    onToggleStar={(e) => toggleStar(e, board.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Locked Other Company Departments — Request Temporary Access */}
          {lockedDepartments.length > 0 && (
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 15.5,
                    fontWeight: 800,
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Building2 size={18} color="#64748b" />
                  أقسام الشركة الأخرى (محمية ومعزولة أمنياً عن قسمك)
                </h3>
              </div>

              <div className="locked-dept-grid">
                {lockedDepartments.map((dept) => (
                  <div key={dept.id} className="locked-dept-card">
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 6,
                        }}
                      >
                        <span
                          className="badge"
                          style={{ background: `${dept.color}18`, color: dept.color }}
                        >
                          <Lock size={12} />
                          {dept.name}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                          عزل السيرفر مفعل
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
                        {dept.description || 'لوحات ومهام هذا القسم مخصصة لموظفيه فقط.'}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-locked btn-sm"
                      onClick={() =>
                        onOpenRequestModal({
                          permissionKey: 'boards.view_department',
                          targetDepartmentId: dept.id,
                          actionLabel: `طلب إذن اطلاع مؤقت على لوحات (${dept.name})`,
                        })
                      }
                    >
                      <KeyRound size={14} />
                      طلب إذن اطلاع مؤقت من المدير
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Create Board Modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>إنشاء لوحة عمل جديدة</div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCreateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateBoard}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">عنوان اللوحة</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="مثال: متابعة عقود التوريد الربع الأول"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">القسم التابع له اللوحة</label>
                  <select
                    className="form-select"
                    value={newDeptId}
                    disabled={!hasViewAll && Boolean(user.departmentId)}
                    onChange={(e) => setNewDeptId(Number(e.target.value))}
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">وصف مختصر (اختياري)</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="هدف اللوحة وطبيعة المهام التي ستتابعها..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">مظهر وخلفية اللوحة</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {Object.values(BOARD_THEMES).map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setNewBg(th.id)}
                        style={{
                          height: 44,
                          borderRadius: 8,
                          background: th.gradient,
                          border: newBg === th.id ? '3px solid #f59e0b' : '2px solid transparent',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {th.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
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
                  <Plus size={16} />
                  {creating ? 'جاري الإنشاء...' : 'إنشاء اللوحة الآن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function BoardTile({ board, onOpen, onToggleStar }) {
  const theme = BOARD_THEMES[board.background] || BOARD_THEMES.ocean;
  const pct =
    board.cards_count > 0
      ? Math.round((board.completed_cards_count / board.cards_count) * 100)
      : 0;

  return (
    <div className="board-tile" onClick={onOpen}>
      <div className="board-tile-cover" style={{ background: theme.gradient }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span
            style={{
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(4px)',
              padding: '2px 9px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {board.department_name}
          </span>

          <button
            type="button"
            onClick={onToggleStar}
            style={{
              background: 'rgba(0,0,0,0.22)',
              border: 'none',
              borderRadius: 99,
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: board.is_starred ? '#fbbf24' : '#fff',
            }}
            title="إضافة / إزالة من المفضلة"
          >
            <Star size={15} fill={board.is_starred ? '#fbbf24' : 'none'} />
          </button>
        </div>

        <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.35, textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
          {board.title}
        </div>
      </div>

      <div className="board-tile-body">
        <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6, minHeight: 38 }}>
          {board.description || 'لوحة متابعة مهام ومراحل العمل الخاصة بالقسم.'}
        </div>

        <div>
          {board.accessViaGrant && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                borderRadius: 7,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Clock size={12} />
              متاحة لك بتصريح مؤقت ({formatRemainingTime(board.accessViaGrant.expiresAt)})
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: '#475569',
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            <span>{board.lists_count} قوائم • {board.cards_count} مهام</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#059669' }}>
              <CheckCircle2 size={13} />
              {pct}% منجز
            </span>
          </div>

          <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: pct === 100 ? '#10b981' : '#0a6fa8',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
