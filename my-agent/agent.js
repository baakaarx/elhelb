/* ============================================================
   agent.js — "مخ" الايجنت 🧠
   ------------------------------------------------------------
   الملف ده فيه كل منطق الايجنت من غير أي تعامل مع الشاشة.
   الايجنت = موديل لغوي (LLM) + أدوات (Tools) + لووب (Loop) + ذاكرة (Memory)

   اقرأ الملف من فوق لتحت وهتفهم إزاي أي ايجنت في الدنيا شغال.
   ============================================================ */

/* ---------- 1) المزوّدات: مين اللي بيشغّل الموديل؟ ----------
   إحنا بنستخدم صيغة OpenAI القياسية (chat/completions) لأن
   معظم المزوّدات بقت متوافقة معاها — يعني نفس الكود يشتغل مع
   Groq و Gemini وغيرهم، بس بنغيّر العنوان والمفتاح.           */
const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  gemini: {
    // Gemini عنده endpoint متوافق مع صيغة OpenAI — بنستغلها عشان كود واحد يكفي
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
  },
};

/* ---------- 2) الإعدادات: بنحفظها في متصفحك بس ---------- */
const settings = {
  get: () => JSON.parse(localStorage.getItem('agent_settings') || '{"provider":"groq","apiKey":"","model":""}'),
  set: (s) => localStorage.setItem('agent_settings', JSON.stringify(s)),
};

/* ---------- 3) الذاكرة طويلة المدى 🧠 ----------
   دي قايمة "حقايق" عن المستخدم (اسمه، شغله، تفضيلاته...).
   الفكرة الذكية: مش إحنا اللي بنحفظ — الموديل نفسه بيقرر
   يحفظ إيه عن طريق أداة اسمها save_memory (شوف الأدوات تحت).
   وبعدين في كل محادثة جديدة بنحقن الذاكرة دي في الـ system prompt
   فالايجنت "يفتكرك" حتى لو مسحت المحادثة.                      */
const memory = {
  list: () => JSON.parse(localStorage.getItem('agent_memories') || '[]'),
  add(fact) {
    const l = memory.list();
    if (!l.includes(fact)) l.push(fact);
    localStorage.setItem('agent_memories', JSON.stringify(l));
  },
  remove(index) {
    const l = memory.list();
    l.splice(index, 1);
    localStorage.setItem('agent_memories', JSON.stringify(l));
  },
};

/* ---------- 3.5) قاعدة المعرفة 📚 — "علّمه أي حاجة" ----------
   دي النسخة المبسطة من تقنية اسمها RAG (Retrieval Augmented Generation):
   - المستخدم بيعلّم الايجنت معلومات (يدوي أو برفع ملفات)
   - بنحفظها كمواضيع (topic + content)
   - مش بنحقنها كلها في الـ prompt (هتبقى ضخمة) — بنحقن العناوين بس
   - ولما ييجي سؤال، الموديل بيستخدم أداة search_knowledge
     يدوّر بيها ويجيب المحتوى المناسب بس. ده جوهر الـ RAG!
   البحث هنا بسيط (كلمات مفتاحية) — الأنظمة الكبيرة بتستخدم
   embeddings (تمثيل رقمي للمعنى)، ودي خطوتك الجاية لو حبيت.     */
const knowledge = {
  list: () => JSON.parse(localStorage.getItem('agent_knowledge') || '[]'),
  save(topic, content) {
    const l = knowledge.list();
    const i = l.findIndex((k) => k.topic === topic);
    const item = { topic: String(topic).slice(0, 120), content: String(content).slice(0, 8000), at: Date.now() };
    if (i >= 0) l[i] = item; else l.push(item); // نفس العنوان = تحديث
    localStorage.setItem('agent_knowledge', JSON.stringify(l));
  },
  remove(index) {
    const l = knowledge.list();
    l.splice(index, 1);
    localStorage.setItem('agent_knowledge', JSON.stringify(l));
  },
  /* بحث بسيط بالكلمات: بنحسب "نقط" لكل موضوع حسب تكرار كلمات السؤال فيه */
  search(query) {
    const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const scored = knowledge.list().map((k) => {
      const topic = k.topic.toLowerCase(), content = k.content.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (topic.includes(w)) score += 5;                       // تطابق في العنوان أهم
        score += content.split(w).length - 1;                    // عدد مرات الظهور في المحتوى
      }
      return { ...k, score };
    }).filter((k) => k.score > 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, 3); // أحسن 3 نتايج بس — عشان منغرقش الموديل
  },
};

