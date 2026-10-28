import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Star,
  Plus,
  Settings,
  Trash2,
  Lock,
  Search,
  CheckSquare,
  MessageSquare,
  Calendar,
  KeyRound,
  Clock,
  CheckCircle2,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import {
  BOARD_THEMES,
  PRIORITY_CONFIG,
  formatRemainingTime,
  getDueDateStatus,
  getInitials,
} from '../constants';
import CardDetailModal from './CardDetailModal';

export default function KanbanBoardView({
  boardId,
  initialCardId = null,
  currentUser,
  onBack,
  onOpenRequestModal,
  onRefreshMe,
  showToast,
}) {
  const [boardData, setBoardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCardId, setActiveCardId] = useState(initialCardId);

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [filterMember, setFilterMember] = useState('ALL');

  // Add card / list composers
  const [addingCardListId, setAddingCardListId] = useState(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardPriority, setNewCardPriority] = useState('medium');

  const [addingList, setAddingList] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');

  // Inline list rename
  const [editingListId, setEditingListId] = useState(null);
  const [editingListTitle, setEditingListTitle] = useState('');

  // Drag & Drop state
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dragOverListId, setDragOverListId] = useState(null);

  // Board Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBg, setEditBg] = useState('ocean');
  const [confirmBoardDelete, setConfirmBoardDelete] = useState(false);

  async function loadBoard(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch(`/api/boards/${boardId}`);
      setBoardData(data);
      setEditTitle(data.board.title);
      setEditDesc(data.board.description || '');
      setEditBg(data.board.background || 'ocean');
    } catch (err) {
      showToast(err.message || 'لا يمكن فتح هذه اللوحة', 'error');
      onBack();
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadBoard();
  }, [boardId, currentUser.id, currentUser.roleId, currentUser.permissions?.length, currentUser.activeGrants?.length]);

  useEffect(() => {
    if (initialCardId) setActiveCardId(initialCardId);
  }, [initialCardId]);

  if (loading || !boardData) {
    return (
      <div className="page-container">
        <div className="card-box" style={{ textAlign: 'center', padding: 54, color: '#64748b' }}>
          جاري التحقق من صلاحيات اللوحة وتحميل القوائم والمهام...
        </div>
      </div>
    );
  }

  const { board, capabilities, lists, cards, labels, departmentMembers } = boardData;
  const theme = BOARD_THEMES[board.background] || BOARD_THEMES.ocean;

  function requestBoardPerm(permissionKey, actionLabel) {
    onOpenRequestModal({
      permissionKey,
      targetDepartmentId: board.department_id,
      targetBoardId: board.id,
      targetBoardTitle: board.title,
      actionLabel,
    });
  }

  async function handleToggleStar() {
    try {
      const res = await apiFetch(`/api/boards/${board.id}/star`, { method: 'POST' });
      setBoardData((prev) => ({
        ...prev,
        board: { ...prev.board, is_starred: res.is_starred },
      }));
    } catch (_) {}
  }

  async function handleCreateCard(e, listId) {
    e.preventDefault();
    if (!newCardTitle.trim()) return;
    try {
      await apiFetch(`/api/lists/${listId}/cards`, {
        method: 'POST',
        body: {
          title: newCardTitle.trim(),
          priority: newCardPriority,
        },
      });
      setNewCardTitle('');
      setNewCardPriority('medium');
      setAddingCardListId(null);
      await loadBoard(true);
      onRefreshMe();
      showToast('تمت إضافة المهمة بنجاح', 'success');
    } catch (err) {
      if (err.status !== 403) showToast(err.message || 'تعذر إنشاء الكارت', 'error');
    }
  }

  async function handleCreateList(e) {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    try {
      await apiFetch(`/api/boards/${board.id}/lists`, {
        method: 'POST',
        body: { title: newListTitle.trim() },
      });
      setNewListTitle('');
      setAddingList(false);
      await loadBoard(true);
      onRefreshMe();
      showToast('تمت إضافة القائمة الجديدة', 'success');
    } catch (err) {
      if (err.status !== 403) showToast(err.message || 'تعذر إضافة القائمة', 'error');
    }
  }

  async function handleRenameList(listId) {
    if (!editingListTitle.trim()) {
      setEditingListId(null);
      return;
    }
    try {
      await apiFetch(`/api/lists/${listId}`, {
        method: 'PATCH',
        body: { title: editingListTitle.trim() },
      });
      setEditingListId(null);
      await loadBoard(true);
    } catch (err) {
      setEditingListId(null);
      if (err.status !== 403) showToast(err.message, 'error');
    }
  }

  async function handleDeleteList(list) {
    if (!capabilities.canDeleteList) {
      return requestBoardPerm('lists.delete', `حذف قائمة "${list.title}" من لوحة "${board.title}"`);
    }
    if (!window.confirm(`هل أنت متأكد من حذف قائمة "${list.title}" وكافة المهام بداخلها؟`)) {
      return;
    }
    try {
      await apiFetch(`/api/lists/${list.id}`, { method: 'DELETE' });
      await loadBoard(true);
      onRefreshMe();
      showToast('تم حذف القائمة', 'success');
    } catch (err) {
      if (err.status !== 403) showToast(err.message, 'error');
    }
  }

  async function handleDropOnList(targetListId, targetIndex) {
    const movingId = draggingCardId;
    setDraggingCardId(null);
    setDragOverListId(null);
    if (!movingId) return;

    const movingCard = cards.find((c) => c.id === movingId);
    if (!movingCard) return;

    const canMoveThisCard =
      capabilities.canMoveCard ||
      (movingCard.grantedCardPermissions || []).includes('cards.move');

    if (!canMoveThisCard) {
      onOpenRequestModal({
        permissionKey: 'cards.move',
        targetDepartmentId: board.department_id,
        targetBoardId: board.id,
        targetBoardTitle: board.title,
        targetCardId: movingCard.id,
        targetCardTitle: movingCard.title,
        actionLabel: `نقل كارت "${movingCard.title}" بين قوائم اللوحة`,
      });
      return;
    }

    // Optimistic UI update
    const prevCards = cards;
    setBoardData((prev) => {
      const others = prev.cards.filter((c) => c.id !== movingId);
      const listCards = others.filter((c) => c.list_id === targetListId);
      const nonListCards = others.filter((c) => c.list_id !== targetListId);
      const moved = { ...movingCard, list_id: targetListId };
      const idx = Math.min(targetIndex, listCards.length);
      listCards.splice(idx, 0, moved);
      const reindexed = listCards.map((c, i) => ({ ...c, position: i + 1 }));
      return { ...prev, cards: [...nonListCards, ...reindexed] };
    });

    try {
      await apiFetch(`/api/cards/${movingId}/move`, {
        method: 'POST',
        body: { targetListId, targetIndex },
      });
      await loadBoard(true);
      onRefreshMe();
    } catch (err) {
      setBoardData((prev) => ({ ...prev, cards: prevCards }));
      if (err.status !== 403) showToast(err.message || 'تعذر نقل الكارت', 'error');
    }
  }

  async function handleSaveBoardSettings(e) {
    e.preventDefault();
    try {
      await apiFetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        body: {
          title: editTitle,
          description: editDesc,
          background: editBg,
        },
      });
      setSettingsOpen(false);
      await loadBoard(true);
      onRefreshMe();
      showToast('تم تحديث إعدادات اللوحة', 'success');
    } catch (err) {
      if (err.status !== 403) showToast(err.message, 'error');
    }
  }

  async function handleDeleteBoard() {
    try {
      await apiFetch(`/api/boards/${board.id}`, { method: 'DELETE' });
      onRefreshMe();
      showToast('تم حذف اللوحة نهائياً', 'success');
      onBack();
    } catch (err) {
      if (err.status !== 403) showToast(err.message, 'error');
    }
  }

  // Apply board filters
  const filteredCards = cards.filter((c) => {
    if (
      filterText.trim() &&
      !c.title.toLowerCase().includes(filterText.toLowerCase()) &&
      !(c.description || '').toLowerCase().includes(filterText.toLowerCase())
    ) {
      return false;
    }
    if (filterPriority !== 'ALL' && c.priority !== filterPriority) return false;
    if (
      filterMember !== 'ALL' &&
      !c.assignees.some((a) => Number(a.id) === Number(filterMember))
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="kanban-wrapper" style={{ background: theme.boardBg }}>
      {/* Board Top Header */}
      <div className="kanban-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="icon-btn-dark" onClick={onBack}>
            <ArrowRight size={15} />
            كل اللوحات
          </button>

          <button
            type="button"
            className="icon-btn-dark"
            onClick={handleToggleStar}
            title="تمييز كمفضلة"
          >
            <Star
              size={15}
              fill={board.is_starred ? '#fbbf24' : 'none'}
              color={board.is_starred ? '#fbbf24' : '#fff'}
            />
          </button>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{board.title}</h1>
              <span
                className="badge"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
              >
                {board.department_name}
              </span>
              {board.accessViaGrant && (
                <span
                  className="badge"
                  style={{ background: '#fef3c7', color: '#92400e' }}
                >
                  <Clock size={12} />
                  تصريح مؤقت ({formatRemainingTime(board.accessViaGrant.expiresAt)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Avatar stack of department members */}
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 6 }}>
            {departmentMembers.slice(0, 5).map((m, idx) => (
              <div
                key={m.id}
                className="avatar-circle"
                title={`${m.fullName} (${m.roleName})`}
                style={{
                  width: 30,
                  height: 30,
                  fontSize: 11,
                  background: m.avatarColor,
                  marginRight: idx === 0 ? 0 : -8,
                  border: '2px solid rgba(6,24,44,0.8)',
                }}
              >
                {getInitials(m.fullName)}
              </div>
            ))}
          </div>

          {capabilities.canEditBoard ? (
            <button
              type="button"
              className="icon-btn-dark"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={15} />
              إعدادات اللوحة
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn-dark gold-cta"
              onClick={() =>
                requestBoardPerm('boards.edit', `تعديل إعدادات لوحة "${board.title}"`)
              }
            >
              <Lock size={13} />
              إعدادات اللوحة (طلب إذن)
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="kanban-filterbar">
        <div style={{ position: 'relative', width: 220 }}>
          <Search
            size={13}
            color="#cbd5e1"
            style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            className="nav-search-input"
            style={{ padding: '5px 28px 5px 8px', fontSize: 12.5 }}
            placeholder="تصفية الكروت في اللوحة..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 7,
            padding: '5px 10px',
            fontSize: 12.5,
          }}
        >
          <option value="ALL" style={{ color: '#0f172a' }}>كل الأولويات</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, cfg]) => (
            <option key={k} value={k} style={{ color: '#0f172a' }}>
              أولوية: {cfg.label}
            </option>
          ))}
        </select>

        <select
          value={filterMember}
          onChange={(e) => setFilterMember(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 7,
            padding: '5px 10px',
            fontSize: 12.5,
          }}
        >
          <option value="ALL" style={{ color: '#0f172a' }}>كل أعضاء الفريق</option>
          {departmentMembers.map((m) => (
            <option key={m.id} value={m.id} style={{ color: '#0f172a' }}>
              المسؤول: {m.fullName}
            </option>
          ))}
        </select>

        {(filterText || filterPriority !== 'ALL' || filterMember !== 'ALL') && (
          <button
            type="button"
            className="icon-btn-dark"
            style={{ height: 30, fontSize: 12 }}
            onClick={() => {
              setFilterText('');
              setFilterPriority('ALL');
              setFilterMember('ALL');
            }}
          >
            مسح التصفية
          </button>
        )}

        <div style={{ marginRight: 'auto', fontSize: 12, color: '#e2e8f0' }}>
          {capabilities.canMoveCard
            ? '💡 اسحب الكروت وأفلتها بين القوائم لتحديث المرحلة، أو اضغط على أي كارت للتفاصيل'
            : '🔒 وضع القراءة المقيدة: اضغط على أي إجراء مقفل لطلب صلاحية من المدير'}
        </div>
      </div>

      {/* Horizontal Kanban Lists */}
      <div className="kanban-columns-scroll">
        {lists.map((list) => {
          const listCards = filteredCards
            .filter((c) => c.list_id === list.id)
            .sort((a, b) => a.position - b.position || a.id - b.id);

          return (
            <div
              key={list.id}
              className={`kanban-list ${dragOverListId === list.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverListId !== list.id) setDragOverListId(list.id);
              }}
              onDragLeave={() => {
                if (dragOverListId === list.id) setDragOverListId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnList(list.id, listCards.length);
              }}
            >
              <div className="kanban-list-header">
                {editingListId === list.id && capabilities.canEditList ? (
                  <input
                    type="text"
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: 13.5, fontWeight: 800 }}
                    autoFocus
                    value={editingListTitle}
                    onChange={(e) => setEditingListTitle(e.target.value)}
                    onBlur={() => handleRenameList(list.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameList(list.id);
                      if (e.key === 'Escape') setEditingListId(null);
                    }}
                  />
                ) : (
                  <div
                    onClick={() => {
                      if (capabilities.canEditList) {
                        setEditingListId(list.id);
                        setEditingListTitle(list.title);
                      }
                    }}
                    style={{
                      fontWeight: 800,
                      fontSize: 14,
                      color: '#0f172a',
                      cursor: capabilities.canEditList ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <span>{list.title}</span>
                    <span
                      style={{
                        background: '#cbd5e1',
                        color: '#1e293b',
                        borderRadius: 99,
                        padding: '1px 7px',
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {listCards.length}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleDeleteList(list)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: capabilities.canDeleteList ? '#64748b' : '#b45309',
                    padding: 4,
                  }}
                  title={
                    capabilities.canDeleteList
                      ? 'حذف القائمة'
                      : 'طلب إذن حذف القائمة من المدير'
                  }
                >
                  {capabilities.canDeleteList ? <Trash2 size={14} /> : <Lock size={13} />}
                </button>
              </div>

              {/* Cards Stack */}
              <div className="kanban-cards-container">
                {listCards.map((card, index) => {
                  const prio = PRIORITY_CONFIG[card.priority] || PRIORITY_CONFIG.medium;
                  const dueStatus = getDueDateStatus(card.due_date, card.is_completed);
                  const hasCardGrant =
                    card.grantedCardPermissions && card.grantedCardPermissions.length > 0;

                  return (
                    <div
                      key={card.id}
                      className={`kanban-card ${draggingCardId === card.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={() => setDraggingCardId(card.id)}
                      onDragEnd={() => {
                        setDraggingCardId(null);
                        setDragOverListId(null);
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDropOnList(list.id, index);
                      }}
                      onClick={() => setActiveCardId(card.id)}
                    >
                      {card.cover_color && (
                        <div
                          className="kanban-card-cover"
                          style={{ background: card.cover_color }}
                        />
                      )}

                      <div className="kanban-card-inner">
                        {card.labels && card.labels.length > 0 && (
                          <div className="label-pills-row">
                            {card.labels.map((l) => (
                              <span
                                key={l.id}
                                className="label-pill"
                                style={{ background: l.color }}
                              >
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}

                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 13.5,
                            color: card.is_completed ? '#64748b' : '#0f172a',
                            textDecoration: card.is_completed ? 'line-through' : 'none',
                            lineHeight: 1.5,
                            marginBottom: 8,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                          }}
                        >
                          {card.is_completed && (
                            <CheckCircle2
                              size={15}
                              color="#10b981"
                              style={{ flexShrink: 0, marginTop: 3 }}
                            />
                          )}
                          <span>{card.title}</span>
                        </div>

                        {hasCardGrant && (
                          <div
                            style={{
                              background: '#fef3c7',
                              color: '#92400e',
                              padding: '2px 7px',
                              borderRadius: 5,
                              fontSize: 10.5,
                              fontWeight: 800,
                              marginBottom: 7,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <KeyRound size={11} />
                            تصريح مدير نشط على هذا الكارت
                          </div>
                        )}

                        {/* Card Footer Meta */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span
                              style={{
                                background: prio.bg,
                                color: prio.color,
                                border: `1px solid ${prio.border}`,
                                borderRadius: 5,
                                padding: '1px 6px',
                                fontSize: 10.5,
                                fontWeight: 800,
                              }}
                            >
                              {prio.label}
                            </span>

                            {dueStatus && (
                              <span
                                style={{
                                  background: dueStatus.bg,
                                  color: dueStatus.color,
                                  borderRadius: 5,
                                  padding: '1px 6px',
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <Calendar size={10} />
                                {dueStatus.label}
                              </span>
                            )}

                            {card.checklist_total > 0 && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color:
                                    card.checklist_done === card.checklist_total
                                      ? '#059669'
                                      : '#64748b',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <CheckSquare size={12} />
                                {card.checklist_done}/{card.checklist_total}
                              </span>
                            )}

                            {card.comments_count > 0 && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: '#64748b',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <MessageSquare size={12} />
                                {card.comments_count}
                              </span>
                            )}
                          </div>

                          {card.assignees && card.assignees.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {card.assignees.slice(0, 3).map((a, i) => (
                                <span
                                  key={a.id}
                                  className="avatar-circle"
                                  title={a.fullName}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    fontSize: 9.5,
                                    background: a.avatarColor,
                                    marginRight: i === 0 ? 0 : -6,
                                    border: '1.5px solid #fff',
                                  }}
                                >
                                  {getInitials(a.fullName)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Card Composer in List Footer */}
              <div style={{ padding: '8px 10px 10px' }}>
                {addingCardListId === list.id ? (
                  <form onSubmit={(e) => handleCreateCard(e, list.id)}>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      autoFocus
                      placeholder="اكتب عنوان المهمة الجديدة..."
                      value={newCardTitle}
                      onChange={(e) => setNewCardTitle(e.target.value)}
                      style={{ marginBottom: 6, fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select
                        className="form-select"
                        style={{ padding: '5px 8px', fontSize: 12, width: 115 }}
                        value={newCardPriority}
                        onChange={(e) => setNewCardPriority(e.target.value)}
                      >
                        {Object.entries(PRIORITY_CONFIG).map(([k, cfg]) => (
                          <option key={k} value={k}>
                            {cfg.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                        إضافة
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setAddingCardListId(null)}
                      >
                        ×
                      </button>
                    </div>
                  </form>
                ) : capabilities.canCreateCard ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingCardListId(list.id);
                      setNewCardTitle('');
                    }}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 8,
                      padding: '7px 10px',
                      color: '#475569',
                      fontSize: 13,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Plus size={15} />
                    إضافة كارت مهمة
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    style={{ width: '100%' }}
                    onClick={() =>
                      requestBoardPerm('cards.create', `إضافة كارت مهمة جديد في "${board.title}"`)
                    }
                  >
                    <Lock size={12} />
                    إضافة كارت (طلب إذن المدير)
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add New List Column */}
        <div className="kanban-add-list-box">
          {addingList ? (
            <form onSubmit={handleCreateList}>
              <input
                type="text"
                className="form-input"
                autoFocus
                placeholder="اسم القائمة الجديدة..."
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                  حفظ القائمة
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAddingList(false)}
                >
                  إلغاء
                </button>
              </div>
            </form>
          ) : capabilities.canCreateList ? (
            <button
              type="button"
              onClick={() => setAddingList(true)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontWeight: 800,
                fontSize: 13.5,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 4,
              }}
            >
              <Plus size={17} />
              إضافة قائمة مراحل جديدة
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                requestBoardPerm('lists.create', `إضافة قائمة مراحل جديدة في "${board.title}"`)
              }
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#fde68a',
                fontWeight: 700,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: 4,
              }}
            >
              <Lock size={15} />
              إضافة قائمة جديدة (طلب إذن المدير)
            </button>
          )}
        </div>
      </div>

      {/* Card Detail Modal */}
      {activeCardId && (
        <CardDetailModal
          cardId={activeCardId}
          board={board}
          lists={lists}
          boardLabels={labels}
          departmentMembers={departmentMembers}
          capabilities={capabilities}
          currentUser={currentUser}
          onClose={() => setActiveCardId(null)}
          onBoardChanged={(refreshMeToo = false) => {
            loadBoard(true);
            if (refreshMeToo) onRefreshMe();
          }}
          onOpenRequestModal={onOpenRequestModal}
          showToast={showToast}
        />
      )}

      {/* Board Settings Modal */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>إعدادات اللوحة</div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveBoardSettings}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">عنوان اللوحة</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">الوصف</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">لون ومظهر اللوحة</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {Object.values(BOARD_THEMES).map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setEditBg(th.id)}
                        style={{
                          height: 40,
                          borderRadius: 8,
                          background: th.gradient,
                          border: editBg === th.id ? '3px solid #f59e0b' : 'none',
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

                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 14,
                    borderTop: '1px solid #e2e8f0',
                  }}
                >
                  {capabilities.canDeleteBoard ? (
                    !confirmBoardDelete ? (
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-sm"
                        onClick={() => setConfirmBoardDelete(true)}
                      >
                        <Trash2 size={14} />
                        حذف هذه اللوحة بالكامل
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#b91c1c' }}>
                          سيتم مسح جميع القوائم والكروت نهائياً:
                        </span>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={handleDeleteBoard}
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setConfirmBoardDelete(false)}
                        >
                          تراجع
                        </button>
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      className="btn btn-locked btn-sm"
                      onClick={() => {
                        setSettingsOpen(false);
                        requestBoardPerm('boards.delete', `حذف لوحة "${board.title}"`);
                      }}
                    >
                      <Lock size={13} />
                      طلب إذن حذف اللوحة من المدير
                    </button>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSettingsOpen(false)}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary">
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
