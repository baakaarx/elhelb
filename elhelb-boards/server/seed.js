const bcrypt = require('bcryptjs');
const { get, run, transaction } = require('./db');

const PERMISSIONS_CATALOG = [
  // لوحات العمل (Boards)
  {
    key: 'boards.view_department',
    name: 'عرض لوحات القسم',
    description: 'الاطلاع على جميع لوحات العمل التابعة لقسم الموظف فقط',
    category: 'boards',
    category_label: 'لوحات العمل والأقسام',
    sort_order: 1,
  },
  {
    key: 'boards.view_all',
    name: 'عرض لوحات جميع الأقسام',
    description: 'صلاحية عابرة للأقسام تتيح رؤية لوحات الشركة بالكامل دون قيود القسم',
    category: 'boards',
    category_label: 'لوحات العمل والأقسام',
    sort_order: 2,
  },
  {
    key: 'boards.create',
    name: 'إنشاء لوحة عمل جديدة',
    description: 'إنشاء لوحات مشاريع جديدة وربطها بالقسم المختص',
    category: 'boards',
    category_label: 'لوحات العمل والأقسام',
    sort_order: 3,
  },
  {
    key: 'boards.edit',
    name: 'تعديل إعدادات اللوحة والتصنيفات',
    description: 'تعديل اسم اللوحة، وصفها، الخلفية، وإدارة التصنيفات الملونة',
    category: 'boards',
    category_label: 'لوحات العمل والأقسام',
    sort_order: 4,
  },
  {
    key: 'boards.delete',
    name: 'حذف لوحة عمل نهائياً',
    description: 'حذف لوحة العمل بكافة القوائم والكروت التابعة لها',
    category: 'boards',
    category_label: 'لوحات العمل والأقسام',
    sort_order: 5,
  },

  // القوائم والأعمدة (Lists)
  {
    key: 'lists.create',
    name: 'إضافة قائمة مراحل جديدة',
    description: 'إضافة عمود (قائمة مراحل) جديد داخل لوحة العمل',
    category: 'lists',
    category_label: 'القوائم ومراحل العمل',
    sort_order: 10,
  },
  {
    key: 'lists.edit',
    name: 'تعديل وترتيب القوائم',
    description: 'تغيير اسم القائمة أو إعادة ترتيب أعمدة المراحل داخل اللوحة',
    category: 'lists',
    category_label: 'القوائم ومراحل العمل',
    sort_order: 11,
  },
  {
    key: 'lists.delete',
    name: 'حذف قائمة من اللوحة',
    description: 'حذف عمود مراحل وما بداخله من كروت مهام',
    category: 'lists',
    category_label: 'القوائم ومراحل العمل',
    sort_order: 12,
  },

  // كروت المهام (Cards)
  {
    key: 'cards.create',
    name: 'إضافة كارت مهمة جديد',
    description: 'إنشاء كروت مهام جديدة داخل قوائم اللوحة',
    category: 'cards',
    category_label: 'كروت المهام والتنفيذ',
    sort_order: 20,
  },
  {
    key: 'cards.edit',
    name: 'تعديل بيانات الكارت وقوائم التحقق',
    description: 'تعديل عنوان الكارت، الوصف، الأولوية، تاريخ التسليم، والتصنيفات والمهام الفرعية',
    category: 'cards',
    category_label: 'كروت المهام والتنفيذ',
    sort_order: 21,
  },
  {
    key: 'cards.move',
    name: 'سحب ونقل الكروت بين المراحل',
    description: 'تحريك الكروت (Drag & Drop) بين القوائم وتحديث حالة إنجازها',
    category: 'cards',
    category_label: 'كروت المهام والتنفيذ',
    sort_order: 22,
  },
  {
    key: 'cards.assign',
    name: 'تعيين وتوزيع المهام على الموظفين',
    description: 'إسناد الكارت لموظف أو أكثر من أعضاء القسم أو إلغاء الإسناد',
    category: 'cards',
    category_label: 'كروت المهام والتنفيذ',
    sort_order: 23,
  },
  {
    key: 'cards.delete',
    name: 'حذف كارت مهمة نهائياً',
    description: 'مسح كارت المهمة وسجله نهائياً من قاعدة البيانات',
    category: 'cards',
    category_label: 'كروت المهام والتنفيذ',
    sort_order: 24,
  },

  // التعاون والتعليقات (Collaboration)
  {
    key: 'comments.create',
    name: 'إضافة تعليقات على المهام',
    description: 'كتابة ملاحظات وتعليقات متابعة داخل الكروت وحذف تعليقاته الشخصية',
    category: 'collaboration',
    category_label: 'التعليقات والتعاون',
    sort_order: 30,
  },
  {
    key: 'comments.delete_any',
    name: 'إشراف وحذف تعليقات الآخرين',
    description: 'حذف أي تعليق مكتوب من أي عضو داخل الكروت',
    category: 'collaboration',
    category_label: 'التعليقات والتعاون',
    sort_order: 31,
  },

  // طلبات الصلاحيات وتسكين القسم (Onboarding & Requests)
  {
    key: 'department.onboard_members',
    name: 'ضم الموظفين الجدد وتسكينهم في القسم',
    description: 'قبول الموظفين المسجلين عبر Google / Facebook وإضافتهم إلى فريق القسم وتحديد دورهم',
    category: 'requests',
    category_label: 'تسكين الموظفين وطلبات الصلاحيات',
    sort_order: 39,
  },
  {
    key: 'requests.review_department',
    name: 'اعتماد طلبات الصلاحيات داخل القسم',
    description: 'مراجعة وقبول أو رفض طلبات الاستثناء من موظفي نفس القسم في حدود صلاحيات رئيس القسم',
    category: 'requests',
    category_label: 'تسكين الموظفين وطلبات الصلاحيات',
    sort_order: 40,
  },
  {
    key: 'requests.review_all',
    name: 'اعتماد كافة طلبات الصلاحيات بالشركة',
    description: 'مراجعة واعتماد أو رفض جميع طلبات الصلاحيات بما فيها العابرة للأقسام',
    category: 'requests',
    category_label: 'تسكين الموظفين وطلبات الصلاحيات',
    sort_order: 41,
  },

  // الإدارة والأمان (Administration & Security)
  {
    key: 'users.manage',
    name: 'إدارة حسابات جميع الموظفين وتسكينهم',
    description: 'إضافة موظفين جدد، تعديل أدوارهم وأقسامهم، وتفعيل أو إيقاف الحسابات على مستوى الشركة',
    category: 'admin',
    category_label: 'إدارة النظام والأمان والـ IT',
    sort_order: 50,
  },
  {
    key: 'roles.manage',
    name: 'إدارة الأدوار ومصفوفة الصلاحيات',
    description: 'إنشاء وتعديل الأدوار وتغيير الصلاحيات في قاعدة البيانات مباشرة بدون تعديل الكود',
    category: 'admin',
    category_label: 'إدارة النظام والأمان والـ IT',
    sort_order: 51,
  },
  {
    key: 'departments.manage',
    name: 'إدارة هيكل وأقسام الشركة',
    description: 'إنشاء أقسام جديدة وتعديل بيانات وهوية الأقسام الحالية',
    category: 'admin',
    category_label: 'إدارة النظام والأمان والـ IT',
    sort_order: 52,
  },
  {
    key: 'audit.view',
    name: 'الاطلاع على سجل المراقبة الأمنية',
    description: 'استعراض سجل العمليات الكامل ومحاولات الوصول المرفوضة على السيرفر',
    category: 'admin',
    category_label: 'إدارة النظام والأمان والـ IT',
    sort_order: 53,
  },
];