/* ---------- 4) الذاكرة قصيرة المدى: تاريخ المحادثة ----------
   الموديلات اللغوية ملهاش ذاكرة أصلاً! كل طلب بيتبعت لوحده.
   عشان كده بنبعت المحادثة كلها (أو آخر جزء منها) مع كل رسالة.
   دي أول حاجة لازم تفهمها عن الايجنتس.                          */
const history = {
  load: () => JSON.parse(localStorage.getItem('agent_history') || '[]'),
  save: (h) => localStorage.setItem('agent_history', JSON.stringify(h)),
  clear: () => localStorage.removeItem('agent_history'),
};

/* ---------- 5) الـ System Prompt: شخصية الايجنت وتعليماته ----------
   دي الرسالة اللي بتتبعت الأول وبتحدد الايجنت "مين" وبيتصرف إزاي.
   لاحظ إننا بنحقن فيها الذاكرة طويلة المدى.                      */
function buildSystemPrompt() {
  const mems = memory.list();
  const topics = knowledge.list().map((k) => k.topic);
  return `أنت اسمك "ELHELP AI"، مساعد شخصي ذكي وشامل، بتتكلم بالعربي المصري البسيط، وبتجاوب على أي سؤال في أي مجال بأحسن ما تقدر. لو حد سألك عن اسمك قول "ELHELP AI".
قواعدك:
1. لما المستخدم يقول معلومة شخصية عن نفسه (اسمه، شغله، مدينته، تفضيلاته...) استخدم أداة save_memory فوراً.
2. لما المستخدم يعلّمك معلومة أو شرح أو قواعد شغل (يقول "اتعلم" أو "احفظ" أو يديك معلومات عن شغله/مشروعه) استخدم أداة save_knowledge بعنوان واضح ومحتوى كامل.
3. قبل ما ترد على سؤال ممكن يكون ليه علاقة بالمواضيع اللي اتعلمتها (القايمة تحت)، استخدم أداة search_knowledge الأول، وخلّي ردك مبني على اللي تلاقيه.
4. لو المستخدم صحّح معلومة قديمة، احفظها تاني بنفس العنوان (بتتحدث تلقائي).
5. استخدم calc لأي حساب، و get_time للوقت والتاريخ.
6. ردودك واضحة ومنظمة، ومش بتخترع معلومات — لو مش متأكد قول مش متأكد.

اللي أنت فاكره عن المستخدم (ذاكرة شخصية):
${mems.length ? mems.map((m, i) => `${i + 1}. ${m}`).join('\n') : '(لسه مفيش)'}

عناوين المواضيع اللي اتعلمتها (استخدم search_knowledge عشان تقرأ محتواها):
${topics.length ? topics.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(لسه متعلمتش حاجة)'}`;
}

