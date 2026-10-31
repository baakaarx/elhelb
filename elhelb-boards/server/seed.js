const bcrypt = require('bcryptjs');
const { get, run, transaction, getSetting, setSetting } = require('./db');

const PERMISSIONS_CATALOG = [
  // 1. اللوحات والأقسام
  {
    key: 'boards.view_department',
    name: 'عرض لوحات القسم التابع له',
    description: 'يسمح للموظف برؤية وفتح لوحات العمل المرتبطة بقسمه فقط',
    category: 'boards',
    category_label: 'صلاحيات اللوحات والأقسام',
    sort_order: 10,
  },
  {
    key: 'boards.view_all',
    name: 'عرض لوحات جميع أقسام الشركة',
    description: 'صلاحية عليا تتيح الاطلاع على لوحات كافة الأقسام بلا قيود عزل',
    category: 'boards',
    category_label: 'صلاحيات اللوحات والأقسام',
    sort_order: 20,
  },
  {
    key: 'boards.create',
    name: 'إنشاء لوحات عمل جديدة',
    description: 'إنشاء لوحة مهام جديدة وربطها بالقسم المختص',
    category: 'boards',
    category_label: 'صلاحيات اللوحات والأقسام',
    sort_order: 30,
  },
  {
    key: 'boards.edit',
    name: 'تعديل إعدادات اللوحة وتصنيفاتها',
    description: 'تعديل اسم اللوحة، الوصف، الخلفية، وإدارة التصنيفات الملونة',
    category: 'boards',
    category_label: 'صلاحيات اللوحات والأقسام',
    sort_order: 40,
  },
  {
    key: 'boards.delete',
    name: 'حذف أو أرشفة لوحات العمل',
    description: 'حذف لوحة عمل بالكامل مع قوائمها وكروتها',
    category: 'boards',
    category_label: 'صلاحيات اللوحات والأقسام',
    sort_order: 50,
  },

  // 2. القوائم (Lists)
  {
    key: 'lists.create',
    name: 'إضافة قوائم مراحل عمل (Lists)',
    description: 'إضافة أعمدة/قوائم جديدة داخل اللوحة (مثل: قيد التنفيذ، مكتمل)',
    category: 'lists',
    category_label: 'صلاحيات القوائم والمراحل',
    sort_order: 60,
  },
  {
    key: 'lists.edit',
    name: 'تعديل أسماء وترتيب القوائم',
    description: 'إعادة تسمية قوائم اللوحة أو تغيير ترتيبها',
    category: 'lists',
    category_label: 'صلاحيات القوائم والمراحل',
    sort_order: 70,
  },
  {
    key: 'lists.delete',
    name: 'حذف القوائم من اللوحة',
    description: 'إزالة قائمة ومحتوياتها من لوحة العمل',
    category: 'lists',
    category_label: 'صلاحيات القوائم والمراحل',
    sort_order: 80,
  },

  // 3. الكروت والمهام (Cards)
  {
    key: 'cards.create',
    name: 'إضافة كروت ومهام جديدة',
    description: 'إنشاء بطاقات مهام جديدة داخل قوائم اللوحة',
    category: 'cards',
    category_label: 'صلاحيات الكروت والمهام',
    sort_order: 90,
  },
  {
    key: 'cards.edit',
    name: 'تعديل تفاصيل الكروت وقوائم التحقق',
    description: 'تحديث عنوان الكارت، الوصف، الأولوية، تاريخ التسليم، والمهام الفرعية',
    category: 'cards',
    category_label: 'صلاحيات الكروت والمهام',
    sort_order: 100,
  },
  {
    key: 'cards.move',
    name: 'تحريك ونقل الكروت بين القوائم',
    description: 'سحب وإفلات الكروت لتغيير مرحلة تنفيذ المهمة',
    category: 'cards',
    category_label: 'صلاحيات الكروت والمهام',
    sort_order: 110,
  },
  {
    key: 'cards.assign',
    name: 'تعيين الموظفين المسؤولين عن الكارت',
    description: 'إسناد المهمة لموظف أو أكثر داخل القسم',
    category: 'cards',
    category_label: 'صلاحيات الكروت والمهام',
    sort_order: 120,
  },
  {
    key: 'cards.delete',
    name: 'حذف الكروت والمهام نهائياً',
    description: 'مسح بطاقة مهمة من اللوحة بشكل نهائي',
    category: 'cards',
    category_label: 'صلاحيات الكروت والمهام',
    sort_order: 130,
  },

  // 4. التعليقات والتعاون
  {
    key: 'comments.create',
    name: 'كتابة التعليقات والملاحظات',
    description: 'إضافة تعليقات وتحديثات العمل على الكروت',
    category: 'collaboration',
    category_label: 'التعليقات والتواصل',
    sort_order: 140,
  },
  {
    key: 'comments.delete_any',
    name: 'حذف تعليقات الآخرين (إشراف)',
    description: 'إزالة أي تعليق مخالف أو خاطئ داخل لوحات القسم',
    category: 'collaboration',
    category_label: 'التعليقات والتواصل',
    sort_order: 150,
  },

  // 5. إدارة الموظفين وتسكين الأقسام وطلبات الصلاحيات
  {
    key: 'department.onboard_members',
    name: 'ضم وتسكين الموظفين الجدد في القسم',
    description: 'يسمح بقبول وتسكين الموظفين الجدد وتحديد دورهم داخل القسم التابع له',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 155,
  },
  {
    key: 'requests.review_department',
    name: 'اعتماد طلبات الصلاحيات لموظفي القسم',
    description: 'مراجعة وقبول أو رفض طلبات الاستثناء المؤقتة داخل نفس القسم',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 160,
  },
  {
    key: 'requests.review_all',
    name: 'اعتماد طلبات الصلاحيات لجميع الأقسام',
    description: 'مراجعة ومنح تصاريح العمل المؤقتة أو العابرة للأقسام على مستوى الشركة',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 170,
  },
  {
    key: 'users.manage',
    name: 'إدارة وتسكين وحذف حسابات الموظفين على مستوى الشركة (HR / الإدارة)',
    description: 'تسجيل موظفين جدد، قبول وتسكين المسجلين في كافة الأقسام، تعديل الأدوار والأقسام، إيقاف الحسابات، أو الحذف النهائي لمن ترك العمل',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 180,
  },
  {
    key: 'roles.manage',
    name: 'إدارة الأدوار ومصفوفة الصلاحيات (DB)',
    description: 'إنشاء وتعديل الأدوار وتفعيل/إلغاء الصلاحيات مباشرة في قاعدة البيانات',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 190,
  },
  {
    key: 'departments.manage',
    name: 'إدارة هيكل أقسام الشركة',
    description: 'إضافة أو تعديل أو حذف الأقسام الإدارية والتشغيلية بالشركة',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 200,
  },
  {
    key: 'audit.view',
    name: 'الاطلاع على سجل المراقبة الأمنية (Audit Log)',
    description: 'مراجعة كافة العمليات المسموحة والمرفوضة أمنياً على السيرفر',
    category: 'governance',
    category_label: 'إدارة الموارد البشرية والأقسام والنظام',
    sort_order: 210,
  },
];

