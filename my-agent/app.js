/* ============================================================
   app.js — الواجهة 🎨
   ------------------------------------------------------------
   الملف ده مسؤول عن الشاشة بس: عرض الرسايل، الذاكرة، الإعدادات.
   كل "ذكاء" الايجنت موجود في agent.js — افصل دايماً المنطق عن العرض.
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- عرض رسالة في الشات ---------- */
function addBubble(text, who) {
  const d = document.createElement('div');
  d.className = 'bubble ' + who;
  d.textContent = text;
  $('msgs').appendChild(d);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  return d;
}

/* ---------- عرض الذاكرة في اللوحة الجانبية ---------- */
function renderMemories() {
  const ul = $('memList');
  ul.textContent = '';
  const mems = memory.list();
  if (!mems.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'فاضية — قوله حاجة عن نفسك!';
    ul.appendChild(li);
    return;
  }
  mems.forEach((m, i) => {
    const li = document.createElement('li');
    li.textContent = m + ' ';
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'انسى المعلومة دي';
    x.onclick = () => { memory.remove(i); renderMemories(); };
    li.appendChild(x);
    ul.appendChild(li);
  });
}

/* ---------- عرض قاعدة المعرفة 📚 ---------- */
function renderKnowledge() {
  const ul = $('knList');
  ul.textContent = '';
  const items = knowledge.list();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'فاضية — علّمه أول حاجة!';
    ul.appendChild(li);
    return;
  }
  items.forEach((k, i) => {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = '📖 ' + k.topic;
    t.title = k.content.slice(0, 500); // مرر الماوس تشوف المحتوى
    t.style.cursor = 'help';
    li.appendChild(t);
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'امسح الموضوع ده';
    x.onclick = () => { knowledge.remove(i); renderKnowledge(); };
    li.appendChild(x);
    ul.appendChild(li);
  });
}

/* ---------- نافذة "علّمه حاجة" ---------- */
$('btnTeach').onclick = () => { $('knTopic').value = ''; $('knContent').value = ''; $('dlgTeach').showModal(); };
$('btnTeachClose').onclick = () => $('dlgTeach').close();
$('btnTeachSave').onclick = () => {
  const topic = $('knTopic').value.trim(), content = $('knContent').value.trim();
  if (!topic || !content) return;
  knowledge.save(topic, content);
  $('dlgTeach').close();
  renderKnowledge();
  addBubble(`اتعلمت موضوع جديد: "${topic}" 📚 اسألني عنه في أي وقت!`, 'bot');
};

/* ---------- التعلم من ملفات 📄 ----------
   بنقرأ الملف نص، ولو كبير بنقسمه "أجزاء" (chunks) —
   ده بالظبط أول خطوة في أي نظام RAG حقيقي               */
$('btnUpload').onclick = () => $('fileIn').click();
$('fileIn').onchange = async () => {
  const CHUNK = 3000; // حجم الجزء الواحد بالحروف
  for (const f of $('fileIn').files) {
    const text = await f.text();
    const parts = [];
    for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    parts.forEach((p, i) => knowledge.save(parts.length > 1 ? `${f.name} (جزء ${i + 1})` : f.name, p));
    addBubble(`اتعلمت ملف "${f.name}" (${parts.length} جزء) 📄 اسألني عن أي حاجة فيه!`, 'bot');
  }
  $('fileIn').value = '';
  renderKnowledge();
};

/* ---------- استرجاع المحادثة المحفوظة عند فتح الصفحة ---------- */
function renderHistory() {
  for (const m of history.load()) {
    if (m.role === 'user') addBubble(m.content, 'me');
    else if (m.role === 'assistant' && m.content) addBubble(m.content, 'bot');
    // رسايل الأدوات (role: tool) بنخفيها من الشات — دي "كواليس"
  }
}

/* ---------- الإرسال ---------- */
async function send() {
  const text = $('box').value.trim();
  if (!text) return;
  $('box').value = '';
  addBubble(text, 'me');

  const typing = addBubble('⏳ بفكر...', 'bot typing');
  $('btnSend').disabled = true;
  try {
    const reply = await runAgent(text, (name, args, result) => {
      // كل ما الايجنت يستخدم أداة بنعرضها — عشان تشوف "الكواليس"
      $('toolLog').textContent = `🛠️ ${name}(${JSON.stringify(args).slice(0, 120)}) → ${String(result).slice(0, 120)}`;
      renderMemories();   // لو حفظ ذاكرة جديدة تظهر فوراً
      renderKnowledge();  // لو اتعلم حاجة جديدة تظهر فوراً
    });
    typing.textContent = reply || '(رد فاضي)';
  } catch (e) {
    typing.textContent = e.message === 'NO_KEY'
      ? '⚠️ محتاج مفتاح API الأول — دوس ⚙️ الإعدادات فوق. طريقة الحصول على مفتاح مجاني في README.md'
      : '❌ ' + e.message;
  }
  typing.classList.remove('typing');
  $('btnSend').disabled = false;
  $('box').focus();
}

$('btnSend').onclick = send;
$('box').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
};

/* ---------- محادثة جديدة (الذاكرة طويلة المدى بتفضل!) ---------- */
$('btnNew').onclick = () => {
  history.clear();
  $('msgs').textContent = '';
  addBubble('محادثة جديدة 🆕 — بس لسه فاكر كل اللي في الذاكرة 🧠', 'bot');
};

/* ---------- الإعدادات ---------- */
$('btnSettings').onclick = () => {
  const s = settings.get();
  $('provider').value = s.provider;
  $('apiKey').value = s.apiKey;
  $('modelName').value = s.model;
  $('dlg').showModal();
};
$('btnSave').onclick = () => {
  settings.set({
    provider: $('provider').value,
    apiKey: $('apiKey').value.trim(),
    model: $('modelName').value.trim(),
  });
  $('dlg').close();
  addBubble('تم حفظ الإعدادات ✅ جرب تبعتلي رسالة!', 'bot');
};
$('btnClose').onclick = () => $('dlg').close();

/* ---------- إعداد سريع من اللينك ----------
   لو الصفحة اتفتحت بلينك فيه #key=... بنحفظ المفتاح تلقائياً
   وبنمسحه من العنوان فوراً — تسهيل لأول مرة بس                 */
(function quickSetup() {
  // 1) من اللينك: #key=...
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('key')) {
    settings.set({ provider: h.get('provider') || 'groq', apiKey: h.get('key').trim(), model: '' });
    // لاحظ: window.history مش history بتاعتنا — الاسم متكرر (درس مجاني في الـ shadowing 😄)
    window.history.replaceState(null, '', location.pathname); // نمسح المفتاح من العنوان
    addBubble('تم ضبط المفتاح تلقائياً ✅ اكتبلي أي حاجة وجرّبني! 🚀', 'bot');
    return;
  }
  // 2) من ملف config.js المحلي (لو موجود ومفيش مفتاح متحفظ قبل كده)
  if (!settings.get().apiKey && window.DEFAULT_SETTINGS && window.DEFAULT_SETTINGS.apiKey) {
    settings.set(window.DEFAULT_SETTINGS);
    addBubble('تم ضبط المفتاح تلقائياً ✅ اكتبلي أي حاجة وجرّبني! 🚀', 'bot');
  }
})();

/* ---------- تشغيل أولي ---------- */
renderMemories();
renderKnowledge();
renderHistory();
