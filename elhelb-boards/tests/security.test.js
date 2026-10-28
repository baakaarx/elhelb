const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `elhelb-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.ELHELB_TEST_MODE = '1';

const app = require('../server/index');
const oauthRoutes = require('../server/routes/oauth');

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
    const deptMgrRole = roleBySlug('dept_manager');
    const staffRole = roleBySlug('staff');
    const viewerRole = roleBySlug('viewer');

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

    console.log('6️⃣ Testing Email Verification OTP -> Zero Facebook -> Create Username/Password -> Pick Department -> Claim...');
    const exportDept = deptBySlug('export');

    // Facebook & unverified social-entry endpoints must be completely removed (404)!
    const fbGone = await api('GET', '/api/auth/oauth/facebook/start', chairmanTok);
    assert.equal(fbGone.status, 404, 'Facebook OAuth route must be completely removed');
    const unverifiedSocialGone = await api('POST', '/api/auth/social-entry', chairmanTok, {
      fullName: 'Bypass',
      email: 'bypass@gmail.com',
    });
    assert.equal(unverifiedSocialGone.status, 404, 'Unverified social-entry route must be completely removed');

    // Inline 1-Step Gmail Activator: wrong admin password MUST be blocked (401)
    const badQuickGmail = await api('POST', '/api/auth/quick-setup-gmail', null, {
      adminPassword: 'wrong-password',
      gmailUser: 'mb9836504@gmail.com',
      gmailAppPassword: 'abcd efgh ijkl mnop',
    });
    assert.equal(badQuickGmail.status, 401, 'Quick Gmail setup must verify admin password');

    // Valid admin password activates Gmail AND sends OTP to pending employee in one step!
    const okQuickGmail = await api('POST', '/api/auth/quick-setup-gmail', null, {
      adminPassword: '010228513849',
      gmailUser: 'mb9836504@gmail.com',
      gmailAppPassword: 'abcd efgh ijkl mnop',
      pendingEmail: 'mahmoud.shennawy@gmail.com',
      pendingFullName: 'محمود سامي الشناوي',
    });
    assert.equal(okQuickGmail.status, 200);
    assert.equal(okQuickGmail.data.codeSent, true);

    const realOtp = oauthRoutes._lastTestOtpByEmail.get('mahmoud.shennawy@gmail.com');
    assert.match(realOtp, /^\d{6}$/);

    // Wrong 6-digit code MUST be rejected!
    const wrongOtp = realOtp === '000000' ? '999999' : '000000';
    const badVerify = await api('POST', '/api/auth/email/verify-code', null, {
      email: 'mahmoud.shennawy@gmail.com',
      code: wrongOtp,
    });
    assert.equal(badVerify.status, 400, 'Wrong OTP code must be rejected');

    // Valid 6-digit OTP verifies email and creates pending onboarding employee!
    const verifyRes = await api('POST', '/api/auth/email/verify-code', null, {
      email: 'mahmoud.shennawy@gmail.com',
      code: realOtp,
      fullName: 'محمود سامي الشناوي',
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.data.isNewUser, true);
    const newGoogleTok = verifyRes.data.token;

    // Check /me shows emailVerified: true & Step 1 required (hasCustomCredentials: false)
    const mePending = await api('GET', '/api/auth/me', newGoogleTok);
    assert.equal(mePending.status, 200);
    assert.equal(mePending.data.user.emailVerified, true);
    assert.equal(mePending.data.user.onboardingStatus, 'pending');
    assert.equal(mePending.data.user.hasCustomCredentials, false);
    assert.equal(mePending.data.user.departmentConfirmed, false);
    assert.equal(mePending.data.user.permissions.length, 0);

    // Step 1: Employee creates their own username & password!
    const setupCreds = await api('POST', '/api/onboarding/setup-credentials', newGoogleTok, {
      username: 'mahmoud.export',
      password: 'myPassword99',
      fullName: 'محمود سامي الشناوي',
    });
    assert.equal(setupCreds.status, 200);

    // Verify Mahmoud can ALSO log in directly using his newly created username & password!
    const directLoginTok = await login('mahmoud.export', 'myPassword99');
    assert.ok(directLoginTok);

    // Step 2: Employee chooses their department (Export) -> triggers notification + email log!
    const pickDept = await api('PATCH', '/api/onboarding/my-preference', newGoogleTok, {
      preferredDepartmentId: exportDept.id,
      jobTitle: 'منسق شحن بحري',
    });
    assert.equal(pickDept.status, 200);
    assert.equal(pickDept.data.departmentConfirmed, true);

    // Pending employee sees ZERO company boards until claimed by Department Head!
    const pendingBoards = await api('GET', '/api/boards', newGoogleTok);
    assert.equal(pendingBoards.status, 200);
    assert.equal(pendingBoards.data.length, 0, 'Pending social user must see 0 boards before onboarding');

    // Pending employee cannot submit permission elevation requests before onboarding
    const pendingReqAttempt = await api('POST', '/api/requests', newGoogleTok, {
      permissionKey: 'boards.view_department',
      targetDepartmentId: exportDept.id,
      reason: 'محاولة قبل موافقة رئيس القسم',
    });
    assert.equal(pendingReqAttempt.status, 403);

    // Sales Manager tries to claim employee into Export department -> BLOCKED!
    const crossDeptClaim = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      salesMgrTok,
      {
        departmentId: exportDept.id,
        roleId: staffRole.id,
      }
    );
    assert.equal(crossDeptClaim.status, 403, 'Department Head must only claim into their own department');

    // Export Manager tries to elevate employee to Chairman -> BLOCKED!
    const illegalRankClaim = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      exportMgrTok,
      {
        departmentId: exportDept.id,
        roleId: chairmanRole.id,
      }
    );
    assert.equal(illegalRankClaim.status, 403, 'Department Head cannot grant higher/equal rank role');

    // Export Manager claims Mahmoud into Export Department as Staff!
    const validClaim = await api(
      'POST',
      `/api/onboarding/${mePending.data.user.id}/claim`,
      exportMgrTok,
      {
        departmentId: exportDept.id,
        roleId: staffRole.id,
        jobTitle: 'منسق شحن بحري دولي',
      }
    );
    assert.equal(validClaim.status, 200);

    // Verify Gmail notification settings & email_logs recorded both events cleanly!
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

    console.log('\n✅ ALL 8 PRODUCTION v4 TESTS (SINGLE ADMIN ACCOUNT, ZERO DEMO ACCOUNTS, RBAC, ONBOARDING & GMAIL) PASSED 100%!');
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
