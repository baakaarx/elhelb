import React, { useEffect, useState } from 'react';
import {
  Shield,
  Users,
  Building2,
  FileSearch,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Edit3,
  X,
  Database,
  Crown,
  Lock,
  Globe,
  Copy,
  Mail,
  Send,
} from 'lucide-react';
import { apiFetch } from '../api';
import { COLOR_SWATCHES, formatSqliteDate, getInitials } from '../constants';

export default function AdminControlView({ user, onRefreshMe, showToast }) {
  const permSet = new Set(user.permissions || []);
  const canRoles = permSet.has('roles.manage');
  const canUsers = permSet.has('users.manage');
  const canDepts = permSet.has('departments.manage');
  const canAudit = permSet.has('audit.view');

  const defaultSubTab = canRoles
    ? 'roles'
    : canUsers
    ? 'users'
    : canDepts
    ? 'departments'
    : 'audit';

  const [subTab, setSubTab] = useState(defaultSubTab);

  return (
    <div className="page-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={23} color="#0a6fa8" />
            مركز الإدارة والتحكم الديناميكي بالصلاحيات
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#64748b' }}>
            كافة الأدوار والصلاحيات والأقسام مخزنة في قاعدة البيانات وتُطبّق لحظياً على السيرفر مع حماية الرتب السيادية
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {canRoles && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'roles' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('roles')}
            >
              <Shield size={15} />
              الأدوار ومصفوفة الصلاحيات
            </button>
          )}
          {canUsers && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('users')}
            >
              <Users size={15} />
              إدارة الموظفين والحسابات
            </button>
          )}
          {canDepts && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'departments' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('departments')}
            >
              <Building2 size={15} />
              أقسام الشركة
            </button>
          )}
          {canRoles && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'gmail' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('gmail')}
            >
              <Mail size={15} />
              ربط إشعارات Gmail
            </button>
          )}
          {canRoles && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'oauth' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('oauth')}
            >
              <Globe size={15} />
              ربط Google OAuth
            </button>
          )}
          {canAudit && (
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'audit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('audit')}
            >
              <FileSearch size={15} />
              سجل المراقبة الأمنية (Audit)
            </button>
          )}
        </div>
      </div>

      {subTab === 'roles' && canRoles && (
        <RolesMatrixPanel onRefreshMe={onRefreshMe} showToast={showToast} />
      )}
      {subTab === 'users' && canUsers && (
        <UsersManagementPanel currentUser={user} onRefreshMe={onRefreshMe} showToast={showToast} />
      )}
      {subTab === 'departments' && canDepts && (
        <DepartmentsManagementPanel showToast={showToast} />
      )}
      {subTab === 'gmail' && canRoles && <GmailSettingsPanel showToast={showToast} />}
      {subTab === 'oauth' && canRoles && <OAuthSettingsPanel showToast={showToast} />}
      {subTab === 'audit' && canAudit && <AuditLogsPanel showToast={showToast} />}
    </div>
  );
}

/* ==========================================
   1. ROLES & PERMISSIONS MATRIX
   ========================================== */
