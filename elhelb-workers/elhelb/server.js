const express = require('express'), multer = require('multer'), { Pool } = require('pg'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser'),
  helmet = require('helmet'), rateLimit = require('express-rate-limit'), sizeOf = require('image-size'),
  path = require('path');
const { Document, Packer, Paragraph, TextRun, ImageRun, PageBreak } = require('docx');
const { DATABASE_URL, JWT_SECRET, HR_USER, HR_PASSWORD, NODE_ENV, PORT = 3000 } = process.env;
if (!DATABASE_URL || !JWT_SECRET) { console.error('DATABASE_URL and JWT_SECRET are required'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
const A = f => (q, r, n) => f(q, r, n).catch(n);
const log = (actor, event, q) => pool.query('insert into logs(actor,event,ip) values($1,$2,$3)', [actor, event, q ? q.ip : null]).catch(() => {});

app.get('/health', (q, r) => r.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/hr', (q, r) => r.sendFile(path.join(__dirname, 'public', 'hr.html')));

// نوع الملف من محتواه الفعلي (JPG / PNG / PDF فقط)
const kind = b => (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ? 'image/jpeg'
  : (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) ? 'image/png'
  : (b.slice(0, 4).toString() === '%PDF') ? 'application/pdf' : null;

const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 12 } })
  .fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }, { name: 'docs', maxCount: 10 }]);

// ---- تسجيل عامل (مفتوح لأي حد معاه اللينك) ----
app.post('/api/register', rateLimit({ windowMs: 3600e3, max: 60, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  up(req, res, async err => {
    if (err) return res.status(400).json({ error: 'حجم الملف كبير أو عدد الملفات زايد (الحد 8 ميجا للملف)' });
    try {
      const name = (req.body.name || '').trim(), phone = (req.body.phone || '').trim(), f = req.files || {};
      if (name.length < 2 || name.length > 100 || !/^[0-9+\s-]{8,15}$/.test(phone) || !f.front || !f.back || !(f.docs && f.docs.length))
        return res.status(400).json({ error: 'البيانات ناقصة أو غير صحيحة' });
      const items = [['front', f.front[0]], ['back', f.back[0]], ...f.docs.map(d => ['doc', d])];
      for (const it of items) { it.push(kind(it[1].buffer)); if (!it[2]) return res.status(400).json({ error: 'مسموح بصور JPG/PNG أو PDF فقط' }); }
      const c = await pool.connect();
      try {
        await c.query('begin');
        const w = await c.query('insert into workers(name,phone,ip) values($1,$2,$3) returning id', [name, phone, req.ip]);
        for (const [k, file, mime] of items)
          await c.query('insert into files(worker_id,kind,filename,mime,data) values($1,$2,$3,$4,$5)', [w.rows[0].id, k, (file.originalname || '').slice(0, 120), mime, file.buffer]);
        await c.query('commit');
      } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
      log('public', 'تسجيل عامل جديد', req);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'حصل خطأ في الحفظ، حاول تاني' }); }
  });
});

// ---- دخول الموارد البشرية ----
app.post('/api/login', rateLimit({ windowMs: 900e3, max: 10, standardHeaders: true, legacyHeaders: false }), A(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const r = await pool.query('select * from hr_users where username=$1', [String(username)]);
  const ok = r.rows[0] && await bcrypt.compare(String(password), r.rows[0].pass_hash);
  if (!ok) { log(String(username).slice(0, 50), 'محاولة دخول فاشلة', req); return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' }); }
  res.cookie('hr', jwt.sign({ u: r.rows[0].username }, JWT_SECRET, { expiresIn: '8h' }),
    { httpOnly: true, sameSite: 'strict', secure: NODE_ENV === 'production', maxAge: 8 * 3600e3 });
  log(r.rows[0].username, 'تسجيل دخول', req);
  res.json({ ok: true });
}));
const auth = (q, r, n) => { try { q.hr = jwt.verify(q.cookies.hr, JWT_SECRET).u; n(); } catch (e) { r.status(401).json({ error: 'unauthorized' }); } };
app.get('/api/me', auth, (q, r) => r.json({ user: q.hr }));
app.post('/api/logout', (q, r) => { r.clearCookie('hr'); r.json({ ok: true }); });

