import agriKnowledge from '../shared/agriKnowledgeBase.json';

const AR_START = '(?:^|\\s)';
const AR_END = '(?=\\s|$|[؟?!.,،])';

export function normalizeArabicClient(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// يفهم الكلام العامي قبل المطابقة: يشيل كلمات المناداة ("يا باشا"، "يا هندسة") من أول الجملة،
// ويضيف الكلمة الفصيحة المقابلة للأعراض العامية (بيصفر ← اصفرار، بيدبل ← ذبول) بدون ما يمسح كلام المستخدم.
export function expandDialect(text = '') {
  let norm = normalizeArabicClient(text);
  const fillers = /^(?:(?:يا|ي)\s+(?:باشا|هندسه|بشمهندس|بشمهندسه|استاذ|دكتور|فندم|معلم|حاج|حاجه|برنس|غالي|صاحبي|عم|ريس|كبير)|طيب|طب|بقولك|اسمع|بص|يعني|لو سمحت|من فضلك|ممكن|معلش)\s+/;
  for (let i = 0; i < 3 && fillers.test(norm); i++) norm = norm.replace(fillers, '');
  const extras = [];
  if (/(?:بيصفر|بتصفر|بيصفرو|بتصفرو|اصفرت|صفرت|اصفرار|مصفر|صفرا|صفراء|الورق اصفر|ورقه اصفر|لونه اصفر)/.test(norm)) extras.push('اصفرار');
  if (/(?:بيدبل|بتدبل|بيدبلو|دبلان|دبلت|دابل|بيدوب|بيدبل)/.test(norm)) extras.push('ذبول');
  return extras.length ? `${norm} ${extras.join(' ')}` : norm;
}

export function formatForSpeechClient(text = '', language = 'ar') {
  const isEnglish = String(language).toLowerCase().startsWith('en');
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ #>*_~|•]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, isEnglish ? '$1 percent' : '$1 بالمائة')
    .replace(/\b(?:EC|WP|SC|SL|WG|GR|UL|DP)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERAL_STARTER_SUGGESTIONS = [
  'الزرع عندي تعبان ومحتاج أشخّص الإصابة',
  'إيه أهم منتجات ومبيدات مجموعة الهلب؟',
  'عندي عنكبوت أحمر وذبابة بيضا، أرش إيه؟',
  'إزاي أتواصل مع مبيعات مجموعة الهلب؟',
];

const PRODUCT_CATALOG = [
  {
    keys: ['كابيتول', 'capitol', 'كلورفينابير', 'chlorfenapyr'],
    name: 'كابيتول 24% SC (Capitol 24% SC)',
    category: 'مبيد أكاروسي وحشري',
    active: 'كلورفينابير (Chlorfenapyr 24%)',
    packs: '100 مل، 500 مل، 1 لتر، 5 لتر، 10 لتر',
    usage: 'فعال جداً لمكافحة العنكبوت الأحمر (الأكاروسات)، حشرة التوتا أبسلوتا (سوسة الطماطم)، والتربس.',
  },
  {
    keys: ['جولد', 'gold', 'ابامكتين', 'abamectin'],
    name: 'جولد 1.8% EC (Gold 1.8% EC)',
    category: 'مبيد أكاروسي وحشري',
    active: 'أبامكتين (Abamectin 1.8%)',
    packs: '100 مل، 250 مل، 1 لتر',
    usage: 'للقضاء على العنكبوت الأحمر والأكاروسات وصانعات الأنفاق في الخضر والفاكهة والفراولة.',
  },
  {
    keys: ['بيريبان', 'pyriban'],
    name: 'بيريبان 48% EC (Pyriban 48% EC)',
    category: 'مبيد حشري',
    active: 'كلوربيريفوس (Chlorpyrifos 48%)',
    packs: '250 مل، 500 مل، 1 لتر، 5 لتر',
    usage: 'التوصية المعتمدة لمكافحة الحفار والديدان القارضة وآفات التربة بمعدل 1 لتر للفدان طعم سام سرسبة عند الغروب.',
  },
  {
    keys: ['هلبان', 'helban', 'تافابان', 'tafaban', 'لوكبان', 'locban'],
    name: 'هلبان 48% EC (Helban 48% EC) / تافابان 48% EC',
    category: 'مبيد حشري',
    active: 'كلوربيريفوس (Chlorpyrifos 48%)',
    packs: '250 مل، 500 مل، 1 لتر، 5 لتر',
    usage: 'لمكافحة الحشرات القارضة والثاقبة الماصة وآفات المحاصيل الحقلية والبستانية.',
  },
  {
    keys: ['لافيدا', 'laveda', 'اوكساميل', 'oxamyl'],
    name: 'لافيدا 24% SL (Laveda 24% SL)',
    category: 'مبيد نيماتودا جهازي',
    active: 'أوكساميل (Oxamyl 24%)',
    packs: '1 لتر',
    usage: 'لمكافحة نيماتودا تعقد الجذور في الخضر والفاكهة والبطاطس مع مياه الري بالتنقيط.',
  },
  {
    keys: ['نيما بروب', 'nemaprobe', 'فوستيازات', 'fosthiazate'],
    name: 'نيما بروب 10% GR (Nemaprobe 10% GR)',
    category: 'مبيد نيماتودا محبب للتربة',
    active: 'فوستيازات (Fosthiazate 10%)',
    packs: '1 كجم',
    usage: 'معاملة التربة لمكافحة نيماتودا الجذور والدرنات في البطاطس والطماطم والموز.',
  },
  {
    keys: ['بيست', 'best', 'ايميداكلوبريد', 'imidacloprid'],
    name: 'بيست 25% WP (Best 25% WP)',
    category: 'مبيد حشري جهازي',
    active: 'إيميداكلوبريد (Imidacloprid 25%)',
    packs: '250 جرام، 1 كجم',
    usage: 'لمكافحة المن والذبابة البيضاء والتربس والجاسيد بمعدل 250 جم / 200 لتر ماء للموالح والفاكهة.',
  },
  {
    keys: ['كورد', 'cord', 'بروفينوفوس', 'profenofos'],
    name: 'كورد 72% EC (Cord 72% EC)',
    category: 'مبيد حشري',
    active: 'بروفينوفوس (Profenofos 72%)',
    packs: '750 مل',
    usage: 'لمكافحة دودة ورق القطن وديدان اللوز والثاقبات والتربس بمعدل 750 مل للفدان.',
  },
  {
    keys: ['هلب ستار', 'helbstar', 'بيريدابين', 'pyridaben'],
    name: 'هلب ستار 20% EC (HelbStar 20% EC)',
    category: 'مبيد أكاروسي متخصص',
    active: 'بيريدابين (Pyridaben 20%)',
    packs: '400 مل، 1 لتر',
    usage: 'سريع الصدمة على أطوار العنكبوت الأحمر والأكاروسات.',
  },
  {
    keys: ['برنس', 'prince', 'راجنو', 'ragno', 'سولانو', 'solano', 'ديفيلوبر', 'developer'],
    name: 'برنس 10% EC (Prince 10% EC) ومجموعة درع الأكاروس',
    category: 'مبيد أكاروسي',
    active: 'Hexythiazox 10% (وبرفقته راجنو 5% SC وسولانو 25% WP وديفيلوبر 24% SC)',
    packs: '100 مل، 250 مل، 400 جم، 1 لتر',
    usage: 'للقضاء على بيض ويرقات العنكبوت الأحمر وكسر المناعة.',
  },
  {
    keys: ['اتش سلفر', 'سولي سلفر', 'sulphur', 'كبريت'],
    name: 'إتش سلفر 80% WP وسولي سلفر 80% WG',
    category: 'مبيد فطري وأكاروسي ومصلح تربة',
    active: 'كبريت ميكروني (Sulfur 80%)',
    packs: '750 جرام، 10 كجم',
    usage: 'لمكافحة البياض الدقيقي في العنب والمانجو والقرعيات بمعدل 250 جم / 100 لتر ماء وتصحيح قلوية التربة.',
  },
  {
    keys: ['دايفر', 'تايجر', 'diver', 'tiger', 'زيت معدني'],
    name: 'دايفر 97% EC وتايجر 97% EC (Diver & Tiger)',
    category: 'زيت معدني زراعي نقي',
    active: 'Mineral Oil 97%',
    packs: '20 لتر',
    usage: 'لمكافحة الحشرات القشرية والبق الدقيقي على أشجار الموالح والفاكهة.',
  },
  {
    keys: ['انادول', 'تازولين', 'رولكس', 'دودجو', 'توربو', 'مولر'],
    name: 'مجموعة مكافحة الندوات (تازولين 72% WP / دودجو 68% WG / أنادول 80% WP / رولكس 50% WP)',
    category: 'مبيدات فطرية للندوة المبكرة والمتأخرة',
    active: 'تركيبات وقائية وعلاجية متخصصة للندوات واللفحة',
    packs: 'عبوات متعددة للرش الورقي',
    usage: 'الوقاية بـ أنادول 80% (250 جم/100 لتر ماء)، والعلاج بـ تازولين 72% (250 جم/100 لتر ماء) أو دودجو 68% WG (200 جم/100 لتر ماء) أو رولكس 50% (150 جم/100 لتر ماء).',
  },
];

const SYMPTOM_RULES = [
  {
    pattern: /(?:بياكل الجدر|بيقرص الجدر|بيقرض|شتله مقروضه|الزرع بيقع|تخريم في البطاطس|اخرام في الدرنات|تحت الارض|حفار|ديدان قارضه)/,
    title: 'اشتباه إصابة بالحفار أو الديدان القارضة تحت التربة',
    advice:
      'من وصفك (**قرض تحت التربة / ذبول مفاجئ أو ثقوب في الدرنات**)، غالباً دي إصابة **بالحفار** أو **الديدان القارضة**:\n' +
      '- **العلاج المعتمد من مجموعة الهلب:** مبيد **بيريبان 48% EC (`Pyriban 48% EC`)**.\n' +
      '- **الجرعة وطريقة الاستخدام:** **1 لتر للفدان** يُخلط كطعم سام (مع الجريش أو الردة المنداة) ويوضع **سرسبة بين الخطوط بعد الري وعند الغروب** لأن الحفار ينشط ليلاً.',
    followUps: [
      'إيه أحجام العبوات المتوفرة من بيريبان 48%؟',
      'عندي كمان بقع بني على الورق، أرش إيه؟',
      'إزاي أتواصل لطلب المنتج؟',
    ],
  },
  {
    pattern: /(?:كلاكيع في الجدر|عقد في الجذور|تورم في الجدر|تعقد الجذور|الجدر معقد|نيماتودا|الزرع واقف ومصفر من الجدر)/,
    title: 'أعراض إصابة بنيماتودا تعقد الجذور',
    advice:
      'وجود **عُقد أو انتفاخات على الجذور مع تقزم واصفرار النبات** يدل على إصابة **بنيماتودا تعقد الجذور**:\n' +
      '- **أفضل حلول مجموعة الهلب:**\n' +
      '  1. **لافيدا 24% SL (`Laveda 24% SL` — أوكساميل):** مبيد نيماتودا جهازي يُضاف مع مياه الري بالتنقيط (عبوة 1 لتر).\n' +
      '  2. **نيما بروب 10% GR (`Nemaprobe 10% GR` — فوستيازات):** مبيد نيماتودا محبب يُعامل به التربة (عبوة 1 كجم).',
    followUps: [
      'إيه أحجام عبوات لافيدا ونيما بروب؟',
      'عندي كمان عنكبوت أحمر على الأوراق',
      'إزاي أتواصل مع الدعم الفني لمجموعة الهلب؟',
    ],
  },
  {
    pattern: /(?:بودره بيضا|زي الدقيق|دقيق ابيض|عفن ابيض علي الورق|بياض دقيقي|لطش ابيض)/,
    title: 'أعراض مرض البياض الدقيقي الفطري',
    advice:
      'ظهور **طبقة بيضاء تشبه الدقيق أو البودرة على الأوراق** هو عرض واضح لمرض **البياض الدقيقي**:\n' +
      '- **التوصية المعتمدة من مجموعة الهلب:** الرش بمستحضر **إتش سلفر 80% WP (`H-Sulphur 80% WP`)** أو **سولي سلفر 80% WG (`Soli-Sulphur 80% WG`)** بمعدل **250 جرام لكل 100 لتر ماء** مع تغطية المجموع الخضري جيداً.',
    followUps: [
      'إيه أحجام عبوات إتش سلفر المتوفرة؟',
      'عندي كمان بقع بنية وحروق في الورق (ندوة)',
      'إزاي أتواصل لطلب المنتج؟',
    ],
  },
  {
    pattern: /(?:نقط بني|بقع بني|لطش بني|حروق في الورق|شعوطه في الورق|ندوه|الندوه البدر|الندوه المبكر|الندوه المتاخر|لفحه)/,
    title: 'أعراض الندوة المبكرة / المتأخرة (اللفحة) على الأوراق والسيقان',
    advice:
      'ظهور **بقع بنية داكنة أو حروق على الأوراق** في البطاطس أو الطماطم يشير إلى **الندوة**:\n' +
      '- **للوقاية قبل اشتداد الإصابة:** مبيد **أنادول 80% WP** بمعدل **250 جم / 100 لتر ماء**.\n' +
      '- **للعلاج السريع عند ظهور الأعراض:**\n' +
      '  • **تازولين 72% WP** بمعدل **250 جم / 100 لتر ماء**\n' +
      '  • أو **دودجو 68% WG** بمعدل **200 جم / 100 لتر ماء**\n' +
      '  • أو **رولكس 50% WP** (`150 جم / 100 لتر ماء`) أو **توربو 72% WP** (`150 جم / 100 لتر ماء`).',
    followUps: [
      'أكرر الرش كل كام يوم؟',
      'عندي كمان إصابة بالحفار في نفس الأرض',
      'إزاي أتواصل لطلب هذه المبيدات؟',
    ],
  },
  {
    pattern: /(?:خيوط عنكبوت|عنكبوت احمر|اكاروس|نقط حمرا|ضهر الورقه مصفر ومغبر|تصدف)/,
    title: 'إصابة بالعنكبوت الأحمر / الأكاروسات',
    advice:
      'لمكافحة **العنكبوت الأحمر والأكاروسات** بكفاءة عالية والقضاء على جميع الأطوار:\n' +
      '- **جولد 1.8% EC (`Gold 1.8% EC` — أبامكتين):** عبوات 100 مل، 250 مل، 1 لتر.\n' +
      '- **كابيتول 24% SC (`Capitol 24% SC` — كلورفينابير):** فعالية مزدوجة ضد الأكاروس والتوتا أبسلوتا والتربس.\n' +
      '- **هلب ستار 20% EC (`HelbStar`)** + **برنس 10% EC (`Prince`):** لكسر المناعة والقضاء على البيض واليرقات مع تغطية السطح السفلي للأوراق.',
    followUps: [
      'إيه أحجام عبوات كابيتول 24% وجولد 1.8%؟',
      'عندي ذبابة بيضاء ومن مع العنكبوت، أرش إيه؟',
      'إزاي أتواصل مع المبيعات لطلب المنتجات؟',
    ],
  },
  {
    pattern: /(?:ناموس ابيض|دبان ابيض|ذبابه بيض|حشرات بتطير|من كتير|ندوه عسليه|تجعد الورق|تربس|جاسيد)/,
    title: 'إصابة بالحشرات الثاقبة الماصة (الذبابة البيضاء / المن / التربس)',
    advice:
      'الحشرات الدقيقة اللي بتطير عند هز النبات أو بتسبب ندوة عسلية وتجعد في الأوراق هي **الذبابة البيضاء والمن والتربس**:\n' +
      '- **العلاج الجهازي المعتمد من مجموعة الهلب:** مبيد **بيست 25% WP (`Best 25% WP` — إيميداكلوبريد)** متوفر بعبوات **250 جرام و 1 كجم**.\n' +
      '- لو فيه **تربس شديد أو توتا أبسلوتا** مع الذبابة، يمكن التبادل مع **كابيتول 24% SC (`Capitol 24% SC`)**.',
    followUps: [
      'إزاي أحمي الطماطم من سوسة الطماطم (التوتا)؟',
      'إيه أهم منتجات ومبيدات مجموعة الهلب؟',
      'إزاي أتواصل مع المبيعات؟',
    ],
  },
  {
    pattern: /(?:سوسه الطماطم|توتا|صانعات انفاق|خطوط بيضا متعرجه|خرايط في الورق)/,
    title: 'إصابة بصانعات الأنفاق أو سوسة الطماطم (التوتا أبسلوتا)',
    advice:
      'الخطوط البيضاء المتعرجة داخل الورقة أو ثقب ثمار الطماطم سببها **صانعات الأنفاق أو التوتا أبسلوتا**:\n' +
      '- **التوصية المعتمدة من مجموعة الهلب:** الرش بالتبادل بين **كابيتول 24% SC (`Capitol 24% SC`)** و **جولد 1.8% EC (`Gold 1.8% EC`)**.',
    followUps: [
      'إيه أحجام العبوات المتوفرة من كابيتول وجولد؟',
      'عندي كمان ندوة بدرية في الطماطم، أرش إيه؟',
      'إزاي أتواصل مع المبيعات لطلب المنتجات؟',
    ],
  },
  {
    pattern: /(?:دود بياكل الورق|ورق مخرم|دوده ورق القطن|ديدان اللوز|ثاقبات|دوده الذره|حشد خريفيه)/,
    title: 'إصابة بدودة ورق القطن / الديدان القارضة للأوراق والثاقبات',
    advice:
      'في حالة وجود **ديدان تتغذى على الأوراق وتثقبها**:\n' +
      '- **كورد 72% EC (`Cord 72% EC` — بروفينوفوس):** قوي وفعال جداً على دودة ورق القطن وديدان اللوز والتربس (عبوة 750 مل).\n' +
      '- **هلبان 48% EC (`Helban 48% EC` — كلوربيريفوس):** متوفر بعبوات 250 مل، 500 مل، 1 لتر.',
    followUps: [
      'إيه أهم منتجات ومبيدات مجموعة الهلب؟',
      'إزاي أتواصل مع خدمة العملاء؟',
    ],
  },
  {
    pattern: /(?:حشره قشريه|بق دقيقي|قطن ابيض علي الشجر|عفن اسود علي الموالح|قشر علي الغصون)/,
    title: 'إصابة بالحشرات القشرية أو البق الدقيقي على الأشجار',
    advice:
      'لعلاج **الحشرات القشرية والبق الدقيقي** على أشجار الموالح والمانجو والزيتون والفاكهة:\n' +
      '- توفر مجموعة الهلب الزيوت المعدنية الزراعية النقية **دايفر 97% EC (`Diver 97% EC`)** و **تايجر 97% EC (`Tiger 97% EC`)** بعبوات **20 لتر**، مع إمكانية التدعيم بمبيد **بيست 25% WP** أو **هلبان 48% EC**.',
    followUps: [
      'عندكم كبريت ميكروني للبياض الدقيقي في المانجو؟',
      'إزاي أتواصل لطلب المنتجات؟',
    ],
  },
];

async function analyzeImageInBrowserCanvas(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxSide = 160;
      const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(20, Math.round(img.width * scale));
      const h = Math.max(20, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // مصغر خفيف للسجل
      const thumbCanvas = document.createElement('canvas');
      const tScale = Math.min(1, 280 / Math.max(img.width || 1, img.height || 1));
      thumbCanvas.width = Math.max(30, Math.round(img.width * tScale));
      thumbCanvas.height = Math.max(30, Math.round(img.height * tScale));
      thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.72);

      const { data } = ctx.getImageData(0, 0, w, h);
      const total = w * h;
      let greenLeaf = 0;
      let darkNecrotic = 0;
      let yellowChlorotic = 0;
      let whitePaper = 0;
      const pixelClass = new Uint8Array(total);

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
        const lum = r * 0.299 + g * 0.587 + b * 0.114;

        if (lum > 215 && sat < 0.08) whitePaper++;

        if (g > r * 1.08 && g > b * 1.14 && g >= 45 && sat >= 0.14) {
          greenLeaf++;
          pixelClass[p] = 1;
        } else if (r >= 135 && g >= 120 && b < g * 0.72 && r <= g * 1.32 && sat >= 0.22) {
          yellowChlorotic++;
          pixelClass[p] = 3;
        } else if (
          lum >= 24 &&
          lum <= 105 &&
          r >= b * 1.08 &&
          g <= r * 0.88 &&
          !(r < 35 && g < 35 && b < 35 && sat < 0.08)
        ) {
          darkNecrotic++;
          pixelClass[p] = 2;
        } else if (lum >= 185 && lum <= 245 && sat < 0.14) {
          pixelClass[p] = 4;
        }
      }

      const greenPct = (greenLeaf / total) * 100;
      const paperPct = (whitePaper / total) * 100;
      const rawNecroticPct = (darkNecrotic / total) * 100;
      const yellowPct = (yellowChlorotic / total) * 100;

      let lesionNearGreen = 0;
      let powderyNearGreen = 0;
      const rad = 2;
      for (let y = rad; y < h - rad; y++) {
        for (let x = rad; x < w - rad; x++) {
          const idx = y * w + x;
          const cls = pixelClass[idx];
          if (cls !== 2 && cls !== 4) continue;
          const greenSides = [
            pixelClass[(y - rad) * w + x], pixelClass[(y + rad) * w + x],
            pixelClass[y * w + (x - rad)], pixelClass[y * w + (x + rad)],
          ].filter((value) => value === 1).length;
          if (greenSides >= 3) {
            if (cls === 2) lesionNearGreen++;
            if (cls === 4) powderyNearGreen++;
          }
        }
      }

      const leafLesionPct = (lesionNearGreen / total) * 100;
      const leafPowderyPct = (powderyNearGreen / total) * 100;
      const isPlantPhoto = greenPct >= 12 && paperPct < 65;

      // لا نعدّ التربة أو الظلال تشخيصاً؛ لا تُحتسب البقعة إلا بجوار نسيج أخضر قريب.
      let condition = 'general';
      if (isPlantPhoto) {
        const scores = [
          ['blight', Math.min(1, leafLesionPct / 3)],
          ['powdery', Math.min(1, leafPowderyPct / 6)],
          ['chlorosis', Math.min(1, yellowPct / 18)],
        ].sort((a, b) => b[1] - a[1]);
        if (scores[0][1] >= 0.22 && (scores[0][0] !== 'blight' || leafLesionPct >= 1.2)) condition = scores[0][0];
        else condition = 'healthy_plant';
      }

      resolve({ thumbDataUrl, isPlantPhoto, condition });
    };
    img.onerror = () => resolve({ thumbDataUrl: dataUrl, isPlantPhoto: false, condition: 'general' });
    img.src = dataUrl;
  });
}