function RolesMatrixPanel({ onRefreshMe, showToast }) {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftColor, setDraftColor] = useState('#0a6fa8');
  const [draftPerms, setDraftPerms] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Create Role Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#4f46e5');

  async function loadRoles(keepId = null) {
    try {
      const data = await apiFetch('/api/admin/roles');
      setPermissions(data.permissions);
      setRoles(data.roles);
      const target =
        data.roles.find((r) => r.id === (keepId || selectedRoleId)) || data.roles[0];
      if (target) selectRole(target);
    } catch (err) {
      showToast(err.message || 'تعذر تحميل الصلاحيات', 'error');
    }
  }

  function selectRole(role) {
    setSelectedRoleId(role.id);
    setDraftName(role.name);
    setDraftDesc(role.description || '');
    setDraftColor(role.color || '#0a6fa8');
    setDraftPerms(new Set(role.permissions || []));
  }

  useEffect(() => {
    loadRoles();
  }, []);

  const currentRole = roles.find((r) => r.id === selectedRoleId);
  const canEditSelectedRole = Boolean(currentRole && currentRole.can_caller_edit);

  function togglePerm(key) {
    if (!canEditSelectedRole) return;
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCategoryAll(catPerms) {
    if (!canEditSelectedRole) return;
    const allEnabled = catPerms.every((p) => draftPerms.has(p.key));
    setDraftPerms((prev) => {
      const next = new Set(prev);
      for (const p of catPerms) {
        if (allEnabled) next.delete(p.key);
        else next.add(p.key);
      }
      return next;
    });
  }

  async function handleSaveRole() {
    if (!currentRole || !canEditSelectedRole) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/roles/${currentRole.id}`, {
        method: 'PUT',
        body: {
          name: draftName,
          description: draftDesc,
          color: draftColor,
          permissions: Array.from(draftPerms),
        },
      });
      await loadRoles(currentRole.id);
      onRefreshMe();
      showToast(
        `تم حفظ صلاحيات دور (${draftName}) في قاعدة البيانات وتفعيلها على السيرفر فوراً!`,
        'success'
      );
    } catch (err) {
      showToast(err.message || 'تعذر حفظ الصلاحيات', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRole(e) {
    e.preventDefault();
    try {
      const created = await apiFetch('/api/admin/roles', {
        method: 'POST',
        body: {
          name: newRoleName,
          description: newRoleDesc,
          color: newRoleColor,
          permissions: ['boards.view_department', 'comments.create'],
        },
      });
      setCreateOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await loadRoles(created.id);
      showToast(`تم إنشاء الدور الجديد (${created.name}) — حدد صلاحياته الآن`, 'success');
    } catch (err) {
      showToast(err.message || 'تعذر إنشاء الدور', 'error');
    }
  }

  async function handleDeleteRole() {
    if (!currentRole) return;
    if (!window.confirm(`حذف الدور الوظيفي "${currentRole.name}" نهائياً؟`)) return;
    try {
      await apiFetch(`/api/admin/roles/${currentRole.id}`, { method: 'DELETE' });
      await loadRoles();
      showToast('تم حذف الدور بنجاح', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر حذف الدور', 'error');
    }
  }

  // Group permissions by category
  const grouped = [];
  const catMap = new Map();
  for (const p of permissions) {
    if (!catMap.has(p.category)) {
      const group = { category: p.category, label: p.category_label, items: [] };
      catMap.set(p.category, group);
      grouped.push(group);
    }
    catMap.get(p.category).items.push(p);
  }

  return (
    <div className="admin-layout">
      {/* Sidebar of Roles */}
      <div className="card-box" style={{ padding: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 14.5 }}>الأدوار الوظيفية ({roles.length})</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} />
            دور جديد
          </button>
        </div>

        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`role-list-item ${r.id === selectedRoleId ? 'selected' : ''}`}
            onClick={() => selectRole(r)}
          >
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: r.color,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontWeight: 800, fontSize: 13.5 }}>{r.name}</span>
                </div>
                {r.slug === 'chairman' ? (
                  <Crown size={14} color="#d97706" />
                ) : !r.can_caller_edit ? (
                  <Lock size={13} color="#94a3b8" />
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
                رتبة {r.rank_level} • {r.permissions.length} صلاحية • {r.users_count} موظف
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Permission Matrix Editor */}
      {currentRole && (
        <div className="card-box">
          {!canEditSelectedRole && (
            <div
              style={{
                background: currentRole.slug === 'chairman' ? '#fffbeb' : '#f8fafc',
                border: `1px solid ${currentRole.slug === 'chairman' ? '#fde68a' : '#cbd5e1'}`,
                color: currentRole.slug === 'chairman' ? '#92400e' : '#475569',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {currentRole.slug === 'chairman' ? <Crown size={17} /> : <Lock size={16} />}
              <span>
                {currentRole.slug === 'pending_onboarding'
                  ? 'هذا الدور مخصص أمنياً للموظفين الجدد المؤكد بريدهم الإلكتروني بدون أي صلاحيات حتى يضمهم رئيس القسم.'
                  : currentRole.slug === 'chairman'
                  ? 'حماية سيادية: دور (رئيس مجلس الإدارة) هو الأعلى في النظام ومغلق ضد التعديل من أي رتبة أدنى.'
                  : `هذا الدور (${currentRole.name}) يماثل أو يعلو رتبتك الإدارية الحالية — يمكنك استعراض صلاحياته فقط.`}
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 14,
              paddingBottom: 16,
              marginBottom: 18,
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">اسم الدور الوظيفي</label>
                  <input
                    type="text"
                    className="form-input"
                    disabled={!canEditSelectedRole}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">لون شارة الدور</label>
                  <div style={{ display: 'flex', gap: 6, paddingTop: 6 }}>
                    {COLOR_SWATCHES.slice(0, 8).map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={!canEditSelectedRole}
                        onClick={() => setDraftColor(c)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: c,
                          border: draftColor === c ? '2.5px solid #0f172a' : 'none',
                          opacity: canEditSelectedRole ? 1 : 0.6,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="form-label">وصف الدور ومسؤولياته</label>
                <input
                  type="text"
                  className="form-input"
                  disabled={!canEditSelectedRole}
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                />
              </div>
            </div>

            {canEditSelectedRole && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={handleSaveRole}
                >
                  <Save size={16} />
                  {saving ? 'جاري الحفظ...' : `حفظ الصلاحيات في قاعدة البيانات (${draftPerms.size})`}
                </button>

                {!currentRole.is_protected && (
                  <button
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    onClick={handleDeleteRole}
                  >
                    <Trash2 size={14} />
                    حذف هذا الدور
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Categories & Permission Toggles */}
          {grouped.map((group) => {
            const enabledInCat = group.items.filter((i) => draftPerms.has(i.key)).length;
            return (
              <div key={group.category} className="perm-category-box">
                <div className="perm-category-header">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {group.label}{' '}
                    <span style={{ fontSize: 12, color: '#0a6fa8' }}>
                      ({enabledInCat}/{group.items.length})
                    </span>
                  </div>
                  {canEditSelectedRole && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleCategoryAll(group.items)}
                    >
                      {enabledInCat === group.items.length ? 'إلغاء تحديد القسم' : 'تحديد كل القسم'}
                    </button>
                  )}
                </div>

                <div className="perm-items-grid">
                  {group.items.map((perm) => {
                    const checked = draftPerms.has(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`perm-toggle-card ${checked ? 'checked' : ''}`}
                        style={!canEditSelectedRole ? { cursor: 'default', opacity: 0.85 } : undefined}
                      >
                        <input
                          type="checkbox"
                          disabled={!canEditSelectedRole}
                          checked={checked}
                          onChange={() => togglePerm(perm.key)}
                          style={{ marginTop: 4, width: 16, height: 16 }}
                        />
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 13.5, color: '#0f172a' }}>
                            {perm.name}
                          </div>
                          <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5, marginTop: 2 }}>
                            {perm.description}
                          </div>
                          <code
                            style={{
                              display: 'inline-block',
                              marginTop: 4,
                              fontSize: 10.5,
                              background: '#f1f5f9',
                              padding: '1px 6px',
                              borderRadius: 4,
                              color: '#334155',
                            }}
                          >
                            {perm.key}
                          </code>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create New Custom Role Modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>إنشاء دور وظيفي جديد</div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCreateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateRole}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">اسم الدور (مثلاً: مراجع شحنات تصدير / أخصائي تسجيل)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">الوصف</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">لون الشارة</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {COLOR_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewRoleColor(c)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          background: c,
                          border: newRoleColor === c ? '2.5px solid #000' : 'none',
                        }}
                      />
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
                <button type="submit" className="btn btn-primary">
                  إنشاء الدور
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================
   2. USERS & EMPLOYEES MANAGEMENT
   ========================================== */
function UsersManagementPanel({ currentUser, onRefreshMe, showToast }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const [uForm, setUForm] = useState({
    username: '',
    email: '',
    password: '',
    fullName: '',
    jobTitle: '',
    roleId: '',
    departmentId: '',
    avatarColor: '#0a6fa8',
  });

  async function loadAll() {
    try {
      const [uList, rData, dList] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/roles'),
        apiFetch('/api/admin/departments'),
      ]);
      setUsers(uList);
      setRoles(rData.roles);
      setDepartments(dList);
      if (!uForm.roleId && rData.roles.length > 0) {
        const staff =
          rData.roles.find((r) => r.slug === 'staff') ||
          rData.roles.find((r) => r.can_caller_edit) ||
          rData.roles[0];
        setUForm((p) => ({
          ...p,
          roleId: staff.id,
          departmentId: dList[0]?.id || '',
        }));
      }
    } catch (err) {
      showToast(err.message || 'تعذر تحميل بيانات الموظفين', 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const assignableRoles = roles.filter(
    (r) => r.slug !== 'pending_onboarding' && r.can_caller_edit
  );

  async function handleCreateUser(e) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: {
          ...uForm,
          roleId: Number(uForm.roleId),
          departmentId: uForm.departmentId ? Number(uForm.departmentId) : null,
        },
      });
      setCreateOpen(false);
      setUForm((p) => ({ ...p, username: '', email: '', password: '', fullName: '', jobTitle: '' }));
      await loadAll();
      showToast('تم إنشاء حساب الموظف وتسكينه بنجاح', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر إضافة الموظف', 'error');
    }
  }

  async function handleSaveEditUser(e) {
    e.preventDefault();
    try {
      await apiFetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: {
          fullName: editingUser.full_name,
          email: editingUser.email || '',
          jobTitle: editingUser.job_title,
          roleId: Number(editingUser.role_id),
          departmentId: editingUser.department_id ? Number(editingUser.department_id) : null,
          isActive: Boolean(editingUser.is_active),
          newPassword: editingUser.newPassword || '',
        },
      });
      setEditingUser(null);
      await loadAll();
      onRefreshMe();
      showToast('تم تحديث دور وقسم الموظف في قاعدة البيانات فوراً', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر التحديث', 'error');
    }
  }

  return (
    <div className="card-box">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
          موظفو الشركة وتوزيع الأدوار والأقسام ({users.length})
        </h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={15} />
          إضافة موظف جديد (اسم مستخدم وباسورد)
        </button>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>حساب الدخول</th>
              <th>طريقة التسجيل</th>
              <th>الدور الوظيفي</th>
              <th>القسم التابع له</th>
              <th>الحالة</th>
              <th>تعديل</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      className="avatar-circle"
                      style={{ width: 32, height: 32, background: u.avatar_color }}
                    >
                      {getInitials(u.full_name)}
                    </span>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {u.role_slug === 'chairman' && <Crown size={14} color="#d97706" />}
                        {u.full_name}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>{u.job_title}</div>
                    </div>
                  </div>
                </td>
                <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                  <div>@{u.username}</div>
                  {u.email && <div style={{ color: '#64748b', fontSize: 11 }}>{u.email}</div>}
                </td>
                <td>
                  {u.auth_provider === 'google' ? (
                    <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                      Google
                    </span>
                  ) : u.auth_provider === 'email' ? (
                    <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                      بريد مؤكد ✓
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                      حساب الشركة
                    </span>
                  )}
                </td>
                <td>
                  <span className="badge" style={{ background: u.role_color, color: '#fff' }}>
                    {u.role_name}
                  </span>
                </td>
                <td>
                  {u.onboarding_status === 'pending' ? (
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                      بانتظار ضم رئيس القسم
                      {u.preferred_department_name ? ` (${u.preferred_department_name})` : ''}
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#f1f5f9', color: '#0f172a' }}>
                      {u.department_name || 'الإدارة العليا (عام)'}
                    </span>
                  )}
                </td>
                <td>
                  {!u.is_active ? (
                    <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                      موقوف
                    </span>
                  ) : u.onboarding_status === 'pending' ? (
                    <span className="badge" style={{ background: '#ffedd5', color: '#c2410c' }}>
                      قيد التسكين
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                      نشط
                    </span>
                  )}
                </td>
                <td>
                  {u.can_caller_edit ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        setEditingUser({
                          ...u,
                          department_id: u.department_id || '',
                          newPassword: '',
                        })
                      }
                    >
                      <Edit3 size={13} />
                      تعديل الدور/القسم
                    </button>
                  ) : (
                    <span
                      className="badge"
                      style={{ background: '#fef3c7', color: '#92400e', fontSize: 11 }}
                    >
                      <Lock size={11} />
                      محمي سيادياً
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Employee Modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>إضافة حساب موظف جديد</div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCreateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">الاسم الكامل للموظف</label>
                  <input
                    type="text"
                    className="form-input"
                    value={uForm.fullName}
                    onChange={(e) => setUForm({ ...uForm, fullName: e.target.value })}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">اسم المستخدم (إنجليزي)</label>
                    <input
                      type="text"
                      className="form-input"
                      dir="ltr"
                      value={uForm.username}
                      onChange={(e) => setUForm({ ...uForm, username: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">كلمة المرور</label>
                    <input
                      type="password"
                      className="form-input"
                      dir="ltr"
                      value={uForm.password}
                      onChange={(e) => setUForm({ ...uForm, password: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">البريد الإلكتروني للإشعارات (Gmail — اختياري)</label>
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
                <div className="form-group">
                  <label className="form-label">المسمى الوظيفي</label>
                  <input
                    type="text"
                    className="form-input"
                    value={uForm.jobTitle}
                    onChange={(e) => setUForm({ ...uForm, jobTitle: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">الدور الوظيفي</label>
                    <select
                      className="form-select"
                      value={uForm.roleId}
                      onChange={(e) => setUForm({ ...uForm, roleId: e.target.value })}
                    >
                      {assignableRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">القسم التابع له</label>
                    <select
                      className="form-select"
                      value={uForm.departmentId}
                      onChange={(e) => setUForm({ ...uForm, departmentId: e.target.value })}
                    >
                      <option value="">الإدارة العليا (بدون قسم مقيد)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
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
                <button type="submit" className="btn btn-primary">
                  حفظ حساب الموظف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {editingUser && (
        <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                تعديل بيانات وصلاحيات: {editingUser.full_name}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingUser(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSaveEditUser}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">الاسم الكامل</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingUser.full_name}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, full_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">البريد الإلكتروني لاستقبال إشعارات Gmail</label>
                  <input
                    type="email"
                    className="form-input"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    placeholder="name@gmail.com"
                    value={editingUser.email || ''}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">المسمى الوظيفي</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingUser.job_title}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, job_title: e.target.value })
                    }
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">الدور الوظيفي</label>
                    <select
                      className="form-select"
                      disabled={editingUser.id === currentUser.id && editingUser.role_slug !== 'chairman'}
                      value={editingUser.role_id}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, role_id: Number(e.target.value) })
                      }
                    >
                      {roles
                        .filter(
                          (r) =>
                            r.id === editingUser.role_id ||
                            (r.slug !== 'pending_onboarding' && r.can_caller_edit)
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">القسم التابع له</label>
                    <select
                      className="form-select"
                      value={editingUser.department_id}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, department_id: e.target.value })
                      }
                    >
                      <option value="">الإدارة العليا (عام)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">تعيين كلمة مرور جديدة (اتركها فارغة لعدم التغيير)</label>
                  <input
                    type="password"
                    className="form-input"
                    dir="ltr"
                    placeholder="••••••••"
                    value={editingUser.newPassword}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, newPassword: e.target.value })
                    }
                  />
                </div>
                {editingUser.id !== currentUser.id && editingUser.role_slug !== 'chairman' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(editingUser.is_active)}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, is_active: e.target.checked })
                      }
                    />
                    الحساب مفعل ومسموح له بتسجيل الدخول
                  </label>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingUser(null)}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary">
                  حفظ التغييرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================
   3. DEPARTMENTS MANAGEMENT
   ========================================== */
function DepartmentsManagementPanel({ showToast }) {
  const [departments, setDepartments] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#0a6fa8');

  async function loadDepts() {
    try {
      const list = await apiFetch('/api/admin/departments');
      setDepartments(list);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  useEffect(() => {
    loadDepts();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/departments', {
        method: 'POST',
        body: { name, description, color },
      });
      setName('');
      setDescription('');
      await loadDepts();
      showToast('تم إنشاء القسم الجديد بنجاح', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر إنشاء القسم', 'error');
    }
  }

  async function handleDelete(dept) {
    if (!window.confirm(`حذف قسم "${dept.name}"؟`)) return;
    try {
      await apiFetch(`/api/admin/departments/${dept.id}`, { method: 'DELETE' });
      await loadDepts();
      showToast('تم حذف القسم', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر حذف القسم', 'error');
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 20 }}>
      <div className="card-box">
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>إضافة قسم جديد بالشركة</h3>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label className="form-label">اسم القسم</label>
            <input
              type="text"
              className="form-input"
              placeholder="مثال: قسم الرقابة والجودة"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">الوصف والاختصاص</label>
            <textarea
              className="form-textarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">اللون المميز للقسم</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: c,
                    border: color === c ? '2.5px solid #000' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            <Plus size={15} />
            إنشاء القسم
          </button>
        </form>
      </div>

      <div className="card-box">
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>
          أقسام مجموعة الهلب المسجلة ({departments.length})
        </h3>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>القسم</th>
                <th>الوصف</th>
                <th>عدد الموظفين</th>
                <th>عدد اللوحات</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="badge" style={{ background: d.color, color: '#fff' }}>
                      {d.name}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5, color: '#475569' }}>{d.description}</td>
                  <td style={{ fontWeight: 800 }}>{d.users_count}</td>
                  <td style={{ fontWeight: 800 }}>{d.boards_count}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger-soft btn-sm"
                      disabled={d.users_count > 0 || d.boards_count > 0}
                      title={
                        d.users_count > 0 || d.boards_count > 0
                          ? 'لا يمكن حذف قسم مرتبط بلوحات أو موظفين'
                          : 'حذف القسم'
                      }
                      onClick={() => handleDelete(d)}
                    >
                      <Trash2 size={13} />
                    </button>
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

/* ==========================================
   4. GMAIL NOTIFICATIONS INTEGRATION (ربط إشعارات الجميل)
   ========================================== */
function GmailSettingsPanel({ showToast }) {
  const [loading, setLoading] = useState(true);
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [appPasswordSaved, setAppPasswordSaved] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [senderName, setSenderName] = useState('منصة مجموعة الهلب — ELHELB GROUP');
  const [adminNotifyEmail, setAdminNotifyEmail] = useState('');
  const [emailLogs, setEmailLogs] = useState([]);

  const [saving, setSaving] = useState(false);
  const [testTarget, setTestTarget] = useState('');
  const [testing, setTesting] = useState(false);

  async function loadGmail() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/gmail-settings');
      setGmailUser(res.gmailUser || '');
      setAppPasswordSaved(Boolean(res.appPasswordSaved));
      setConfigured(Boolean(res.configured));
      setEnabled(Boolean(res.enabled));
      setSenderName(res.senderName || 'منصة مجموعة الهلب — ELHELB GROUP');
      setAdminNotifyEmail(res.adminNotifyEmail || '');
      setEmailLogs(Array.isArray(res.emailLogs) ? res.emailLogs : []);
      if (!testTarget && (res.adminNotifyEmail || res.gmailUser)) {
        setTestTarget(res.adminNotifyEmail || res.gmailUser);
      }
    } catch (err) {
      showToast(err.message || 'تعذر تحميل إعدادات Gmail', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGmail();
  }, []);

  async function handleSaveGmail(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/admin/gmail-settings', {
        method: 'PUT',
        body: {
          gmailUser,
          gmailAppPassword,
          senderName,
          adminNotifyEmail,
          enabled,
        },
      });
      setGmailAppPassword('');
      await loadGmail();
      showToast('تم حفظ إعدادات ربط Gmail في النظام بنجاح ✅', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر حفظ الإعدادات', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTestEmail() {
    setTesting(true);
    try {
      const res = await apiFetch('/api/admin/gmail-settings/test', {
        method: 'POST',
        body: { targetEmail: testTarget || adminNotifyEmail || gmailUser },
      });
      await loadGmail();
      showToast(`تم إرسال الرسالة التجريبية بنجاح إلى (${res.to})! تفقد صندوق الوارد في Gmail الآن.`, 'success');
    } catch (err) {
      await loadGmail();
      showToast(err.message || 'تعذر إرسال الرسالة التجريبية', 'error');
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="card-box" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
        جاري تحميل إعدادات إشعارات Gmail...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card-box">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17.5, fontWeight: 900, color: '#0b2545', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={20} color="#ea4335" />
            ربط حساب Gmail لإرسال الإشعارات الفورية تلقائياً
          </h3>
          <span
            className="badge"
            style={{
              background: configured && enabled ? '#dcfce7' : '#fef3c7',
              color: configured && enabled ? '#166534' : '#92400e',
              fontSize: 12,
            }}
          >
            {configured && enabled
              ? 'مربوط وجاهز للإرسال عبر Gmail ✅'
              : 'بانتظار إدخال بريد Gmail وكلمة مرور التطبيقات'}
          </span>
        </div>

        {/* 30-second Setup Guide */}
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 18,
            fontSize: 13,
            color: '#1e3a8a',
            lineHeight: 1.75,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 4 }}>
            طريقة الربط المجانية مع Gmail في 3 خطوات سريعة (بدون أي رسوم):
          </div>
          <div>
            1. افتح صفحة كلمات مرور التطبيقات في حساب جوجل الخاص بك:{' '}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              style={{ fontWeight: 800, color: '#0a6fa8', textDecoration: 'underline' }}
            >
              https://myaccount.google.com/apppasswords
            </a>
          </div>
          <div>
            2. اكتب اسم التطبيق <strong>ELHELB</strong> واضغط إنشاء، فسيعطيك جوجل كوداً مكوناً من{' '}
            <strong>16 حرفاً</strong>.
          </div>
          <div>
            3. الصق إيميلك الـ Gmail والكود المكون من 16 حرفاً بالأسفل واضغط <strong>حفظ</strong> ثم جرب زر{' '}
            <strong>إرسال رسالة تجريبية</strong>!
          </div>
        </div>

        <form onSubmit={handleSaveGmail}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">إيميل Gmail المرسل (الذي سيرسل منه الموقع) *</label>
              <input
                type="email"
                className="form-input"
                dir="ltr"
                style={{ textAlign: 'left' }}
                placeholder="company.elhelb@gmail.com"
                value={gmailUser}
                onChange={(e) => setGmailUser(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                كلمة مرور التطبيق من جوجل (App Password — 16 حرفاً){' '}
                {appPasswordSaved ? '(محفوظة مسبقاً ✅)' : '*'}
              </label>
              <input
                type="password"
                className="form-input"
                dir="ltr"
                style={{ textAlign: 'left' }}
                placeholder={appPasswordSaved ? '•••••••••••••••• (اتركها فارغة للإبقاء عليها)' : 'xxxx xxxx xxxx xxxx'}
                value={gmailAppPassword}
                onChange={(e) => setGmailAppPassword(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">اسم المرسل الذي يظهر في رسائل Gmail</label>
              <input
                type="text"
                className="form-input"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                إيميل الإدارة / رئيس مجلس الإدارة لاستلام نسخة من كل الإشعارات (اختياري)
              </label>
              <input
                type="email"
                className="form-input"
                dir="ltr"
                style={{ textAlign: 'left' }}
                placeholder="chairman@gmail.com"
                value={adminNotifyEmail}
                onChange={(e) => setAdminNotifyEmail(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 8,
              paddingTop: 14,
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              تفعيل إرسال الإشعارات تلقائياً (انضمام الموظفين، اعتماد الأقسام، طلبات الصلاحيات، والمهام)
            </label>

            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save size={16} />
              {saving ? 'جاري الحفظ...' : 'حفظ إعدادات Gmail'}
            </button>
          </div>
        </form>

        {/* Live Test Sender */}
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#0b2545' }}>
              فحص الإرسال الفوري إلى بريدك الآن:
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              اكتب أي إيميل Gmail واضغط إرسال للتأكد من وصول الإشعارات لصندوق الوارد فوراً.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              className="form-input"
              dir="ltr"
              style={{ width: 250, textAlign: 'left' }}
              placeholder="your.email@gmail.com"
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: '#059669', borderColor: '#059669' }}
              disabled={testing}
              onClick={handleSendTestEmail}
            >
              <Send size={15} />
              {testing ? 'جاري الإرسال...' : 'إرسال رسالة تجريبية الآن'}
            </button>
          </div>
        </div>
      </div>

      {/* Email Logs Table */}
      <div className="card-box">
        <h3 style={{ margin: '0 0 12px', fontSize: 15.5, fontWeight: 800, color: '#0b2545' }}>
          سجل رسائل وإشعارات البريد الإلكتروني الأخيرة ({emailLogs.length})
        </h3>
        {emailLogs.length === 0 ? (
          <div style={{ padding: 22, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            لا توجد رسائل مسجلة بعد.
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الحالة</th>
                  <th>المستلم</th>
                  <th>عنوان الإشعار</th>
                  <th>ملاحظات</th>
                  <th>التوقيت</th>
                </tr>
              </thead>
              <tbody>
                {emailLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      {log.status === 'SENT' ? (
                        <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                          تم الإرسال ✅
                        </span>
                      ) : log.status === 'SKIPPED_NOT_CONFIGURED' ? (
                        <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                          بانتظار ربط Gmail
                        </span>
                      ) : (
                        <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                          خطأ إرسال
                        </span>
                      )}
                    </td>
                    <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {log.to_email}
                    </td>
                    <td style={{ fontWeight: 700, fontSize: 13 }}>{log.subject}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{log.error_message || 'تم التوصيل بنجاح'}</td>
                    <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {formatSqliteDate(log.created_at)}
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

/* ==========================================
   5. GOOGLE OAUTH 2.0 SETTINGS (للـ IT والإدارة)
   ========================================== */
function OAuthSettingsPanel({ showToast }) {
  const [settings, setSettings] = useState(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    try {
      const res = await apiFetch('/api/admin/oauth-settings');
      setSettings(res);
      setGoogleClientId(res.googleClientId || '');
    } catch (err) {
      showToast(err.message || 'تعذر تحميل إعدادات الربط', 'error');
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/admin/oauth-settings', {
        method: 'PUT',
        body: {
          googleClientId,
          googleClientSecret,
        },
      });
      setGoogleClientSecret('');
      await loadSettings();
      showToast('تم حفظ مفاتيح الربط مع Google OAuth بنجاح', 'success');
    } catch (err) {
      showToast(err.message || 'تعذر الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  }

  function copyText(txt) {
    if (!txt) return;
    navigator.clipboard?.writeText(txt);
    showToast('تم نسخ رابط Callback بنجاح', 'info');
  }

  if (!settings) {
    return (
      <div className="card-box" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
        جاري تحميل إعدادات Google OAuth...
      </div>
    );
  }

  return (
    <div className="card-box">
      <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 900, color: '#071e14' }}>
        إعدادات الربط الاختياري مع Google OAuth 2.0 (لقسم الـ IT)
      </h3>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
        يتم تأكيد البريد الإلكتروني للموظفين الجدد عبر <strong>كود تحقق من 6 أرقام</strong> يُرسل إلى البريد الإلكتروني عبر تبويب (إشعارات البريد Gmail). ويمكن لقسم الـ IT اختيارياً تفعيل زر الدخول المباشر عبر Google Cloud OAuth من هنا:
      </p>

      <form onSubmit={handleSave}>
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            maxWidth: 640,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 900, fontSize: 15 }}>Google OAuth 2.0</span>
            <span
              className="badge"
              style={{
                background: settings.googleConfigured ? '#dcfce7' : '#f1f5f9',
                color: settings.googleConfigured ? '#166534' : '#475569',
              }}
            >
              {settings.googleConfigured ? 'مربوط ومفعل ✅' : 'غير مفعل (يُستخدم كود تأكيد البريد)'}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">رابط Authorized Redirect URI</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="form-input"
                dir="ltr"
                readOnly
                value={settings.googleCallbackUrl}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => copyText(settings.googleCallbackUrl)}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Google Client ID</label>
            <input
              type="text"
              className="form-input"
              dir="ltr"
              placeholder="xxxx.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">
              Google Client Secret {settings.googleSecretSaved ? '(محفوظ مسبقاً ✅)' : ''}
            </label>
            <input
              type="password"
              className="form-input"
              dir="ltr"
              placeholder={settings.googleSecretSaved ? '••••••••••••' : 'GOCSPX-...'}
              value={googleClientSecret}
              onChange={(e) => setGoogleClientSecret(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={16} />
            {saving ? 'جاري الحفظ...' : 'حفظ إعدادات Google OAuth'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ==========================================
   5. SECURITY AUDIT LOGS
   ========================================== */
function AuditLogsPanel({ showToast }) {
  const [logs, setLogs] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [q, setQ] = useState('');

  async function loadLogs() {
    try {
      const list = await apiFetch(
        `/api/admin/audit-logs?status=${statusFilter}&q=${encodeURIComponent(q)}`
      );
      setLogs(list);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  useEffect(() => {
    const t = setTimeout(loadLogs, 180);
    return () => clearTimeout(t);
  }, [statusFilter, q]);

  return (
    <div className="card-box">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
          سجل المراقبة الأمنية ومحاولات الوصول ({logs.length})
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            style={{ width: 220, padding: '6px 10px', fontSize: 13 }}
            placeholder="بحث باسم الموظف أو العملية..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('ALL')}
          >
            الكل
          </button>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'DENIED' ? 'btn-danger' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('DENIED')}
          >
            محاولات مرفوضة أمنياً (403)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'ALLOWED' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('ALLOWED')}
          >
            عمليات مصرح بها
          </button>
        </div>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>الحالة</th>
              <th>المستخدم والدور</th>
              <th>العملية</th>
              <th>الصلاحية الفاعلة</th>
              <th>المسار البرمجي</th>
              <th>التفاصيل</th>
              <th>التوقيت</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                style={{ background: log.status === 'DENIED' ? '#fff1f2' : 'transparent' }}
              >
                <td>
                  {log.status === 'ALLOWED' ? (
                    <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                      <CheckCircle2 size={12} />
                      مسموح
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                      <XCircle size={12} />
                      مرفوض 403
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ fontWeight: 800 }}>{log.actor_name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                    {log.actor_role} {log.department_name ? `• ${log.department_name}` : ''}
                  </div>
                </td>
                <td style={{ fontWeight: 700 }}>{log.action}</td>
                <td>
                  {log.permission_key ? (
                    <code style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                      {log.permission_key}
                    </code>
                  ) : (
                    '—'
                  )}
                </td>
                <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11.5 }}>
                  {log.method} {log.endpoint}
                </td>
                <td style={{ fontSize: 12.5, color: '#334155' }}>{log.details}</td>
                <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                  {formatSqliteDate(log.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
