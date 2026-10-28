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

    const adminTok = await login('admin', '123456');
    const salesMgrTok = await login('sales_mgr', '123456');
    const salesEmpTok = await login('sales_emp', '123456');
    const salesViewerTok = await login('sales_viewer', '123456');
    const mediaEmpTok = await login('media_emp', '123456');

    console.log('2️⃣ Testing strict Department Isolation across Sales, Media, Procurement, HR...');
    const adminBoards = await api('GET', '/api/boards', adminTok);
    assert.equal(adminBoards.status, 200);
    assert.ok(adminBoards.data.length >= 5, 'Admin should see all company boards');

    const salesBoards = await api('GET', '/api/boards', salesEmpTok);
    assert.equal(salesBoards.status, 200);
    assert.equal(salesBoards.data.length, 2, 'Sales employee must ONLY see the 2 Sales boards');
    assert.ok(salesBoards.data.every((b) => b.department_slug === 'sales'));

    const mediaBoard = adminBoards.data.find((b) => b.department_slug === 'media');
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

    console.log('3️⃣ Testing Viewer vs Staff Role enforcement on server...');
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

    console.log('4️⃣ Testing Dynamic DB Permission Matrix changes (Zero code edit, instant effect)...');
    const rolesRes = await api('GET', '/api/admin/roles', adminTok);
    const staffRole = rolesRes.data.roles.find((r) => r.slug === 'staff');
    const originalStaffPerms = [...staffRole.permissions];

    // Remove cards.move from staff role in DB
    const permsWithoutMove = originalStaffPerms.filter((p) => p !== 'cards.move');
    const updateRole1 = await api('PUT', `/api/admin/roles/${staffRole.id}`, adminTok, {
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
    const updateRole2 = await api('PUT', `/api/admin/roles/${staffRole.id}`, adminTok, {
      permissions: originalStaffPerms,
    });
    assert.equal(updateRole2.status, 200);

    const moveAllowedAgain = await api('POST', `/api/cards/${empCreateCard.data.id}/move`, salesEmpTok, {
      targetListId: salesLists[1].id,
      targetIndex: 0,
    });
    assert.equal(moveAllowedAgain.status, 200, 'Restoring permission in DB must immediately allow request');

    console.log('5️⃣ Testing Manager Permission Request workflow & One-Time Card Grant consumption...');
    // Sales employee requests one-time delete on empCreateCard
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

    console.log('6️⃣ Testing Cross-Department Access Request, Anti-Escalation & Instant Revocation...');
    const inboxAdmin = await api('GET', '/api/requests/inbox', adminTok);
    const crossDeptReq = inboxAdmin.data.requests.find(
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

    // General Manager approves 24h view access to Media Department
    const gmCrossApprove = await api('POST', `/api/requests/${crossDeptReq.id}/review`, adminTok, {
      decision: 'approved',
      approvedDuration: '24h',
      reviewNote: 'مسموح بالاطلاع لمتابعة البروشور.',
    });
    assert.equal(gmCrossApprove.status, 200);

    // Now Sales employee CAN view Media board
    const canViewMediaNow = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(canViewMediaNow.status, 200);
    assert.ok(canViewMediaNow.data.board.accessViaGrant);

    // BUT Sales employee still CANNOT edit or create cards in Media board!
    const illegalWriteMedia = await api(
      'POST',
      `/api/lists/${mediaBoardFull.data.lists[0].id}/cards`,
      salesEmpTok,
      { title: 'محاولة كتابة في قسم آخر' }
    );
    assert.equal(illegalWriteMedia.status, 403, 'View grant on another department must not allow writes');

    // Admin revokes the grant -> access immediately cut off!
    const grantId = canViewMediaNow.data.board.accessViaGrant.id;
    const revokeRes = await api('POST', `/api/grants/${grantId}/revoke`, adminTok);
    assert.equal(revokeRes.status, 200);

    const viewAfterRevoke = await api('GET', `/api/boards/${mediaBoard.id}`, salesEmpTok);
    assert.equal(viewAfterRevoke.status, 403, 'Revoked grant must immediately cut off access');

    console.log('7️⃣ Testing Admin Anti-Lockout protection...');
    const superAdminRole = rolesRes.data.roles.find((r) => r.slug === 'super_admin');
    const lockoutAttempt = await api('PUT', `/api/admin/roles/${superAdminRole.id}`, adminTok, {
      permissions: ['boards.view_all'],
    });
    assert.equal(lockoutAttempt.status, 400, 'Must prevent stripping roles.manage from last admin role');

    console.log('\n✅ ALL SECURITY, RBAC, DEPARTMENT ISOLATION & REQUEST TESTS PASSED 100%!');
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
