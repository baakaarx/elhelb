import React, { useEffect, useState } from 'react';
import {
  X,
  CheckSquare,
  MessageSquare,
  Tag,
  Users,
  Calendar,
  Flag,
  Trash2,
  Lock,
  Plus,
  CheckCircle2,
  KeyRound,
  ArrowLeftRight,
  Palette,
} from 'lucide-react';
import { apiFetch } from '../api';
import {
  COLOR_SWATCHES,
  PRIORITY_CONFIG,
  formatSqliteDate,
  getInitials,
} from '../constants';

export default function CardDetailModal({
  cardId,
  board,
  lists,
  boardLabels,
  departmentMembers,
  capabilities,
  currentUser,
  onClose,
  onBoardChanged,
  onOpenRequestModal,
  showToast,
}) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);

  const [newCheckTitle, setNewCheckTitle] = useState('');
  const [commentBody, setCommentBody] = useState('');

  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#0a6fa8');
  const [showLabelCreator, setShowLabelCreator] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Check if currentUser holds a card-specific grant on this exact card
  const cardSpecificPerms = new Set(
    (currentUser.activeGrants || [])
      .filter((g) => g.scope_type === 'card' && Number(g.target_card_id) === Number(cardId))
      .map((g) => g.permission_key)
  );

  const canEdit = capabilities.canEditCard || cardSpecificPerms.has('cards.edit');
  const canMove = capabilities.canMoveCard || cardSpecificPerms.has('cards.move');
  const canAssign = capabilities.canAssignCard || cardSpecificPerms.has('cards.assign');
  const canDelete = capabilities.canDeleteCard || cardSpecificPerms.has('cards.delete');
  const canComment = capabilities.canComment || cardSpecificPerms.has('comments.create');

  async function loadCard() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/cards/${cardId}`);
      setCard(data);
      setTitle(data.title);
      setDescription(data.description || '');
    } catch (err) {
      showToast(err.message || 'تعذر فتح الكارت', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCard();
  }, [cardId, currentUser.activeGrants?.length, currentUser.permissions?.length]);

  function askManagerFor(permissionKey, actionLabel) {
    onOpenRequestModal({
      permissionKey,
      targetDepartmentId: board.department_id,
      targetBoardId: board.id,
      targetBoardTitle: board.title,
      targetCardId: card?.id || cardId,
      targetCardTitle: card?.title || '',
      actionLabel,
    });
  }

  async function patchCard(updates) {
    try {
      const updated = await apiFetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        body: updates,
      });
      setCard(updated);
      setTitle(updated.title);
      setDescription(updated.description || '');
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر حفظ التعديل', 'error');
    }
  }

  async function handleMoveList(targetListId) {
    try {
      await apiFetch(`/api/cards/${card.id}/move`, {
        method: 'POST',
        body: { targetListId: Number(targetListId), targetIndex: 0 },
      });
      await loadCard();
      onBoardChanged();
      showToast('تم نقل الكارت إلى القائمة الجديدة', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر نقل الكارت', 'error');
    }
  }

  async function toggleAssignee(userId) {
    try {
      const updated = await apiFetch(`/api/cards/${card.id}/assignees`, {
        method: 'POST',
        body: { userId },
      });
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر تعديل المسؤولين', 'error');
    }
  }

  async function toggleLabel(labelId) {
    try {
      const updated = await apiFetch(`/api/cards/${card.id}/labels`, {
        method: 'POST',
        body: { labelId },
      });
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر تعديل التصنيف', 'error');
    }
  }

  async function handleCreateBoardLabel(e) {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    try {
      const created = await apiFetch(`/api/boards/${board.id}/labels`, {
        method: 'POST',
        body: { name: newLabelName.trim(), color: newLabelColor },
      });
      setNewLabelName('');
      setShowLabelCreator(false);
      await toggleLabel(created.id);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر إنشاء التصنيف', 'error');
    }
  }

  async function handleAddChecklist(e) {
    e.preventDefault();
    if (!newCheckTitle.trim()) return;
    try {
      const updated = await apiFetch(`/api/cards/${card.id}/checklist`, {
        method: 'POST',
        body: { title: newCheckTitle.trim() },
      });
      setNewCheckTitle('');
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر إضافة المهمة الفرعية', 'error');
    }
  }

  async function toggleChecklistItem(item) {
    try {
      const updated = await apiFetch(`/api/checklist/${item.id}`, {
        method: 'PATCH',
        body: { isChecked: !item.is_checked },
      });
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر التحديث', 'error');
    }
  }

  async function deleteChecklistItem(itemId) {
    try {
      const updated = await apiFetch(`/api/checklist/${itemId}`, {
        method: 'DELETE',
      });
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر الحذف', 'error');
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    try {
      const updated = await apiFetch(`/api/cards/${card.id}/comments`, {
        method: 'POST',
        body: { body: commentBody.trim() },
      });
      setCommentBody('');
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر إضافة التعليق', 'error');
    }
  }

  async function handleDeleteComment(commentId) {
    try {
      const updated = await apiFetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
      });
      setCard(updated);
      onBoardChanged();
    } catch (err) {
      showToast(err.message || 'تعذر حذف التعليق', 'error');
    }
  }

  async function handleDeleteCard() {
    try {
      const res = await apiFetch(`/api/cards/${card.id}`, { method: 'DELETE' });
      showToast(
        res.consumedGrant
          ? 'تم حذف الكارت بنجاح واستهلاك تصريح المدير (لمرة واحدة)'
          : 'تم حذف الكارت نهائياً',
        'success'
      );
      onBoardChanged(true);
      onClose();
    } catch (err) {
      showToast(err.message || 'تعذر حذف الكارت', 'error');
    }
  }

  if (loading || !card) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel modal-lg" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body" style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
            جاري تحميل تفاصيل المهمة...
          </div>
        </div>
      </div>
    );
  }

  const assignedIds = new Set(card.assignees.map((a) => a.id));
  const attachedLabelIds = new Set(card.labels.map((l) => l.id));
  const checkTotal = card.checklist.length;
  const checkDone = card.checklist.filter((i) => i.is_checked).length;
  const checkPct = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-lg" onClick={(e) => e.stopPropagation()}>
        {card.cover_color && (
          <div style={{ height: 14, background: card.cover_color }} />
        )}

        <div className="modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  if (!canEdit) {
                    return askManagerFor('cards.edit', `تغيير حالة إنجاز كارت "${card.title}"`);
                  }
                  patchCard({ isCompleted: !card.is_completed });
                }}
                style={{
                  background: card.is_completed ? '#10b981' : '#fff',
                  color: card.is_completed ? '#fff' : '#64748b',
                  border: `2px solid ${card.is_completed ? '#10b981' : '#cbd5e1'}`,
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                title="تحديد كمكتمل / غير مكتمل"
              >
                {card.is_completed && <CheckCircle2 size={16} />}
              </button>

              {canEdit ? (
                <input
                  type="text"
                  className="form-input"
                  style={{ fontWeight: 800, fontSize: 17, padding: '6px 10px' }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title.trim() && title.trim() !== card.title) {
                      patchCard({ title: title.trim() });
                    }
                  }}
                />
              ) : (
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{card.title}</h2>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              في قائمة: <strong>{card.list_title}</strong> • قسم: <strong>{board.department_name}</strong>
              {cardSpecificPerms.size > 0 && (
                <span
                  className="badge"
                  style={{ background: '#fef3c7', color: '#92400e', marginRight: 8 }}
                >
                  <KeyRound size={11} />
                  تصريح استثنائي مفعل على هذا الكارت
                </span>
              )}
            </div>
          </div>

          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="card-modal-grid">
            {/* MAIN RIGHT COLUMN */}
            <div>
              {/* Active Labels & Assignees Preview */}
              {(card.labels.length > 0 || card.assignees.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 18 }}>
                  {card.labels.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', marginBottom: 5 }}>
                        التصنيفات:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {card.labels.map((l) => (
                          <span
                            key={l.id}
                            style={{
                              background: l.color,
                              color: '#fff',
                              padding: '3px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {l.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {card.assignees.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', marginBottom: 5 }}>
                        المسؤولون عن التنفيذ:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {card.assignees.map((a) => (
                          <span
                            key={a.id}
                            className="badge"
                            style={{ background: '#f1f5f9', color: '#0f172a', padding: '4px 10px' }}
                          >
                            <span
                              className="avatar-circle"
                              style={{ width: 20, height: 20, fontSize: 9.5, background: a.avatarColor }}
                            >
                              {getInitials(a.fullName)}
                            </span>
                            {a.fullName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              <div style={{ marginBottom: 22 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <label className="form-label" style={{ margin: 0, fontSize: 14 }}>
                    وصف وتفاصيل المهمة
                  </label>
                  {canEdit && !editingDesc && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingDesc(true)}
                    >
                      تعديل الوصف
                    </button>
                  )}
                </div>

                {editingDesc && canEdit ? (
                  <div>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="اكتب كافة تفاصيل المهمة، المتطلبات، والملاحظات التنفيذية..."
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          patchCard({ description });
                          setEditingDesc(false);
                        }}
                      >
                        حفظ الوصف
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setDescription(card.description || '');
                          setEditingDesc(false);
                        }}
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      if (canEdit) setEditingDesc(true);
                    }}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '12px 14px',
                      fontSize: 13.5,
                      color: card.description ? '#1e293b' : '#94a3b8',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.7,
                      cursor: canEdit ? 'pointer' : 'default',
                    }}
                  >
                    {card.description || 'لا يوجد وصف تفصيلي بعد...'}
                  </div>
                )}
              </div>

              {/* Checklist */}
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckSquare size={16} color="#0a6fa8" />
                    قائمة المهام الفرعية ({checkDone}/{checkTotal})
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#059669' }}>
                    {checkPct}%
                  </span>
                </div>

                {checkTotal > 0 && (
                  <div
                    style={{
                      height: 7,
                      background: '#e2e8f0',
                      borderRadius: 99,
                      overflow: 'hidden',
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${checkPct}%`,
                        background: checkPct === 100 ? '#10b981' : '#0a6fa8',
                        transition: 'width 0.25s',
                      }}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {card.checklist.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 8,
                        background: item.is_checked ? '#f0fdf4' : '#f8fafc',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          flex: 1,
                          cursor: canEdit ? 'pointer' : 'not-allowed',
                          fontSize: 13.5,
                          textDecoration: item.is_checked ? 'line-through' : 'none',
                          color: item.is_checked ? '#64748b' : '#0f172a',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={item.is_checked}
                          onChange={() => {
                            if (!canEdit) {
                              return askManagerFor('cards.edit', `تحديث المهام الفرعية في "${card.title}"`);
                            }
                            toggleChecklistItem(item);
                          }}
                        />
                        {item.title}
                      </label>

                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => deleteChecklistItem(item.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            padding: 4,
                          }}
                          title="حذف العنصر"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canEdit ? (
                  <form onSubmit={handleAddChecklist} style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="أضف خطوة تنفيذية فرعية..."
                      value={newCheckTitle}
                      onChange={(e) => setNewCheckTitle(e.target.value)}
                    />
                    <button type="submit" className="btn btn-secondary btn-sm">
                      <Plus size={14} />
                      إضافة
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    onClick={() => askManagerFor('cards.edit', `تعديل وإضافة مهام فرعية في "${card.title}"`)}
                  >
                    <Lock size={13} />
                    طلب صلاحية تعديل المهمة من المدير
                  </button>
                )}
              </div>

              {/* Comments & Team Activity */}
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 10,
                  }}
                >
                  <MessageSquare size={16} color="#0a6fa8" />
                  التعليقات والمتابعة ({card.comments.length})
                </div>

                {canComment ? (
                  <form onSubmit={handleAddComment} style={{ marginBottom: 14 }}>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      placeholder="اكتب تعليقاً أو تحديثاً للفريق على هذه المهمة..."
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                    />
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="submit" className="btn btn-primary btn-sm">
                        إرسال التعليق
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    style={{ marginBottom: 14 }}
                    onClick={() => askManagerFor('comments.create', `إضافة تعليق على "${card.title}"`)}
                  >
                    <Lock size={13} />
                    طلب صلاحية إضافة تعليق من المدير
                  </button>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {card.comments.map((cm) => {
                    const canDelComment =
                      (cm.user_id === currentUser.id && canComment) ||
                      capabilities.canDeleteAnyComment;
                    return (
                      <div
                        key={cm.id}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 5,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              className="avatar-circle"
                              style={{ width: 24, height: 24, fontSize: 10, background: cm.avatar_color }}
                            >
                              {getInitials(cm.full_name)}
                            </span>
                            <span style={{ fontWeight: 800, fontSize: 12.5 }}>{cm.full_name}</span>
                            <span style={{ fontSize: 11, color: '#64748b' }}>({cm.role_name})</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {formatSqliteDate(cm.created_at)}
                            </span>
                            {canDelComment && (
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(cm.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#dc2626',
                                  padding: 2,
                                }}
                                title="حذف التعليق"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                          {cm.body}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* LEFT SIDEBAR CONTROLS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Move List */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ArrowLeftRight size={14} color="#0a6fa8" />
                  نقل المرحلة (القائمة)
                </div>
                {canMove ? (
                  <select
                    className="form-select"
                    value={card.list_id}
                    onChange={(e) => handleMoveList(e.target.value)}
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    style={{ width: '100%' }}
                    onClick={() => askManagerFor('cards.move', `نقل كارت "${card.title}" بين القوائم`)}
                  >
                    <Lock size={13} />
                    نقل الكارت (طلب إذن)
                  </button>
                )}
              </div>

              {/* Priority & Due Date */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Flag size={14} color="#d97706" />
                  درجة الأولوية
                </div>
                <select
                  className="form-select"
                  value={card.priority}
                  disabled={!canEdit}
                  onChange={(e) => patchCard({ priority: e.target.value })}
                >
                  {Object.entries(PRIORITY_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>
                      {cfg.label}
                    </option>
                  ))}
                </select>

                <div style={{ fontSize: 12, fontWeight: 800, margin: '10px 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Calendar size={14} color="#0a6fa8" />
                  تاريخ الاستحقاق
                </div>
                <input
                  type="date"
                  className="form-input"
                  value={card.due_date || ''}
                  disabled={!canEdit}
                  onChange={(e) => patchCard({ dueDate: e.target.value || null })}
                />
              </div>

              {/* Cover Strip Color */}
              {canEdit && (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Palette size={14} color="#7c3aed" />
                    لون غلاف الكارت
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => patchCard({ coverColor: null })}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        fontSize: 10,
                      }}
                      title="بدون غلاف"
                    >
                      ×
                    </button>
                    {COLOR_SWATCHES.slice(0, 7).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => patchCard({ coverColor: c })}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: c,
                          border: card.cover_color === c ? '2px solid #0f172a' : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Assignees Picker */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Users size={14} color="#059669" />
                  تعيين أعضاء القسم
                </div>
                {canAssign ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 155, overflowY: 'auto' }}>
                    {departmentMembers.map((m) => {
                      const active = assignedIds.has(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleAssignee(m.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            borderRadius: 7,
                            border: `1px solid ${active ? '#059669' : '#e2e8f0'}`,
                            background: active ? '#ecfdf5' : '#fff',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <span>{m.fullName}</span>
                          {active && <CheckCircle2 size={14} color="#059669" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    style={{ width: '100%' }}
                    onClick={() => askManagerFor('cards.assign', `تعيين موظف على كارت "${card.title}"`)}
                  >
                    <Lock size={13} />
                    تعيين موظفين (طلب إذن)
                  </button>
                )}
              </div>

              {/* Labels Picker */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Tag size={14} color="#0a6fa8" />
                  التصنيفات الملونة
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {boardLabels.map((lbl) => {
                    const active = attachedLabelIds.has(lbl.id);
                    return (
                      <button
                        key={lbl.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleLabel(lbl.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '5px 9px',
                          borderRadius: 6,
                          border: active ? '2px solid #0f172a' : '1px solid transparent',
                          background: lbl.color,
                          color: '#fff',
                          fontSize: 11.5,
                          fontWeight: 700,
                        }}
                      >
                        <span>{lbl.name}</span>
                        {active && <span>✓</span>}
                      </button>
                    );
                  })}
                </div>

                {capabilities.canEditBoard && (
                  <div style={{ marginTop: 8 }}>
                    {!showLabelCreator ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%' }}
                        onClick={() => setShowLabelCreator(true)}
                      >
                        <Plus size={13} />
                        تصنيف جديد للوحة
                      </button>
                    ) : (
                      <form onSubmit={handleCreateBoardLabel} style={{ marginTop: 6 }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="اسم التصنيف..."
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          style={{ marginBottom: 6, fontSize: 12 }}
                        />
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          {COLOR_SWATCHES.slice(0, 6).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setNewLabelColor(c)}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                background: c,
                                border: newLabelColor === c ? '2px solid #000' : 'none',
                              }}
                            />
                          ))}
                        </div>
                        <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%' }}>
                          حفظ التصنيف
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Delete Card Action (Role OR One-time Grant OR Request Manager Permission) */}
              <div style={{ paddingTop: 4 }}>
                {canDelete ? (
                  !confirmDelete ? (
                    <button
                      type="button"
                      className="btn btn-danger-soft btn-sm"
                      style={{ width: '100%' }}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={14} />
                      {cardSpecificPerms.has('cards.delete')
                        ? 'حذف الكارت (بتصريح المدير 🔑)'
                        : 'حذف الكارت نهائياً'}
                    </button>
                  ) : (
                    <div
                      style={{
                        background: '#fee2e2',
                        border: '1px solid #fca5a5',
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#991b1b', marginBottom: 8 }}>
                        تأكيد حذف هذا الكارت نهائياً؟
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          style={{ flex: 1 }}
                          onClick={handleDeleteCard}
                        >
                          نعم، احذف
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setConfirmDelete(false)}
                        >
                          تراجع
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn btn-locked btn-sm"
                    style={{ width: '100%' }}
                    onClick={() => askManagerFor('cards.delete', `حذف كارت "${card.title}"`)}
                  >
                    <Lock size={13} />
                    حذف الكارت (طلب إذن المدير)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
