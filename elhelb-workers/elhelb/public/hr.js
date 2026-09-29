const $ = id => document.getElementById(id);
const el = (t, x, c) => { const e = document.createElement(t); if (x) e.textContent = x; if (c) e.className = c; return e; };
const fmt = d => new Date(d).toLocaleString('ar-EG');
const L = { front: 'البطاقة (وش)', back: 'البطاقة (ظهر)', doc: 'مستند' };
async function load() {
  const [w, l] = await Promise.all([fetch('/api/workers'), fetch('/api/logs')]);
  if (w.status === 401) { $('panel').hidden = true; $('login').hidden = false; return; }
  $('login').hidden = true; $('panel').hidden = false;
  const ls = $('ls'); ls.textContent = '';
  for (const x of await w.json()) {
    const r = el('div', '', 'r'); r.appendChild(el('div', x.name + ' — ' + x.phone + ' — ' + fmt(x.created_at)));
    for (const f of x.files || []) {
      const a = el('a'); a.href = '/api/file/' + f.id; a.target = '_blank'; a.rel = 'noopener'; a.title = L[f.kind];
      if (f.mime === 'application/pdf') { a.textContent = '📄 PDF ' + L[f.kind] + ' '; } else { const i = el('img', '', 'th'); i.src = a.href; i.alt = L[f.kind]; a.appendChild(i); }
      r.appendChild(a);
    }
    ls.appendChild(r);
  }
  const lg = $('lg'); lg.textContent = '';
  for (const x of await l.json()) lg.appendChild(el('div', fmt(x.at) + ' — ' + x.actor + ' — ' + x.event, 'r'));
}
$('in').onclick = async () => {
  $('lm').textContent = '';
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value.trim(), password: $('pw').value }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); $('lm').textContent = r.status === 429 ? 'محاولات كتير. استنى شوية وحاول تاني.' : (j.error || 'حصل خطأ'); return; }
  $('pw').value = ''; load();
};
$('pw').onkeydown = e => { if (e.key === 'Enter') $('in').click(); };
$('out').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
load();
