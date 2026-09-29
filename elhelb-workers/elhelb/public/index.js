const $ = id => document.getElementById(id);
const msg = (t, c) => { $('msg').textContent = t; $('msg').className = 'm ' + (c || ''); };
// تصغير الصور قبل الرفع (بيحوّل كمان HEIC وغيره لـ JPG)
const shrink = f => new Promise(res => {
  if (!f.type.startsWith('image/')) return res(f);
  createImageBitmap(f).then(b => {
    const s = Math.min(1, 1600 / Math.max(b.width, b.height)), c = document.createElement('canvas');
    c.width = Math.round(b.width * s); c.height = Math.round(b.height * s);
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    c.toBlob(bl => res(bl ? new File([bl], 'photo.jpg', { type: 'image/jpeg' }) : f), 'image/jpeg', .85);
  }).catch(() => res(f));
});
$('s').onclick = async () => {
  const name = $('n').value.trim(), phone = $('p').value.trim(), f = $('f').files[0], b = $('b').files[0], ds = [...$('d').files];
  if (!name || !phone || !f || !b || !ds.length) return msg('من فضلك املأ كل الحقول وارفع كل الملفات', 'er');
  if (!/^[0-9+\s-]{8,15}$/.test(phone)) return msg('رقم التليفون غير صحيح', 'er');
  $('s').disabled = true; msg('جاري الرفع...');
  try {
    const fd = new FormData();
    fd.append('name', name); fd.append('phone', phone);
    fd.append('front', await shrink(f)); fd.append('back', await shrink(b));
    for (const d of ds) fd.append('docs', await shrink(d));
    const r = await fetch('/api/register', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'حصل خطأ');
    msg('تم حفظ البيانات بنجاح ✅', 'ok');
    ['n', 'p', 'f', 'b', 'd'].forEach(i => $(i).value = '');
  } catch (e) { msg(e.message || 'حصل خطأ، حاول تاني', 'er'); }
  $('s').disabled = false;
};
