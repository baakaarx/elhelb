import {
  runStandaloneClientTurn,
  getLocalHistoryResponse,
  clearLocalHistory,
} from './offlineStaticBrain';

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
    // ignore storage errors
  }
  return next;
}

const isStaticGithubPages =
  typeof window !== 'undefined' && /\.github\.io$/i.test(window.location.hostname);

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, formData, headers = {} } = options;

  // في حالة الاستضافة الساكنة المباشرة على GitHub Pages نستخدم المحرك المدمج فوراً بدون تأخير
  if (isStaticGithubPages) {
    return handleStaticClientFallback(path, method, body, formData);
  }

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

  try {
    const res = await fetch(path, fetchOptions);
    const contentType = res.headers.get('content-type') || '';

    // إذا تم فتح الواجهة على استضافة ملفات ثابتة لا تحتوي على سيرفر Node
    if ((res.status === 404 || res.status === 405) && !contentType.includes('application/json')) {
      return handleStaticClientFallback(path, method, body, formData);
    }

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
  } catch (err) {
    if (err instanceof TypeError) {
      return handleStaticClientFallback(path, method, body, formData);
    }
    throw err;
  }
}

async function handleStaticClientFallback(path, method, body, formData) {
  if (path.startsWith('/api/chat/history')) {
    const qIndex = path.indexOf('?');
    const params = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : '');
    const sid = params.get('sessionId') || getVisitorSessionId();
    if (method === 'DELETE') {
      clearLocalHistory(sid);
      return { ok: true };
    }
    return getLocalHistoryResponse(sid);
  }

  if (path.startsWith('/api/chat/ask')) {
    if (formData) {
      return runStandaloneClientTurn({
        sessionId: String(formData.get('sessionId') || getVisitorSessionId()),
        message: String(formData.get('message') || ''),
        imageFile: formData.get('image') || null,
      });
    }
    return runStandaloneClientTurn({
      sessionId: body?.sessionId || getVisitorSessionId(),
      message: body?.message || '',
      imageBase64: body?.imageBase64 || null,
    });
  }

  return { ok: true };
}