// ---- بيانات الـ HR فقط ----
app.get('/api/workers', auth, A(async (q, r) => {
  const x = await pool.query(`select w.id,w.name,w.phone,w.created_at,
    (select json_agg(json_build_object('id',f.id,'kind',f.kind,'mime',f.mime) order by f.id) from files f where f.worker_id=w.id) files
    from workers w order by w.id desc`);
  r.json(x.rows);
}));
app.get('/api/file/:id(\\d+)', auth, A(async (q, r) => {
  const x = await pool.query('select mime,data from files where id=$1', [q.params.id]);
  if (!x.rows[0]) return r.sendStatus(404);
  r.set({ 'Content-Type': x.rows[0].mime, 'Cache-Control': 'private, no-store' }).send(x.rows[0].data);
}));
app.get('/api/logs', auth, A(async (q, r) => r.json((await pool.query('select at,actor,event from logs order by id desc limit 100')).rows)));

const rtl = (t, o = {}) => new Paragraph({ bidirectional: true, children: [new TextRun({ text: t, rightToLeft: true, ...o })] });
app.get('/api/export.docx', auth, A(async (q, r) => {
  const ws = (await pool.query('select id,name,phone from workers order by id desc')).rows, ch = [];
  const lab = { front: 'صورة البطاقة - الوش', back: 'صورة البطاقة - الظهر', doc: 'مسوغات التعيين' };
  for (const w of ws) {
    ch.push(rtl(w.name, { bold: true, size: 36 }), rtl('رقم التليفون: ' + w.phone, { size: 26 }));
    for (const f of (await pool.query('select kind,mime,data from files where worker_id=$1 order by id', [w.id])).rows) {
      ch.push(rtl(lab[f.kind], { bold: true, size: 24 }));
      if (f.mime === 'application/pdf') { ch.push(rtl('(ملف PDF - غير مضمّن في هذا الملف)')); continue; }
      const d = sizeOf(f.data), max = f.kind === 'doc' ? 520 : 260;
      let wd = Math.min(400, d.width), ht = wd * d.height / d.width;
      if (ht > max) { wd = wd * max / ht; ht = max; }
      ch.push(new Paragraph({ children: [new ImageRun({ type: f.mime === 'image/png' ? 'png' : 'jpg', data: f.data, transformation: { width: Math.round(wd), height: Math.round(ht) } })] }));
    }
    ch.push(new Paragraph({ children: [new PageBreak()] }));
  }
  if (!ch.length) ch.push(rtl('لا توجد بيانات'));
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: ch }] }));
  log(q.hr, 'تنزيل ملف Word', q);
  r.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="workers-data.docx"' }).send(buf);
}));

app.use((e, q, r, n) => { console.error(e); r.status(500).json({ error: 'server error' }); });

(async () => {
  await pool.query(`
    create table if not exists workers(id serial primary key, name text not null, phone text not null, ip text, created_at timestamptz default now());
    create table if not exists files(id serial primary key, worker_id int references workers(id) on delete cascade, kind text not null, filename text, mime text not null, data bytea not null);
    create table if not exists logs(id serial primary key, at timestamptz default now(), actor text, event text, ip text);
    create table if not exists hr_users(username text primary key, pass_hash text not null);`);
  if (HR_USER && HR_PASSWORD)
    await pool.query('insert into hr_users(username,pass_hash) values($1,$2) on conflict(username) do update set pass_hash=excluded.pass_hash', [HR_USER, await bcrypt.hash(HR_PASSWORD, 12)]);
  else console.warn('HR_USER / HR_PASSWORD not set: no HR account will exist');
  app.listen(PORT, () => console.log('listening on ' + PORT));
})().catch(e => { console.error(e); process.exit(1); });
