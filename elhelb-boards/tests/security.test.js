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
    console.log('1️⃣ Testing unauthenticated block...');
    const unauth = await api('GET', '/api/boards');
    assert.equal(unauth.status, 401);

    const chairmanTok = await login('chairman', '123456');
    const adminTok = await login('admin', '123456');
    const itMgrTok = await login('it_mgr', '123456');
    const exportMgrTok = await login('export_mgr', '123456');
    const exportEmpTok = await login('export_emp', '123456');
    const regEmpTok = await login('reg_emp', '123456');
    const salesMgrTok = await login('sales_mgr', '123456');
    const salesEmpTok = await login('sales_emp', '123456');
    const salesViewerTok = await login('sales_viewer', '123456');
    const mediaEmpTok = await login('media_emp', '123456');

    console.log('2️⃣ Testing strict Department Isolation across Export, Product Registration, IT, Sales & Media...');
    const chairmanBoards = await api('GET', '/api/boards', chairmanTok);
    assert.equal(chairmanBoards.status, 200);
    assert.equal(chairmanBoards.data.length, 8, 'Chairman should see all 8 company boards across all 8 departments');

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

    // IDOR attack: Sales employee editing a Media card directly by card ID
    const mediaBoardFull = await api('GET', `/api/boards/${mediaBoard.id}`, mediaEmpTok);
    assert.equal(mediaBoardFull.status, 200);
    const mediaCard = mediaBoardFull.data.cards[0];
    const idorAttack = await api('PATCH', `/api/cards/${mediaCard.id}`, salesEmpTok, {
      title: 'اختراق كارت قسم آخر',
    });
    assert.equal(idorAttack.status, 403, 'Server must block cross-department IDOR on cards');

    console.log('3️⃣ Testing Sovereign Role Hierarchy (Chairman > GM > IT Admin)...');
    // IT Manager HAS shared administrative access to boards, users, roles & departments
    const itDepts = await api('GET', '/api/admin/departments', itMgrTok);
    assert.equal(itDepts.status, 200);
    assert.equal(itDepts.data.length, 8);

    const rolesRes = await api('GET', '/api/admin/roles', chairmanTok);
    const chairmanRole = rolesRes.data.roles.find((r) => r.slug === 'chairman');
    const superAdminRole = rolesRes.data.roles.find((r) => r.slug === 'super_admin');
    const staffRole = rolesRes.data.roles.find((r) => r.slug === 'staff');

    // Neither GM (admin) nor IT Manager (it_mgr) can edit Chairman's sovereign role!
    const gmTouchChairman = await api('PUT', `/api/admin/roles/${chairmanRole.id}`, adminTok, {
      name: 'تغيير غير مصرح',
    });
    assert.equal(gmTouchChairman.status, 403, 'GM must NOT be able to modify Chairman role');

    const itTouchGm = await api('PUT', `/api/admin/roles/${superAdminRole.id}`, itMgrTok, {
      name: 'تغيير المدير العام من IT',
    });
    assert.equal(itTouchGm.status, 403, 'IT Admin must NOT be able to modify GM role');

    // Users list check: IT Admin cannot deactivate or downgrade Chairman user
    const usersList = await api('GET', '/api/admin/users', chairmanTok);
    const chairmanUser = usersList.data.find((u) => u.username === 'chairman');
    const itAttackChairmanUser = await api('PATCH', `/api/admin/users/${chairmanUser.id}`, itMgrTok, {
      isActive: false,
    });
    assert.equal(itAttackChairmanUser.status, 403, 'IT Admin must NOT be able to modify Chairman account');

    console.log('4️⃣ Testing Viewer vs Staff Role enforcement on server...');
    const salesBoard1 = salesBoards.data[0];
    const salesBoardFull = await api('GET', `/api/boards/${salesBoard1.id}`, salesEmpTok);
    const salesLists = salesBoardFull.data.lists;
    const salesCards = salesBoardFull.data.cards;

    // Viewer cannot create or move cards
    const viewerCreate = await api('POST', `/api/lists/${salesLists[0].id}/cards`, salesViewerTok, {
      title: 'كارت من متدرب بدون صلاحية',
    });
    assert.equal(viewerCreate.status, 403);

    const viewerMove = await api('POST', `/api/cards/${salesCards[0].id}/move`, salesViewerTok, {
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

    console.log('6️⃣ Testing Google/Facebook Sign-In -> Create Username/Password -> Pick Department -> Claim + Gmail Logs...');
    const exportDept = itDepts.data.find((d) => d.slug === 'export');

    // New employee signs in via Google with ONLY their real name & Gmail
    const googleSign = await api('POST', '/api/auth/social-entry', null, {
      provider: 'google',
      fullName: 'محمود سامي الشناوي',
      email: 'mahmoud.shennawy@gmail.com',
    });
    assert.equal(googleSign.status, 200);
    assert.equal(googleSign.data.isNewUser, true);
    const newGoogleTok = googleSign.data.token;

    // Check /me shows Step 1 required (hasCustomCredentials: false, departmentConfirmed: false)
    const mePending = await api('GET', '/api/auth/me', newGoogleTok);
    assert.equal(mePending.status, 200);
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
    const wrongCard = salesCards.find((c) => c.id !== empCreateCard.data.id);
    const deleteWrongCard = await api('DELETE', `/api/cards/${wrongCard.id}`, salesEmpTok);
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
    const inboxChairman = await api('GET', '/api/requests/inbox', chairmanTok);
    const crossDeptReq = inboxChairman.data.requests.find(
      (r) => r.permission_key === 'boards.view_department' && r.status === 'pending'
    );
    assert.ok(crossDeptReq, 'Seeded cross-dept request should exist');

    // Sales Manager MUST NOT be allowed to approve access to Media Department!
    const illegalCrossApprove = await api(
      'POST',
      `/api/requests/${crossDeptReq.id}/review`,
      salesMgrTok,
      { decision: 'approved', approvedDuration: '24h' }
    );
    assert.equal(illegalCrossApprove.status, 403);

    // Chairman approves 24h view access to Media Department for Sales Employee
    const chairmanCrossApprove = await api('POST', `/api/requests/${crossDeptReq.id}/review`, chairmanTok, {
      decision: 'approved',
      approvedDuration: '24h',
      reviewNote: 'مسموح بالاطلاع لمتابعة الكتالوج التصديري.',
    });
    assert.equal(chairmanCrossApprove.status, 200);

    // Now Sales employee CAN view Media board
    const canViewMediaNow = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(canViewMediaNow.status, 200);
    assert.ok(canViewMediaNow.data.board.accessViaGrant);

    // Chairman revokes the grant -> access immediately cut off!
    const grantId = canViewMediaNow.data.board.accessViaGrant.id;
    const revokeRes = await api('POST', `/api/grants/${grantId}/revoke`, chairmanTok);
    assert.equal(revokeRes.status, 200);

    const viewAfterRevoke = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(viewAfterRevoke.status, 403, 'Revoked grant must immediately cut off access');

    console.log('\n✅ ALL 8 SOVEREIGN RBAC, EXPORT/REGISTRATION/IT ISOLATION & GOOGLE/FACEBOOK ONBOARDING TESTS PASSED 100%!');
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