function seedIfNeeded() {
  for (const p of PERMISSIONS_CATALOG) {
    run(
      `INSERT INTO permissions (key, name, description, category, category_label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         category = excluded.category,
         category_label = excluded.category_label,
         sort_order = excluded.sort_order`,
      [p.key, p.name, p.description, p.category, p.category_label, p.sort_order]
    );
  }

  // Transparently upgrade any legacy plaintext secret settings in existing DBs to AES-256-GCM
  for (const secretKey of ['gmail_app_password', 'google_client_secret']) {
    const curVal = getSetting(secretKey, '');
    if (curVal && !String(curVal).startsWith('enc:v1:')) {
      const { encryptSecretValue } = require('./rbac');
      setSetting(secretKey, encryptSecretValue(curVal));
    }
  }

  const HR_ROLE_DEFAULT_PERMS = [
    'users.manage',
    'department.onboard_members',
    'boards.view_department',
    'boards.create',
    'boards.edit',
    'lists.create',
    'lists.edit',
    'lists.delete',
    'cards.create',
    'cards.edit',
    'cards.move',
    'cards.assign',
    'cards.delete',
    'comments.create',
    'comments.delete_any',
    'requests.review_department',
  ];

  const OFFICIAL_DEPARTMENTS = [
    {
      slug: 'export',
      name: 'قسم التصدير والشحن الدولي',
      description: 'إدارة عقود التصدير الخارجية، الشحن البحري والجوي، الاعتمادات المستندية، والأسواق الدولية',
      color: '#0284c7',
      icon: 'globe',
      boardTitle: 'لوحة أعمال قسم التصدير والشحن الدولي',
      boardBg: 'ocean',
      isChairmanExclusive: 0,
    },
    {
      slug: 'customs',
      name: 'قسم التخليص الجمركي واللوجستيات والموانئ',
      description: 'متابعة منظومة نافذة (ACI)، الإفراج الجمركي للخامات الواردة، شهادات الصادر بالموانئ، البوليصة الملاحية، وحجز الحاويات والنقل',
      color: '#0369a1',
      icon: 'anchor',
      boardTitle: 'لوحة أعمال التخليص الجمركي واللوجستيات والموانئ',
      boardBg: 'ocean',
      isChairmanExclusive: 0,
      lists: [
        'شحنات جديدة وتسجيل نافذة (ACI)',
        'الفحص والرقابة وسحب العينات',
        'سداد الرسوم والإفراج الجمركي',
        'النقل للمصانع / الشحن البحري ✅',
      ],
      labels: [
        ['نافذة ACI', '#0284c7'],
        ['وارد خامات', '#d97706'],
        ['صادر دولي', '#7c3aed'],
        ['تم الإفراج', '#059669'],
      ],
    },
    {
      slug: 'registration',
      name: 'قسم تسجيل المنتجات والتراخيص',
      description: 'إعداد الملفات الفنية، تسجيل المنتجات بالهيئات الرقابية، الشهادات الصحية، وتجديد التراخيص',
      color: '#7c3aed',
      icon: 'file-check',
      boardTitle: 'لوحة أعمال قسم تسجيل المنتجات والتراخيص',
      boardBg: 'purple',
      isChairmanExclusive: 0,
    },
    {
      slug: 'production',
      name: 'قسم المصانع والإنتاج والتعبئة',
      description: 'إدارة خطوط التصنيع والخلط والتعبئة بمصانع المجموعة، أوامر التشغيل، وتجهيز طلبيات التصدير والسوق المحلي',
      color: '#b45309',
      icon: 'factory',
      boardTitle: 'لوحة أعمال المصانع وخطوط الإنتاج والتعبئة',
      boardBg: 'gold',
      isChairmanExclusive: 0,
      lists: [
        'أوامر التشغيل المطلوبة',
        'تحت التصنيع والخلط',
        'التعبئة والتغليف والترقيم',
        'جاهز للتسليم للمخازن ✅',
      ],
      labels: [
        ['طلبيات تصدير', '#0284c7'],
        ['سوق محلي', '#b45309'],
        ['تشغيلة عاجلة', '#dc2626'],
        ['تم الإنتاج', '#059669'],
      ],
    },
    {
      slug: 'qc_labs',
      name: 'قسم المعامل ورقابة الجودة (QC)',
      description: 'الفحص المعملي للخامات والمنتج النهائي، مطابقة المواصفات القياسية، وإصدار شهادات التحليل (COA) للتصدير والجمارك',
      color: '#6d28d9',
      icon: 'flask',
      boardTitle: 'لوحة أعمال المعامل المركزية ورقابة الجودة (QC)',
      boardBg: 'purple',
      isChairmanExclusive: 0,
      lists: [
        'عينات واردة للفحص',
        'جاري التحليل المعملي',
        'مراجعة وإصدار شهادة (COA)',
        'مطابق للمواصفات ومعتمد ✅',
      ],
      labels: [
        ['شهادة COA', '#7c3aed'],
        ['فحص خامات', '#d97706'],
        ['مطابقة تصدير', '#0284c7'],
        ['معتمد معملياً', '#059669'],
      ],
    },
    {
      slug: 'warehouses',
      name: 'قسم المخازن وإدارة الإمداد',
      description: 'إدارة مخازن الخامات والعبوات والمنتج التام، أذون الاستلام والصرف، الجرد الدوري، وتجهيز الحاويات للشحن',
      color: '#047857',
      icon: 'warehouse',
      boardTitle: 'لوحة أعمال المخازن المركزية وإدارة الإمداد',
      boardBg: 'emerald',
      isChairmanExclusive: 0,
      lists: [
        'أذون استلام وصرف جديدة',
        'تجهيز وتجميع الطلبيات',
        'تحميل وتستيف الحاويات',
        'تم الصرف والجرد ✅',
      ],
      labels: [
        ['مخزن الخامات', '#d97706'],
        ['مخزن العبوات', '#0a6fa8'],
        ['منتج تام', '#059669'],
        ['تجهيز حاوية', '#7c3aed'],
      ],
    },
    {
      slug: 'agri_support',
      name: 'قسم الدعم الفني الزراعي والتجارب الحقلية',
      description: 'المتابعة الفنية للمزارع الكبرى، التجارب الحقلية للمبيدات والأسمدة، وبرامج وقاية وتغذية المحاصيل',
      color: '#15803d',
      icon: 'sprout',
      boardTitle: 'لوحة أعمال الدعم الفني الزراعي والتجارب الحقلية',
      boardBg: 'emerald',
      isChairmanExclusive: 0,
      lists: [
        'زيارات وبرامج حقلية مطلوبة',
        'تحت التطبيق والمتابعة بالمزارع',
        'تقييم النتائج والتوصيات الفنية',
        'تقرير حقلي مكتمل ✅',
      ],
      labels: [
        ['تجربة حقلية', '#15803d'],
        ['كبار المزارع', '#b45309'],
        ['وقاية المزروعات', '#dc2626'],
        ['تغذية النبات', '#059669'],
      ],
    },
    {
      slug: 'it',
      name: 'قسم تكنولوجيا المعلومات (IT)',
      description: 'إدارة الأنظمة والمنصات الرقمية، صلاحيات الحسابات، الشبكات، أمن المعلومات، والدعم الفني',
      color: '#2563eb',
      icon: 'cpu',
      boardTitle: 'لوحة أعمال قسم تكنولوجيا المعلومات (IT)',
      boardBg: 'royal',
      isChairmanExclusive: 0,
    },
    {
      slug: 'sales',
      name: 'قسم المبيعات والتعاقدات',
      description: 'إدارة عروض الأسعار، صفقات الشركات بالسوق المحلي، ومتابعة حسابات كبار العملاء',
      color: '#0a6fa8',
      icon: 'trending-up',
      boardTitle: 'لوحة أعمال قسم المبيعات والتعاقدات',
      boardBg: 'gold',
      isChairmanExclusive: 0,
    },
    {
      slug: 'procurement',
      name: 'قسم المشتريات والتوريدات',
      description: 'إدارة الموردين، أوامر الشراء المحلية والدولية، الخامات، والمخازن المركزية',
      color: '#059669',
      icon: 'package',
      boardTitle: 'لوحة أعمال قسم المشتريات والتوريدات',
      boardBg: 'emerald',
      isChairmanExclusive: 0,
    },
    {
      slug: 'media',
      name: 'قسم الميديا والتسويق',
      description: 'الهوية البصرية، الكتالوجات التصديرية، التصميم الجرافيكي، والحملات الرقمية',
      color: '#db2777',
      icon: 'megaphone',
      boardTitle: 'لوحة أعمال قسم الميديا والتسويق',
      boardBg: 'crimson',
      isChairmanExclusive: 0,
    },
    {
      slug: 'hr',
      name: 'قسم الموارد البشرية',
      description: 'استقطاب الكفاءات، مسوغات التعيين، الحضور والانصراف، وتقييم الأداء الإداري',
      color: '#d97706',
      icon: 'users',
      boardTitle: 'لوحة أعمال قسم الموارد البشرية',
      boardBg: 'slate',
      isChairmanExclusive: 0,
    },
    {
      slug: 'finance',
      name: 'قسم الحسابات والمالية',
      description: 'المراجعة المالية، الفواتير الضريبية، التحصيلات، وتسوية الاعتمادات البنكية',
      color: '#0d9488',
      icon: 'landmark',
      boardTitle: 'لوحة أعمال قسم الحسابات والمالية',
      boardBg: 'sunset',
      isChairmanExclusive: 0,
    },
    {
      slug: 'ai_systems',
      name: 'قسم الذكاء الاصطناعي وتطوير الأنظمة (AI)',
      description: 'تطوير أنظمة الذكاء الاصطناعي والمنصات الرقمية والأتمتة الخاصة بمجموعة الهلب — يتبع رئيس مجلس الإدارة مباشرةً بخصوصية سيادية كاملة',
      color: '#92400e',
      icon: 'sparkles',
      boardTitle: 'لوحة تكليفات ومشاريع الذكاء الاصطناعي (مكتب رئيس مجلس الإدارة)',
      boardBg: 'royal',
      isChairmanExclusive: 1,
      lists: [
        'تكليفات جديدة من رئيس مجلس الإدارة',
        'قيد التطوير والتنفيذ (AI & Dev)',
        'جاهز لعرض ومراجعة رئيس مجلس الإدارة',
        'تم الاعتماد والتشغيل ✅',
      ],
      labels: [
        ['تكليف سيادي عاجل', '#dc2626'],
        ['ذكاء اصطناعي (AI)', '#7c3aed'],
        ['تطوير منصات وأنظمة', '#2563eb'],
        ['معتمد من رئيس مجلس الإدارة', '#059669'],
      ],
    },
  ];

  const defaultLists = [
    'المهام الجديدة',
    'جاري العمل عليها',
    'قيد المراجعة والاعتماد',
    'مكتمل ✅',
  ];
  const defaultLabels = [
    ['عاجل', '#dc2626'],
    ['مهم', '#d97706'],
    ['متابعة', '#0a6fa8'],
    ['معتمد', '#059669'],
  ];

  function createStarterBoardForDept(dept, creatorId) {
    const boardId = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [dept.boardTitle, dept.description, dept.id, dept.boardBg, creatorId]
    ).lastInsertRowid;

    const listsToUse = dept.lists || defaultLists;
    listsToUse.forEach((lTitle, idx) => {
      run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)`, [
        boardId,
        lTitle,
        idx + 1,
      ]);
    });

    const labelsToUse = dept.labels || defaultLabels;
    labelsToUse.forEach(([lName, lColor]) => {
      run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [
        boardId,
        lName,
        lColor,
      ]);
    });
  }

  const existingUsers = get(`SELECT COUNT(*) AS cnt FROM users`);
  if (existingUsers && existingUsers.cnt > 0) {
    transaction(() => {
      // Safe migration 1: ensure hr_manager role exists in pre-existing local databases
      const existingHrRole = get(`SELECT id FROM roles WHERE slug = 'hr_manager'`);
      if (!existingHrRole) {
        const hrRoleId = run(
          `INSERT INTO roles (slug, name, description, color, rank_level, is_protected)
           VALUES ('hr_manager', 'مسؤول الموارد البشرية (HR)', ?, '#d97706', 70, 1)`,
          [
            'قبول وتسكين الموظفين الجدد عبر كافة أقسام الشركة، إنشاء حسابات الموظفين، وحذف أو إيقاف حسابات من يترك العمل (مع عزله التشغيلي داخل لوحات قسم الموارد البشرية فقط)',
          ]
        ).lastInsertRowid;
        for (const k of HR_ROLE_DEFAULT_PERMS) {
          run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [
            hrRoleId,
            k,
          ]);
        }
      }

      // Safe migration 2: ensure any newly introduced official departments & starter boards exist
      const chairmanUser = get(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'chairman' ORDER BY u.id ASC LIMIT 1`
      );
      const creatorId = chairmanUser ? chairmanUser.id : null;

      for (const d of OFFICIAL_DEPARTMENTS) {
        let existingDept = get(`SELECT id, is_chairman_exclusive FROM departments WHERE slug = ?`, [
          d.slug,
        ]);
        if (!existingDept) {
          const newDeptId = run(
            `INSERT INTO departments (slug, name, description, color, icon, is_chairman_exclusive)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [d.slug, d.name, d.description, d.color, d.icon, d.isChairmanExclusive ? 1 : 0]
          ).lastInsertRowid;
          createStarterBoardForDept({ ...d, id: newDeptId }, creatorId);
        } else if (d.slug === 'ai_systems' && !existingDept.is_chairman_exclusive) {
          run(`UPDATE departments SET is_chairman_exclusive = 1 WHERE id = ?`, [existingDept.id]);
        }
      }
    });
    return;
  }

  // Sovereign Chairman (admin) irreversible bcrypt hash (cost=12) — override via ADMIN_INIT_PASSWORD if desired
  const adminPasswordHash = process.env.ADMIN_INIT_PASSWORD
    ? bcrypt.hashSync(process.env.ADMIN_INIT_PASSWORD, 12)
    : '$2a$12$nzDzqaKeSvRqLYoqCYggUufp8Za8HtCrk84n7GTjfvAHUsSH7hEWS';

  transaction(() => {
    // 1. Official ELHELB GROUP Departments (14 departments including Sovereign AI Office)
    const createdDepts = OFFICIAL_DEPARTMENTS.map((d) => {
      const id = run(
        `INSERT INTO departments (slug, name, description, color, icon, is_chairman_exclusive)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [d.slug, d.name, d.description, d.color, d.icon, d.isChairmanExclusive ? 1 : 0]
      ).lastInsertRowid;
      return { ...d, id };
    });

    // 2. Hierarchical Roles
    const chairmanRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 100, 1)`,
      [
        'chairman',
        'رئيس مجلس الإدارة',
        'السلطة السيادية الأعلى في الشركة — إشراف كامل على كافة الأقسام والمديرين والصلاحيات دون إمكانية المساس بحسابه',
        '#92400e',
      ]
    ).lastInsertRowid;

    const superAdminRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 90, 1)`,
      [
        'super_admin',
        'المدير العام',
        'إدارة تنفيذية شاملة لجميع أقسام الشركة واللوحات والموظفين ومصفوفة الصلاحيات',
        '#b45309',
      ]
    ).lastInsertRowid;

    const itAdminRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 80, 1)`,
      [
        'it_admin',
        'مسؤول تكنولوجيا المعلومات (IT)',
        'صلاحيات إدارية وتقنية مشتركة لإدارة حسابات الموظفين، الأقسام، الصلاحيات، وبوابات الدخول الرقمية',
        '#2563eb',
      ]
    ).lastInsertRowid;

    const hrMgrRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 70, 1)`,
      [
        'hr_manager',
        'مسؤول الموارد البشرية (HR)',
        'قبول وتسكين الموظفين الجدد عبر كافة أقسام الشركة، تسجيل حسابات الموظفين، وحذف أو إيقاف حسابات من يترك العمل (مع عزله التشغيلي داخل لوحات قسم الموارد البشرية فقط)',
        '#d97706',
      ]
    ).lastInsertRowid;

    const deptMgrRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 60, 1)`,
      [
        'dept_manager',
        'رئيس قسم',
        'إدارة شاملة للوحات ومهام القسم وتوزيع الأعمال واعتماد طلبات الصلاحيات داخل قسمه',
        '#0a6fa8',
      ]
    ).lastInsertRowid;

    const teamLeadRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 40, 0)`,
      [
        'team_lead',
        'مشرف فريق',
        'إنشاء وتعديل القوائم والكروت وتوزيع المهام على أعضاء الفريق داخل القسم بدون حذف اللوحات',
        '#4f46e5',
      ]
    ).lastInsertRowid;

    const staffRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 20, 0)`,
      [
        'staff',
        'موظف تنفيذي',
        'عرض لوحات القسم وإضافة وتعديل ونقل الكروت والتعليق عليها دون الحذف أو إنشاء لوحات',
        '#059669',
      ]
    ).lastInsertRowid;

    const viewerRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 10, 0)`,
      [
        'viewer',
        'متدرب / مشاهد',
        'صلاحية قراءة ومتابعة لوحات ومهام القسم فقط؛ يتطلب إذن رئيس القسم لأي إجراء تعديل',
        '#64748b',
      ]
    ).lastInsertRowid;

    run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 0, 1)`,
      [
        'pending_onboarding',
        'بانتظار اعتماد وتسكين الـ HR',
        'موظف جديد سجّل حسابه وينتظر قيام الموارد البشرية (HR) أو الإدارة العليا بقبوله وتسكينه في قسمه',
        '#94a3b8',
      ]
    );

    const assignPerms = (roleId, keys) => {
      for (const k of keys) {
        run(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [roleId, k]);
      }
    };

    const allPermKeys = PERMISSIONS_CATALOG.map((p) => p.key);

    assignPerms(chairmanRole, allPermKeys);
    assignPerms(superAdminRole, allPermKeys);
    assignPerms(
      itAdminRole,
      allPermKeys.filter((k) => k !== 'boards.delete')
    );
    assignPerms(hrMgrRole, HR_ROLE_DEFAULT_PERMS);

    assignPerms(deptMgrRole, [
      'boards.view_department',
      'boards.create',
      'boards.edit',
      'boards.delete',
      'lists.create',
      'lists.edit',
      'lists.delete',
      'cards.create',
      'cards.edit',
      'cards.move',
      'cards.assign',
      'cards.delete',
      'comments.create',
      'comments.delete_any',
      'requests.review_department',
    ]);

    assignPerms(teamLeadRole, [
      'boards.view_department',
      'lists.create',
      'lists.edit',
      'cards.create',
      'cards.edit',
      'cards.move',
      'cards.assign',
      'comments.create',
    ]);

    assignPerms(staffRole, [
      'boards.view_department',
      'cards.create',
      'cards.edit',
      'cards.move',
      'comments.create',
    ]);

    assignPerms(viewerRole, ['boards.view_department', 'comments.create']);

    // 3. ONLY ONE SOVEREIGN ACCOUNT: admin
    const adminUserId = run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title, avatar_color,
        auth_provider, has_custom_credentials, department_confirmed,
        onboarding_status, role_id, department_id
      ) VALUES (?, NULL, ?, ?, ?, '#92400e', 'local', 1, 1, 'approved', ?, NULL)`,
      [
        'admin',
        adminPasswordHash,
        'رئيس مجلس الإدارة',
        'رئيس مجلس الإدارة — المسؤول الأعلى للنظام',
        chairmanRole,
      ]
    ).lastInsertRowid;

    // 4. Clean Starter Board for each of the 14 company departments (zero fake users/cards)
    for (const dept of createdDepts) {
      createStarterBoardForDept(dept, adminUserId);
    }
  });
}

module.exports = {
  PERMISSIONS_CATALOG,
  seedIfNeeded,
};
