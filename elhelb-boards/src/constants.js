export const BOARD_THEMES = {
  ocean: {
    id: 'ocean',
    label: 'أزرق بحري (الهلب)',
    gradient: 'linear-gradient(135deg, #072a47 0%, #0a6fa8 55%, #0284c7 100%)',
    boardBg: 'linear-gradient(160deg, #07223b 0%, #0b4a75 50%, #0f6396 100%)',
  },
  gold: {
    id: 'gold',
    label: 'ذهبي ملكي',
    gradient: 'linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)',
    boardBg: 'linear-gradient(160deg, #451a03 0%, #78350f 55%, #92400e 100%)',
  },
  purple: {
    id: 'purple',
    label: 'بنفسجي إبداعي',
    gradient: 'linear-gradient(135deg, #3b0764 0%, #6d28d9 55%, #9333ea 100%)',
    boardBg: 'linear-gradient(160deg, #2e1065 0%, #4c1d95 55%, #6d28d9 100%)',
  },
  emerald: {
    id: 'emerald',
    label: 'أخضر زمردي',
    gradient: 'linear-gradient(135deg, #064e3b 0%, #047857 55%, #059669 100%)',
    boardBg: 'linear-gradient(160deg, #022c22 0%, #065f46 55%, #047857 100%)',
  },
  crimson: {
    id: 'crimson',
    label: 'ياقوتي داكن',
    gradient: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 55%, #e11d48 100%)',
    boardBg: 'linear-gradient(160deg, #450a0a 0%, #881337 55%, #9f1239 100%)',
  },
  royal: {
    id: 'royal',
    label: 'نيلي تنفيذي',
    gradient: 'linear-gradient(135deg, #1e1b4b 0%, #3730a3 55%, #4f46e5 100%)',
    boardBg: 'linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #3730a3 100%)',
  },
  slate: {
    id: 'slate',
    label: 'رمادي مؤسسي',
    gradient: 'linear-gradient(135deg, #0f172a 0%, #334155 60%, #475569 100%)',
    boardBg: 'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
  },
  sunset: {
    id: 'sunset',
    label: 'غروب متوسطي',
    gradient: 'linear-gradient(135deg, #0f4c81 0%, #7c2d12 55%, #c2410c 100%)',
    boardBg: 'linear-gradient(160deg, #0c4a6e 0%, #431407 60%, #7c2d12 100%)',
  },
};

export const PRIORITY_CONFIG = {
  low: { label: 'منخفضة', color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1' },
  medium: { label: 'متوسطة', color: '#0284c7', bg: '#e0f2fe', border: '#7dd3fc' },
  high: { label: 'مرتفعة', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' },
  urgent: { label: 'عاجل جداً', color: '#dc2626', bg: '#fee2e2', border: '#fca5a5' },
};

export const DURATION_NAMES = {
  once: 'تنفيذ لمرة واحدة فقط',
  '1h': 'ساعة واحدة',
  '8h': '8 ساعات (يوم عمل)',
  '24h': '24 ساعة (يوم كامل)',
  '7d': '7 أيام (أسبوع)',
};

export const COLOR_SWATCHES = [
  '#0a6fa8',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#d97706',
  '#059669',
  '#0d9488',
  '#475569',
];

export function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'م';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

export function formatSqliteDate(dtStr) {
  if (!dtStr) return '';
  const iso = dtStr.includes('T') ? dtStr : `${dtStr.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dtStr;
  return d.toLocaleString('ar-EG', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRemainingTime(expiresAtStr, usesRemaining) {
  if (usesRemaining === 1) {
    return 'صالح لعملية واحدة فقط';
  }
  if (!expiresAtStr) return 'نشط';
  const iso = expiresAtStr.includes('T') ? expiresAtStr : `${expiresAtStr.replace(' ', 'T')}Z`;
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'منتهي';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `متبقي ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `متبقي ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `متبقي ${days} يوم`;
}

export function getDueDateStatus(dueDateStr, isCompleted) {
  if (!dueDateStr) return null;
  if (isCompleted) return { state: 'done', label: dueDateStr, color: '#059669', bg: '#dcfce7' };
  const today = new Date().toISOString().slice(0, 10);
  if (dueDateStr < today) {
    return { state: 'overdue', label: `متأخر (${dueDateStr})`, color: '#dc2626', bg: '#fee2e2' };
  }
  const diffDays = Math.ceil(
    (new Date(`${dueDateStr}T23:59:59`).getTime() - Date.now()) / (86400 * 1000)
  );
  if (diffDays <= 3) {
    return { state: 'soon', label: `قريباً (${dueDateStr})`, color: '#b45309', bg: '#fef3c7' };
  }
  return { state: 'normal', label: dueDateStr, color: '#475569', bg: '#f1f5f9' };
}
