const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `elhelb-test-${Date.now()}.db`);
const TEST_ADMIN_INIT_PASSWORD = `AdminInit#${crypto.randomBytes(10).toString('hex')}`;
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_INIT_PASSWORD = TEST_ADMIN_INIT_PASSWORD;

const app = require('../server/index');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function api(method, url, token = null, body = undefined) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function login(username, password) {
    const r = await api('POST', '/api/auth/login', null, { username, password });
    assert.equal(r.status, 200, `Login failed for ${username}: ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  try {
    console.log('1️⃣ Testing clean production seed: ONLY admin (from ADMIN_INIT_PASSWORD env) exists & quick-login endpoint is removed...');
    const unauth = await api('GET', '/api/boards');
    assert.equal(unauth.status, 401);

    // Quick-login / demo-accounts endpoint must NOT be publicly accessible (401 unauth)
    const demoEndpointUnauth = await api('GET', '/api/auth/demo-accounts');
    assert.notEqual(demoEndpointUnauth.status, 200, '/api/auth/demo-accounts must never return accounts');

    // Old demo credentials must fail
    const oldDemoAttempt = await api('POST', '/api/auth/login', null, {
      username: 'chairman',
      password: '123456',
    });
    assert.equal(oldDemoAttempt.status, 401, 'Old demo accounts must not exist');

    // Owner sovereign account logs in with ADMIN_INIT_PASSWORD (zero hardcoded password in repo)
    const chairmanTok = await login('admin', TEST_ADMIN_INIT_PASSWORD);

    // Even when authenticated, /api/auth/demo-accounts returns 404 (route completely removed)
    const demoEndpointAuth = await api('GET', '/api/auth/demo-accounts', chairmanTok);
    assert.equal(demoEndpointAuth.status, 404, '/api/auth/demo-accounts route must be 404');

    const initialUsersRes = await api('GET', '/api/admin/users', chairmanTok);
    assert.equal(initialUsersRes.status, 200);
    assert.equal(initialUsersRes.data.length, 1, 'Fresh production DB must contain ONLY 1 account (admin)');
    assert.equal(initialUsersRes.data[0].username, 'admin');
    assert.equal(initialUsersRes.data[0].role_slug, 'chairman');

    // Fetch roles & departments so we can dynamically create isolated test users inside tmpDb
    const rolesRes = await api('GET', '/api/admin/roles', chairmanTok);
    const deptsRes = await api('GET', '/api/admin/departments', chairmanTok);
    assert.equal(deptsRes.data.length, 14, 'Chairman must see all 14 official ELHELB GROUP departments');

    const roleBySlug = (slug) => rolesRes.data.roles.find((r) => r.slug === slug);
    const deptBySlug = (slug) => deptsRes.data.find((d) => d.slug === slug);

    const chairmanRole = roleBySlug('chairman');
    const superAdminRole = roleBySlug('super_admin');
    const itAdminRole = roleBySlug('it_admin');
    const hrMgrRole = roleBySlug('hr_manager');
    const deptMgrRole = roleBySlug('dept_manager');
    const staffRole = roleBySlug('staff');
    const viewerRole = roleBySlug('viewer');
    assert.ok(hrMgrRole, 'Official HR Manager role (hr_manager) must be seeded in DB');
    assert.equal(hrMgrRole.rank_level, 70);

    async function createUser(username, fullName, roleId, departmentId, email = null) {
      const res = await api('POST', '/api/admin/users', chairmanTok, {
        username,
        password: 'TestPass#2026',
        fullName,
        email,
        jobTitle: fullName,
        roleId,
        departmentId,
      });
      assert.equal(res.status, 201, `Failed creating ${username}: ${JSON.stringify(res.data)}`);
      return login(username, 'TestPass#2026');
    }

    const gmTok = await createUser('gm_test', 'مدير عام تجريبي', superAdminRole.id, null);
    const itMgrTok = await createUser('it_mgr', 'مسؤول IT', itAdminRole.id, deptBySlug('it').id);
    const exportMgrTok = await createUser('export_mgr', 'رئيس قسم التصدير', deptMgrRole.id, deptBySlug('export').id, 'export.head@gmail.com');
    const exportEmpTok = await createUser('export_emp', 'موظف تصدير', staffRole.id, deptBySlug('export').id);
    const regEmpTok = await createUser('reg_emp', 'موظف تسجيل منتجات', staffRole.id, deptBySlug('registration').id);
    const salesMgrTok = await createUser('sales_mgr', 'رئيس قسم المبيعات', deptMgrRole.id, deptBySlug('sales').id);
    const salesEmpTok = await createUser('sales_emp', 'موظف مبيعات', staffRole.id, deptBySlug('sales').id);
    const salesViewerTok = await createUser('sales_viewer', 'متدرب مبيعات', viewerRole.id, deptBySlug('sales').id);
    const mediaEmpTok = await createUser('media_emp', 'موظف ميديا', staffRole.id, deptBySlug('media').id);

    console.log('2️⃣ Testing strict Department Isolation across Export, Product Registration, IT, Sales & Media...');
    const chairmanBoards = await api('GET', '/api/boards', chairmanTok);
    assert.equal(chairmanBoards.status, 200);
    assert.equal(chairmanBoards.data.length, 14, 'Admin (Chairman) should see all 14 company boards across all 14 departments');

    const execSummary = await api('GET', '/api/boards/executive-summary', chairmanTok);
    assert.equal(execSummary.status, 200);
    assert.equal(execSummary.data.departments.length, 14, 'Executive summary for Chairman should include all 14 departments');

    // Export employee ONLY sees Export board
    const exportBoards = await api('GET', '/api/boards', exportEmpTok);
    assert.equal(exportBoards.status, 200);
    assert.equal(exportBoards.data.length, 1, 'Export employee must ONLY see Export board');
    assert.ok(exportBoards.data.every((b) => b.department_slug === 'export'));

    // Product Registration employee ONLY sees Registration board
    const regBoards = await api('GET', '/api/boards', regEmpTok);
    assert.equal(regBoards.status, 200);
    assert.equal(regBoards.data.length, 1, 'Registration employee must ONLY see Registration board');
    assert.ok(regBoards.data.every((b) => b.department_slug === 'registration'));

    // Export employee CANNOT open Product Registration board
    const probeReg = await api('GET', `/api/boards/${regBoards.data[0].id}`, exportEmpTok);
    assert.equal(probeReg.status, 403);

    const salesBoards = await api('GET', '/api/boards', salesEmpTok);
    assert.equal(salesBoards.status, 200);
    assert.equal(salesBoards.data.length, 1, 'Sales employee must ONLY see Sales board');
    assert.ok(salesBoards.data.every((b) => b.department_slug === 'sales'));

    const mediaBoard = chairmanBoards.data.find((b) => b.department_slug === 'media');
    assert.ok(mediaBoard);

    // Direct URL probing of Media board by Sales Employee
    const probeMediaBoard = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(probeMediaBoard.status, 403);
    assert.equal(probeMediaBoard.data.targetBoardTitle, null, '403 must NOT leak private board title');

    // Create a card in Media board as mediaEmp, then attempt IDOR attack from salesEmp
    const mediaBoardFull = await api('GET', `/api/boards/${mediaBoard.id}`, mediaEmpTok);
    assert.equal(mediaBoardFull.status, 200);
    const createdMediaCard = await api(
      'POST',
      `/api/lists/${mediaBoardFull.data.lists[0].id}/cards`,
      mediaEmpTok,
      { title: 'تصميم كتالوج التصدير الدولي' }
    );
    assert.equal(createdMediaCard.status, 201);

    const idorAttack = await api('PATCH', `/api/cards/${createdMediaCard.data.id}`, salesEmpTok, {
      title: 'اختراق كارت قسم آخر',
    });
    assert.equal(idorAttack.status, 403, 'Server must block cross-department IDOR on cards');

    console.log('3️⃣ Testing Sovereign Role Hierarchy (admin [Chairman] > GM > IT Admin)...');
    const itDepts = await api('GET', '/api/admin/departments', itMgrTok);
    assert.equal(itDepts.status, 200);
    assert.equal(
      itDepts.data.length,
      13,
      'IT Admin sees ONLY the 13 operational departments (Chairman-Exclusive AI department is hidden)'
    );

    // Neither GM nor IT Manager can edit Chairman's sovereign role!
    const gmTouchChairman = await api('PUT', `/api/admin/roles/${chairmanRole.id}`, gmTok, {
      name: 'تغيير غير مصرح',
    });
    assert.equal(gmTouchChairman.status, 403, 'GM must NOT be able to modify Chairman role');

    const itTouchGm = await api('PUT', `/api/admin/roles/${superAdminRole.id}`, itMgrTok, {
      name: 'تغيير المدير العام من IT',
    });
    assert.equal(itTouchGm.status, 403, 'IT Admin must NOT be able to modify GM role');

    // IT Admin cannot deactivate or downgrade sovereign admin account
    const adminAccount = initialUsersRes.data[0];
    const itAttackChairmanUser = await api('PATCH', `/api/admin/users/${adminAccount.id}`, itMgrTok, {
      isActive: false,
    });
    assert.equal(itAttackChairmanUser.status, 403, 'IT Admin must NOT be able to modify sovereign admin account');

    console.log('4️⃣ Testing Viewer vs Staff Role enforcement on server...');
    const salesBoard1 = salesBoards.data[0];
    const salesBoardFull = await api('GET', `/api/boards/${salesBoard1.id}`, salesEmpTok);
    const salesLists = salesBoardFull.data.lists;

    // Seed one baseline card in Sales board as salesEmp
    const baselineSalesCard = await api('POST', `/api/lists/${salesLists[0].id}/cards`, salesEmpTok, {
      title: 'متابعة عقد التوريد السنوي',
    });
    assert.equal(baselineSalesCard.status, 201);

    // Viewer cannot create or move cards
    const viewerCreate = await api('POST', `/api/lists/${salesLists[0].id}/cards`, salesViewerTok, {
      title: 'كارت من متدرب بدون صلاحية',
    });
    assert.equal(viewerCreate.status, 403);

    const viewerMove = await api('POST', `/api/cards/${baselineSalesCard.data.id}/move`, salesViewerTok, {
      targetListId: salesLists[1].id,
      targetIndex: 0,
    });
    assert.equal(viewerMove.status, 403);

    // Staff CAN create & move cards, CANNOT delete cards or create boards
    const empCreateCard = await api('POST', `/api/lists/${salesLists[0].id}/cards`, salesEmpTok, {
      title: 'عميل جديد — شركة النصر للملاحة',
      priority: 'high',
    });
    assert.equal(empCreateCard.status, 201);

    const empDeleteCard = await api('DELETE', `/api/cards/${empCreateCard.data.id}`, salesEmpTok);
    assert.equal(empDeleteCard.status, 403);
    assert.equal(empDeleteCard.data.missingPermission, 'cards.delete');

    const empCreateBoard = await api('POST', '/api/boards', salesEmpTok, {
      title: 'لوحة غير مصرح بها',
      departmentId: salesBoard1.department_id,
    });
    assert.equal(empCreateBoard.status, 403);

    console.log('5️⃣ Testing Dynamic DB Permission Matrix changes by IT Admin (Instant effect)...');
    const originalStaffPerms = [...staffRole.permissions];

    // IT Manager removes cards.move from staff role in DB
    const permsWithoutMove = originalStaffPerms.filter((p) => p !== 'cards.move');
    const updateRole1 = await api('PUT', `/api/admin/roles/${staffRole.id}`, itMgrTok, {
      permissions: permsWithoutMove,
    });
    assert.equal(updateRole1.status, 200);

    // Immediately verify sales_emp is blocked from moving cards without re-login!
    const moveBlocked = await api('POST', `/api/cards/${empCreateCard.data.id}/move`, salesEmpTok, {
      targetListId: salesLists[1].id,
      targetIndex: 0,
    });
    assert.equal(moveBlocked.status, 403, 'Removing permission in DB must immediately block next request');

    // Restore cards.move in DB
    const updateRole2 = await api('PUT', `/api/admin/roles/${staffRole.id}`, itMgrTok, {
      permissions: originalStaffPerms,
    });
    assert.equal(updateRole2.status, 200);

    const moveAllowedAgain = await api('POST', `/api/cards/${empCreateCard.data.id}/move`, salesEmpTok, {
      targetListId: salesLists[1].id,
      targetIndex: 0,
    });
    assert.equal(moveAllowedAgain.status, 200, 'Restoring permission in DB must immediately allow request');

    console.log('6️⃣ Testing HR Self-Registration -> Admin Approves HR -> HR Onboards & Registers Employees Across All Departments...');
    const exportDept = deptBySlug('export');
    const hrDept = deptBySlug('hr');
    const regDept = deptBySlug('registration');

    // Facebook & email OTP endpoints must NOT exist (404)!
    const fbGone = await api('GET', '/api/auth/oauth/facebook/start', chairmanTok);
    assert.equal(fbGone.status, 404, 'Facebook OAuth route must be completely removed');
    const otpGone = await api('POST', '/api/auth/email/send-code', chairmanTok, {
      fullName: 'Test',
      email: 'test@gmail.com',
    });
    assert.equal(otpGone.status, 404, 'Email OTP route must be removed');

    // Configure trusted official admin notification email BEFORE onboarding so email_logs records trusted admin alerts
    assert.equal(
      (
        await api('PUT', '/api/admin/gmail-settings', chairmanTok, {
          adminNotifyEmail: 'hr.alerts@elhelbgroup.com',
        })
      ).status,
      200
    );

    // Step A: HR Specialist self-registers -> picks HR Department -> Sovereign Admin approves as HR Manager!
    const hrSignupRes = await api('POST', '/api/auth/register', null, {
      fullName: 'أ. منى عبد العزيز (HR)',
      username: 'mona.hr',
      password: 'HrPass#2026',
      email: 'mona.hr@gmail.com',
    });
    assert.equal(hrSignupRes.status, 201);
    const hrTok = hrSignupRes.data.token;

    const hrPickDept = await api('PATCH', '/api/onboarding/my-preference', hrTok, {
      preferredDepartmentId: hrDept.id,
      jobTitle: 'مسؤول الموارد البشرية والتعيينات',
    });
    assert.equal(hrPickDept.status, 200);

    const hrMeBefore = await api('GET', '/api/auth/me', hrTok);
    assert.equal(hrMeBefore.data.user.onboardingStatus, 'pending');

    // Admin (Chairman) approves Mona into HR Department with official hr_manager role!
    const approveHrRes = await api(
      'POST',
      `/api/onboarding/${hrMeBefore.data.user.id}/claim`,
      chairmanTok,
      {
        departmentId: hrDept.id,
        roleId: hrMgrRole.id,
        jobTitle: 'مسؤول الموارد البشرية (HR)',
      }
    );
    assert.equal(approveHrRes.status, 200);

    // Verify HR strict board isolation: HR ONLY sees HR Department boards (NEVER Export/Sales/Media)!
    const hrBoards = await api('GET', '/api/boards', hrTok);
    assert.equal(hrBoards.status, 200);
    assert.equal(hrBoards.data.length, 1, 'HR Manager must ONLY see HR Department board');
    assert.equal(hrBoards.data[0].department_slug, 'hr');
    const hrProbeExport = await api('GET', `/api/boards/${exportBoards.data[0].id}`, hrTok);
    assert.equal(hrProbeExport.status, 403, 'HR Manager must NOT view Export operational boards');

    // Step B: New Export employee registers directly -> picks Export -> HR accepts & assigns him!
    const regRes = await api('POST', '/api/auth/register', null, {
      fullName: 'محمود سامي الشناوي',
      username: 'mahmoud.export',
      password: 'myPassword99',
      email: 'mahmoud.shennawy@gmail.com',
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.data.isNewUser, true);
    const newGoogleTok = regRes.data.token;

    // Duplicate username must be blocked (409)
    const dupReg = await api('POST', '/api/auth/register', null, {
      fullName: 'مستخدم مكرر',
      username: 'mahmoud.export',
      password: 'myPassword99',
    });
    assert.equal(dupReg.status, 409);

    const mePending = await api('GET', '/api/auth/me', newGoogleTok);
    assert.equal(mePending.status, 200);
    assert.equal(mePending.data.user.onboardingStatus, 'pending');
    assert.equal(mePending.data.user.hasCustomCredentials, true);
    assert.equal(mePending.data.user.departmentConfirmed, false);
    assert.equal(mePending.data.user.permissions.length, 0);

    const directLoginTok = await login('mahmoud.export', 'myPassword99');
    assert.ok(directLoginTok);

    const pickDept = await api('PATCH', '/api/onboarding/my-preference', newGoogleTok, {
      preferredDepartmentId: exportDept.id,
      jobTitle: 'منسق شحن بحري',
    });
    assert.equal(pickDept.status, 200);
    assert.equal(pickDept.data.departmentConfirmed, true);

    // Pending employee sees ZERO company boards until approved by HR!
    const pendingBoards = await api('GET', '/api/boards', newGoogleTok);
    assert.equal(pendingBoards.status, 200);
    assert.equal(pendingBoards.data.length, 0, 'Pending employee must see 0 boards before HR onboarding');

    const pendingReqAttempt = await api('POST', '/api/requests', newGoogleTok, {
      permissionKey: 'boards.view_department',
      targetDepartmentId: exportDept.id,
      reason: 'محاولة قبل موافقة الـ HR',
    });
    assert.equal(pendingReqAttempt.status, 403);

    // Regular Department Managers CANNOT claim pending signups (Onboarding is governed by HR / Admin / IT)!
    const deptMgrClaimAttempt = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      exportMgrTok,
      {
        departmentId: exportDept.id,
        roleId: staffRole.id,
      }
    );
    assert.equal(deptMgrClaimAttempt.status, 403, 'Onboarding is handled by HR / Admin, not regular Dept Head');

    // HR tries to elevate employee to Chairman or IT Admin -> BLOCKED!
    const illegalRankClaim = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      hrTok,
      {
        departmentId: exportDept.id,
        roleId: chairmanRole.id,
      }
    );
    assert.equal(illegalRankClaim.status, 403, 'HR cannot grant Chairman or equal/higher rank role');

    // HR Manager approves & assigns Mahmoud into Export Department!
    const validClaim = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      hrTok,
      {
        departmentId: exportDept.id,
        roleId: staffRole.id,
        jobTitle: 'منسق شحن بحري دولي',
      }
    );
    assert.equal(validClaim.status, 200);

    // Step C: HR ALSO directly registers a new employee account (sara.reg) in Product Registration!
    const hrDirectCreate = await api('POST', '/api/admin/users', hrTok, {
      username: 'sara.reg',
      password: 'Sara#Pass26',
      fullName: 'م. سارة فؤاد',
      jobTitle: 'أخصائية تسجيل مبيدات',
      roleId: staffRole.id,
      departmentId: regDept.id,
    });
    assert.equal(hrDirectCreate.status, 201, 'HR must be able to directly register new employees');
    const saraTok = await login('sara.reg', 'Sara#Pass26');
    const saraBoards = await api('GET', '/api/boards', saraTok);
    assert.equal(saraBoards.data.length, 1);
    assert.equal(saraBoards.data[0].department_slug, 'registration');

    // Step D: HR rejects & permanently deletes a bogus pending registration!
    const bogusSignup = await api('POST', '/api/auth/register', null, {
      fullName: 'حساب بالخطأ',
      username: 'mistake.signup',
      password: 'StrongBogus#2026',
    });
    assert.equal(bogusSignup.status, 201);
    const bogusMe = await api('GET', '/api/auth/me', bogusSignup.data.token);
    const rejectBogus = await api('DELETE', `/api/onboarding/${bogusMe.data.user.id}`, hrTok);
    assert.equal(rejectBogus.status, 200, 'HR must be able to reject & delete pending signup');

    // Verify Gmail notification settings & email_logs recorded events cleanly!
    const gmailSettingsGet = await api('GET', '/api/admin/gmail-settings', chairmanTok);
    assert.equal(gmailSettingsGet.status, 200);
    assert.ok(gmailSettingsGet.data.emailLogs.length >= 2, 'Email logs should record onboarding & approval events');

    const saveGmailRes = await api('PUT', '/api/admin/gmail-settings', itMgrTok, {
      gmailUser: 'elhelb.notify@gmail.com',
      gmailAppPassword: 'abcd efgh ijkl mnop',
      adminNotifyEmail: 'chairman@gmail.com',
      enabled: true,
    });
    assert.equal(saveGmailRes.status, 200);
    assert.equal(saveGmailRes.data.configured, true);

    // Immediately (using the SAME token without re-login!), Mahmoud now sees Export boards ONLY!
    const afterClaimMe = await api('GET', '/api/auth/me', newGoogleTok);
    assert.equal(afterClaimMe.data.user.onboardingStatus, 'approved');
    assert.equal(afterClaimMe.data.user.departmentSlug, 'export');

    const afterClaimBoards = await api('GET', '/api/boards', newGoogleTok);
    assert.equal(afterClaimBoards.status, 200);
    assert.equal(afterClaimBoards.data.length, 1);
    assert.ok(afterClaimBoards.data.every((b) => b.department_slug === 'export'));

    console.log('7️⃣ Testing Manager Permission Request workflow & One-Time Card Grant consumption...');
    const reqRes = await api('POST', '/api/requests', salesEmpTok, {
      permissionKey: 'cards.delete',
      targetCardId: empCreateCard.data.id,
      requestedDuration: 'once',
      reason: 'أحتاج حذف هذا الكارت التجريبي لمرة واحدة فقط.',
    });
    assert.equal(reqRes.status, 201);

    // Self-approval attempt must fail
    const selfApprove = await api('POST', `/api/requests/${reqRes.data.id}/review`, salesEmpTok, {
      decision: 'approved',
    });
    assert.equal(selfApprove.status, 403);

    // Sales Manager approves the one-time grant on empCreateCard
    const mgrApprove = await api('POST', `/api/requests/${reqRes.data.id}/review`, salesMgrTok, {
      decision: 'approved',
      approvedDuration: 'once',
      reviewNote: 'موافق لحذف الكارت المحدد فقط.',
    });
    assert.equal(mgrApprove.status, 200);

    // Trying to delete a DIFFERENT card must STILL fail with 403!
    const deleteWrongCard = await api('DELETE', `/api/cards/${baselineSalesCard.data.id}`, salesEmpTok);
    assert.equal(deleteWrongCard.status, 403, 'Card-scoped grant must NOT allow deleting other cards');

    // Deleting the exact approved card succeeds!
    const deleteApprovedCard = await api('DELETE', `/api/cards/${empCreateCard.data.id}`, salesEmpTok);
    assert.equal(deleteApprovedCard.status, 200);
    assert.equal(deleteApprovedCard.data.consumedGrant, true);

    // Create another card and verify the one-time grant is now exhausted
    const secondCard = await api('POST', `/api/lists/${salesLists[0].id}/cards`, salesEmpTok, {
      title: 'كارت ثانٍ للتجربة',
    });
    const deleteAfterExhaust = await api('DELETE', `/api/cards/${secondCard.data.id}`, salesEmpTok);
    assert.equal(deleteAfterExhaust.status, 403, 'One-time grant must be exhausted after 1 execution');

    console.log('8️⃣ Testing Cross-Department Access Request, Anti-Escalation & Instant Revocation...');
    const mediaDept = deptBySlug('media');
    const crossDeptCreate = await api('POST', '/api/requests', salesEmpTok, {
      permissionKey: 'boards.view_department',
      targetDepartmentId: mediaDept.id,
      requestedDuration: '24h',
      reason: 'أحتاج الاطلاع على لوحة الميديا لمراجعة الكتالوج التصديري.',
    });
    assert.equal(crossDeptCreate.status, 201);

    // Sales Manager MUST NOT be allowed to approve access to Media Department!
    const illegalCrossApprove = await api(
      'POST',
      `/api/requests/${crossDeptCreate.data.id}/review`,
      salesMgrTok,
      { decision: 'approved', approvedDuration: '24h' }
    );
    assert.equal(illegalCrossApprove.status, 403);

    // Admin (Chairman) approves 24h view access to Media Department for Sales Employee
    const chairmanCrossApprove = await api(
      'POST',
      `/api/requests/${crossDeptCreate.data.id}/review`,
      chairmanTok,
      {
        decision: 'approved',
        approvedDuration: '24h',
        reviewNote: 'مسموح بالاطلاع لمتابعة الكتالوج التصديري.',
      }
    );
    assert.equal(chairmanCrossApprove.status, 200);

    // Now Sales employee CAN view Media board
    const canViewMediaNow = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(canViewMediaNow.status, 200);
    assert.ok(canViewMediaNow.data.board.accessViaGrant);

    // Admin revokes the grant -> access immediately cut off!
    const grantId = canViewMediaNow.data.board.accessViaGrant.id;
    const revokeRes = await api('POST', `/api/grants/${grantId}/revoke`, chairmanTok);
    assert.equal(revokeRes.status, 200);

    const viewAfterRevoke = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(viewAfterRevoke.status, 403, 'Revoked grant must immediately cut off access');

    console.log('9️⃣ Testing Permanent Employee Deletion (Offboarding Departed Staff Safely via HR / Admin)...');
    const mediaEmpMe = await api('GET', '/api/auth/me', mediaEmpTok);
    const mediaEmpId = mediaEmpMe.data.user.id;

    // Add a comment on createdMediaCard by media_emp before they leave the company
    const commentBeforeLeave = await api(
      'POST',
      `/api/cards/${createdMediaCard.data.id}/comments`,
      mediaEmpTok,
      { body: 'تم تسليم ملفات الكتالوج الأولية قبل مغادرة الشركة' }
    );
    assert.equal(commentBeforeLeave.status, 201);

    // Regular employee CANNOT delete users
    const staffTryDelete = await api('DELETE', `/api/admin/users/${mediaEmpId}`, salesEmpTok);
    assert.equal(staffTryDelete.status, 403);

    // HR CANNOT delete Sovereign Admin (Chairman) or higher-rank IT Admin!
    const hrTryDeleteAdmin = await api('DELETE', `/api/admin/users/${adminAccount.id}`, hrTok);
    assert.equal(hrTryDeleteAdmin.status, 403);
    const itMe = await api('GET', '/api/auth/me', itMgrTok);
    const hrTryDeleteIt = await api('DELETE', `/api/admin/users/${itMe.data.user.id}`, hrTok);
    assert.equal(hrTryDeleteIt.status, 403);

    // Admin cannot delete their own logged-in account
    const adminSelfDelete = await api('DELETE', `/api/admin/users/${adminAccount.id}`, chairmanTok);
    assert.equal(adminSelfDelete.status, 400);

    // HR permanently deletes departed employee media_emp!
    const hrDeleteMediaEmp = await api('DELETE', `/api/admin/users/${mediaEmpId}`, hrTok);
    assert.equal(hrDeleteMediaEmp.status, 200);

    // Deleted employee's existing token is immediately rejected (401) & cannot log in!
    const deletedMeAttempt = await api('GET', '/api/auth/me', mediaEmpTok);
    assert.equal(deletedMeAttempt.status, 401);
    const deletedLoginAttempt = await api('POST', '/api/auth/login', null, {
      username: 'media_emp',
      password: 'TestPass#2026',
    });
    assert.equal(deletedLoginAttempt.status, 401);

    // Company data integrity: Media board AND the card created by media_emp remain 100% intact!
    const mediaBoardAfterDelete = await api('GET', `/api/boards/${mediaBoard.id}`, chairmanTok);
    assert.equal(mediaBoardAfterDelete.status, 200);
    const preservedCards = mediaBoardAfterDelete.data.cards || [];
    assert.ok(
      preservedCards.some((c) => c.id === createdMediaCard.data.id),
      'Cards created by a deleted employee must remain intact on company boards'
    );

    console.log('🔟 Testing Domain Session Isolation, Anti-CDN Cache Headers & Legacy Token Revocation...');
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../server/rbac');

    // Fresh visitor opening shared domain link must get 401 + strict anti-CDN headers + zero ETag
    const freshMeRaw = await fetch(`${base}/api/auth/me`);
    assert.equal(freshMeRaw.status, 401);
    assert.match(freshMeRaw.headers.get('cache-control') || '', /private.*no-store/i);
    assert.equal(freshMeRaw.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(freshMeRaw.headers.get('vercel-cdn-cache-control'), 'no-store');
    assert.equal(freshMeRaw.headers.get('cloudflare-cdn-cache-control'), 'no-store');
    assert.equal(freshMeRaw.headers.get('etag'), null, 'API responses must never emit ETag');

    // Authenticated /api/auth/me must also carry strict anti-CDN headers so no proxy ever caches admin!
    const authMeRaw = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${chairmanTok}` },
    });
    assert.equal(authMeRaw.status, 200);
    assert.match(authMeRaw.headers.get('cache-control') || '', /private.*no-store/i);
    assert.equal(authMeRaw.headers.get('cloudflare-cdn-cache-control'), 'no-store');
    assert.equal(authMeRaw.headers.get('etag'), null);

    // Legacy v1-v9 token signed with old secret must be 100% rejected
    const legacyAdminToken = jwt.sign(
      { uid: 1, tv: 1 },
      'elhelb-enterprise-rbac-secret-2026-v1',
      { expiresIn: '12h' }
    );
    const legacyAttempt = await api('GET', '/api/auth/me', legacyAdminToken);
    assert.equal(legacyAttempt.status, 401, 'Legacy secret tokens must be rejected');

    // Token missing uname or with mismatched uname (anti-ID-collision) must be 100% rejected
    const missingUnameTok = jwt.sign({ uid: 1, tv: 1 }, JWT_SECRET, { expiresIn: '12h' });
    assert.equal((await api('GET', '/api/auth/me', missingUnameTok)).status, 401);

    const mismatchedUnameTok = jwt.sign(
      { uid: 1, uname: 'not_admin', tv: 1 },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    assert.equal((await api('GET', '/api/auth/me', mismatchedUnameTok)).status, 401);

    console.log('1️⃣1️⃣ Testing Multi-Container Serverless Cloud Persistence (Upstash KV & Vercel Blob Encrypted Sync)...');
    const http = require('node:http');
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const execFileAsync = promisify(execFile);
    const { resetCloudSyncStateForTests } = require('../server/cloudSync');

    // --- Part A: Upstash Serverless Redis / Vercel KV cross-container sync ---
    const kvMemory = new Map();
    const mockKvServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw || '[]');
        const execCmd = (cmdArr) => {
          const op = String(cmdArr[0] || '').toUpperCase();
          if (op === 'GET') return { result: kvMemory.has(cmdArr[1]) ? kvMemory.get(cmdArr[1]) : null };
          if (op === 'SET') {
            kvMemory.set(cmdArr[1], cmdArr[2]);
            return { result: 'OK' };
          }
          return { result: null };
        };
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/pipeline') {
          res.end(JSON.stringify(body.map(execCmd)));
        } else {
          res.end(JSON.stringify(execCmd(body)));
        }
      });
    });
    mockKvServer.listen(0, '127.0.0.1');
    await new Promise((r) => mockKvServer.once('listening', r));
    const kvPort = mockKvServer.address().port;

    process.env.KV_REST_API_URL = `http://127.0.0.1:${kvPort}`;
    process.env.KV_REST_API_TOKEN = 'test-kv-secret-token-2026';
    resetCloudSyncStateForTests();

    try {
      // Container A creates employee @mo.ai with strong password as HR Manager
      const createMoAi = await api('POST', '/api/admin/users', chairmanTok, {
        username: 'mo.ai',
        password: 'MoAiStrong#2026',
        fullName: 'محمد عبد الرحمن',
        email: 'hr.notify@elhelbgroup.com',
        jobTitle: 'مسؤول الموارد البشرية (HR)',
        roleId: hrMgrRole.id,
        departmentId: hrDept.id,
      });
      assert.equal(createMoAi.status, 201, `Creating @mo.ai failed: ${JSON.stringify(createMoAi.data)}`);
      assert.ok(kvMemory.get('elhelb:v11:rev'), 'Upstash KV must receive revision key');
      assert.ok(kvMemory.get('elhelb:v11:state'), 'Upstash KV must receive AES-256-GCM encrypted state');
      // Verify stored payload is encrypted (does NOT expose plaintext email or username)
      const rawStateBuf = Buffer.from(kvMemory.get('elhelb:v11:state'), 'base64');
      assert.equal(rawStateBuf.subarray(0, 4).toString('utf8'), 'EHB1');
      assert.equal(rawStateBuf.includes(Buffer.from('hr.notify@elhelbgroup.com')), false);

      // Brand-new Cold-Started Container B (completely separate tmp SQLite DB in child process!) logs in as mo.ai!
      const containerBDb = path.join(os.tmpdir(), `elhelb-containerB-kv-${Date.now()}.db`);
      const { stdout: childOut } = await execFileAsync(
        process.execPath,
        [
          '--no-warnings',
          '-e',
          `
          const app = require('./server/index');
          (async () => {
            const srv = app.listen(0, '127.0.0.1');
            await new Promise((r) => srv.once('listening', r));
            const p = srv.address().port;
            const loginRes = await fetch('http://127.0.0.1:' + p + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: 'mo.ai', password: 'MoAiStrong#2026' })
            });
            const loginJson = await loginRes.json();
            srv.close();
            console.log(JSON.stringify({ status: loginRes.status, username: loginJson.user?.username, role: loginJson.user?.roleSlug }));
          })();
          `,
        ],
        {
          cwd: path.join(__dirname, '..'),
          env: {
            ...process.env,
            DB_PATH: containerBDb,
            KV_REST_API_URL: `http://127.0.0.1:${kvPort}`,
            KV_REST_API_TOKEN: 'test-kv-secret-token-2026',
          },
          encoding: 'utf8',
        }
      );
      try { fs.unlinkSync(containerBDb); } catch (_) {}
      try { fs.unlinkSync(`${containerBDb}-wal`); } catch (_) {}
      try { fs.unlinkSync(`${containerBDb}-shm`); } catch (_) {}

      const parsedB = JSON.parse(childOut.trim().split('\n').pop());
      assert.equal(parsedB.status, 200, 'Cold-started Container B must authenticate mo.ai immediately via Upstash KV');
      assert.equal(parsedB.username, 'mo.ai');
      assert.equal(parsedB.role, 'hr_manager');
    } finally {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      resetCloudSyncStateForTests();
      mockKvServer.close();
    }

    // --- Part B: Native Vercel Blob v13 cross-container encrypted sync ---
    const blobStore = new Map(); // pathname -> Buffer
    let mockBlobPort = 0;
    const mockBlobServer = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${mockBlobPort}`);
      if (req.method === 'PUT' && u.pathname === '/') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const pathname = u.searchParams.get('pathname');
          const buf = Buffer.concat(chunks);
          blobStore.set(pathname, buf);
          const fileUrl = `http://127.0.0.1:${mockBlobPort}/dl/${encodeURIComponent(pathname)}`;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            url: fileUrl,
            downloadUrl: `${fileUrl}?download=1`,
            pathname,
            contentType: 'application/octet-stream',
            contentDisposition: 'inline',
            etag: `"${buf.length}"`,
          }));
        });
        return;
      }
      if (req.method === 'GET' && u.pathname === '/') {
        const prefix = u.searchParams.get('prefix') || '';
        const blobs = [];
        for (const [pathname, buf] of blobStore.entries()) {
          if (pathname.startsWith(prefix)) {
            const fileUrl = `http://127.0.0.1:${mockBlobPort}/dl/${encodeURIComponent(pathname)}`;
            blobs.push({
              url: fileUrl,
              downloadUrl: `${fileUrl}?download=1`,
              pathname,
              size: buf.length,
              uploadedAt: new Date().toISOString(),
              etag: `"${buf.length}"`,
            });
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ blobs, hasMore: false }));
        return;
      }
      if (req.method === 'GET' && u.pathname.startsWith('/dl/')) {
        const pathname = decodeURIComponent(u.pathname.slice(4));
        const buf = blobStore.get(pathname);
        if (!buf) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(buf);
        return;
      }
      if (req.method === 'POST' && u.pathname === '/delete') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const { urls = [] } = JSON.parse(body || '{}');
          for (const itemUrl of urls) {
            const p = decodeURIComponent(new URL(itemUrl).pathname.slice(4));
            blobStore.delete(p);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ deleted: urls.length }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    mockBlobServer.listen(0, '127.0.0.1');
    await new Promise((r) => mockBlobServer.once('listening', r));
    mockBlobPort = mockBlobServer.address().port;

    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_storetest123_secretkey2026';
    process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${mockBlobPort}`;
    resetCloudSyncStateForTests();

    try {
      // Trigger sync push via registering a second employee on Container A
      const regBlobUser = await api('POST', '/api/auth/register', null, {
        fullName: 'سارة علي',
        username: 'sara.hr',
        password: 'SaraHrStrong#2026',
      });
      assert.equal(regBlobUser.status, 201);
      assert.ok(blobStore.size >= 1, 'Vercel Blob store must contain encrypted DB snapshot');

      // Cold-started Container C logs in BOTH mo.ai AND sara.hr from empty DB via Vercel Blob!
      const containerCDb = path.join(os.tmpdir(), `elhelb-containerC-blob-${Date.now()}.db`);
      const { stdout: childBlobOut } = await execFileAsync(
        process.execPath,
        [
          '--no-warnings',
          '-e',
          `
          const app = require('./server/index');
          (async () => {
            const srv = app.listen(0, '127.0.0.1');
            await new Promise((r) => srv.once('listening', r));
            const p = srv.address().port;
            const r1 = await fetch('http://127.0.0.1:' + p + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: 'mo.ai', password: 'MoAiStrong#2026' })
            });
            const r2 = await fetch('http://127.0.0.1:' + p + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: 'sara.hr', password: 'SaraHrStrong#2026' })
            });
            srv.close();
            console.log(JSON.stringify({ moStatus: r1.status, saraStatus: r2.status }));
          })();
          `,
        ],
        {
          cwd: path.join(__dirname, '..'),
          env: {
            ...process.env,
            DB_PATH: containerCDb,
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_storetest123_secretkey2026',
            VERCEL_BLOB_API_URL: `http://127.0.0.1:${mockBlobPort}`,
          },
          encoding: 'utf8',
        }
      );
      try { fs.unlinkSync(containerCDb); } catch (_) {}
      try { fs.unlinkSync(`${containerCDb}-wal`); } catch (_) {}
      try { fs.unlinkSync(`${containerCDb}-shm`); } catch (_) {}

      const parsedC = JSON.parse(childBlobOut.trim().split('\n').pop());
      assert.equal(parsedC.moStatus, 200, 'Container C must authenticate mo.ai via Vercel Blob');
      assert.equal(parsedC.saraStatus, 200, 'Container C must authenticate sara.hr via Vercel Blob');
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.VERCEL_BLOB_API_URL;
      resetCloudSyncStateForTests();
      mockBlobServer.close();
    }

    console.log('1️⃣2️⃣ Testing Sovereign Chairman-Only Server Backup Export & Restore...');
    assert.equal((await api('GET', '/api/admin/backup/export', hrTok)).status, 403);
    assert.equal((await api('GET', '/api/admin/backup/export', itMgrTok)).status, 403);

    const exported = await api('GET', '/api/admin/backup/export', chairmanTok);
    assert.equal(exported.status, 200);
    assert.ok(Array.isArray(exported.data.snapshot?.tables?.users));

    // Reject corrupt snapshot missing chairman
    const badSnap = { tables: { users: [], roles: exported.data.snapshot.tables.roles } };
    assert.equal(
      (await api('POST', '/api/admin/backup/import', chairmanTok, { snapshot: badSnap })).status,
      400
    );

    const imported = await api('POST', '/api/admin/backup/import', chairmanTok, {
      snapshot: exported.data.snapshot,
    });
    assert.equal(imported.status, 200);
    assert.equal((await api('POST', '/api/auth/login', null, { username: 'mo.ai', password: 'MoAiStrong#2026' })).status, 200);

    console.log('1️⃣3️⃣ Testing 14 Official Departments + Sovereign Chairman-Exclusive AI Department Isolation...');
    // Verify all 5 new agrochemical/export operational departments + sovereign ai_systems exist
    for (const slug of ['customs', 'production', 'qc_labs', 'warehouses', 'agri_support', 'ai_systems']) {
      assert.ok(deptBySlug(slug), `Department ${slug} must exist in seeded DB`);
    }
    const aiDept = deptBySlug('ai_systems');
    assert.equal(aiDept.is_chairman_exclusive, true, 'ai_systems must be marked is_chairman_exclusive = true');

    const aiBoard = chairmanBoards.data.find((b) => b.department_slug === 'ai_systems');
    assert.ok(aiBoard, 'Chairman must see ai_systems board');

    // General Manager (super_admin), IT Admin, and HR Manager MUST NOT see ai_systems anywhere!
    const gmBoards = await api('GET', '/api/boards', gmTok);
    assert.equal(gmBoards.status, 200);
    assert.equal(gmBoards.data.length, 13, 'General Manager must see ONLY 13 operational boards, NEVER ai_systems');
    assert.ok(!gmBoards.data.some((b) => b.department_slug === 'ai_systems'));

    const gmSummary = await api('GET', '/api/boards/executive-summary', gmTok);
    assert.equal(gmSummary.status, 200);
    assert.equal(gmSummary.data.departments.length, 13, 'General Manager executive summary must exclude ai_systems');

    const gmDirectory = await api('GET', '/api/departments/directory', gmTok);
    assert.equal(gmDirectory.status, 200);
    assert.ok(!gmDirectory.data.some((d) => d.slug === 'ai_systems'), 'Directory for GM must hide ai_systems');

    // Direct URL probing of ai_systems board by General Manager, IT Admin, and HR Manager -> 403!
    const gmProbeAi = await api('GET', `/api/boards/${aiBoard.id}`, gmTok);
    assert.equal(gmProbeAi.status, 403, 'even super_admin General Manager must get 403 on ai_systems board');
    assert.equal(gmProbeAi.data.targetBoardTitle, null, '403 must NOT leak ai_systems board title');
    assert.equal(gmProbeAi.data.canRequestElevation, false, 'ai_systems must disallow elevation requests');

    assert.equal((await api('GET', `/api/boards/${aiBoard.id}`, itMgrTok)).status, 403);
    assert.equal((await api('GET', `/api/boards/${aiBoard.id}`, hrTok)).status, 403);

    // GM, IT Admin, and HR Manager CANNOT create or move users into ai_systems
    assert.equal(
      (
        await api('POST', '/api/admin/users', gmTok, {
          username: 'sneak.ai',
          password: 'StrongSneak#2026',
          fullName: 'متسلل',
          roleId: staffRole.id,
          departmentId: aiDept.id,
        })
      ).status,
      403
    );
    assert.equal(
      (
        await api('POST', '/api/admin/users', hrTok, {
          username: 'sneak.hr.ai',
          password: 'StrongSneak#2026',
          fullName: 'متسلل HR',
          roleId: staffRole.id,
          departmentId: aiDept.id,
        })
      ).status,
      403
    );

    // Self-register AI Systems Engineer -> self-service /my-preference blocks sovereign dept (403) -> ONLY Chairman assigns into ai_systems!
    const regAi = await api('POST', '/api/auth/register', null, {
      fullName: 'مهندس الذكاء الاصطناعي وتطوير الأنظمة',
      username: 'ai.sovereign',
      password: 'AiEngStrong#2026',
    });
    assert.equal(regAi.status, 201);
    const aiEmpTok = regAi.data.token;
    const aiEmpId = regAi.data.user.id;

    const pickAiDept = await api('PATCH', '/api/onboarding/my-preference', aiEmpTok, {
      preferredDepartmentId: aiDept.id,
      jobTitle: 'مدير الذكاء الاصطناعي وتطوير الأنظمة',
    });
    assert.equal(pickAiDept.status, 403, 'Pending user must NOT self-select sovereign department via /my-preference');

    assert.equal(
      (
        await api('POST', `/api/onboarding/${aiEmpId}/claim`, gmTok, {
          departmentId: aiDept.id,
          roleId: deptMgrRole.id,
        })
      ).status,
      403,
      'General Manager must get 403 attempting to approve into ai_systems'
    );

    // Chairman DOES see pending ai.sovereign and approves directly into ai_systems!
    const chPendingCheck = await api('GET', '/api/onboarding/pending', chairmanTok);
    assert.ok(chPendingCheck.data.pendingUsers.some((u) => u.username === 'ai.sovereign'));
    const chClaimAi = await api('POST', `/api/onboarding/${aiEmpId}/claim`, chairmanTok, {
      departmentId: aiDept.id,
      roleId: deptMgrRole.id,
      jobTitle: 'مدير الذكاء الاصطناعي وتطوير الأنظمة',
    });
    assert.equal(chClaimAi.status, 200);

    // Approved AI engineer logs in, sees ONLY ai_systems board, and works directly with Chairman!
    const aiBoards = await api('GET', '/api/boards', aiEmpTok);
    assert.equal(aiBoards.status, 200);
    assert.equal(aiBoards.data.length, 1);
    assert.equal(aiBoards.data[0].department_slug, 'ai_systems');
    assert.equal(aiBoards.data[0].department_chairman_exclusive, true);

    const openAiBoard = await api('GET', `/api/boards/${aiBoard.id}`, aiEmpTok);
    assert.equal(openAiBoard.status, 200);
    // Assignee list on ai_systems board contains ONLY ai_systems members + Chairman (NO GM, NO IT Admin!)
    assert.equal(
      openAiBoard.data.departmentMembers.length,
      2,
      'ai_systems board members list must include ONLY AI engineer + Chairman'
    );

    // Chairman posts a direct sovereign task to AI engineer -> 201!
    const chTask = await api('POST', `/api/lists/${openAiBoard.data.lists[0].id}/cards`, chairmanTok, {
      title: 'بناء مساعد ذكي لتحليل عقود التصدير لـ 22 دولة',
      priority: 'urgent',
      assigneeIds: [aiEmpId],
    });
    assert.equal(chTask.status, 201);

    // General Manager CANNOT edit/delete AI engineer or touch that card -> 403!
    assert.equal((await api('PATCH', `/api/cards/${chTask.data.id}`, gmTok, { title: 'تطفل' })).status, 403);
    assert.equal((await api('DELETE', `/api/admin/users/${aiEmpId}`, gmTok)).status, 403);
    const gmUsersList = await api('GET', '/api/admin/users', gmTok);
    assert.ok(!gmUsersList.data.some((u) => u.username === 'ai.sovereign'), 'GM users table must hide ai.sovereign');

    console.log('1️⃣4️⃣ Testing Production Security Hardening (Mandatory JWT_SECRET, Clickjacking/CSP, XFF Anti-Spoof Brute-Force Lock & Seamless Admin Password Rotation)...');
    // 14a. Production MUST refuse to start without JWT_SECRET or with short JWT_SECRET
    await assert.rejects(
      execFileAsync(process.execPath, ['--no-warnings', '-e', 'require("./server/rbac")'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', VERCEL: '' },
      }),
      /FATAL SECURITY ERROR: JWT_SECRET/
    );
    await assert.rejects(
      execFileAsync(process.execPath, ['--no-warnings', '-e', 'require("./server/rbac")'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'too-short', VERCEL: '' },
      }),
      /at least 32 characters/
    );

    // 14b. Production cloudSync must NOT expose resetCloudSyncStateForTests
    const { stdout: prodExportsOut } = await execFileAsync(
      process.execPath,
      ['--no-warnings', '-e', 'console.log(JSON.stringify(Object.keys(require("./server/cloudSync"))))'],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );
    const prodCloudKeys = JSON.parse(prodExportsOut.trim());
    assert.ok(!prodCloudKeys.includes('resetCloudSyncStateForTests'));

    // 14c. Verify scripts/verify-server.js passes 100% (tests X-Frame-Options: DENY & CSP in production)
    const { stdout: verifyOut } = await execFileAsync(
      process.execPath,
      ['--no-warnings', 'scripts/verify-server.js'],
      { cwd: path.join(__dirname, '..') }
    );
    assert.ok(verifyOut.includes('Passed 100%'));

    // 14d. Anti-Brute-Force + X-Forwarded-For spoofing defense
    let lockedOut = false;
    for (let i = 0; i < 10; i += 1) {
      const bfRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `203.0.113.${i + 10}`,
        },
        body: JSON.stringify({ username: 'export_emp', password: `wrong-pass-${i}` }),
      });
      if (bfRes.status === 429) {
        lockedOut = true;
        break;
      }
    }
    assert.equal(lockedOut, true, 'Brute-force attacks must hit 429 even when spoofing X-Forwarded-For');

    // 14e. Chairman rotates own password from UI -> receives fresh token & old token is immediately revoked!
    const adminMeBefore = await api('GET', '/api/auth/me', chairmanTok);
    const adminId = adminMeBefore.data.user.id;
    const rotateRes = await api('PATCH', `/api/admin/users/${adminId}`, chairmanTok, {
      fullName: adminMeBefore.data.user.fullName,
      email: adminMeBefore.data.user.email || '',
      jobTitle: adminMeBefore.data.user.jobTitle || '',
      roleId: adminMeBefore.data.user.roleId,
      departmentId: null,
      isActive: true,
      newPassword: 'Strong#Chairman2026!',
    });
    assert.equal(rotateRes.status, 200);
    assert.ok(rotateRes.data.token, 'Rotating own password must return a refreshed JWT immediately');
    assert.equal((await api('GET', '/api/auth/me', chairmanTok)).status, 401, 'Old Chairman token must be revoked');
    const activeChairmanTok = rotateRes.data.token;
    assert.equal((await api('GET', '/api/auth/me', activeChairmanTok)).status, 200, 'New Chairman token works seamlessly');

    console.log('1️⃣5️⃣ Testing Deep White-Box Hardening (No Query Token Leak, Sovereign Audit Isolation, CSRF Cookie Block, DoS Caps, OAuth Host Poisoning & Non-Root)...');
    // 15a. Query-string ?_t= token MUST be rejected (401) & audit_logs must NEVER store query strings
    const queryLeakAttempt = await fetch(`${base}/api/auth/me?_t=${encodeURIComponent(activeChairmanTok)}`);
    assert.equal(queryLeakAttempt.status, 401, 'Query-string ?_t= token must be rejected');

    // Trigger an audited action with a query string and verify endpoint in audit_logs has zero '?'
    const aiEmpTaskRes = await api(
      'POST',
      `/api/lists/${openAiBoard.data.lists[0].id}/cards?leak_probe=secret123`,
      aiEmpTok,
      { title: 'بناء نموذج سري للتنبؤ بالمبيعات لمكتب رئيس مجلس الإدارة' }
    );
    assert.equal(aiEmpTaskRes.status, 201);

    const chAuditRes = await api('GET', '/api/admin/audit-logs', activeChairmanTok);
    assert.equal(chAuditRes.status, 200);
    assert.ok(
      chAuditRes.data.every((row) => !String(row.endpoint || '').includes('?')),
      'audit_logs.endpoint must strip all query parameters'
    );
    assert.ok(
      chAuditRes.data.some((row) => String(row.details || '').includes('بناء نموذج سري')),
      'Chairman must see sovereign AI audit logs'
    );

    // 15b. IT Admin & General Manager MUST NOT see any sovereign AI or Chairman backup audit logs!
    const itAuditRes = await api('GET', '/api/admin/audit-logs', itMgrTok);
    assert.equal(itAuditRes.status, 200);
    assert.ok(
      !itAuditRes.data.some(
        (row) =>
          String(row.details || '').includes('بناء نموذج سري') ||
          String(row.details || '').includes('بناء مساعد ذكي لتحليل عقود التصدير') ||
          String(row.details || '').includes('الذكاء الاصطناعي') ||
          String(row.endpoint || '').startsWith('/api/admin/backup')
      ),
      'IT Admin audit logs must strictly exclude sovereign AI department and Chairman backup logs'
    );

    const gmAuditRes = await api('GET', '/api/admin/audit-logs', gmTok);
    assert.equal(gmAuditRes.status, 200);
    assert.ok(
      !gmAuditRes.data.some(
        (row) =>
          String(row.details || '').includes('بناء نموذج سري') ||
          String(row.details || '').includes('الذكاء الاصطناعي')
      ),
      'General Manager audit logs must strictly exclude sovereign AI department logs'
    );

    // 15c. Cookie-only CSRF on state-changing POST/PATCH/DELETE MUST return 403 CSRF_BLOCKED
    const csrfCookieOnly = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `elhelb_session_v10=${activeChairmanTok}`,
        'Content-Type': 'application/json',
      },
    });
    assert.equal(csrfCookieOnly.status, 403, 'Cookie-only state-changing request must be blocked against CSRF');
    const csrfBody = await csrfCookieOnly.json();
    assert.equal(csrfBody.code, 'CSRF_BLOCKED');

    // 15d. CPU & Body DoS defenses (oversized >128 char password -> 400; >256kb JSON -> 413)
    const longPassRes = await api('POST', '/api/auth/register', null, {
      fullName: 'اختبار حماية المعالج',
      username: 'dos.probe',
      password: 'A'.repeat(500),
    });
    assert.equal(longPassRes.status, 400, 'Oversized password (>128 chars) must be rejected immediately');

    const hugeJsonRes = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeChairmanTok}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'X'.repeat(300 * 1024), departmentId: aiDept.id }),
    });
    assert.equal(hugeJsonRes.status, 413, 'Normal API endpoints must reject >256kb JSON payloads');

    // 15e. OAuth Host-Header Poisoning defense when TRUST_PROXY is off
    const poisonedOAuth = await fetch(`${base}/api/auth/oauth/providers`, {
      headers: {
        'X-Forwarded-Host': 'evil-attacker.example.com',
        'X-Forwarded-Proto': 'https',
      },
    });
    const poisonedOAuthData = await poisonedOAuth.json();
    assert.ok(
      !String(poisonedOAuthData.googleCallbackUrl || '').includes('evil-attacker'),
      'X-Forwarded-Host must be ignored when trust proxy is disabled'
    );

    // 15f. Non-root least-privilege declarations in Dockerfile & setup-from-zip.sh
    const dockerfileContent = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
    assert.match(dockerfileContent, /^USER node$/m, 'Dockerfile must run as non-root USER node');
    const setupScriptContent = fs.readFileSync(path.join(__dirname, '..', 'setup-from-zip.sh'), 'utf8');
    assert.ok(setupScriptContent.includes('User=$SERVICE_USER') && setupScriptContent.includes('NoNewPrivileges=true'));

    console.log('1️⃣6️⃣ Testing v15.1 Zero-Defect Audit (Sovereign Assignee/Request/Grant/Email-Log Isolation, Pending User Block & Linux/Windows Installer Hardening)...');
    // 16a. Sovereign AI card assignment isolation + atomic create-with-assignees + pending user block
    const gmMe16 = await api('GET', '/api/auth/me', gmTok);
    const itMe16 = await api('GET', '/api/auth/me', itMgrTok);
    const gmId16 = gmMe16.data.user.id;
    const itId16 = itMe16.data.user.id;

    // Even Chairman calling POST /cards/:id/assignees on an AI board MUST NOT assign GM or IT Admin!
    const assignGmToAi = await api('POST', `/api/cards/${chTask.data.id}/assignees`, activeChairmanTok, {
      userId: gmId16,
    });
    assert.equal(assignGmToAi.status, 403, 'Assigning General Manager to sovereign AI card must be blocked');
    const assignItToAi = await api('POST', `/api/cards/${chTask.data.id}/assignees`, activeChairmanTok, {
      userId: itId16,
    });
    assert.equal(assignItToAi.status, 403, 'Assigning IT Admin to sovereign AI card must be blocked');

    // Register a pending (unapproved) user and verify they cannot be assigned to any card before onboarding approval
    const regUnapproved = await api('POST', '/api/auth/register', null, {
      fullName: 'متقدم بانتظار التسكين',
      username: 'pending.probe',
      password: 'PendingUser#2026',
    });
    assert.equal(regUnapproved.status, 201);
    const assignPendingRes = await api(
      'POST',
      `/api/cards/${chTask.data.id}/assignees`,
      activeChairmanTok,
      { userId: regUnapproved.data.user.id }
    );
    assert.equal(assignPendingRes.status, 404, 'Unapproved pending user must never be assignable to cards');

    // Atomic card creation with assigneeIds works cleanly in one request
    const atomicAiCard = await api(
      'POST',
      `/api/lists/${openAiBoard.data.lists[0].id}/cards`,
      activeChairmanTok,
      {
        title: 'أتمتة مطابقة شهادات التحليل بالذكاء الاصطناعي',
        priority: 'high',
        assigneeIds: [aiEmpId],
      }
    );
    assert.equal(atomicAiCard.status, 201);
    assert.ok(
      Array.isArray(atomicAiCard.data.assignees) &&
        atomicAiCard.data.assignees.some((a) => a.id === aiEmpId),
      'POST /lists/:id/cards must atomically attach validated assigneeIds'
    );

    // 16b. Sovereign AI employee permission request, notifications, email_logs & grant revocation isolation
    // Register a regular employee inside ai_systems (approved by Chairman) who lacks board.delete
    const rolesRes16 = await api('GET', '/api/admin/roles', activeChairmanTok);
    const empRoleRow = rolesRes16.data.roles.find((r) => r.slug === 'staff');
    const regAiJunior = await api('POST', '/api/auth/register', null, {
      fullName: 'باحث ذكاء اصطناعي',
      username: 'ai.researcher',
      email: 'ai.researcher@elhelbgroup.com',
      password: 'AiResearcher#2026',
    });
    assert.equal(regAiJunior.status, 201);
    const aiJuniorTok = regAiJunior.data.token;
    const aiJuniorId = regAiJunior.data.user.id;
    assert.equal(
      (
        await api('POST', `/api/onboarding/${aiJuniorId}/claim`, activeChairmanTok, {
          departmentId: aiDept.id,
          roleId: empRoleRow.id,
          jobTitle: 'باحث تعلم عميق',
        })
      ).status,
      200
    );

    // AI researcher submits a permission request for cards.delete on the sovereign AI card
    const aiPermReq = await api('POST', '/api/requests', aiJuniorTok, {
      permissionKey: 'cards.delete',
      targetCardId: atomicAiCard.data.id,
      requestedDuration: '8h',
      reason: 'أحتاج صلاحية حذف المسودة التجريبية السرية بعد دمج النموذج النهائي',
    });
    assert.equal(aiPermReq.status, 201);

    // GM and IT Admin MUST NOT receive any notification about this sovereign AI permission request!
    const gmNotifs = await api('GET', '/api/auth/notifications', gmTok);
    const itNotifs = await api('GET', '/api/auth/notifications', itMgrTok);
    assert.ok(
      !gmNotifs.data.some((n) => String(n.message || '').includes('باحث ذكاء اصطناعي')),
      'GM must never receive notifications for sovereign AI permission requests'
    );
    assert.ok(
      !itNotifs.data.some((n) => String(n.message || '').includes('باحث ذكاء اصطناعي')),
      'IT Admin must never receive notifications for sovereign AI permission requests'
    );

    // Chairman approves the sovereign grant; verify GM/IT cannot see it in activeGrants or revoke it, nor see it in emailLogs!
    const chReviewAiReq = await api(
      'POST',
      `/api/requests/${aiPermReq.data.id}/review`,
      activeChairmanTok,
      {
        decision: 'approved',
        approvedDuration: '8h',
        reviewNote: 'موافقة سيادية مباشرة',
      }
    );
    assert.equal(chReviewAiReq.status, 200);

    const chInboxAfter = await api('GET', '/api/requests/inbox', activeChairmanTok);
    const aiGrantRow = chInboxAfter.data.activeGrants.find((g) => g.user_id === aiJuniorId);
    assert.ok(aiGrantRow, 'Chairman must see active sovereign AI grant');

    const gmInboxAfter = await api('GET', '/api/requests/inbox', gmTok);
    assert.ok(
      !gmInboxAfter.data.activeGrants.some((g) => g.user_id === aiJuniorId),
      'GM must NOT see active grants belonging to sovereign AI department'
    );
    const gmRevokeAttempt = await api('POST', `/api/grants/${aiGrantRow.id}/revoke`, gmTok);
    assert.equal(gmRevokeAttempt.status, 403, 'GM must get 403 attempting to revoke a sovereign AI grant');

    const itGmailLogs = await api('GET', '/api/admin/gmail-settings', itMgrTok);
    assert.equal(itGmailLogs.status, 200);
    assert.ok(
      !itGmailLogs.data.emailLogs.some(
        (l) =>
          String(l.subject || '').includes('باحث ذكاء اصطناعي') ||
          String(l.to_email || '').includes('ai.researcher@elhelbgroup.com')
      ),
      'IT Admin Gmail logs must exclude sovereign AI email log entries'
    );

    // 16c. Linux & Windows installer script regressions (umask 022, Caddy 644, gpg --yes, protected lock, Windows CRLF & Node >= 22)
    assert.match(setupScriptContent, /^umask 022$/m, 'setup-from-zip.sh must enforce umask 022 at top level');
    assert.ok(
      setupScriptContent.includes('chmod 644 /etc/caddy/Caddyfile') &&
        setupScriptContent.includes('gpg --batch --yes --dearmor') &&
        setupScriptContent.includes('/opt/elhelb-backups/.backup.lock'),
      'setup-from-zip.sh must keep Caddyfile world-readable for caddy user, non-interactive gpg, and protected backup lock'
    );
    const winBatBuf = fs.readFileSync(path.join(__dirname, '..', 'start-windows-server.bat'));
    assert.ok(winBatBuf.includes(Buffer.from('\r\n')), 'start-windows-server.bat must use Windows CRLF line endings');
    assert.ok(
      winBatBuf.toString('utf8').includes('process.versions.node') &&
        fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'oauth.js'), 'utf8').includes('/#oauth_token='),
      'Windows script must check Node >= 22 and OAuth must deliver tokens via URL #hash fragment'
    );

    console.log('1️⃣7️⃣ Testing v15.2 Second Deep Audit (Setup-Credentials Token Refresh, Sovereign Pending Applicant Lock, Duplicate Email 409, Backup Restore Token & PM2 Auto-Secret)...');
    // 17a. Changing username in /api/onboarding/setup-credentials returns refreshed JWT so session NEVER drops with 401
    const regOAuthLike = await api('POST', '/api/auth/register', null, {
      fullName: 'موظف تحديث بيانات الدخول',
      username: 'temp.initial99',
      password: 'InitPass#2026',
    });
    assert.equal(regOAuthLike.status, 201);
    // Without currentPassword, updating already-initialized credentials must be rejected!
    assert.equal(
      (
        await api('POST', '/api/onboarding/setup-credentials', regOAuthLike.data.token, {
          username: 'final.chosen99',
          password: 'NewChosen#2026',
          fullName: 'موظف تحديث بيانات الدخول',
        })
      ).status,
      400,
      'setup-credentials must require currentPassword when has_custom_credentials is already true'
    );

    const setupCredsRes = await api(
      'POST',
      '/api/onboarding/setup-credentials',
      regOAuthLike.data.token,
      {
        username: 'final.chosen99',
        currentPassword: 'InitPass#2026',
        password: 'NewChosen#2026',
        fullName: 'موظف تحديث بيانات الدخول',
      }
    );
    assert.equal(setupCredsRes.status, 200);
    assert.ok(setupCredsRes.data.token, 'setup-credentials must issue a refreshed JWT bound to the new username');
    // Old token with old uname must be rejected (401), while refreshed token works seamlessly (200)!
    assert.equal((await api('GET', '/api/auth/me', regOAuthLike.data.token)).status, 401);
    const meAfterSetup = await api('GET', '/api/auth/me', setupCredsRes.data.token);
    assert.equal(meAfterSetup.status, 200);
    assert.equal(meAfterSetup.data.user.username, 'final.chosen99');

    // 17b. Self-service /my-preference blocks sovereign ai_systems (403); Chairman-staged AI candidate is locked against GM/IT/HR hijack, edit, or delete
    const pickAiPref17 = await api(
      'PATCH',
      '/api/onboarding/my-preference',
      setupCredsRes.data.token,
      {
        preferredDepartmentId: aiDept.id,
        jobTitle: 'مهندس رؤية حاسوبية',
      }
    );
    assert.equal(pickAiPref17.status, 403);
    const pendingAiApplicantId = meAfterSetup.data.user.id;
    const pendingRoleRow17 = (await api('GET', '/api/admin/roles', activeChairmanTok)).data.roles.find(
      (r) => r.slug === 'pending_onboarding'
    );
    assert.equal(
      (
        await api('PATCH', `/api/admin/users/${pendingAiApplicantId}`, activeChairmanTok, {
          roleId: pendingRoleRow17.id,
          departmentId: aiDept.id,
        })
      ).status,
      200
    );
    const exportDeptRow17 = (await api('GET', '/api/admin/departments', activeChairmanTok)).data.find(
      (d) => d.slug === 'export'
    );
    assert.equal(
      (
        await api('POST', `/api/onboarding/${pendingAiApplicantId}/claim`, gmTok, {
          departmentId: exportDeptRow17.id,
          roleId: empRoleRow.id,
        })
      ).status,
      403,
      'GM must not hijack a pending sovereign AI applicant into another department'
    );
    assert.equal(
      (await api('PATCH', `/api/admin/users/${pendingAiApplicantId}`, gmTok, { fullName: 'تعديل' })).status,
      403,
      'GM must not edit a pending sovereign AI applicant'
    );
    assert.equal(
      (await api('DELETE', `/api/admin/users/${pendingAiApplicantId}`, gmTok)).status,
      403,
      'GM must not delete a pending sovereign AI applicant'
    );

    // Sovereign users_count isolation on GET /api/admin/roles
    const chRoles17 = await api('GET', '/api/admin/roles', activeChairmanTok);
    const gmRoles17 = await api('GET', '/api/admin/roles', gmTok);
    const chStaffCount = chRoles17.data.roles.find((r) => r.slug === 'staff').users_count;
    const gmStaffCount = gmRoles17.data.roles.find((r) => r.slug === 'staff').users_count;
    assert.ok(
      chStaffCount > gmStaffCount,
      'GM roles users_count must exclude staff inside sovereign Chairman-exclusive departments'
    );

    // 17c. Duplicate email on POST /api/admin/users returns clean 409 (never 500)
    const dupEmailAdminRes = await api('POST', '/api/admin/users', activeChairmanTok, {
      username: 'dup.email.test',
      email: 'ai.researcher@elhelbgroup.com',
      password: 'DupEmail#2026',
      fullName: 'اختبار تكرار البريد',
      roleId: empRoleRow.id,
      departmentId: exportDeptRow17.id,
    });
    assert.equal(dupEmailAdminRes.status, 409, 'Duplicate email must return clean 409 Conflict');

    // 17d. Backup export -> Chairman rotates password (bumping token_version) -> Backup import returns valid fresh token
    const snapBeforeRotate = await api('GET', '/api/admin/backup/export', activeChairmanTok);
    assert.equal(snapBeforeRotate.status, 200);
    const chMe17 = await api('GET', '/api/auth/me', activeChairmanTok);
    const rotateAgain = await api(
      'PATCH',
      `/api/admin/users/${chMe17.data.user.id}`,
      activeChairmanTok,
      { newPassword: 'TempRotateBeforeRestore#99' }
    );
    assert.equal(rotateAgain.status, 200);
    const tokAfterRotate17 = rotateAgain.data.token;

    const restoreSnap17 = await api('POST', '/api/admin/backup/import', tokAfterRotate17, {
      snapshot: snapBeforeRotate.data.snapshot,
    });
    assert.equal(restoreSnap17.status, 200);
    assert.ok(restoreSnap17.data.token, 'Backup import must return a refreshed Chairman session token');
    const restoredChairmanTok = restoreSnap17.data.token;
    assert.equal(
      (await api('GET', '/api/auth/me', restoredChairmanTok)).status,
      200,
      'Chairman session must remain 100% active immediately after restoring an older snapshot'
    );

    // 17e. PM2 ecosystem.config.cjs auto-secret & IT_SERVER_GUIDE_AR.md unzip path check
    const pm2Out = await execFileAsync(
      process.execPath,
      [
        '--no-warnings',
        '-e',
        'const cfg = require("./ecosystem.config.cjs"); process.stdout.write(String(cfg.apps[0].env.JWT_SECRET.length));',
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, JWT_SECRET: '', DB_PATH: path.join(os.tmpdir(), `pm2-check-${Date.now()}.db`) },
      }
    );
    assert.ok(Number(pm2Out.stdout) >= 64, 'ecosystem.config.cjs must auto-provide >=64 char JWT_SECRET');
    const itGuideText = fs.readFileSync(path.join(__dirname, '..', 'IT_SERVER_GUIDE_AR.md'), 'utf8');
    assert.ok(
      !itGuideText.includes('-d elhelb-boards') && itGuideText.includes('unzip -q elhelb-boards-server.zip'),
      'IT_SERVER_GUIDE_AR.md must extract directly into elhelb-boards/ without double-nesting'
    );

    console.log('1️⃣8️⃣ Testing v16 Exhaustive Zero-Vulnerability Audit (IDOR Board Title Masking, Post-Delete Sovereign Audit Tagging, Server-Side JTI Logout Revocation & NaN/Cookie Hardening)...');
    // 18a + 18b. Create a secret sovereign AI board + card, probe IDOR as GM & IT, then delete and verify audit_logs stay 100% hidden!
    const secretAiBoardRes = await api('POST', '/api/boards', restoredChairmanTok, {
      title: 'خطة استحواذ استراتيجية سرية للغاية 2027',
      description: 'مكتب رئيس مجلس الإدارة',
      departmentId: aiDept.id,
      background: 'royal',
    });
    assert.equal(secretAiBoardRes.status, 201);
    const secretBoardId = secretAiBoardRes.data.id;
    const secretBoardDetail = await api('GET', `/api/boards/${secretBoardId}`, restoredChairmanTok);
    const secretCardRes = await api(
      'POST',
      `/api/lists/${secretBoardDetail.data.lists[0].id}/cards`,
      restoredChairmanTok,
      { title: 'ملف الصفقة السرية رقم 99' }
    );
    assert.equal(secretCardRes.status, 201);

    // Probe PATCH, DELETE, GET on board & card as IT Admin -> 403 and ZERO leak of board title or AI dept name!
    for (const probe of [
      await api('GET', `/api/boards/${secretBoardId}`, itMgrTok),
      await api('PATCH', `/api/boards/${secretBoardId}`, itMgrTok, { title: 'probe' }),
      await api('DELETE', `/api/boards/${secretBoardId}`, itMgrTok),
      await api('POST', `/api/boards/${secretBoardId}/labels`, itMgrTok, { name: 'probe' }),
      await api('GET', `/api/cards/${secretCardRes.data.id}`, itMgrTok),
    ]) {
      assert.equal(probe.status, 403);
      const rawJson = JSON.stringify(probe.data);
      assert.ok(
        !rawJson.includes('خطة استحواذ') &&
          !rawJson.includes('ملف الصفقة') &&
          !rawJson.includes('الذكاء الاصطناعي'),
        'IDOR 403 responses must NEVER leak private board/card titles or sovereign AI department name'
      );
    }

    // NaN-safe card move check
    const moveNanRes = await api(
      'POST',
      `/api/cards/${secretCardRes.data.id}/move`,
      restoredChairmanTok,
      {
        targetListId: secretBoardDetail.data.lists[1].id,
        targetIndex: 'not-a-number',
      }
    );
    assert.equal(moveNanRes.status, 200);
    assert.equal(moveNanRes.data.card.position, 1);

    // Chairman deletes the secret card AND the secret board -> verify GM & IT audit logs still show ZERO trace!
    assert.equal(
      (await api('DELETE', `/api/cards/${secretCardRes.data.id}`, restoredChairmanTok)).status,
      200
    );
    assert.equal(
      (await api('DELETE', `/api/boards/${secretBoardId}`, restoredChairmanTok)).status,
      200
    );
    const gmAuditAfterDel = await api('GET', '/api/admin/audit-logs', gmTok);
    const itAuditAfterDel = await api('GET', '/api/admin/audit-logs', itMgrTok);
    for (const logs of [gmAuditAfterDel.data, itAuditAfterDel.data]) {
      assert.ok(
        !logs.some(
          (row) =>
            String(row.details || '').includes('خطة استحواذ') ||
            String(row.details || '').includes('ملف الصفقة')
        ),
        'Post-DELETE audit logs for sovereign boards/cards must remain strictly hidden from GM & IT'
      );
    }

    // 18c. Server-side JTI cryptographic logout revocation (multi-device safe!) + spoofed X-Forwarded-Proto cookie defense
    const regLogoutUser = await api('POST', '/api/auth/register', null, {
      fullName: 'اختبار إبطال التوكن عند الخروج',
      username: 'jti.logout.user',
      password: 'LogoutSafe#2026',
    });
    assert.equal(regLogoutUser.status, 201);

    const loginLaptop = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https', // Untrusted proxy header on plain HTTP!
      },
      body: JSON.stringify({ username: 'jti.logout.user', password: 'LogoutSafe#2026' }),
    });
    assert.equal(loginLaptop.status, 200);
    const setCookieHdr = loginLaptop.headers.get('set-cookie') || '';
    assert.ok(
      !/;\s*Secure/i.test(setCookieHdr),
      'Plain HTTP server without trust proxy must ignore spoofed X-Forwarded-Proto: https on Set-Cookie'
    );
    const tokLaptop = (await loginLaptop.json()).token;

    const loginPhoneRes = await api('POST', '/api/auth/login', null, {
      username: 'jti.logout.user',
      password: 'LogoutSafe#2026',
    });
    assert.equal(loginPhoneRes.status, 200);
    const tokPhone = loginPhoneRes.data.token;

    // Logout on Laptop -> tokLaptop MUST immediately return 401 on server, while tokPhone stays 200!
    assert.equal((await api('POST', '/api/auth/logout', tokLaptop)).status, 200);
    assert.equal(
      (await api('GET', '/api/auth/me', tokLaptop)).status,
      401,
      'Logged-out JWT must be cryptographically rejected on server immediately'
    );
    assert.equal(
      (await api('GET', '/api/auth/me', tokPhone)).status,
      200,
      'Other active device session (phone) must remain active when logging out from office PC'
    );

    console.log('1️⃣9️⃣ Testing v16.1 Deep Red-Team Fixes (HR Global-Scope Block, Atomic FK Backup Rollback, Sovereign Dept/Grant/Pending Audit Masking, Dept-Only Onboarding Isolation & LIKE Wildcard Safety)...');

    // 19a. Server-side boards.view_all check when departmentId === null on POST/PATCH /api/admin/users + storage-status admin guard
    const hrGlobalCreateTry = await api('POST', '/api/admin/users', hrTok, {
      username: 'hr.global.escape',
      password: 'Escape#2026',
      fullName: 'محاولة إنشاء حساب عام بدون قسم',
      roleId: empRoleRow.id,
      departmentId: null,
    });
    assert.equal(
      hrGlobalCreateTry.status,
      403,
      'HR manager without boards.view_all must NOT create a global (department_id = NULL) account'
    );

    const hrNormalUserRes = await api('POST', '/api/admin/users', hrTok, {
      username: 'hr.scoped.emp',
      password: 'Scoped#2026',
      fullName: 'موظف مسكن بقسم التصدير',
      roleId: empRoleRow.id,
      departmentId: exportDeptRow17.id,
    });
    assert.equal(hrNormalUserRes.status, 201);

    const hrGlobalPatchTry = await api(
      'PATCH',
      `/api/admin/users/${hrNormalUserRes.data.id}`,
      hrTok,
      { departmentId: null }
    );
    assert.equal(
      hrGlobalPatchTry.status,
      403,
      'HR manager without boards.view_all must NOT move an employee to global (department_id = NULL) scope'
    );

    assert.equal(
      (await api('GET', '/api/admin/storage-status', salesEmpTok)).status,
      403,
      'Non-admin staff must receive 403 on GET /api/admin/storage-status'
    );
    assert.equal(
      (await api('GET', '/api/admin/storage-status', restoredChairmanTok)).status,
      200,
      'Chairman must receive 200 on GET /api/admin/storage-status'
    );

    // 19b. Atomic PRAGMA foreign_key_check & anti-lockout rollback on POST /api/admin/backup/import
    const cleanSnap19 = await api('GET', '/api/admin/backup/export', restoredChairmanTok);
    assert.equal(cleanSnap19.status, 200);
    const corruptedFkSnap = JSON.parse(JSON.stringify(cleanSnap19.data.snapshot));
    corruptedFkSnap.tables.boards.push({
      id: 999991,
      department_id: 888888, // Non-existent department FK!
      title: 'لوحة معطوبة بعلاقة مكسورة',
      description: '',
      background: 'emerald',
      is_archived: 0,
      created_by: 1,
      created_at: '2026-10-31 00:00:00',
    });
    const badImportRes = await api('POST', '/api/admin/backup/import', restoredChairmanTok, {
      snapshot: corruptedFkSnap,
    });
    assert.equal(
      badImportRes.status,
      400,
      'Snapshot with broken foreign keys must be rejected cleanly with 400'
    );
    // Live DB must have rolled back 100% cleanly — hr.scoped.emp created just before export is still intact!
    const usersAfterRollback = await api('GET', '/api/admin/users', restoredChairmanTok);
    assert.equal(usersAfterRollback.status, 200);
    assert.ok(
      usersAfterRollback.data.some((u) => u.username === 'hr.scoped.emp'),
      'Failed backup import must roll back atomically without losing live database records'
    );

    // 19c. Sovereign Chairman-exclusive department create -> delete + pending AI reject + AI grant revoke audit masking!
    const sovDeptRes = await api('POST', '/api/admin/departments', restoredChairmanTok, {
      name: 'مكتب التخطيط السيادي الخاص 2027',
      description: 'مكتب سري تابع لرئيس مجلس الإدارة',
      color: '#92400e',
      isChairmanExclusive: true,
    });
    assert.equal(sovDeptRes.status, 201);
    assert.equal(
      (await api('DELETE', `/api/admin/departments/${sovDeptRes.data.id}`, restoredChairmanTok)).status,
      200
    );

    // Unconfirmed registrant (preferred_department_id IS NULL) must NOT be visible or deletable by a single-department manager
    // Temporarily grant department.onboard_members to dept_manager to verify single-dept onboarding boundary
    const allRoles19 = (await api('GET', '/api/admin/roles', restoredChairmanTok)).data.roles;
    const deptMgrRole19 = allRoles19.find((r) => r.slug === 'dept_manager');
    assert.equal(
      (
        await api('PUT', `/api/admin/roles/${deptMgrRole19.id}`, restoredChairmanTok, {
          name: deptMgrRole19.name,
          description: deptMgrRole19.description,
          color: deptMgrRole19.color,
          permissions: [...deptMgrRole19.permissions, 'department.onboard_members'],
        })
      ).status,
      200
    );

    const unconfirmedReg = await api('POST', '/api/auth/register', null, {
      fullName: 'مرشح سري قبل اختيار القسم',
      username: 'unconfirmed.secret.cand',
      password: 'Candidate#2026',
    });
    assert.equal(unconfirmedReg.status, 201);
    const salesMgrPending = await api('GET', '/api/onboarding/pending', salesMgrTok);
    assert.equal(salesMgrPending.status, 200);
    assert.ok(
      !salesMgrPending.data.pendingUsers.some((u) => u.username === 'unconfirmed.secret.cand'),
      'Single-department manager must not see unconfirmed registrants before they pick that department'
    );
    assert.equal(
      (await api('DELETE', `/api/onboarding/${unconfirmedReg.data.user.id}`, salesMgrTok)).status,
      403,
      'Single-department manager must not delete an unconfirmed registrant'
    );

    // Approved employee must NEVER be able to call PATCH /api/onboarding/my-preference to cloak themselves under sovereign AI dept!
    assert.equal(
      (
        await api('PATCH', '/api/onboarding/my-preference', salesEmpTok, {
          preferredDepartmentId: aiDept.id,
          jobTitle: 'انتحال صفة سيادية',
        })
      ).status,
      403,
      'Already-approved employee must receive 403 on PATCH /api/onboarding/my-preference (anti-sovereign-cloaking)'
    );

    // Pending registrant CANNOT self-select sovereign AI department to hide their audit trail!
    assert.equal(
      (
        await api('PATCH', '/api/onboarding/my-preference', unconfirmedReg.data.token, {
          preferredDepartmentId: aiDept.id,
          jobTitle: 'مهندس ذكاء اصطناعي',
        })
      ).status,
      403,
      'Pending registrant must NOT cloak audit logs by selecting sovereign department'
    );
    // And IT/GM CAN see & audit the pending registrant before deletion!
    const itLogsBeforeDel = (await api('GET', '/api/admin/audit-logs', itMgrTok)).data;
    assert.ok(
      itLogsBeforeDel.some((row) => String(row.details || '').includes('unconfirmed.secret.cand')),
      'Pending registrant audit trail must remain visible to IT/GM'
    );
    assert.equal(
      (await api('DELETE', `/api/onboarding/${unconfirmedReg.data.user.id}`, hrTok)).status,
      200,
      'HR must be able to reject & delete any unapproved self-registered account'
    );

    const gmLogs19 = (await api('GET', '/api/admin/audit-logs', gmTok)).data;
    const itLogs19 = (await api('GET', '/api/admin/audit-logs', itMgrTok)).data;
    for (const logs of [gmLogs19, itLogs19]) {
      assert.ok(
        !logs.some((row) => String(row.details || '').includes('مكتب التخطيط السيادي الخاص')),
        'Deleting sovereign departments must never leak into GM/IT audit logs'
      );
    }

    // Gmail settings email syntax validation + literal SQLite LIKE wildcard (% / _) search check
    assert.equal(
      (
        await api('PUT', '/api/admin/gmail-settings', restoredChairmanTok, {
          gmailUser: 'not-an-email-address',
        })
      ).status,
      400,
      'Invalid Gmail sender address must return 400 Bad Request'
    );

    const wildcardSearch = await api(
      'GET',
      `/api/search?q=${encodeURIComponent('100%_literal_no_match')}`,
      restoredChairmanTok
    );
    assert.equal(wildcardSearch.status, 200);
    assert.equal(wildcardSearch.data.cards.length, 0);

    // Railway config & Windows live-watch Node 22 safety check
    const railwayCfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8')
    );
    assert.equal(
      railwayCfg.deploy.startCommand,
      '/app/docker-entrypoint.sh',
      'railway.json must invoke docker-entrypoint.sh so JWT_SECRET is auto-provisioned'
    );
    const liveWatchSrc = fs.readFileSync(
      path.join(__dirname, '..', 'deploy', 'live-watch.js'),
      'utf8'
    );
    assert.ok(
      !liveWatchSrc.includes("'npm.cmd'"),
      'live-watch.js must invoke Vite via process.execPath instead of spawning npm.cmd with shell:false on Node 22'
    );

    console.log('2️⃣0️⃣ Testing v17 External Auditor Fixes (OAuth Anti-Pre-Hijacking, AES-256-GCM Secret Vault + Redacted Backup, Per-IP+Account Lockout DoS Defense, Always-On CSP, Post-Auth 5MB Parser & Unified 10+ Password Policy)...');

    // 20a. Zero personal @gmail.com email pre-seeded in seed.js
    const seedSrc20 = fs.readFileSync(path.join(__dirname, '..', 'server', 'seed.js'), 'utf8');
    assert.ok(!/@gmail\.com/i.test(seedSrc20), 'seed.js must contain zero personal email addresses');

    // 20b. Google OAuth Pre-Hijacking Defense:
    // Attacker registers locally claiming victim's email WITHOUT verification -> Victim logs in with verified Google OAuth!
    const { findOrCreateGoogleEmployee } = require('../server/routes/oauth');
    const { get: dbGet20 } = require('../server/db');

    const squatterReg = await api('POST', '/api/auth/register', null, {
      fullName: 'مهاجم ينتحل بريد زميله',
      username: 'squatter.attacker',
      password: 'AttackerKnows#2026',
      email: 'real.victim@elhelbgroup.com',
    });
    assert.equal(squatterReg.status, 201);
    const squatterDbBefore = dbGet20(`SELECT * FROM users WHERE id = ?`, [squatterReg.data.user.id]);
    assert.equal(Number(squatterDbBefore.email_verified), 0, 'Local registration must store email_verified = 0');

    const googleRealOwner = findOrCreateGoogleEmployee({
      oauthId: 'google-verified-sub-998877',
      fullName: 'الموظف الحقيقي صاحب حساب جوجل',
      email: 'real.victim@elhelbgroup.com',
      emailVerifiedByGoogle: true,
    });
    assert.notEqual(
      Number(googleRealOwner.user.id),
      Number(squatterReg.data.user.id),
      'Verified Google login MUST NOT link into an unverified local squatter account'
    );
    assert.equal(googleRealOwner.isNewUser, true);
    const squatterDbAfter = dbGet20(`SELECT * FROM users WHERE id = ?`, [squatterReg.data.user.id]);
    assert.equal(squatterDbAfter.email, null, 'Unverified squatter email claim must be detached upon real owner Google verification');

    // Login against Google-only account without local password returns unified 401 (zero account enumeration!)
    const enumProbeGoogle = await api('POST', '/api/auth/login', null, {
      username: googleRealOwner.user.username,
      password: 'AttackerKnows#2026',
    });
    assert.equal(enumProbeGoogle.status, 401);
    assert.equal(enumProbeGoogle.data.error, 'اسم المستخدم أو كلمة المرور غير صحيحة');

    // 20c. AES-256-GCM encryption at rest for gmail_app_password & google_client_secret + redacted human backup export!
    assert.equal(
      (
        await api('PUT', '/api/admin/gmail-settings', restoredChairmanTok, {
          gmailUser: 'official.notify@elhelbgroup.com',
          gmailAppPassword: 'zvxy wuts rqpo nmlk',
        })
      ).status,
      200
    );
    assert.equal(
      (
        await api('PUT', '/api/admin/oauth-settings', restoredChairmanTok, {
          googleClientId: '12345-elhelb.apps.googleusercontent.com',
          googleClientSecret: 'GOCSPX-TopSecretValue2026',
        })
      ).status,
      200
    );

    const rawGmailCipher = dbGet20(`SELECT value FROM system_settings WHERE key = 'gmail_app_password'`).value;
    const rawGoogleCipher = dbGet20(`SELECT value FROM system_settings WHERE key = 'google_client_secret'`).value;
    assert.ok(rawGmailCipher.startsWith('enc:v1:'), 'gmail_app_password must be encrypted with AES-256-GCM at rest');
    assert.ok(!rawGmailCipher.includes('zvxywutsrqponmlk'), 'Plaintext Gmail App Password must never sit in SQLite');
    assert.ok(rawGoogleCipher.startsWith('enc:v1:'), 'google_client_secret must be encrypted with AES-256-GCM at rest');
    assert.ok(!rawGoogleCipher.includes('TopSecretValue2026'), 'Plaintext Google Client Secret must never sit in SQLite');

    // Export downloadable JSON backup -> verify neither secret (not even ciphertext) is leaked in exported JSON!
    const exportedHumanSnap = await api('GET', '/api/admin/backup/export', restoredChairmanTok);
    assert.equal(exportedHumanSnap.status, 200);
    const exportedJsonText = JSON.stringify(exportedHumanSnap.data.snapshot);
    assert.ok(
      !exportedJsonText.includes('gmail_app_password') &&
        !exportedJsonText.includes('google_client_secret') &&
        !exportedJsonText.includes('TopSecretValue2026'),
      'Human JSON backup export must strip third-party Gmail/Google secrets completely'
    );

    // Restoring that redacted backup on the server MUST preserve the server's existing encrypted secrets!
    const reimportRedacted = await api('POST', '/api/admin/backup/import', restoredChairmanTok, {
      snapshot: exportedHumanSnap.data.snapshot,
    });
    assert.equal(reimportRedacted.status, 200);
    const chTok20 = reimportRedacted.data.token;
    const oauthAfterRestore = await api('GET', '/api/admin/oauth-settings', chTok20);
    assert.equal(oauthAfterRestore.data.googleSecretSaved, true, 'Server must preserve encrypted OAuth secret across backup restore');
    const gmailAfterRestore = await api('GET', '/api/admin/gmail-settings', chTok20);
    assert.equal(gmailAfterRestore.data.appPasswordSaved, true, 'Server must preserve encrypted Gmail App Password across backup restore');

    // 20d. Pre-auth 5MB body parser protection on POST /api/admin/backup/import!
    const hugeUnauthPayload = JSON.stringify({ pad: 'X'.repeat(400 * 1024) }); // 400KB > 256KB standard limit
    const unauthImportProbe = await fetch(`${base}/api/admin/backup/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugeUnauthPayload,
    });
    assert.equal(
      unauthImportProbe.status,
      401,
      'Unauthenticated POST to /api/admin/backup/import must be rejected with 401 BEFORE parsing 5MB body'
    );
    const nonChairImportProbe = await fetch(`${base}/api/admin/backup/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${itMgrTok}`,
        'X-Elhelb-Token': itMgrTok,
      },
      body: hugeUnauthPayload,
    });
    assert.equal(
      nonChairImportProbe.status,
      403,
      'Non-Chairman POST to /api/admin/backup/import must be rejected with 403 BEFORE parsing 5MB body'
    );

    // 20e. Per-(IP + username) lockout prevents remote Account Lockout DoS when behind trusted reverse proxy (TRUST_PROXY=1)
    app.set('trust proxy', 1);
    try {
      let attackerGot429 = false;
      for (let i = 0; i < 9; i += 1) {
        const atk = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.200',
          },
          body: JSON.stringify({ username: 'admin', password: `wrong-dos-${i}` }),
        });
        if (atk.status === 429) {
          attackerGot429 = true;
          break;
        }
      }
      assert.equal(attackerGot429, true, 'Attacker IP must be locked out after 8 failed guesses on admin');

      // Real Chairman from a DIFFERENT office IP ('198.51.100.10') MUST STILL LOG IN 200 OK!
      const legitChairmanLogin = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.10',
        },
        body: JSON.stringify({ username: 'admin', password: 'Strong#Chairman2026!' }),
      });
      assert.equal(
        legitChairmanLogin.status,
        200,
        'Attacker failing 8 times from another IP must NEVER lock out the real Chairman on their own IP'
      );
    } finally {
      app.set('trust proxy', false);
    }

    // 20f. Unified 10+ password policy + weak-password blocklist + zero window token / dangerouslySetInnerHTML in frontend
    assert.equal(
      (
        await api('POST', '/api/auth/register', null, {
          fullName: 'اختبار باسورد قصير',
          username: 'short.pw.user',
          password: 'Short123', // 8 chars (< 10)
        })
      ).status,
      400,
      'Passwords shorter than 10 characters must be rejected'
    );
    assert.equal(
      (
        await api('POST', '/api/auth/register', null, {
          fullName: 'اختبار باسورد شائع',
          username: 'common.pw.user',
          password: 'password1234', // 12 chars but in COMMON_WEAK_PASSWORDS
        })
      ).status,
      400,
      'Common weak passwords must be rejected even if >= 10 characters'
    );

    const apiJsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8');
    assert.ok(
      !apiJsSrc.includes('window.__ELHELB_TOKEN_V10__ =') && !apiJsSrc.includes('localStorage.setItem'),
      'src/api.js must never write tokens to global window properties or persistent localStorage'
    );
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'components'))) {
      const compSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', f), 'utf8');
      assert.ok(!compSrc.includes('dangerouslySetInnerHTML'), `${f} must contain zero dangerouslySetInnerHTML`);
    }

    // Always-on CSP check even when ALLOW_IFRAME_PREVIEW=1 in child process
    const previewCspOut = await execFileAsync(
      process.execPath,
      [
        '--no-warnings',
        '-e',
        `
        const app = require('./server/index.js');
        const srv = app.listen(0, '127.0.0.1', async () => {
          const r = await fetch('http://127.0.0.1:' + srv.address().port + '/api/health');
          process.stdout.write(r.headers.get('content-security-policy') || '');
          srv.close(() => process.exit(0));
        });
        `,
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DB_PATH: ':memory:', ALLOW_IFRAME_PREVIEW: '1' },
      }
    );
    assert.ok(
      previewCspOut.stdout.includes("script-src 'self'") &&
        previewCspOut.stdout.includes("object-src 'none'"),
      'CSP script-src and object-src must remain strictly enforced even when ALLOW_IFRAME_PREVIEW=1'
    );

    console.log('2️⃣1️⃣ Testing v18 Second Deep Auditor Fixes (Zero Default Admin Password, Anti-Audit-Hiding, Mail-Bomb Guard, Self-Dept/Password/Role Amplification Locks, CloudSync Key Separation, Scoped Board Grants & Strict Email/Title Validation)...');

    // 21a. Zero leaked legacy hash or plaintext password in seed.js & tests + ADMIN_RESET_PASSWORD recovery
    const seedSrc21 = fs.readFileSync(path.join(__dirname, '..', 'server', 'seed.js'), 'utf8');
    assert.ok(
      !seedSrc21.includes('nzDzqaKeSvRqLYoqCYggUufp8Za8HtCrk84n7GTjfvAHUsSH7hEWS'),
      'seed.js must never contain the old leaked hash'
    );
    process.env.ADMIN_RESET_PASSWORD = 'RecoveredChairman#2026!';
    try {
      const { seedIfNeeded: reseed21 } = require('../server/seed');
      reseed21();
      const recTok = await login('admin', 'RecoveredChairman#2026!');
      assert.ok(recTok, 'ADMIN_RESET_PASSWORD must cleanly recover Chairman account');
      // Rotate back to Strong#Chairman2026! via UI API
      const adminMe21 = await api('GET', '/api/auth/me', recTok);
      const rotBack21 = await api('PATCH', `/api/admin/users/${adminMe21.data.user.id}`, recTok, {
        fullName: adminMe21.data.user.fullName,
        roleId: adminMe21.data.user.roleId,
        departmentId: null,
        isActive: true,
        newPassword: 'Strong#Chairman2026!',
      });
      assert.equal(rotBack21.status, 200);
      var chTok21 = rotBack21.data.token;
    } finally {
      delete process.env.ADMIN_RESET_PASSWORD;
    }

    // 21b. Public /api/auth/oauth/providers hides sovereign departments + /my-preference anti-mail-bombing
    const pubProviders21 = await api('GET', '/api/auth/oauth/providers');
    assert.equal(pubProviders21.status, 200);
    assert.equal(pubProviders21.data.departments.length, 13);
    assert.ok(
      !pubProviders21.data.departments.some((d) => d.is_chairman_exclusive || d.slug === 'ai_systems'),
      'Public /api/auth/oauth/providers must exclude sovereign departments'
    );

    const antiFloodCand = await api('POST', '/api/auth/register', null, {
      fullName: 'متقدم لاختبار عدم تكرار الإيميلات',
      username: 'antiflood.cand21',
      password: 'CandidateStrong#2026',
    });
    assert.equal(antiFloodCand.status, 201);

    const logsBeforePref = dbGet20(`SELECT COUNT(*) AS cnt FROM email_logs`).cnt;
    assert.equal(
      (
        await api('PATCH', '/api/onboarding/my-preference', antiFloodCand.data.token, {
          preferredDepartmentId: exportDept.id,
          jobTitle: 'أخصائي تصدير',
        })
      ).status,
      200
    );
    const logsAfterFirstPref = dbGet20(`SELECT COUNT(*) AS cnt FROM email_logs`).cnt;
    assert.equal(logsAfterFirstPref, logsBeforePref + 1, 'First department selection sends 1 admin alert');

    // Repeating /my-preference with same department or switching departments must NOT send extra SMTP emails!
    assert.equal(
      (
        await api('PATCH', '/api/onboarding/my-preference', antiFloodCand.data.token, {
          preferredDepartmentId: exportDept.id,
          jobTitle: 'أخصائي تصدير أول',
        })
      ).status,
      200
    );
    assert.equal(
      (
        await api('PATCH', '/api/onboarding/my-preference', antiFloodCand.data.token, {
          preferredDepartmentId: regDept.id,
          jobTitle: 'أخصائي تسجيل',
        })
      ).status,
      200
    );
    const logsAfterRepeatPref = dbGet20(`SELECT COUNT(*) AS cnt FROM email_logs`).cnt;
    assert.equal(
      logsAfterRepeatPref,
      logsAfterFirstPref,
      'Repeated /my-preference calls must NEVER send extra SMTP emails (anti-mail-bomb)'
    );

    // 21c. HR Manager CANNOT hop departments on self OR reset passwords of approved employees in other departments!
    const hrMe21 = await api('GET', '/api/auth/me', hrTok);
    assert.equal(
      (
        await api('PATCH', `/api/admin/users/${hrMe21.data.user.id}`, hrTok, {
          departmentId: exportDept.id,
        })
      ).status,
      403,
      'HR Manager must receive 403 attempting to move their own account into another department'
    );
    const salesMgrMe21 = await api('GET', '/api/auth/me', salesMgrTok);
    assert.equal(
      (
        await api('PATCH', `/api/admin/users/${salesMgrMe21.data.user.id}`, hrTok, {
          newPassword: 'HijackAttempt#2026!',
        })
      ).status,
      403,
      'HR Manager must receive 403 attempting to reset password of an approved manager in another department'
    );

    // 21d. Anti-Privilege-Amplification on roles.manage (IT Admin lacks boards.delete -> cannot add boards.delete to staff or new role)
    assert.equal(
      (
        await api('PUT', `/api/admin/roles/${staffRole.id}`, itMgrTok, {
          permissions: [...staffRole.permissions, 'boards.delete'],
        })
      ).status,
      403,
      'IT Admin lacking boards.delete must receive 403 trying to add boards.delete to staff role'
    );
    assert.equal(
      (
        await api('POST', '/api/admin/roles', itMgrTok, {
          name: 'دور مضخم غير مصرح',
          permissions: ['boards.view_department', 'boards.delete'],
        })
      ).status,
      403,
      'IT Admin lacking boards.delete must receive 403 trying to create a role containing boards.delete'
    );

    // 21e. CloudSync encryption key separation (stealing storage token alone cannot decrypt snapshot)
    const { encodeSnapshot, decodeSnapshot } = require('../server/cloudSync');
    const sampleCipher = encodeSnapshot({ tables: { users: [] } }, 'stolen-storage-token-123456');
    const origJwtEnv = process.env.JWT_SECRET;
    process.env.CLOUD_ENCRYPTION_KEY = 'wrong-attacker-guessed-secret-999999';
    let failedDecryptWithoutAppKey = false;
    try {
      decodeSnapshot(sampleCipher, 'stolen-storage-token-123456');
    } catch (_) {
      failedDecryptWithoutAppKey = true;
    } finally {
      delete process.env.CLOUD_ENCRYPTION_KEY;
      process.env.JWT_SECRET = origJwtEnv;
    }
    assert.equal(
      failedDecryptWithoutAppKey,
      true,
      'Stealing storage token without CLOUD_ENCRYPTION_KEY / JWT_SECRET must fail AES-GCM authentication'
    );

    // 21f. Board-scoped request on foreign board stays board-scoped (not widened to department) & non-view once grant does not grant board view
    const extraExportBoard = await api('POST', '/api/boards', chTok21, {
      title: 'لوحة تصدير ثانية سرية',
      departmentId: exportDept.id,
    });
    assert.equal(extraExportBoard.status, 201);
    const singleBoardReq = await api('POST', '/api/requests', salesEmpTok, {
      permissionKey: 'boards.view_department',
      targetBoardId: exportBoards.data[0].id,
      requestedDuration: '1h',
      reason: 'أحتاج الاطلاع على هذه اللوحة الواحدة فقط لمطابقة فاتورة شحنة.',
    });
    assert.equal(singleBoardReq.status, 201);
    const createdReqRow = dbGet20(`SELECT * FROM permission_requests WHERE id = ?`, [
      singleBoardReq.data.id,
    ]);
    assert.equal(
      createdReqRow.scope_type,
      'board',
      'Requesting view on a specific board ID must remain board-scoped, NOT widened to department'
    );
    assert.equal(Number(createdReqRow.target_board_id), Number(exportBoards.data[0].id));
    assert.equal(
      (
        await api('POST', `/api/requests/${singleBoardReq.data.id}/review`, chTok21, {
          decision: 'approved',
          approvedDuration: '1h',
        })
      ).status,
      200
    );
    assert.equal(
      (await api('GET', `/api/boards/${exportBoards.data[0].id}`, salesEmpTok)).status,
      200,
      'Approved single-board grant allows viewing that exact board'
    );
    assert.equal(
      (await api('GET', `/api/boards/${extraExportBoard.data.id}`, salesEmpTok)).status,
      403,
      'Approved single-board grant MUST NOT leak access to other boards in the same department'
    );

    // 21g. Strict isDeliverableEmail + executive title spoofing block + [object Object] guard + deployment configs
    const { isDeliverableEmail } = require('../server/mailer');
    for (const badMail of [
      '"attacker"@domain.com',
      '<victim@domain.com>',
      'a,b@domain.com',
      'user..double@domain.com',
      'bad@domain.invalid',
    ]) {
      assert.equal(isDeliverableEmail(badMail), false, `isDeliverableEmail must reject ${badMail}`);
    }
    assert.equal(isDeliverableEmail('export.team@elhelbgroup.com'), true);

    for (const spoofName of ['رئيس مجلس الإدارة', 'المدير العام للشركة', 'System Admin', 'Chairman']) {
      assert.equal(
        (
          await api('POST', '/api/auth/register', null, {
            fullName: spoofName,
            username: `spoof.${Math.random().toString(36).slice(2, 8)}`,
            password: 'SpoofTestPass#2026',
          })
        ).status,
        400,
        `Self-registration must reject spoofed executive title: ${spoofName}`
      );
    }

    assert.ok(
      apiJsSrc.includes('extractApiErrorMessage') && apiJsSrc.includes("typeof payload.error === 'object'"),
      'src/api.js must safely unwrap object error payloads so [object Object] never renders'
    );
    const renderYamlSrc = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
    assert.ok(
      renderYamlSrc.includes('TRUST_PROXY') && renderYamlSrc.includes('ADMIN_INIT_PASSWORD'),
      'render.yaml must configure TRUST_PROXY and ADMIN_INIT_PASSWORD'
    );
    const installShSrc = fs.readFileSync(
      path.join(__dirname, '..', 'deploy', 'install-server.sh'),
      'utf8'
    );
    assert.ok(
      installShSrc.includes('--ignore-scripts') && installShSrc.includes('runuser -u "$SERVICE_USER"'),
      'install-server.sh must run builds as unprivileged service user with --ignore-scripts'
    );
    const composeSrc = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
    assert.ok(
      composeSrc.includes('127.0.0.1'),
      'docker-compose.yml must bind to 127.0.0.1 by default'
    );

    console.log('2️⃣2️⃣ Testing v19.1 Multi-Lambda Zero-Env-Var Vercel Serverless Consistency (Container 1 Signs Token -> Container 2 Verifies Across Separate /tmp DBs Without 401)...');
    const vercelSimDb1 = path.join(os.tmpdir(), `elhelb-vercel-sim1-${Date.now()}.db`);
    const vercelSimDb2 = path.join(os.tmpdir(), `elhelb-vercel-sim2-${Date.now()}.db`);
    try {
      const sharedVercelEnv = {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_PROJECT_ID: 'prj_test_elhelb_multi_lambda',
        VERCEL_PROJECT_PRODUCTION_URL: 'elhelb.vercel.app',
        JWT_SECRET: '',
        ADMIN_INIT_PASSWORD: '',
      };

      // Lambda Container #1 signs a Chairman JWT (simulating POST /api/auth/login on Container 1)
      const { stdout: vercelC1Out } = await execFileAsync(
        process.execPath,
        [
          '--no-warnings',
          '-e',
          `
          require('./server/index.js');
          const { get } = require('./server/db.js');
          const { signUserToken } = require('./server/rbac.js');
          const ch = get("SELECT * FROM users WHERE username = 'admin'");
          console.log(JSON.stringify({ token: signUserToken(ch) }));
          process.exit(0);
          `,
        ],
        {
          cwd: path.join(__dirname, '..'),
          env: { ...sharedVercelEnv, DB_PATH: vercelSimDb1 },
          encoding: 'utf8',
        }
      );
      const { token: container1Token } = JSON.parse(vercelC1Out.trim().split('\n').pop());

      // Lambda Container #2 (with a completely separate /tmp SQLite DB!) receives parallel GETs right after login
      const { stdout: vercelC2Out } = await execFileAsync(
        process.execPath,
        [
          '--no-warnings',
          '-e',
          `
          const app = require('./server/index.js');
          const tok = process.argv[1];
          const srv = app.listen(0, '127.0.0.1', async () => {
            const p = srv.address().port;
            const hdrs = { Authorization: 'Bearer ' + tok };
            const [bRes, nRes, rRes] = await Promise.all([
              fetch('http://127.0.0.1:' + p + '/api/boards', { headers: hdrs }),
              fetch('http://127.0.0.1:' + p + '/api/auth/notifications', { headers: hdrs }),
              fetch('http://127.0.0.1:' + p + '/api/requests/inbox', { headers: hdrs }),
            ]);
            srv.close(() => {
              console.log(JSON.stringify({
                boards: bRes.status,
                notifications: nRes.status,
                requests: rRes.status,
              }));
              process.exit(0);
            });
          });
          `,
          container1Token,
        ],
        {
          cwd: path.join(__dirname, '..'),
          env: { ...sharedVercelEnv, DB_PATH: vercelSimDb2 },
          encoding: 'utf8',
        }
      );
      const parsedC2 = JSON.parse(vercelC2Out.trim().split('\n').pop());
      assert.equal(parsedC2.boards, 200, 'Lambda Container #2 GET /api/boards must return 200 (never 401)');
      assert.equal(parsedC2.notifications, 200, 'Lambda Container #2 GET /api/auth/notifications must return 200');
      assert.equal(parsedC2.requests, 200, 'Lambda Container #2 GET /api/requests must return 200');
    } finally {
      for (const dbFile of [vercelSimDb1, vercelSimDb2]) {
        for (const ext of ['', '-wal', '-shm']) {
          try { fs.unlinkSync(`${dbFile}${ext}`); } catch (_) {}
        }
      }
    }

    console.log('\n✅ ALL 22 PRODUCTION v19.1 TESTS (100% MULTI-LAMBDA VERCEL + EXTERNAL AUDITOR + RED-TEAM SUITE) PASSED 100%!');
  } finally {
    server.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(`${tmpDb}-wal`); } catch (_) {}
    try { fs.unlinkSync(`${tmpDb}-shm`); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
