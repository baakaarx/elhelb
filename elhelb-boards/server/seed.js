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

  // طلبات الصلاحيات (Permission Requests)
  {
    key: 'requests.review_department',
    name: 'اعتماد طلبات الصلاحيات داخل القسم',
    description: 'مراجعة وقبول أو رفض طلبات الاستثناء من موظفي نفس القسم في حدود صلاحيات المدير',
    category: 'requests',
    category_label: 'طلبات الاستثناء والصلاحيات',
    sort_order: 40,
  },
  {
    key: 'requests.review_all',
    name: 'اعتماد كافة طلبات الصلاحيات بالشركة',
    description: 'مراجعة واعتماد أو رفض جميع طلبات الصلاحيات بما فيها العابرة للأقسام',
    category: 'requests',
    category_label: 'طلبات الاستثناء والصلاحيات',
    sort_order: 41,
  },

  // الإدارة والأمان (Administration & Security)
  {
    key: 'users.manage',
    name: 'إدارة حسابات الموظفين وتسكينهم',
    description: 'إضافة موظفين جدد، تعديل أدوارهم وأقسامهم، وتفعيل أو إيقاف الحسابات',
    category: 'admin',
    category_label: 'إدارة النظام والأمان',
    sort_order: 50,
  },
  {
    key: 'roles.manage',
    name: 'إدارة الأدوار ومصفوفة الصلاحيات',
    description: 'إنشاء وتعديل الأدوار وتغيير الصلاحيات في قاعدة البيانات مباشرة بدون تعديل الكود',
    category: 'admin',
    category_label: 'إدارة النظام والأمان',
    sort_order: 51,
  },
  {
    key: 'departments.manage',
    name: 'إدارة هيكل وأقسام الشركة',
    description: 'إنشاء أقسام جديدة وتعديل بيانات وهوية الأقسام الحالية',
    category: 'admin',
    category_label: 'إدارة النظام والأمان',
    sort_order: 52,
  },
  {
    key: 'audit.view',
    name: 'الاطلاع على سجل المراقبة الأمنية',
    description: 'استعراض سجل العمليات الكامل ومحاولات الوصول المرفوضة (403) من السيرفر',
    category: 'admin',
    category_label: 'إدارة النظام والأمان',
    sort_order: 53,
  },
];

