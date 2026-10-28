const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `elhelb-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

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
    console.log('1️⃣ Testing clean production seed: ONLY admin (010228513849) exists & quick-login endpoint is removed...');
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

    // Owner sovereign account logs in with admin / 010228513849
    const chairmanTok = await login('admin', '010228513849');

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
    assert.equal(deptsRes.data.length, 8);

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
    assert.equal(chairmanBoards.data.length, 8, 'Admin (Chairman) should see all 8 company boards across all 8 departments');

    const execSummary = await api('GET', '/api/boards/executive-summary', chairmanTok);
    assert.equal(execSummary.status, 200);
    assert.equal(execSummary.data.departments.length, 8, 'Executive summary should include all 8 departments');

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
    assert.equal(itDepts.data.length, 8);

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
      password: 'Password123',
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
      // Container A creates employee @mo.ai with password 010228513849 as HR Manager
      const createMoAi = await api('POST', '/api/admin/users', chairmanTok, {
        username: 'mo.ai',
        password: '010228513849',
        fullName: 'محمد عبد الرحمن',
        email: 'mb9836504@gmail.com',
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
      assert.equal(rawStateBuf.includes(Buffer.from('mb9836504@gmail.com')), false);

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
              body: JSON.stringify({ username: 'mo.ai', password: '010228513849' })
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
        password: '010228513849',
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
              body: JSON.stringify({ username: 'mo.ai', password: '010228513849' })
            });
            const r2 = await fetch('http://127.0.0.1:' + p + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: 'sara.hr', password: '010228513849' })
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

    console.log('\n✅ ALL 11 PRODUCTION v11 TESTS (CLOUD PERSISTENCE, SESSION ISOLATION, HR ONBOARDING, DELETION & RBAC) PASSED 100%!');
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