/* ---------- 6) الأدوات (Tools) 🛠️ ----------
   الأدوات هي اللي بتفرّق "ايجنت" عن مجرد "شات بوت".
   بنوصف كل أداة بصيغة JSON Schema، والموديل بيقرر لوحده
   يستدعيها إمتى وبأي قيم. إحنا بننفذها وبنرجعله النتيجة.      */
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'احفظ معلومة شخصية مهمة عن المستخدم في الذاكرة طويلة المدى. استخدمها كل ما المستخدم يذكر معلومة عن نفسه.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'المعلومة كجملة قصيرة واضحة، مثال: "اسم المستخدم أحمد" أو "بيحب القهوة سادة"' },
        },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_knowledge',
      description: 'احفظ معلومة أو شرح علّمه المستخدم ليك في قاعدة المعرفة. استخدمها لما المستخدم يعلمك حاجة أو يصحح معلومة. نفس العنوان بيحدّث المحتوى القديم.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'عنوان قصير وواضح للموضوع، مثال: "أسعار منتجات الشركة" أو "طريقة عمل القهوة التركي"' },
          content: { type: 'string', description: 'المحتوى الكامل بالتفاصيل زي ما المستخدم قاله' },
        },
        required: ['topic', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'دوّر في قاعدة المعرفة اللي علمهالك المستخدم. استخدمها قبل الرد على أي سؤال ممكن يكون المستخدم علمك حاجة عنه.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'كلمات البحث' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calc',
      description: 'احسب تعبير رياضي، مثال: "2*(3+4)/5"',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'التعبير الرياضي بأرقام وعلامات + - * / ( ) . فقط' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'هات التاريخ والوقت الحاليين',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/* تنفيذ الأدوات فعلياً: الموديل "بيطلب"، وإحنا "بننفذ" */
function executeTool(name, args) {
  switch (name) {
    case 'save_memory':
      memory.add(String(args.fact || '').trim());
      return 'تم الحفظ في الذاكرة ✅';
    case 'save_knowledge':
      knowledge.save(args.topic || 'بدون عنوان', args.content || '');
      return `تم التعلم ✅ اتحفظ تحت عنوان: "${args.topic}"`;
    case 'search_knowledge': {
      const results = knowledge.search(args.query || '');
      if (!results.length) return 'ملقتش حاجة عن الموضوع ده في قاعدة المعرفة.';
      // بنرجّع للموديل أحسن النتايج عشان يبني رده عليها — ده هو الـ RAG
      return results.map((r) => `### ${r.topic}\n${r.content}`).join('\n\n');
    }
    case 'calc': {
      const ex = String(args.expression || '');
      // أمان: مسموح بس بأرقام وعلامات حساب — عشان محدش يحقن كود
      if (!/^[0-9+\-*/().\s%]+$/.test(ex)) return 'تعبير غير مسموح';
      try { return String(Function('"use strict";return(' + ex + ')')()); }
      catch { return 'تعبير غير صحيح'; }
    }
    case 'get_time':
      return new Date().toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' });
    default:
      return 'أداة غير معروفة';
  }
}

/* ---------- 7) نداء الموديل (LLM Call) ---------- */
async function callLLM(messages) {
  const s = settings.get();
  const p = PROVIDERS[s.provider] || PROVIDERS.groq;
  if (!s.apiKey) throw new Error('NO_KEY');

  const res = await fetch(p.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey, // المفتاح بيروح للمزود مباشرة من متصفحك
    },
    body: JSON.stringify({
      model: s.model || p.defaultModel,
      messages,                 // المحادثة كلها — دي "الذاكرة قصيرة المدى"
      tools: toolDefinitions,   // بنعرّف الموديل على أدواتنا
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`خطأ من المزوّد (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices[0].message; // ممكن يكون كلام عادي أو طلب استخدام أداة
}

/* ---------- 8) اللووب: قلب الايجنت ❤️ ----------
   دي أهم دالة في المشروع كله. الفكرة:

   ┌─> ابعت المحادثة للموديل
   │     │
   │     ├── رد بكلام عادي؟ ──> خلصنا، اعرضه للمستخدم
   │     │
   │     └── طلب أداة؟ ──> نفّذها ──> حط النتيجة في المحادثة ──┐
   └──────────────────────────────────────────────────────────┘

   يعني الموديل ممكن ياخد كذا "خطوة" قبل ما يرد عليك —
   وده بالظبط اللي بيعمله أي ايجنت كبير (بس بأدوات أكتر).      */
async function runAgent(userText, onToolUse) {
  const h = history.load();
  h.push({ role: 'user', content: userText });

  // بنبعت آخر 30 رسالة بس عشان منكبّرش الطلب (إدارة الـ context window)
  const window = () => [{ role: 'system', content: buildSystemPrompt() }, ...h.slice(-30)];

  const MAX_STEPS = 5; // حد أمان عشان الايجنت ميلفّش في لووب لا نهائية
  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await callLLM(window());
    h.push(msg);

    // مفيش طلب أدوات؟ يبقى ده الرد النهائي
    if (!msg.tool_calls || !msg.tool_calls.length) {
      history.save(h);
      return msg.content;
    }

    // الموديل طلب أداة (أو أكتر): ننفذ ونرجعله النتايج
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      const result = executeTool(tc.function.name, args);
      if (onToolUse) onToolUse(tc.function.name, args, result); // للعرض في الواجهة
      h.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  history.save(h);
  return 'وصلت لأقصى عدد خطوات 😅 جرب تاني.';
}