function seedIfNeeded() {
  // Always ensure all catalog permissions exist in DB (idempotent)
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
  });

  const existingUsers = get(`SELECT COUNT(*) AS cnt FROM users`);
  if (existingUsers && existingUsers.cnt > 0) {
    return;
  }

  transaction(() => {
    // 1. Departments
    const salesDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      ['sales', 'قسم المبيعات والتعاقدات', 'إدارة عروض الأسعار، صفقات الشركات، ومتابعة كبار العملاء', '#0a6fa8', 'trending-up']
    ).lastInsertRowid;

    const mediaDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      ['media', 'قسم الميديا والتسويق', 'الحملات الإعلانية، التصميم الجرافيكي، إنتاج الفيديو، ومنصات التواصل', '#7c3aed', 'megaphone']
    ).lastInsertRowid;

    const procDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      ['procurement', 'قسم المشتريات والتوريدات', 'إدارة الموردين، أوامر الشراء، التوريدات البحرية، والمخازن', '#059669', 'package']
    ).lastInsertRowid;

    const hrDept = run(
      `INSERT INTO departments (slug, name, description, color, icon) VALUES (?, ?, ?, ?, ?)`,
      ['hr', 'قسم الموارد البشرية', 'استقطاب الكفاءات، مسوغات التعيين، وتقييم الأداء الإداري', '#d97706', 'users']
    ).lastInsertRowid;

    // 2. Roles
    const superAdminRole = run(
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 1)`,
      ['super_admin', 'المدير العام', 'صلاحية كاملة على كافة أقسام الشركة، اللوحات، الموظفين، ومصفوفة الصلاحيات', '#b45309']
    ).lastInsertRowid;

    const deptMgrRole = run(
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 1)`,
      ['dept_manager', 'مدير قسم', 'إدارة شاملة للوحات ومهام القسم التابع له واعتماد طلبات صلاحيات موظفي قسمه', '#0a6fa8']
    ).lastInsertRowid;

    const teamLeadRole = run(
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 0)`,
      ['team_lead', 'مشرف فريق', 'إنشاء وتعديل القوائم والكروت وتوزيع المهام على الفريق داخل القسم بدون حذف اللوحات', '#4f46e5']
    ).lastInsertRowid;

    const staffRole = run(
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 0)`,
      ['staff', 'موظف تنفيذي', 'عرض لوحات القسم وإضافة وتعديل ونقل الكروت والتعليق عليها دون الحذف أو إنشاء لوحات', '#059669']
    ).lastInsertRowid;

    const viewerRole = run(
      `INSERT INTO roles (slug, name, description, color, is_protected) VALUES (?, ?, ?, ?, 0)`,
      ['viewer', 'متدرب / مشاهد', 'صلاحية قراءة ومتابعة لوحات ومهام القسم فقط؛ يتطلب إذن المدير لأي إجراء تعديل', '#64748b']
    ).lastInsertRowid;

    const assignPerms = (roleId, keys) => {
      for (const k of keys) {
        run(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`, [roleId, k]);
      }
    };

    // Super Admin -> ALL permissions
    assignPerms(superAdminRole, PERMISSIONS_CATALOG.map((p) => p.key));

    // Department Manager -> Full department board/list/card/comment control + department request review
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

    // Team Lead -> Create/edit boards/lists/cards/assign, no delete boards/lists, no request approval
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

    // Staff -> View dept boards, create/edit/move cards, comment (NO delete card, NO create/delete board/list, NO assign)
    assignPerms(staffRole, [
      'boards.view_department',
      'cards.create',
      'cards.edit',
      'cards.move',
      'comments.create',
    ]);

    // Viewer -> View dept boards ONLY
    assignPerms(viewerRole, ['boards.view_department']);

    // 3. Users (Real bcrypt hashes — easy demo password: 123456)
    const defaultHash = bcrypt.hashSync('123456', 10);
    const hashAdmin = defaultHash;
    const hashMgr = defaultHash;
    const hashLead = defaultHash;
    const hashStaff = defaultHash;
    const hashViewer = defaultHash;

    const uAdmin = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['admin', hashAdmin, 'أحمد الهلب', 'المدير العام ورئيس مجلس الإدارة', '#b45309', superAdminRole, null]
    ).lastInsertRowid;

    const uSalesMgr = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['sales_mgr', hashMgr, 'م. طارق منصور', 'مدير قسم المبيعات والتعاقدات', '#0a6fa8', deptMgrRole, salesDept]
    ).lastInsertRowid;

    const uSalesLead = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['sales_lead', hashLead, 'كريم محمود', 'مشرف مبيعات الشركات', '#2563eb', teamLeadRole, salesDept]
    ).lastInsertRowid;

    const uSalesEmp = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['sales_emp', hashStaff, 'سارة عبد الرحمن', 'أخصائي مبيعات وتعاقدات', '#0284c7', staffRole, salesDept]
    ).lastInsertRowid;

    const uSalesViewer = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['sales_viewer', hashViewer, 'يوسف عادل', 'متدرب مبيعات جديد', '#64748b', viewerRole, salesDept]
    ).lastInsertRowid;

    const uMediaMgr = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['media_mgr', hashMgr, 'ندى الشافعي', 'مدير قسم الميديا والتسويق', '#7c3aed', deptMgrRole, mediaDept]
    ).lastInsertRowid;

    const uMediaEmp = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['media_emp', hashStaff, 'عمر خالد', 'مصمم جرافيك وصانع محتوى', '#9333ea', staffRole, mediaDept]
    ).lastInsertRowid;

    const uProcMgr = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['proc_mgr', hashMgr, 'محمود الجمل', 'مدير المشتريات والتوريدات', '#059669', deptMgrRole, procDept]
    ).lastInsertRowid;

    const uProcEmp = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['proc_emp', hashStaff, 'مصطفى حسن', 'مسؤول أوامر توريد ومخازن', '#10b981', staffRole, procDept]
    ).lastInsertRowid;

    const uHrEmp = run(
      `INSERT INTO users (username, password_hash, full_name, job_title, avatar_color, role_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['hr_emp', hashStaff, 'هدى إبراهيم', 'أخصائي شؤون عاملين وتوظيف', '#d97706', staffRole, hrDept]
    ).lastInsertRowid;

    // 4. Boards & Kanban Data
    // --- SALES BOARD 1 ---
    const bSales1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'خطة مبيعات وتعاقدات الربع الرابع',
        'متابعة الصفقات الجارية، عروض الأسعار، والمناقصات الخاصة بعملاء مجموعة الهلب بالإسكندرية والقاهرة',
        salesDept,
        'ocean',
        uSalesMgr,
      ]
    ).lastInsertRowid;

    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uAdmin, bSales1]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uSalesMgr, bSales1]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uSalesEmp, bSales1]);

    const lblVip = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'عميل VIP', '#d97706']).lastInsertRowid;
    const lblContract = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'عقد سنوي', '#0a6fa8']).lastInsertRowid;
    const lblUrgent = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'أولوية قصوى', '#dc2626']).lastInsertRowid;
    const lblGov = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bSales1, 'مناقصة توريد', '#059669']).lastInsertRowid;

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
        'عرض سعر التوريدات البحرية — شركة الإسكندرية للملاحة',
        'إعداد العرض المالي والفني الشامل لتوريد مستلزمات الأسطول البحري لمدة 12 شهراً مع جدول التسليمات الربع سنوية.',
        uSalesMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS1, uSalesEmp]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS1, uSalesLead]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS1, lblVip]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS1, lblUrgent]);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 1, 1)`, [cS1, 'مراجعة قائمة الأصناف والكميات مع قسم المشتريات']);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 1, 2)`, [cS1, 'احتساب هامش الربح وخصم التعاقد السنوي']);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 0, 3)`, [cS1, 'اعتماد النسخة النهائية من مدير المبيعات وإرسالها رسمياً']);
    run(`INSERT INTO card_comments (card_id, user_id, body) VALUES (?, ?, ?)`, [cS1, uSalesMgr, 'يرجى التأكد من إضافة بند الضمان الفني لمدة عام في العرض قبل الإرسال.']);
    run(`INSERT INTO card_comments (card_id, user_id, body) VALUES (?, ?, ?)`, [cS1, uSalesEmp, 'تم تحديث البنود المالية وجارٍ مراجعة المرفق الفني الآن.']);

    const cS2 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-12', 1, ?)`,
      [
        bSales1,
        lSales1_3,
        'تجديد التعاقد السنوي — مجموعة موانئ البحر المتوسط',
        'مراجعة مسودة العقد الجديد مع الشؤون القانونية بعد الاتفاق المبدئي على زيادة حجم التوريد بنسبة 25%.',
        uSalesLead,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS2, uSalesMgr]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS2, lblContract]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS2, lblVip]);

    const cS3 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'low', '2026-11-02', 1, ?)`,
      [
        bSales1,
        lSales1_1,
        '[كارت مكرر بالخطأ] استفسار مبدئي — شركة الدلتا للخدمات اللوجستية',
        'تم تسجيل هذا الكارت مرتين أثناء إدخال بيانات معرض القاهرة، ويحتاج إلى حذف من اللوحة.',
        uSalesEmp,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS3, uSalesEmp]);

    const cS4 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'medium', '2026-11-18', 2, ?)`,
      [
        bSales1,
        lSales1_1,
        'زيارة ميدانية لشركة قناة السويس للحاويات',
        'تنسيق اجتماع تعريفي لعرض خدمات وحلول مجموعة الهلب للربع الأول من العام القادم.',
        uSalesLead,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS4, uSalesLead]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS4, lblGov]);

    const cS5 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, is_completed, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-10-25', 1, 1, ?)`,
      [
        bSales1,
        lSales1_4,
        'توقيع أمر التوريد رقم #409 — الشركة الوطنية للشحن',
        'تم توقيع العقد واستلام الدفعة المقدمة وتحويل أمر التشغيل لقسم المشتريات.',
        uSalesMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS5, uSalesMgr]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cS5, uSalesEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cS5, lblContract]);

    // --- SALES BOARD 2 ---
    const bSales2 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'متابعة حسابات كبار العملاء وخدمة ما بعد البيع',
        'جدول المتابعة الدورية لرضا العملاء الكبار وتحصيل المستحقات المالية',
        salesDept,
        'gold',
        uSalesMgr,
      ]
    ).lastInsertRowid;
    const lSales2_1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bSales2, 'متابعة هذا الأسبوع']).lastInsertRowid;
    const lSales2_2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bSales2, 'قيد التحصيل والمطابقة']).lastInsertRowid;
    const lSales2_3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bSales2, 'تمت المراجعة ✅']).lastInsertRowid;
    run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'medium', '2026-11-08', 1, ?)`,
      [bSales2, lSales2_1, 'مراجعة تقييم الربع الثالث مع عملاء فرع الإسكندرية', 'الاتصال بـ 12 عميل رئيسي لقياس جودة وسرعة التوريد.', uSalesMgr]
    );
    run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-03', 1, ?)`,
      [bSales2, lSales2_2, 'مطابقة كشف حساب شركة البحر الأحمر للملاحة', 'إرسال الفواتير المعتمدة لقسم الحسابات.', uSalesEmp]
    );

    // --- MEDIA BOARD 1 ---
    const bMedia1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'حملة الهوية الرقمية وتصوير مشاريع الهلب جروب',
        'تخطيط وتنفيذ التصميمات، الكتالوج الرسمي، والفيديوهات الترويجية للشركة',
        mediaDept,
        'purple',
        uMediaMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uAdmin, bMedia1]);
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uMediaMgr, bMedia1]);

    const lblDesign = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bMedia1, 'تصميم جرافيك', '#7c3aed']).lastInsertRowid;
    const lblVideo = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bMedia1, 'إنتاج فيديو', '#db2777']).lastInsertRowid;
    const lblAds = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bMedia1, 'إعلانات ممولة', '#2563eb']).lastInsertRowid;

    const lMedia1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bMedia1, 'بنك الأفكار والمحتوى']).lastInsertRowid;
    const lMedia2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bMedia1, 'قيد التصميم والمونتاج']).lastInsertRowid;
    const lMedia3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bMedia1, 'بانتظار اعتماد الإدارة']).lastInsertRowid;
    const lMedia4 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 4)`, [bMedia1, 'تم النشر والإطلاق 🚀']).lastInsertRowid;

    const cM1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, cover_color, created_by)
       VALUES (?, ?, ?, ?, 'urgent', '2026-11-04', 1, '#7c3aed', ?)`,
      [
        bMedia1,
        lMedia2,
        'تصميم البروشور الرسمي الجديد لعام 2027 (عربي / إنجليزي)',
        'تجهيز ملف تعريفي احترافي يبرز سابقة أعمال مجموعة الهلب لخدمة فريق المبيعات في المعارض.',
        uMediaMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cM1, uMediaEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cM1, lblDesign]);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 1, 1)`, [cM1, 'تصميم الغلاف والهوية اللونية الذهبية والبحرية']);
    run(`INSERT INTO checklist_items (card_id, title, is_checked, position) VALUES (?, ?, 0, 2)`, [cM1, 'تنسيق صفحات سابقة الأعمال والشهادات']);

    const cM2 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'high', '2026-11-10', 1, ?)`,
      [bMedia1, lMedia3, 'مونتاج الفيديو الوثائقي لعمليات التوريد بالميناء', 'نسخة 90 ثانية لمنصة لينكدإن وفيسبوك بدقة 4K.', uMediaEmp]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cM2, uMediaMgr]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cM2, uMediaEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cM2, lblVideo]);

    const cM3 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'medium', '2026-11-15', 1, ?)`,
      [bMedia1, lMedia1, 'خطة محتوى شهر نوفمبر لمنصة LinkedIn', 'إعداد 12 منشوراً متخصصاً يستهدف مديري المشتريات والشركات الملاحية.', uMediaMgr]
    ).lastInsertRowid;
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cM3, lblAds]);

    // --- PROCUREMENT BOARD 1 ---
    const bProc1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'أوامر الشراء والتوريدات والمخازن المركزية',
        'متابعة دورة المشتريات من طلب الاحتياج ومقارنة الموردين حتى الفحص والاستلام المخزني',
        procDept,
        'emerald',
        uProcMgr,
      ]
    ).lastInsertRowid;
    run(`INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)`, [uProcMgr, bProc1]);

    const lblImport = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bProc1, 'شحنة استيراد', '#059669']).lastInsertRowid;
    const lblLocal = run(`INSERT INTO board_labels (board_id, name, color) VALUES (?, ?, ?)`, [bProc1, 'توريد محلي', '#0284c7']).lastInsertRowid;

    const lProc1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bProc1, 'طلبات احتياج الأقسام']).lastInsertRowid;
    const lProc2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bProc1, 'مقارنة عروض الموردين']).lastInsertRowid;
    const lProc3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bProc1, 'أوامر شراء قيد الشحن']).lastInsertRowid;
    const lProc4 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 4)`, [bProc1, 'تم الفحص والاستلام بالمخزن ✅']).lastInsertRowid;

    const cP1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, cover_color, created_by)
       VALUES (?, ?, ?, ?, 'urgent', '2026-11-06', 1, '#059669', ?)`,
      [bProc1, lProc3, 'تخليص واستلام شحنة كابلات ومعدات بحرية — ميناء الإسكندرية', 'متابعة الإفراج الجمركي ونقل الحاويات لمخزن العامرية.', uProcMgr]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cP1, uProcMgr]);
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cP1, uProcEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cP1, lblImport]);

    const cP2 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'medium', '2026-11-11', 1, ?)`,
      [bProc1, lProc2, 'مفاضلة 3 موردين لمستلزمات السلامة المهنية', 'إعداد جدول المقارنة الفني والمالي للاعتماد.', uProcEmp]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cP2, uProcEmp]);
    run(`INSERT INTO card_label_links (card_id, label_id) VALUES (?, ?)`, [cP2, lblLocal]);

    // --- HR BOARD 1 ---
    const bHr1 = run(
      `INSERT INTO boards (title, description, department_id, background, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'خطة التوظيف وتأهيل العاملين الجدد',
        'متابعة المقابلات الشخصية، استكمال مسوغات التعيين، وتدريب المنضمين حديثاً',
        hrDept,
        'slate',
        uAdmin,
      ]
    ).lastInsertRowid;
    const lHr1 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 1)`, [bHr1, 'وظائف شاغرة وفرز السير']).lastInsertRowid;
    const lHr2 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 2)`, [bHr1, 'مقابلات ومسوغات التعيين']).lastInsertRowid;
    const lHr3 = run(`INSERT INTO lists (board_id, title, position) VALUES (?, ?, 3)`, [bHr1, 'تم التسكين والمباشرة ✅']).lastInsertRowid;
    const cH1 = run(
      `INSERT INTO cards (board_id, list_id, title, description, priority, due_date, position, created_by)
       VALUES (?, ?, ?, ?, 'medium', '2026-11-09', 1, ?)`,
      [bHr1, lHr2, 'مراجعة ملفات التعيين لعدد 8 فنيين جدد', 'التأكد من استيفاء صور البطاقات وصحيفة الحالة الجنائية والشهادات.', uHrEmp]
    ).lastInsertRowid;
    run(`INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)`, [cH1, uHrEmp]);

    // 5. Realistic Sample Permission Requests
    // Request 1: Sara (Sales Staff) wants one-time permission to delete the duplicate card cS3 in Sales Board 1
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
        'هذا الكارت تم تسجيله مرتين بالخطأ أثناء إدخال عملاء المعرض، وأستأذن في صلاحية حذفه لمرة واحدة لتنظيف اللوحة.',
        'حذف كارت "[كارت مكرر بالخطأ] استفسار مبدئي — شركة الدلتا للخدمات اللوجستية"',
      ]
    );

    // Request 2: Youssef (Sales Viewer/Trainee) wants 8h permission to create cards in Sales Board 1
    run(
      `INSERT INTO permission_requests (
        requester_id, permission_key, scope_type, target_department_id, target_board_id, target_card_id,
        requested_duration, reason, action_summary, status
      ) VALUES (?, 'cards.create', 'board', ?, ?, NULL, '8h', ?, ?, 'pending')`,
      [
        uSalesViewer,
        salesDept,
        bSales1,
        'مكلف اليوم بتفريغ سجل مكالمات العملاء الجدد وإدخالهم في قائمة العملاء المحتملين خلال وردية العمل.',
        'إضافة كروت عملاء جدد في لوحة "خطة مبيعات وتعاقدات الربع الرابع"',
      ]
    );

    // Request 3: Sara (Sales Staff) wants temporary 24h view access to Media Department to check the new 2027 brochure
    run(
      `INSERT INTO permission_requests (
        requester_id, permission_key, scope_type, target_department_id, target_board_id, target_card_id,
        requested_duration, reason, action_summary, status
      ) VALUES (?, 'boards.view_department', 'department', ?, NULL, NULL, '24h', ?, ?, 'pending')`,
      [
        uSalesEmp,
        mediaDept,
        'أحتاج الاطلاع مؤقتاً على لوحة قسم الميديا لمتابعة موعد جهوزية البروشور الرسمي الجديد 2027 قبل اجتماع عميل شركة الإسكندرية للملاحة.',
        'طلب وصول مؤقت للاطلاع على لوحات (قسم الميديا والتسويق)',
      ]
    );

    // Notifications for Managers
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'request_new', 'طلبات صلاحيات بانتظار المراجعة', 'يوجد طلبان جديدان من موظفي قسم المبيعات بانتظار قرارك.', 'requests')`,
      [uSalesMgr]
    );
    run(
      `INSERT INTO notifications (user_id, type, title, message, link_tab)
       VALUES (?, 'request_new', 'طلبات استثناء وصلاحيات عابرة للأقسام', 'توجد 3 طلبات صلاحيات معلقة (بما فيها طلب وصول عابر للأقسام من المبيعات للميديا).', 'requests')`,
      [uAdmin]
    );

    // Initial Audit Log Entries
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, department_name, action, permission_key, status, method, endpoint, details, ip)
       VALUES (?, 'أحمد الهلب', 'المدير العام', 'الإدارة العليا', 'تهيئة مصفوفة الصلاحيات والأقسام', 'roles.manage', 'ALLOWED', 'SYSTEM', '/system/init', 'تم إنشاء 4 أقسام و5 أدوار و21 صلاحية في قاعدة البيانات', '127.0.0.1')`,
      [uAdmin]
    );
  });
}

module.exports = {
  PERMISSIONS_CATALOG,
  seedIfNeeded,
};
