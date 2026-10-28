const SESSION_STORAGE_KEY = 'elhelb_public_session_v1';

function generateRandomSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'vis_' + crypto.randomUUID().replace(/-/g, '');
  }
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return (
    'vis_' +
    Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function getVisitorSessionId() {
  try {
    let sid = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid || !/^[a-zA-Z0-9_-]{16,80}$/.test(sid)) {
      sid = generateRandomSessionId();
      localStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
    return sid;
  } catch {
    return generateRandomSessionId();
  }
}

export function resetVisitorSessionId() {
  const next = generateRandomSessionId();
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, next);
  } catch {
    // ignore storage errors in private mode
  }
  return next;
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, formData, headers = {} } = options;
  const fetchOptions = {
    method,
    headers: {
      ...headers,
    },
  };

  if (formData) {
    fetchOptions.body = formData;
  } else if (body !== undefined) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(path, fetchOptions);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' && data?.error
        ? typeof data.error === 'string'
          ? data.error
          : data.error.message
        : `حدث خطأ في الاتصال (HTTP ${res.status})`;
    throw new Error(errMsg);
  }

  return data;
}