function seedIfNeeded() {
  transaction(() => {
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

    // Ensure pending_onboarding role always exists even on upgraded DBs
    const hasPendingRole = get(`SELECT id FROM roles WHERE slug = 'pending_onboarding'`);
    if (!hasPendingRole && get(`SELECT COUNT(*) AS cnt FROM roles`).cnt > 0) {
      run(
        `INSERT INTO roles (slug, name, description, color, rank_level, is_protected)
         VALUES ('pending_onboarding', 'بانتظار التسكين في قسم', 'حساب جديد سجل عبر جوجل أو فيسبوك وينتظر قيام رئيس القسم بإضافته لقسمه', '#94a3b8', 0, 1)`
      );
    }
  });

  const existingUsers = get(`SELECT COUNT(*) AS cnt FROM users`);
  if (existingUsers && existingUsers.cnt > 0) {
    return;
  }

  transaction(() => {
    // 1. Company Departments (8 Core Departments including Export, Product Registration, IT!)
    const exportDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'export',
        'قسم التصدير والشحن الدولي',
        'عقود التصدير الخارجية، الاعتمادات المستندية، بوالص الشحن البحري والجوي، والتخليص الجمركي',
        '#0284c7',
        'globe',
      ]
    ).lastInsertRowid;

    const regDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'registration',
        'قسم تسجيل المنتجات والتراخيص',
        'إعداد ملفات تسجيل المنتجات، التراخيص الرقابية، الفحص المعملي، وتجديد شهادات المطابقة والجودة',
        '#7c3aed',
        'file-check',
      ]
    ).lastInsertRowid;

    const itDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'it',
        'قسم تكنولوجيا المعلومات (IT)',
        'إدارة الأنظمة والمنصات الرقمية، صلاحيات الحسابات، الشبكات، أمن المعلومات، والدعم الفني',
        '#2563eb',
        'cpu',
      ]
    ).lastInsertRowid;

    const salesDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'sales',
        'قسم المبيعات والتعاقدات',
        'إدارة عروض الأسعار، صفقات الشركات بالسوق المحلي، ومتابعة حسابات كبار العملاء',
        '#0a6fa8',
        'trending-up',
      ]
    ).lastInsertRowid;

    const procDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'procurement',
        'قسم المشتريات والتوريدات',
        'إدارة الموردين، أوامر الشراء المحلية والدولية، الخامات، والمخازن المركزية',
        '#059669',
        'package',
      ]
    ).lastInsertRowid;

    const mediaDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'media',
        'قسم الميديا والتسويق',
        'الهوية البصرية، الكتالوجات التصديرية، التصميم الجرافيكي، والحملات الرقمية',
        '#db2777',
        'megaphone',
      ]
    ).lastInsertRowid;

    const hrDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'hr',
        'قسم الموارد البشرية',
        'استقطاب الكفاءات، مسوغات التعيين، الحضور والانصراف، وتقييم الأداء الإداري',
        '#d97706',
        'users',
      ]
    ).lastInsertRowid;

    const finDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      [
        'finance',
        'قسم الحسابات والمالية',
        'المراجعة المالية، الفواتير الضريبية، التحصيلات، وتسوية الاعتمادات البنكية',
        '#0d9488',
        'landmark',
      ]
    ).lastInsertRowid;

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

    const deptMgrRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 60, 1)`,
      [
        'dept_manager',
        'رئيس قسم',
        'إدارة شاملة للوحات ومهام القسم، ضم وتسكين موظفي قسمه الجدد، واعتماد طلبات الصلاحيات داخل قسمه',
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

    const pendingRole = run(
      `INSERT INTO roles (slug, name, description, color, rank_level, is_protected) VALUES (?, ?, ?, ?, 0, 1)`,
      [
        'pending_onboarding',
        'بانتظار التسكين في قسم',
        'موظف سجل دخوله عبر Google أو Facebook وينتظر قيام رئيس القسم بضمه إلى قسمه',
        '#94a3b8',
      ]
    ).lastInsertRowid;

    const assignPerms = (roleId, keys) => {
      for (const k of keys) {
        run(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [roleId, k]);
      }
    };

    const allPermKeys = PERMISSIONS_CATALOG.map((p) => p.key);

    // Chairman & General Manager -> All permissions (differentiated by sovereign rank_level 100 vs 90)
    assignPerms(chairmanRole, allPermKeys);
    assignPerms(superAdminRole, allPermKeys);

    // IT Admin -> Shared Administrative & Technical permissions (everything except boards.delete by default, customizable from UI!)
    assignPerms(
      itAdminRole,
      allPermKeys.filter((k) => k !== 'boards.delete')
    );

    // Department Head (رئيس قسم) -> Full department control + onboard members to own dept + approve dept requests
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
      'department.onboard_members',
      'requests.review_department',
    ]);

    // Team Lead
    assignPerms(teamLeadRole, [
      'boards.view_department',
      'boards.create',
      'boards.edit',
      'lists.create',
      'lists.edit',
      'cards.create',
      'cards.edit',
      'cards.move',
      'cards.assign',
      'comments.create',
    ]);

    // Staff
    assignPerms(staffRole, [
      'boards.view_department',
      'cards.create',
      'cards.edit',
      'cards.move',
      'comments.create',
    ]);

    // Viewer
    assignPerms(viewerRole, ['boards.view_department']);

    // 3. Users (Easy Demo Password: 123456)
    const defaultHash = bcrypt.hashSync('123456', 10);

    const uChairman = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'approved')`,
      ['chairman', 'chairman@elhelb.com', defaultHash, 'رئيس مجلس الإدارة — مجموعة الهلب', 'رئيس مجلس الإدارة (السلطة السيادية الأعلى)', '#92400e', chairmanRole]
    ).lastInsertRowid;

    const uAdmin = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'approved')`,
      ['admin', 'gm@elhelb.com', defaultHash, 'أحمد الهلب', 'المدير العام التنفيذي', '#b45309', superAdminRole]
    ).lastInsertRowid;

    const uItMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['it_mgr', 'it@elhelb.com', defaultHash, 'م. عمرو سليم', 'مدير قسم تكنولوجيا المعلومات (IT)', '#2563eb', itAdminRole, itDept]
    ).lastInsertRowid;

    const uExportMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['export_mgr', 'export@elhelb.com', defaultHash, 'أ. خالد عبد العزيز', 'رئيس قسم التصدير والشحن الدولي', '#0284c7', deptMgrRole, exportDept]
    ).lastInsertRowid;

    const uExportEmp = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['export_emp', 'm.adel@elhelb.com', defaultHash, 'مروان عادل', 'أخصائي تصدير واعتمادات مستندية', '#0369a1', staffRole, exportDept]
    ).lastInsertRowid;

    const uRegMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['reg_mgr', 'reg@elhelb.com', defaultHash, 'د. منى عبد الحميد', 'رئيس قسم تسجيل المنتجات والتراخيص', '#7c3aed', deptMgrRole, regDept]
    ).lastInsertRowid;

    const uRegEmp = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['reg_emp', 'reem@elhelb.com', defaultHash, 'د. ريم نبيل', 'أخصائي تسجيل منتجات ورقابة دوائية/صناعية', '#9333ea', staffRole, regDept]
    ).lastInsertRowid;

    const uSalesMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['sales_mgr', 'sales@elhelb.com', defaultHash, 'م. طارق منصور', 'رئيس قسم المبيعات والتعاقدات', '#0a6fa8', deptMgrRole, salesDept]
    ).lastInsertRowid;

    const uSalesLead = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['sales_lead', 'karim@elhelb.com', defaultHash, 'كريم محمود', 'مشرف مبيعات الشركات', '#2563eb', teamLeadRole, salesDept]
    ).lastInsertRowid;

    const uSalesEmp = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['sales_emp', 'sara@elhelb.com', defaultHash, 'سارة عبد الرحمن', 'أخصائي مبيعات وتعاقدات', '#0284c7', staffRole, salesDept]
    ).lastInsertRowid;

    const uSalesViewer = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['sales_viewer', 'youssef@elhelb.com', defaultHash, 'يوسف عادل', 'متدرب مبيعات جديد', '#64748b', viewerRole, salesDept]
    ).lastInsertRowid;

    const uMediaMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['media_mgr', 'media@elhelb.com', defaultHash, 'ندى الشافعي', 'رئيس قسم الميديا والتسويق', '#db2777', deptMgrRole, mediaDept]
    ).lastInsertRowid;

    const uMediaEmp = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['media_emp', 'omar@elhelb.com', defaultHash, 'عمر خالد', 'مصمم جرافيك وصانع محتوى', '#9333ea', staffRole, mediaDept]
    ).lastInsertRowid;

    const uProcMgr = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['proc_mgr', 'proc@elhelb.com', defaultHash, 'محمود الجمل', 'رئيس قسم المشتريات والتوريدات', '#059669', deptMgrRole, procDept]
    ).lastInsertRowid;

    const uHrEmp = run(
      `INSERT INTO users (username, email, password_hash, full_name, job_title, avatar_color, role_id, department_id, onboarding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      ['hr_emp', 'hr@elhelb.com', defaultHash, 'هدى إبراهيم', 'أخصائي شؤون عاملين وتوظيف', '#d97706', staffRole, hrDept]
    ).lastInsertRowid;

    // 2 Pending Employees signed up via Google & Facebook waiting for Department Heads!
    run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title, avatar_color,
        auth_provider, oauth_id, onboarding_status, preferred_department_id, role_id, department_id
      ) VALUES (?, ?, '', ?, ?, '#ea4335', 'google', 'google-demo-101', 'pending', ?, ?, NULL)`,
      [
        'ahmed.hossam',
        'ahmed.hossam@gmail.com',
        'أحمد حسام الدين',
        'مسؤول شحن وتصدير دولي',
        exportDept,
        pendingRole,
      ]
    );

    run(
      `INSERT INTO users (
        username, email, password_hash, full_name, job_title, avatar_color,
        auth_provider, oauth_id, onboarding_status, preferred_department_id, role_id, department_id
      ) VALUES (?, ?, '', ?, ?, '#1877f2', 'facebook', 'fb-demo-202', 'pending', ?, ?, NULL)`,
      [
        'noha.fouad',
        'noha.fouad@facebook.com',
        'د. نهى فؤاد',
        'أخصائي ملفات تسجيل منتجات',
        regDept,
        pendingRole,
      ]
    );

    // 4. Departmental Boards
    // --- EXPORT BOARD ---
    const bExport = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'ocean', ?)`,
      [
        'شحنات وعقود التصدير الدولية — الربع الرابع',
        'متابعة الطلبيات التصديرية، فتح الاعتمادات المستندية (LC)، حجز الحاويات، وشهادات المنشأ',
        exportDept,
        uExportMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uChairman, bExport]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uExportMgr, bExport]);
    const lblAfrica = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bExport, 'تصدير أفريقيا والخليج', '#0284c7']).lastInsertRowid;
    const lblLC = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bExport, 'اعتماد مستندي LC', '#d97706']).lastInsertRowid;
    const lExp1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bExport, 'طلبيات تصدير جديدة']).lastInsertRowid;
    const lExp2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bExport, 'تجهيز المستندات وشهادة المنشأ']).lastInsertRowid;
    const lExp3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bExport, 'تم الشحن بالميناء 🚢']).lastInsertRowid;
    const cExp1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, cover_color, created_by)
       VALUES (?, ?, ?, ?, 'urgent', '2026-11-06', 1, '#0284c7', ?)`,
      [
        bExport,
        lExp2,
        'شحنة تصدير 4 حاويات — ميناء جدة الإسلامي (السعودية)',
        'مراجعة الفاتورة التجارية، بيان العبوة (Packing List)، وتصديق شهادة المنشأ من الغرفة التجارية.',
        uExportMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cExp1, uExportMgr]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cExp1, uExportEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cExp1, lblAfrica]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cExp1, lblLC]);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 1, 1)`, [cExp1, 'اعتماد الفاتورة المبدئية Proforma Invoice']);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 0, 2)`, [cExp1, 'إصدار بوليصة الشحن البحري Bill of Lading']);

    // --- PRODUCT REGISTRATION BOARD ---
    const bReg = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'purple', ?)`,
      [
        'ملفات تسجيل المنتجات والتراخيص والشهادات',
        'متابعة دورة تسجيل المنتجات الجديدة، الفحص المعملي، مطابقة المواصفات القياسية، وتجديد التراخيص',
        regDept,
        uRegMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uChairman, bReg]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uRegMgr, bReg]);
    const lblNewProd = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bReg, 'تسجيل منتج جديد', '#7c3aed']).lastInsertRowid;
    const lblLab = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bReg, 'تحليل معملي ومواصفات', '#059669']).lastInsertRowid;
    const lReg1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bReg, 'تجهيز الملف الفني والعينات']).lastInsertRowid;
    const lReg2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bReg, 'قيد الفحص بالجهات الرقابية']).lastInsertRowid;
    const lReg3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bReg, 'صدر إخطار التسجيل النهائي ✅']).lastInsertRowid;
    const cReg1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, cover_color, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-09', 1, '#7c3aed', ?)`,
      [
        bReg,
        lReg2,
        'استكمال ملف تسجيل خط منتجات الهلب الجديد (5 أصناف تصديرية)',
        'متابعة نتائج مطابقة العينات بالمعامل المركزية واستلام شهادة التداول الحر للتصدير.',
        uRegMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cReg1, uRegMgr]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cReg1, uRegEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cReg1, lblNewProd]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cReg1, lblLab]);

    // --- IT DEPARTMENT BOARD ---
    const bIt = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'royal', ?)`,
      [
        'إدارة الأنظمة الرقمية والدعم الفني وأمن المعلومات (IT)',
        'متابعة السيرفرات، صلاحيات الموظفين، البريد المؤسسي، وتحديثات البنية التحتية',
        itDept,
        uItMgr,
      ]
    ).lastInsertRowid;
    const lIt1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bIt, 'طلبات دعم وتجهيز أجهزة']).lastInsertRowid;
    const lIt2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bIt, 'قيد التنفيذ والتأمين']).lastInsertRowid;
    const lIt3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bIt, 'مكتمل ✅']).lastInsertRowid;
    const cIt1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-04', 1, ?)`,
      [bIt, lIt2, 'ربط بوابة الدخول الموحد (Google / Facebook SSO) لجميع أقسام الشركة', 'مراجعة صلاحيات رؤساء الأقسام وتفعيل التسكين التلقائي.', uItMgr]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cIt1, uItMgr]);

    // --- SALES BOARD 1 ---
    const bSales1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'gold', ?)`,
      [
        'خطة مبيعات وتعاقدات السوق المحلي',
        'متابعة الصفقات الجارية، عروض الأسعار، والمناقصات الخاصة بعملاء مجموعة الهلب',
        salesDept,
        uSalesMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uSalesMgr, bSales1]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uSalesEmp, bSales1]);

    const lblVip = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'عميل VIP', '#d97706']).lastInsertRowid;
    const lblUrgent = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'أولوية قصوى', '#dc2626']).lastInsertRowid;

    const lSales1_1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bSales1, 'عملاء محتملون (Leads)']).lastInsertRowid;
    const lSales1_2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bSales1, 'عروض أسعار قيد الإعداد']).lastInsertRowid;
    const lSales1_3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bSales1, 'مفاوضات ومراجعة عقود']).lastInsertRowid;
    const lSales1_4 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 4)`, [bSales1, 'صفقات مغلقة بنجاح ✅']).lastInsertRowid;

    const cS1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, cover_color, created_by)
       VALUES (?, ?, ?, ?, 'urgent', '2026-11-05', 1, '#0a6fa8', ?)`,
      [
        bSales1,
        lSales1_2,
        'عرض سعر التوريدات السنوي — شركة الإسكندرية للملاحة',
        'إعداد العرض المالي والفني الشامل لمدة 12 شهراً مع جدول التسليمات الربع سنوية.',
        uSalesMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS1, uSalesEmp]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS1, uSalesLead]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS1, lblVip]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS1, lblUrgent]);

    const cS3 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'low', '2026-11-02', 1, ?)`,
      [
        bSales1,
        lSales1_1,
        '[كارت مكرر بالخطأ] استفسار مبدئي — شركة الدلتا للخدمات اللوجستية',
        'تم تسجيل هذا الكارت مرتين أثناء إدخال بيانات المعرض، ويحتاج إلى حذف من اللوحة.',
        uSalesEmp,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS3, uSalesEmp]);

    // --- MEDIA BOARD ---
    const bMedia1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'crimson', ?)`,
      [
        'تصميم الكتالوج التصديري والهوية الرقمية',
        'تجهيز مطبوعات المعارض الدولية وتصميمات المنتجات المسجلة حديثاً',
        mediaDept,
        uMediaMgr,
      ]
    ).lastInsertRowid;
    const lMedia1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bMedia1, 'قيد التصميم والمونتاج']).lastInsertRowid;
    const lMedia2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bMedia1, 'تم الاعتماد والنشر 🚀']).lastInsertRowid;
    const cM1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-07', 1, ?)`,
      [bMedia1, lMedia1, 'تصميم عبوات وبروشور التصدير الجديد (عربي / إنجليزي / فرنسي)', 'مراجعة البيانات الإلزامية مع قسم تسجيل المنتجات.', uMediaMgr]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cM1, uMediaEmp]);

    // --- PROCUREMENT BOARD ---
    const bProc1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'emerald', ?)`,
      [
        'أوامر الشراء وتوريد الخامات ومستلزمات الإنتاج',
        'متابعة الموردين، فحص الخامات، واستلام المخازن',
        procDept,
        uProcMgr,
      ]
    ).lastInsertRowid;
    const lProc1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bProc1, 'عروض الموردين وأوامر التوريد']).lastInsertRowid;
    const lProc2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bProc1, 'تم الفحص والاستلام بالمخزن ✅']).lastInsertRowid;
    run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'urgent', '2026-11-06', 1, ?)`,
      [bProc1, lProc1, 'توريد خامات التعبئة والتغليف المخصصة لطلبيات التصدير', 'التأكد من مطابقة المواصفات القياسية الدولية.', uProcMgr]
    );

    // --- HR & FINANCE BOARDS ---
    const bHr1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'slate', ?)`,
      ['شؤون العاملين والتعيينات الجديدة', 'متابعة ملفات التوظيف والتأهيل', hrDept, uAdmin]
    ).lastInsertRowid;
    const lHr1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bHr1, 'مقابلات ومسوغات التعيين']).lastInsertRowid;
    run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, position, created_by)
       VALUES (?, ?, 'استكمال مسوغات التعيين للمنضمين الجدد', 'مراجعة الملفات الورقية والتأمينات.', 'medium', 1, ?)`,
      [bHr1, lHr1, uHrEmp]
    );

    const bFin1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, 'sunset', ?)`,
      ['المراجعة المالية وتسوية الاعتمادات البنكية', 'متابعة التحصيلات والفواتير الضريبية', finDept, uChairman]
    ).lastInsertRowid;
    const lFin1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bFin1, 'قيد المراجعة المالية']).lastInsertRowid;
    run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, position, created_by)
       VALUES (?, ?, 'مراجعة حصيلة تصدير شهر أكتوبر', 'مطابقة التحويلات البنكية مع بوالص الشحن.', 'high', 1, ?)`,
      [bFin1, lFin1, uChairman]
    );

    // 5. Sample Permission Requests
    run(
      `INSERT INTO permission_requests (
        requester_id, permission_key, scope_type, target_department_id, target_board_id, target_card_id,
        requested_duration, reason, action_summary, status
      ) VALUES (?, 'cards.delete', 'card', ?, ?, ?, 'once', ?, ?, 'pending')`,
      [
        uSalesEmp,
        salesDept,
        bSales1,
        cS3,
        'هذا الكارت تم تسجيله مرتين بالخطأ، وأستأذن في صلاحية حذفه لمرة واحدة.',
        'حذف كارت "[كارت مكرر بالخطأ] استفسار مبدئي — شركة الدلتا للخدمات اللوجستية"',
      ]
    );

    run(
      `INSERT INTO permission_requests (
        requester_id, permission_key, scope_type, target_department_id, target_board_id, target_card_id,
        requested_duration, reason, action_summary, status
      ) VALUES (?, 'boards.view_department', 'department', ?, NULL, NULL, '24h', ?, ?, 'pending')`,
      [
        uSalesEmp,
        mediaDept,
        'أحتاج الاطلاع مؤقتاً على لوحة قسم الميديا لمراجعة تصميم الكتالوج الجديد.',
        'طلب وصول مؤقت للاطلاع على لوحات (قسم الميديا والتسويق)',
      ]
    );

    // Notifications for Department Heads & Leadership about waiting Google/Facebook employees!
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'onboarding_new', 'موظف جديد سجل عبر Google ينتظر التسكين', 'قام (أحمد حسام الدين) بتسجيل الدخول عبر Google وينتظر ضمه إلى قسم التصدير.', 'onboarding')`,
      [uExportMgr]
    );
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'onboarding_new', 'موظفة جديدة سجلت عبر Facebook تنتظر التسكين', 'قامت (د. نهى فؤاد) بتسجيل الدخول عبر Facebook وتنتظر ضمها إلى قسم تسجيل المنتجات.', 'onboarding')`,
      [uRegMgr]
    );
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'onboarding_new', 'موظفون جدد بانتظار التسكين في الأقسام', 'يوجد موظفان جديدان سجلا عبر Google و Facebook في انتظار التسكين من رؤساء الأقسام أو الـ IT.', 'onboarding')`,
      [uItMgr]
    );
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'onboarding_new', 'ملخص النظام لرئيس مجلس الإدارة', 'جميع الأقسام (التصدير، تسجيل المنتجات، الـ IT، المبيعات، المشتريات، الميديا، الموارد البشرية، المالية) مفعلة وتعمل بكفاءة.', 'boards')`,
      [uChairman]
    );
  });
}

module.exports = {
  PERMISSIONS_CATALOG,
  seedIfNeeded,
};