function getStandaloneKnowledgeReply(rawText, language = 'ar') {
  const rawLower = String(rawText || '').toLowerCase();
  if (String(language).toLowerCase().startsWith('en')) {
    if (/(?:fertili[sz]er|nutrient|plant food)/i.test(rawLower)) {
      const names = (agriKnowledge.fertilizers || []).map((item) => item.name);
      return `ELHELB has ${names.length} registered fertilizers and crop nutrients: ${names.join(', ')}. Tell me your crop and growth stage so I can narrow the options. For exact rates, follow the product label; I will not guess a dose.`;
    }
    return null;
  }
  const norm = normalizeArabicClient(rawText);
  const asksWeeds = /(?:حشائش|حشايش|حشيش|مبيد حشائش|السعد|الدنيبه|ابو ركبه|العجيره)/.test(norm);
  const herbicide = agriKnowledge.herbicides.find((item) => {
    const names = normalizeArabicClient(item.name.split('(')[0]).split(/\s+/).filter((term) => term.length > 3);
    return names.some((term) => norm.includes(term));
  });
  if (asksWeeds || herbicide) {
    let items = herbicide ? [herbicide] : agriKnowledge.herbicides;
    const weed = ['الدنيبه', 'ابو ركبه', 'العجيره', 'السعد'].find((term) => norm.includes(term));
    if (!herbicide && weed) {
      const matches = items.filter((item) => normalizeArabicClient(`${item.target} ${item.rate}`).includes(weed));
      if (matches.length) items = matches;
    }
    const crop = agriKnowledge.crops.find((name) => norm.includes(normalizeArabicClient(name).replace(/^ال/, '')));
    if (!herbicide && crop) {
      const token = normalizeArabicClient(crop).replace(/^ال/, '');
      const matches = items.filter((item) => normalizeArabicClient(`${item.target} ${item.rate}`).replace(/^ال/, '').includes(token));
      if (matches.length) items = matches;
    }
    return `🌱 **مبيدات الحشائش بمجموعة الهلب:**\n${items.map((item) => `• **${item.name}** (${item.active}) — ${item.target}. المعدل والتوقيت: ${item.rate}.`).join('\n')}\n\n⚠️ اتبع ملصق العبوة، فاختيار مبيد الحشائش يتوقف على المحصول ونوع الحشيشة ومرحلة النمو.`;
  }
  const asksForFertilizerCatalog = /(?:سماد|اسمده|الاسمده|السماد|مغذيات)/.test(norm) &&
    /(?:الشركه|الهلب|عندكم|المتوفر|المتاح|منتجات|انواع|ايه|ما هي|قائمه|كتالوج)/.test(norm);
  if (asksForFertilizerCatalog && Array.isArray(agriKnowledge.fertilizers)) {
    const names = agriKnowledge.fertilizers.map((item) => item.arabic || item.name);
    return `🌱 منتجات الأسمدة والمغذيات المسجلة لدى مجموعة الهلب (${names.length} منتج): ${names.join('، ')}. قولي اسم المحصول ومرحلة نموه أو المشكلة اللي عندك، وأساعدك تختار من غير ما أخمّن جرعة؛ الجرعة تتحدد من ملصق المنتج.`;
  }
  if (/(?:محاصيل|المحاصيل|محصولات)/.test(norm)) return `🌾 المحاصيل الموجودة في دليل العيادة: ${agriKnowledge.crops.join('، ')}.`;
  const symptomWords = /(?:بقع|اصفرار|حشر|دوده|ذبول|عنكبوت|ندوه|بياض|توتا|حفار|تعقد|رش|مبيد|مرض)/;
  if (norm.split(/\s+/).length <= 6 && !symptomWords.test(norm)) {
    const crop = agriKnowledge.crops.find((name) => norm.includes(normalizeArabicClient(name).replace(/^ال/, '')));
    if (crop) return `🌱 سجل العيادة يشمل محصول ${crop}. اذكر الإصابة أو ارفع صورة واضحة لنرشح خياراً مناسباً من دليل الشركة.`;
  }
  const cropTerms = new Set(agriKnowledge.crops.map((crop) => normalizeArabicClient(crop)));
  const protocol = agriKnowledge.protocols.map((item) => {
    const terms = normalizeArabicClient(item.issue).split(/\s+/).filter((term) => term.length > 4 && !cropTerms.has(term));
    return { item, score: terms.filter((term) => norm.includes(term)).length };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score)[0]?.item;
  if (protocol) return `🌿 **${protocol.issue}:**\nالبدائل: ${protocol.products}.\nالإرشاد: ${protocol.rate}.\nاذكر المحصول ومرحلة نموه لتضييق الخيارات، واتبع الملصق الفني.`;
  return null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadLocalHistory(sessionId) {
  if (!sessionId) return [];
  try {
    return JSON.parse(localStorage.getItem('elhelb_hist_' + sessionId) || '[]');
  } catch {
    return [];
  }
}

function saveLocalHistory(sessionId, list) {
  if (!sessionId) return;
  try {
    localStorage.setItem('elhelb_hist_' + sessionId, JSON.stringify(list.slice(-40)));
  } catch {
    // ignore quota errors
  }
}

export function clearLocalHistory(sessionId) {
  if (!sessionId) return;
  try {
    localStorage.removeItem('elhelb_hist_' + sessionId);
  } catch {
    // ignore
  }
}

export function getLocalHistoryResponse(sessionId) {
  return { messages: loadLocalHistory(sessionId) };
}

export async function runStandaloneClientTurn({ sessionId, message = '', imageFile = null, imageBase64 = null, language = 'ar' }) {
  const history = loadLocalHistory(sessionId);
  const cleanMsg = String(message || '').trim();
  const understoodMsg = expandDialect(cleanMsg);

  let dataUrl = imageBase64 || null;
  if (!dataUrl && imageFile) {
    dataUrl = await fileToDataUrl(imageFile);
  }

  let reply = '';
  let suggestions = GENERAL_STARTER_SUGGESTIONS.slice(0, 3);
  let thumbToSave = null;

  if (dataUrl) {
    const vis = await analyzeImageInBrowserCanvas(dataUrl);
    const textContext = normalizeArabicClient(cleanMsg);
    if (/(?:الصدأ|صدأ|rust)/.test(textContext)) vis.condition = 'rust';
    else if (/(?:البياض الزغبي|بياض زغبي|downy mildew)/.test(textContext)) vis.condition = 'downy';
    else if (/(?:التوتا|صانعات الانفاق|leafminer|توتا ابسلوتا)/.test(textContext)) vis.condition = 'leafminer';
    else if (/(?:البياض الدقيقي|بودره بيضا|powdery mildew)/.test(textContext)) vis.condition = 'powdery';
    else if (/(?:عنكبوت احمر|اكاروس|نقط صفراء)/.test(textContext)) vis.condition = 'chlorosis';
    thumbToSave = vis.thumbDataUrl;

    if (String(language).toLowerCase().startsWith('en')) {
      reply = 'I received and reviewed the image. Please tell me the crop, plant age, and the main symptom; a photo alone is not enough to confirm a diagnosis or a safe application rate.';
      suggestions = ['The crop is potato and the leaves have spots', 'I see insects under the leaves', 'How can I contact ELHELB support?'];
    } else if (vis.condition === 'blight') {
      reply =
        '🌿 **فحص الصورة في عيادة الهلب الزراعية (ELHELB Agri-Clinic):**\n\n' +
        '- **الملاحظة البصرية في الصورة:** يظهر على الأوراق الخضراء **بقعة نخرية داكنة (بنية مائلة للسواد / لفحة واضحة على نصل الورقة والساق)**.\n' +
        '- **التشخيص المرجّح:** هذه الأعراض تتطابق بقوة مع إصابة فطرية بـ **الندوة المتأخرة أو الندوة المبكرة (اللفحة — Blight)** التي تنتشر في محاصيل **البطاطس والطماطم** خاصة مع الرطوبة العالية والندى.\n\n' +
        '💊 **برنامج العلاج السريع المعتمد من مجموعة الهلب:**\n' +
        '1. **رش علاجي فوري لوقف انتشار البقع:**\n' +
        '   • مبيد **تازولين 72% WP** بمعدل **250 جرام / 100 لتر ماء**\n' +
        '   • أو مبيد **دودجو 68% WG** بمعدل **200 جرام / 100 لتر ماء**\n' +
        '   • أو مبيد **توربو 72% WP** (150 جم / 100 لتر ماء) أو **مولر 69% WP** (250 جم / 100 لتر ماء).\n' +
        '2. **رش وقائي لحماية الأوراق السليمة الجديدة:** مبيد **أنادول 80% WP** (250 جم / 100 لتر ماء) أو **رولكس 50% WP** (150 جم / 100 لتر ماء).\n\n' +
        '💬 **تأكيد سريع معاك:** هل المحصول في الصورة **بطاطس** فعلاً؟ وهل البقع بقت طرية وبتنتشر بسرعة مع ندى الصبح؟';
      suggestions = [
        'أيوه المحصول بطاطس، أكرر الرش كل كام يوم؟',
        'إيه أهم نصائح الرش السليم للندوة؟',
        'إزاي أتواصل لطلب تازولين ودودجو؟',
      ];
    } else if (vis.condition === 'chlorosis') {
      reply =
        '🌿 **فحص الصورة في عيادة الهلب الزراعية:**\n\n' +
        '- **الملاحظة البصرية:** يظهر في الصورة **اصفرار وشحوب على الأوراق الخضراء**.\n' +
        '- **التوصية المعتمدة من مجموعة الهلب:** افحص ظهر الورقة؛ لو لاحظت عنكبوت أحمر أو أكاروس استخدم **جولد 1.8% EC** أو **كابيتول 24% SC**، ولو ذبابة بيضاء أو من استخدم **بيست 25% WP** مع دعم النبات بمغذيات مجموعة الهلب.';
      suggestions = ['إيه أحجام عبوات جولد وكابيتول؟', 'إزاي أتواصل مع الدعم الفني؟'];
    } else if (vis.condition === 'powdery') {
      reply =
        '🌿 **فحص الصورة في عيادة الهلب الزراعية:**\n\n' +
        '- **الملاحظة البصرية:** يظهر مظهر **طبقة فاتحة بيضاء على سطح الأوراق** (اشتباه **البياض الدقيقي**).\n' +
        '- **التوصية المعتمدة من مجموعة الهلب:** الرش بمستحضر **إتش سلفر 80% WP** أو **سولي سلفر 80% WG** بمعدل **250 جم / 100 لتر ماء**.';
      suggestions = ['أكرر الرش كل كام يوم؟', 'إزاي أتواصل لطلب المنتج؟'];
    } else {
      reply =
        '📷 **تم استلام وفحص الصورة بنجاح:**\n\n' +
        'عشان أديك التشخيص والمبيد الأدق بنسبة 100%، قولي **اسم المحصول أو اسم المبيد الموجود في الصورة** وإيه العرض اللي ملاحظه في الأرض، وهرد عليك بالتوصية الكاملة فوراً!';
      suggestions = [
        'المحصول بطاطس وفيه بقع على الورق',
        'عندي عنكبوت أحمر وذبابة بيضا',
        'إيه أهم مبيدات مجموعة الهلب؟',
      ];
    }
  } else {
    const catalogReply = getStandaloneKnowledgeReply(String(language).toLowerCase().startsWith('en') ? cleanMsg : understoodMsg, language);
    if (catalogReply) {
      reply = catalogReply;
      suggestions = String(language).toLowerCase().startsWith('en')
        ? ['Tell me your crop and growth stage', 'What products are available?', 'How can I contact ELHELB support?']
        : ['اذكر المحصول والآفة لتوصية أدق', 'ما المنتجات المتاحة لمشكلة أخرى؟', 'تحدث عن المحاصيل التي أزرعها'];
    } else {
      const answerObj = generateStandaloneTextReply(String(language).toLowerCase().startsWith('en') ? cleanMsg : understoodMsg, history, language);
      reply = answerObj.reply;
      suggestions = answerObj.suggestions;
    }
  }

  if (dataUrl && cleanMsg) {
    const contextReply = getStandaloneKnowledgeReply(String(language).toLowerCase().startsWith('en') ? cleanMsg : understoodMsg, language);
    const isEnglish = String(language).toLowerCase().startsWith('en');
    reply += isEnglish
      ? `\n\nYour description: “${cleanMsg}”.`
      : `\n\n🧭 **تم دمج وصفك مع ملاحظة الصورة:** «${cleanMsg}»`;
    if (contextReply && !contextReply.includes('سجل العيادة يشمل')) reply += `\n${contextReply}`;
    else reply += isEnglish
      ? '\nThe image alone cannot confirm the cause. Tell me the crop and plant age, and share a close-up of the affected area.'
      : '\nالصورة لا تؤكد المسبب وحدها؛ اذكر المحصول وعمره وصوّر موضع الإصابة عن قرب لتضييق الاحتمالات.';
  }

  const speechText = formatForSpeechClient(reply, language);
  const now = Date.now();
  const userMessage = {
    id: now,
    role: 'user',
    content: cleanMsg || (String(language).toLowerCase().startsWith('en') ? '📷 Image attached for analysis' : '📷 صورة مرفقة للتحليل'),
    imageThumb: thumbToSave,
  };
  const assistantMessage = {
    id: now + 1,
    role: 'assistant',
    content: reply,
    speechText,
    suggestions,
  };

  saveLocalHistory(sessionId, [...history, userMessage, assistantMessage]);

  return {
    reply,
    speechText,
    suggestions,
    userMessage,
    assistantMessage,
  };
}

function generateStandaloneTextReply(rawText, history = [], language = 'ar') {
  if (String(language).toLowerCase().startsWith('en')) {
    return {
      reply: 'I can help with ELHELB agricultural products and crop problems. Please tell me the crop, what symptoms you see, and the product name if you have one. For safety, confirm every application rate on the product label.',
      suggestions: ['What fertilizers does ELHELB offer?', 'Help me identify a crop problem', 'How do I contact ELHELB support?'],
    };
  }
  const norm = normalizeArabicClient(rawText);
  const wordCount = norm.split(/\s+/).filter(Boolean).length;

  const hasAgriTopic =
    /(?:بطاطس|طماطم|قوطه|موالح|برتقال|ليمون|مانجو|عنب|فراوله|قمح|قطن|ذره|بصل|خيار|فلفل|مبيد|مبيدات|رش|حفار|ندوه|عنكبوت|اكاروس|نيماتودا|بياض|ذبابه|توتا|دوده|كابيتول|جولد|بيريبان|هلبان|لافيدا|بيست|كورد|سلفر|دايفر|سماد|اسمده|حشائش|تاريخ|تاسست)/.test(
      norm
    );

  // 1) شكر
  if (
    new RegExp(
      `^(?:شكرا|شكرن|متشكر|الف شكر|تسلم|يسلمو|تسلم ايدك|ربنا يباركلك|الله يبارك فيك|الله ينور|يعطيك العافيه|مشكور|كتر خيرك|جزاك الله|ممتاز شكرا|تمام شكرا|مع السلامه|باي)${AR_END}`
    ).test(norm) &&
    wordCount <= 8 &&
    !hasAgriTopic
  ) {
    return {
      reply:
        'العفو يا أهلاً وسهلاً بحضرتك! 🌱 يسعدنا دايماً خدمتك في **مجموعة الهلب (ELHELB GROUP)**.\n' +
        'أنا موجود معاك في أي وقت لو حبيت تسأل عن أي محصول أو مبيد أو ترفع صورة للإصابة. نتمنى لك موسماً زراعياً ناجحاً وحصاداً وفيراً!',
      suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
    };
  }

  // 2) التحيات (بما فيها "هلا" و"السلام عليكم" و"إزيك")
  if (
    new RegExp(
      `^(?:هلا|يا هلا|ياهلا|هلا والله|هلا بيك|اهلا|اهلين|مرحبا|مراحب|السلام عليكم|سلام عليكم|وعليكم السلام|سلام|صباح الخير|صباح الفل|مساء الخير|مساء النور|ازيك|ازيكم|عامل ايه|اخبارك|كيفك|شلونك|هاي|الو|يا هندسه|يا بشمهندس|لو سمحت|ممكن سؤال|ممكن مساعده|عاوز مساعده|محتاج مساعده|hi|hello|hey)${AR_END}`
    ).test(norm) &&
    wordCount <= 8 &&
    !hasAgriTopic
  ) {
    return {
      reply:
        'يا هلا وأهلاً وسهلاً بحضرتك في **المساعد الذكي لمجموعة الهلب (ELHELB GROUP)** 👋🌱\n\n' +
        'نوّرتنا! اكتب سؤالك أو اتكلم بالميكروفون لو أسهل لك؛ هحوّل كلامك لنص وأتابع معاك هنا بالكتابة.\n' +
        '- لو عندك **مشكلة في الزرع**، ابعت اسم المحصول ووصف العرض أو صورة واضحة.\n' +
        '- أو اسألني عن **منتجات مجموعة الهلب واستخداماتها**.\n\n' +
        'تحب نبدأ بإيه؟',
      suggestions: GENERAL_STARTER_SUGGESTIONS,
    };
  }

  // 2b) كلام عادي: تحية بصيغة تانية، مين انت، بتعمل إيه، بتفهم عربي، مش فاهم
  if (!hasAgriTopic && wordCount <= 8) {
    if (/(?:انت مين|مين انت|انت ايه|اسمك|اسمك ايه|انت روبوت|انت انسان|انت بني ادم|انت ذكاء|انت شات)/.test(norm)) {
      return {
        reply:
          'أنا **المساعد الذكي لمجموعة الهلب (ELHELB GROUP)** 🌱\n' +
          'مساعد متخصص في **منتجات الهلب ومشاكل المحاصيل**: بجاوب على أسئلة المبيدات والأسمدة، وبرشحلك المنتج المناسب لمشكلتك. ' +
          'أنا برنامج مش إنسان، ومعلوماتي محدودة بدليل الشركة، فأي جرعة لازم تتأكد منها من ملصق العبوة.',
        suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
      };
    }
    if (/(?:بتعمل ايه|بتعمل اي|تعمل ايه|تقدر تعمل|بتعرف تعمل|تساعدني في ايه|تقدر تساعدني|بتفيد في ايه|وظيفتك|مجالك|بتشتغل ايه|تساعدني|تفيدني|تنفعني|بتنفع في ايه)/.test(norm)) {
      return {
        reply:
          'أقدر أساعدك في 3 حاجات 🌱\n' +
          '1. **تشخيص مشكلة في الزرع**: اكتب وصفك أو اتكلم بالميكروفون أو ابعت صورة واضحة.\n' +
          '2. **معلومات عن أي منتج**: المادة الفعالة وأحجام العبوات والاستخدام.\n' +
          '3. **التواصل مع الشركة**: أرقام المبيعات والتصدير والموزعين. هرد عليك كتابةً، ولو نقصتني معلومة هسألك عنها خطوة خطوة.',
        suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
      };
    }
    if (/(?:بتفهم عربي|بتتكلم عربي|بتعرف عربي|بتفهمني|فاهمني|سامعني|بتسمعني|بتفهم كلامي|بتفهم مصري|بتفهم عامي)/.test(norm)) {
      return {
        reply:
          'أيوه، بفهم عربي وبالعامية المصرية كمان 👍 اكتب مشكلتك أو اتكلم بالميكروفون؛ هحوّل كلامك لنص وأرد عليك كتابة. ' +
          'ولو فهمت حاجة غلط قولي وأنا أعدّل.',
        suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
      };
    }
    if (/(?:مش فاهم|مفهمتش|مفهمتك|فهمتش|ماسمعتش|مسمعتش|مش مفهوم|مش واضح|اعد|كرر|قول تاني|مش فاهمك)/.test(norm)) {
      return {
        reply:
          'معلش، ممكن أكون ما فهمتش قصدك 🙏 جرّب تقولي بالشكل ده:\n' +
          '- **المحصول** + **اللي شايفه**: *"البطاطس عليها بقع بني"*\n' +
          '- أو **اسم المنتج** اللي عايز تسأل عنه: *"كابيتول"*\n' +
          '- أو *"عايز أكلم المبيعات"*',
        suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
      };
    }
    // تحية أو سؤال "ازيك/عامل ايه" في أي مكان من الجملة القصيرة (مثلاً "اهلا ازيك" أو "ازيك يا باشا عامل ايه")
    if (/(?:^|\s)(?:ازيك|ازيكم|عامل ايه|عاملين ايه|اخبارك|ايه الاخبار|ايه اخبارك|كيف حالك|كيفك|شلونك|صباح الخير|صباح الفل|مساء الخير|مساء النور|اهلا|اهلين|مرحبا|هلا|السلام عليكم|سلام عليكم)(?=\s|$)/.test(norm)) {
      return {
        reply:
          'أهلاً بحضرتك، أنا تمام الحمد لله 🌱 نورتنا!\n' +
          'أنا المساعد الذكي لمجموعة الهلب. قولي عندك مشكلة في أنهي محصول، أو عايز تسأل عن أنهي منتج؟',
        suggestions: GENERAL_STARTER_SUGGESTIONS,
      };
    }
  }

  // 2c) شكوى اصفرار أو ذبول عامة بدون تحديد: اسأل الأول، لأن الأسباب كتير والتشخيص بالتخمين غلط
  if (/(?:اصفرار|ذبول)/.test(norm) && !SYMPTOM_RULES.some((r) => r.pattern.test(norm))) {
    return {
      reply:
        '🌿 **الاصفرار والذبول ليهم أسباب كتير**، ومش هخمّن علاج قبل ما أتأكد. قولي:\n' +
        '1. **المحصول إيه**؟ وعمره كام؟\n' +
        '2. الاصفرار في **الورق القديم (تحت)** ولا **الورق الجديد (فوق)**؟ وهل **بين العروق** ولا على الورقة كلها؟\n' +
        '3. فيه **عنكبوت أو حشرات** ورا الورقة؟ و**الجذور** شكلها إيه (عقد أو تعفن)؟\n\n' +
        'لو السبب نقص عناصر، دليل الهلب بيرشح مغذيات زي **Super Plant Care 20-20-20** أو **Fine 19-19-19**، أو عناصر صغرى (**زنك، منجنيز، حديد**) حسب الاحتياج، والجرعة بتتحدد من ملصق المنتج.',
      suggestions: [
        'الاصفرار في الورق الجديد بين العروق',
        'فيه عنكبوت أحمر ورا الورقة',
        'الجذور فيها عقد',
      ],
    };
  }

  // 3) تمام / ماشي / طيب
  if (
    new RegExp(`^(?:تمام|ماشي|طيب|حلو|جميل|فهمت|وصلت|اوكي|ايوه|اه|نعم|ok|yes)${AR_END}`).test(norm) &&
    wordCount <= 3 &&
    !hasAgriTopic
  ) {
    const recentContext = normalizeArabicClient(history.slice(-4).map((message) => message.content || '').join(' '));
    const recentProduct = PRODUCT_CATALOG.find((product) =>
      [product.name, ...product.keys].some((key) => recentContext.includes(normalizeArabicClient(key)))
    );
    return {
      reply: recentProduct
        ? `تمام يا فندم، أنا متابع معاك بخصوص **${recentProduct.name}**. تحب تعرف المادة الفعالة، العبوات المتاحة، ولا طريقة الاستخدام المسجلة؟`
        : 'تمام يا فندم، أنا معاك. قولي اسم المحصول أو المنتج اللي حابب تعرف عنه، ونمشي في الموضوع خطوة خطوة.',
      suggestions: recentProduct
        ? [`ما المادة الفعالة في ${recentProduct.name}؟`, `ما أحجام عبوات ${recentProduct.name}؟`, 'إيه طريقة الاستخدام المسجلة؟']
        : GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
    };
  }

  // 4) طلب إرسال صورة
  if (/(?:ابعتلك صور|هبعتلك صور|ابعت صور|ارسل صور|اصورلك|اشوف الصور|شوف الصور|معايا صور|عندي صور)/.test(norm)) {
    return {
      reply:
        'أكيد طبعاً اتفضل! 📷🌱\n\n' +
        'اضغط على **علامة الصورة الموجودة جنب مربع الكتابة تحت** (أو اعمل لصق للصورة مباشرة)، وابعتلي **صورة الورقة المصابة عن قرب** وهفحصها معاك فوراً وأقولك التشخيص والعلاج المظبوط من مجموعة الهلب!',
      suggestions: [
        'الزرع فيه بقع بنية وحروق على الورق',
        'فيه اصفرار وعنكبوت تحت الورقة',
        'الزرع بيدبل من الجذور',
      ],
    };
  }

  // 5) تكرار ونصائح الرش
  if (/(?:اكرر الرش|كل كام يوم|بين الرشه والرشه|نصائح الرش|توقيت الرش|امتي ارش)/.test(norm)) {
    return {
      reply:
        '⏱️ **برنامج تكرار الرش وإرشادات التطبيق السليم من عيادة الهلب الزراعية:**\n' +
        '- **الفاصل الزمني بين الرشات:** يُكرر الرش كل **7 إلى 10 أيام** (وفي حالة الرطوبة العالية واشتداد الندوة تكون الرشة التانية بعد **7 أيام**).\n' +
        '- **تبادل المواد الفعالة:** ابدأ مثلاً بـ **تازولين 72% WP**، والرشة التالية بـ **دودجو 68% WG** أو **توربو 72% WP** لمنع تكوين مناعة للفطر.\n' +
        '- **أفضل وقت للرش:** في الصباح الباكر بعد تطاير الندى أو قبل الغروب.',
      suggestions: [
        'إزاي أتواصل لطلب تازولين ودودجو؟',
        'عندي كمان حفار تحت التربة في البطاطس',
        'شكراً جزيلاً يا هندسة',
      ],
    };
  }

  // 6) تاريخ وهوية الشركة والتصدير والتواصل
  if (
    /(?:تاريخ|تاسست|مؤسس|عبد الرحمن السماحي|نبذه عن|عن مجموعه الهلب|قطاعات|تصنيع للغير|تصدير|كم دوله|بكام|سعره كام|الاسعار|اشتري منين|موزع|مبيعات|رقم التليفون|اتواصل|عنوان الشركه)/.test(
      norm
    )
  ) {
    return {
      reply:
        '**مجموعة الهلب للكيماويات الزراعية (ELHELB GROUP)** تأسست عام **1993** على يد **م. عبد الرحمن السماحي** تحت شعار *«علامة ترسم البسمة وقت الحصاد»*:\n' +
        '- 🏭 **قطاعات العمل:** أكثر من **91 مستحضراً معتمداً** (مبيدات حشرية، فطرية، أكاروسية، نيماتودا، حشائش، و20 مستحضر أسمدة ومغذيات محاصيل) + خدمات **التصنيع للغير (Toll Manufacturing)**.\n' +
        '- 🌍 **التصدير العالمي:** تصدّر المجموعة منتجاتها لأكثر من **22 دولة حول العالم**.\n' +
        '- 📞 **للتواصل والأسعار والموزعين المعتمدين:**\n' +
        '  • داخل مصر: `201011112221`\n' +
        '  • التصدير وخارج مصر: `201094460002`\n' +
        '  • المكتب الإقليمي: 34 شارع جامعة الدول العربية — الجيزة، مصر.',
      suggestions: [
        'إيه أهم منتجات ومبيدات مجموعة الهلب؟',
        'رشحلي برنامج مكافحة لمحصول البطاطس',
        'إيه أفضل مبيد للعنكبوت الأحمر؟',
      ],
    };
  }

  // 7) سؤال عام عن المنتجات
  if (/(?:ايه المنتجات|منتجات الشركه|منتجاتكم|عندكم ايه|عندكم مبيدات ايه|بتبيعوا ايه|انواع المبيدات|ايه المبيدات)/.test(norm)) {
    return {
      reply:
        'تضم **مجموعة الهلب (ELHELB GROUP)** أكثر من **91 مستحضراً زراعياً مسجلاً ومعتمداً**:\n' +
        '- 🐛 **مبيدات حشرية (29 مستحضراً):** `بيريبان 48%`، `هلبان 48%`، `بيست 25%`، `كورد 72%`، `مالاتوكس`، والزيوت المعدنية `دايفر 97%`.\n' +
        '- 🕷️ **مبيدات الأكاروس والعنكبوت الأحمر (9 مستحضرات):** `كابيتول 24% SC`، `جولد 1.8% EC`، `هلب ستار 20% EC`، و `برنس 10% EC`.\n' +
        '- 🍄 **مبيدات فطرية وكبريت ميكروني (13 مستحضراً):** `أنادول 80%`، `تازولين 72%`، `رولكس 50%`، `دودجو 68%`، و `إتش سلفر 80%`.\n' +
        '- 🌱 **مبيدات نيماتودا (`لافيدا 24%` و `نيما بروب 10%`) ومبيدات حشائش + 20 مستحضر أسمدة ومغذيات**.\n\n' +
        'قولي اسم المحصول أو الآفة اللي عندك وهارشحلك المستحضر المناسب فوراً!',
      suggestions: [
        'رشحلي برنامج لمحصول البطاطس',
        'إيه أفضل مبيد للعنكبوت الأحمر وسوسة الطماطم؟',
        'إيه مبيدات النيماتودا المتوفرة؟',
      ],
    };
  }

  // 8) شكوى عامة بدون عرض محدد
  const mentionsSick =
    /(?:الزرع تعبان|المحصول بايظ|الزرع بيموت|الزرع دبلان|الورق تعبان|عندي مشكله|عندي اصابه|ارش ايه|محتاج علاج|انصحني بمبيد|البطاطس تعبانه|الطماطم تعبانه)/.test(
      norm
    );
  const hasSpecificSymptom = SYMPTOM_RULES.some((r) => r.pattern.test(norm));
  if (mentionsSick && !hasSpecificSymptom) {
    return {
      reply:
        'ألف سلامة على زرعك ومحصولك! 🌱 أنا معاك خطوة بخطوة ونبدأ بالمعلومة الأهم: **اسم المحصول إيه؟** وبعدها هسألك عن العرض الظاهر ونحدد الاحتمالات بهدوء.\n\n' +
        'لو أسهل، اتكلم بالميكروفون أو ابعت صورة قريبة للجزء المصاب، واختار أقرب وصف من الاختيارات تحت.',
      suggestions: [
        'الزرع بيدبل ومقروض من تحت الأرض',
        'فيه نقط وبقع بني محروقة على الورق',
        'فيه حشرات بيضا بتطير ومن على الورق',
        'فيه عنكبوت أحمر واصفرار في ضهر الورقة',
      ],
    };
  }

  // 9) مطابقة الأعراض باللهجة العامية
  for (const rule of SYMPTOM_RULES) {
    if (rule.pattern.test(norm)) {
      return {
        reply: `🌱 **${rule.title}:**\n\n${rule.advice}`,
        suggestions: rule.followUps,
      };
    }
  }

  // 10) البحث في المنتجات (مع دعم أسئلة المتابعة من المحادثة السابقة مثل "طب العبوات المتوفرة منه إيه؟")
  let searchSpace = norm;
  if (/(?:منه|بتاعه|بتاعته|العبوات|عبواته|مادته|تركيزه|جرعته)/.test(norm) && history.length > 0) {
    const recent = normalizeArabicClient(
      history
        .slice(-3)
        .map((m) => m.content || '')
        .join(' ')
    );
    searchSpace = `${norm} ${recent}`;
  }

  const matchedProducts = PRODUCT_CATALOG.filter((p) =>
    p.keys.some((k) => searchSpace.includes(normalizeArabicClient(k)))
  );

  if (matchedProducts.length > 0) {
    const lines = matchedProducts.map(
      (p) =>
        `🧪 **${p.name}** — *(${p.category})*\n` +
        `- **المادة الفعالة:** ${p.active}\n` +
        `- **العبوات المتوفرة:** ${p.packs}\n` +
        `- **الاستخدام والتوصية:** ${p.usage}`
    );
    return {
      reply: lines.join('\n\n'),
      suggestions: [
        'أكرر الرش كل كام يوم؟',
        'إزاي أتواصل مع المبيعات لطلب المنتج؟',
        'عاوز أسأل عن آفة أو محصول تاني',
      ],
    };
  }

  // 11) برامج المحاصيل
  if (/بطاطس/.test(norm)) {
    return {
      reply:
        '🌱 **برنامج حماية محصول البطاطس المعتمد من مجموعة الهلب:**\n' +
        '- **الحفار والديدان القارضة:** **بيريبان 48% EC** (`1 لتر / فدان` طعم سام سرسبة عند الغروب).\n' +
        '- **الندوة المبكرة والمتأخرة:** **أنادول 80% WP** وقائياً، و **تازولين 72% WP** أو **دودجو 68% WG** علاجياً.\n' +
        '- **نيماتودا الدرنات والجذور:** **نيما بروب 10% GR** أو **لافيدا 24% SL**.\n' +
        '- **المن والذبابة البيضاء:** **بيست 25% WP**.',
      suggestions: [
        'عندي حفار وتخريم في درنات البطاطس',
        'عندي بقع بني وندوة على ورق البطاطس',
        'إيه أحجام عبوات بيريبان وتازولين؟',
      ],
    };
  }

  if (/طماطم|قوطه/.test(norm)) {
    return {
      reply:
        '🌱 **برنامج حماية محصول الطماطم من عيادة الهلب الزراعية:**\n' +
        '- **سوسة الطماطم (التوتا أبسلوتا) والعنكبوت الأحمر:** الرش بالتبادل بين **كابيتول 24% SC** و **جولد 1.8% EC**.\n' +
        '- **الذبابة البيضاء والمن والتربس:** **بيست 25% WP**.\n' +
        '- **الندوات الفطرية:** **أنادول 80% WP** و **تازولين 72% WP**.\n' +
        '- **نيماتودا الجذور:** **لافيدا 24% SL**.',
      suggestions: [
        'عندي سوسة الطماطم (توتا) وصانعات أنفاق',
        'عندي ذبابة بيضاء وتجعد أوراق في الطماطم',
      ],
    };
  }

  return {
    reply:
      'أنا معاك عشان أساعدك في أي حاجة تخص زراعتك ومنتجات **مجموعة الهلب** 🌱\n\n' +
      'عشان أفيدك بأدق إجابة، قولي بكلامك العادي:\n' +
      '- **زارع محصول إيه وإيه المشكلة أو العرض اللي ملاحظه في الأرض؟** (أو ابعتلي صورة الورقة 📷)\n' +
      '- أو **اسم المبيد** اللي حابب تعرف مادته الفعالة ومعدل رشه وأحجام عبواته؟',
    suggestions: GENERAL_STARTER_SUGGESTIONS.slice(0, 3),
  };
}
