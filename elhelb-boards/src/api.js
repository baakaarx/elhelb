const TOKEN_KEY = 'elhelb_jwt_token';

// Primary in-memory token guarantees authentication works 100% even inside
// strict cross-origin sandboxed iframes where localStorage / 3rd-party cookies are blocked!
let memoryToken = '';

let permissionDeniedHandler = null;
let sessionExpiredHandler = null;

export function setApiHandlers({ onPermissionDenied, onSessionExpired }) {
  permissionDeniedHandler = onPermissionDenied;
  sessionExpiredHandler = onSessionExpired;
}

export function getStoredToken() {
  if (memoryToken) return memoryToken;
  if (typeof window !== 'undefined' && window.__ELHELB_TOKEN__) {
    memoryToken = window.__ELHELB_TOKEN__;
    return memoryToken;
  }
  try {
    const s = sessionStorage.getItem(TOKEN_KEY);
    if (s) {
      memoryToken = s;
      return s;
    }
  } catch (_) {}
  try {
    const l = localStorage.getItem(TOKEN_KEY);
    if (l) {
      memoryToken = l;
      return l;
    }
  } catch (_) {}
  return '';
}

export function setStoredToken(token) {
  memoryToken = token || '';
  if (typeof window !== 'undefined') {
    window.__ELHELB_TOKEN__ = memoryToken;
  }
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

function attachTokenToUrl(path, token) {
  if (!token || path === '/api/auth/login') return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}_t=${encodeURIComponent(token)}`;
}

export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    suppressPermissionModal = false,
  } = options;

  const headers = {
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getStoredToken();
  if (token) {
    headers['X-Elhelb-Token'] = token;
    headers.Authorization = `Bearer ${token}`;
  }

  const finalUrl = attachTokenToUrl(path, token);

  const res = await fetch(finalUrl, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));

  if (res.status === 401 && path !== '/api/auth/login') {
    setStoredToken('');
    if (sessionExpiredHandler) sessionExpiredHandler();
    const err = new Error(payload.error || 'انتهت الجلسة');
    err.status = 401;
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
    err.payload = payload;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(payload.error || 'حدث خطأ أثناء تنفيذ الطلب');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

// Raw API tester that never triggers modals — returns raw status & JSON for live server security verification
export async function rawServerProbe(method, path, body = undefined) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getStoredToken();
  if (token) {
    headers['X-Elhelb-Token'] = token;
    headers.Authorization = `Bearer ${token}`;
  }

  const finalUrl = attachTokenToUrl(path, token);

  const started = performance.now();
  const res = await fetch(finalUrl, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const elapsedMs = Math.round(performance.now() - started);
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    elapsedMs,
    method,
    path,
    response: json,
  };
}
