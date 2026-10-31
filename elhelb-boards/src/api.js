const TOKEN_KEY = 'elhelb_auth_token_v10';
const LEGACY_TOKEN_KEYS = ['elhelb_jwt_token', 'elhelb_token', 'elhelb_auth_token_v10'];

// Immediately purge any legacy or persistent localStorage keys on module load
(function purgeLegacyTokens() {
  if (typeof window === 'undefined') return;
  try {
    delete window.__ELHELB_TOKEN_V10__;
  } catch (_) {}
  for (const oldKey of LEGACY_TOKEN_KEYS) {
    if (oldKey !== TOKEN_KEY) {
      try {
        sessionStorage.removeItem(oldKey);
      } catch (_) {}
    }
    try {
      localStorage.removeItem(oldKey);
    } catch (_) {}
  }
})();

// Module-private closure token (never exposed on global window or persistent localStorage)
let memoryToken = '';

let permissionDeniedHandler = null;
let sessionExpiredHandler = null;

export function setApiHandlers({ onPermissionDenied, onSessionExpired }) {
  permissionDeniedHandler = onPermissionDenied;
  sessionExpiredHandler = onSessionExpired;
}

export function getStoredToken() {
  if (memoryToken) return memoryToken;
  try {
    const s = sessionStorage.getItem(TOKEN_KEY);
    if (s) {
      memoryToken = s;
      return s;
    }
  } catch (_) {}
  return '';
}

export function setStoredToken(token) {
  memoryToken = token || '';
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

const PUBLIC_NO_TOKEN_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/oauth/providers',
]);

export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    suppressPermissionModal = false,
  } = options;

  const headers = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getStoredToken();
  if (token && !PUBLIC_NO_TOKEN_PATHS.has(path)) {
    headers['X-Elhelb-Token'] = token;
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));

  if (
    res.status === 401 &&
    !PUBLIC_NO_TOKEN_PATHS.has(path)
  ) {
    setStoredToken('');
    if (sessionExpiredHandler) sessionExpiredHandler();
    const err = new Error(payload.error || 'انتهت الجلسة');
    err.status = 401;
    err.code = payload && payload.code;
    err.payload = payload;
    throw err;
  }

  if (res.status === 403) {
    if (
      !suppressPermissionModal &&
      payload &&
      payload.code === 'PERMISSION_DENIED' &&
      payload.canRequestElevation &&
      permissionDeniedHandler
    ) {
      permissionDeniedHandler(payload);
    }
    const err = new Error(payload.error || 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
    err.status = 403;
    err.code = payload && payload.code;
    err.payload = payload;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(payload.error || 'حدث خطأ أثناء تنفيذ الطلب');
    err.status = res.status;
    err.code = payload && payload.code;
    err.payload = payload;
    throw err;
  }

  return payload;
}
