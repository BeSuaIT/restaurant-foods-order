/**
 * Kiểm thử toàn bộ luồng nghiệp vụ trên server đã triển khai.
 *
 *   node tools/e2e.mjs [http://100.100.1.5]
 *
 * Mô phỏng đúng thao tác thật:
 *   quét QR -> nhập tên/SĐT -> chọn món kèm tuỳ chọn -> gửi đơn
 *   -> NV "order" xác nhận -> phục vụ -> NV "check" thu tiền mặt
 *   -> admin xem lịch sử, kiểm tra đúng tên NV nhận order / NV thanh toán.
 */
const BASE = (process.argv[2] ?? 'http://100.100.1.5').replace(/\/$/, '');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}${extra ? ` \x1b[90m(${extra})\x1b[0m` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✖\x1b[0m ${name}${extra ? ` \x1b[90m(${extra})\x1b[0m` : ''}`);
  }
}

function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function api(pathname, { method = 'GET', body, token, tableToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tableToken) headers['x-table-token'] = tableToken;

  const res = await fetch(`${BASE}/api${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* không phải JSON */
  }
  return { status: res.status, json, text, data: json?.data };
}

const login = async (username, password) => {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  return r;
};

async function main() {
  console.log(`\x1b[1mKIỂM THỬ LUỒNG NGHIỆP VỤ @ ${BASE}\x1b[0m`);

  /* ---------------- 1. Sức khoẻ ---------------- */
  section('1. Sức khoẻ dịch vụ');
  const health = await api('/health');
  check('GET /api/health trả ok', health.status === 200 && health.data?.status === 'ok', `status ${health.status}`);
  check('Môi trường production', health.data?.env === 'production', health.data?.env);

  /* ---------------- 2. Menu ---------------- */
  section('2. Menu & nhóm tuỳ chọn');
  const menuRes = await api('/menu');
  const menu = menuRes.data;
  check('GET /api/menu trả món ăn', Array.isArray(menu?.dishes) && menu.dishes.length > 0, `${menu?.dishes?.length} món`);
  check('Có danh mục', Array.isArray(menu?.categories) && menu.categories.length > 0, menu?.categories?.join(', '));

  const withOptions = menu.dishes.filter((d) => (d.option_groups ?? []).length > 0);
  check('Có món kèm nhóm tuỳ chọn (bánh mì...)', withOptions.length > 0, `${withOptions.length} món`);
  const banhMi = withOptions.find((d) => /bánh mì/i.test(d.name));
  check('Tìm thấy món "Bánh mì"', !!banhMi, banhMi?.name);
  const nhanThem = banhMi?.option_groups?.find((g) => /nhân/i.test(g.name));
  check('Bánh mì có nhóm "Nhân thêm"', !!nhanThem, nhanThem?.items?.map((i) => i.name).join(', '));

  const noOptions = menu.dishes.find((d) => (d.option_groups ?? []).length === 0);

  /* ---------------- 3. Quét QR & vào bàn ---------------- */
  section('3. Quét QR bàn & nhập thông tin khách');
  const lookup = await api('/tables/lookup?q=A1');
  check('Tra cứu bàn A1 theo mã', lookup.status === 200 && lookup.data?.code === 'A1', `bàn ${lookup.data?.name}`);
  const qrToken = lookup.data?.qr_token;
  check('Bàn có mã QR', !!qrToken && qrToken.length >= 10);

  const badLookup = await api('/tables/lookup?q=ZZZ');
  check('Mã bàn sai -> 404', badLookup.status === 404, `status ${badLookup.status}`);

  const phone = `09${String(Date.now()).slice(-8)}`;
  const join = await api('/session/join', {
    method: 'POST',
    body: { qrToken, name: 'Nguyễn Test', phone },
  });
  check('POST /session/join tạo phiên bàn', join.status === 201 && !!join.data?.token, join.data?.table?.code);
  const tToken = join.data?.token;
  check('Số điện thoại được chuẩn hoá', join.data?.customer_phone === phone.replace(/^0/, '0'), join.data?.customer_phone);

  const badPhone = await api('/session/join', { method: 'POST', body: { qrToken, name: 'A', phone: 'abc' } });
  check('SĐT không hợp lệ -> 400', badPhone.status === 400, `status ${badPhone.status}`);

  const noToken = await api('/order/current');
  check('Không có token bàn -> bị chặn', noToken.status === 401 || noToken.status === 403, `status ${noToken.status}`);

  /* ---------------- 4. Giỏ hàng & tuỳ chọn ---------------- */
  section('4. Thêm món vào giỏ (kèm tuỳ chọn)');
  const draft0 = await api('/order/current', { tableToken: tToken });
  check('Giỏ hàng nháp được tạo', draft0.status === 200 && draft0.data?.status === 'draft', `mã ${draft0.data?.order_no}`);
  check('Có giờ bắt đầu order', !!draft0.data?.started_at);

  // món có tuỳ chọn: chọn 1 mục bắt buộc + 1 nhóm tuỳ chọn
  if (banhMi) {
    const required = banhMi.option_groups.find((g) => g.is_required && g.items.length);
    const optional = banhMi.option_groups.find((g) => !g.is_required && g.items.length);
    const selections = [];
    if (required) selections.push({ groupId: required.id, optionIds: [required.items[0].id] });
    if (optional) selections.push({ groupId: optional.id, optionIds: [optional.items[0].id, optional.items[1]?.id].filter(Boolean) });

    const addRes = await api('/order/items', {
      method: 'POST',
      tableToken: tToken,
      body: { dishId: banhMi.id, quantity: 2, note: 'ít cay', selections },
    });
    check(`Thêm "${banhMi.name}" x2 kèm tuỳ chọn`, addRes.status === 201, `mã ${addRes.data?.order_no}`);

    const item = (addRes.data?.items ?? []).find((i) => i.dish_id === banhMi.id);
    check('Món mới thêm xuất hiện ngay trong response', !!item, item ? `${item.dish_name} x${item.quantity}` : 'không thấy');
    check('Tuỳ chọn được lưu kèm món', (item?.options?.length ?? 0) > 0,
      (item?.options ?? []).map((o) => o.option_name).join(', ') || 'không có');

    // giá = (giá món + tổng tiền tuỳ chọn) x số lượng
    const optionSum = (item?.options ?? []).reduce((s, o) => s + Number(o.price_delta ?? 0), 0);
    const expect = (Number(banhMi.price) + optionSum) * 2;
    check('Tính tiền = (giá món + tiền tuỳ chọn) x số lượng',
      Math.abs(Number(item?.line_total) - expect) < 0.01,
      `thực=${item?.line_total} mong đợi=${expect.toFixed(0)}`);
  }

  if (noOptions) {
    const addPlain = await api('/order/items', {
      method: 'POST',
      tableToken: tToken,
      body: { dishId: noOptions.id, quantity: 1 },
    });
    check(`Thêm "${noOptions.name}" x1`, addPlain.status === 201);
  }

  // bỏ nhóm tuỳ chọn bắt buộc -> phải bị từ chối
  if (banhMi) {
    const required = banhMi.option_groups.find((g) => g.is_required && g.items.length);
    if (required) {
      const missing = await api('/order/items', {
        method: 'POST',
        tableToken: tToken,
        body: { dishId: banhMi.id, quantity: 1, selections: [] },
      });
      check('Thiếu nhóm tuỳ chọn bắt buộc -> 400', missing.status === 400, `status ${missing.status}`);
    }
  }

  const cart = await api('/order/current', { tableToken: tToken });
  check('Giỏ có >= 2 món', (cart.data?.items?.length ?? 0) >= 2, `${cart.data?.items?.length} món`);
  check('Tổng tiền > 0', Number(cart.data?.total) > 0, `${cart.data?.total}đ`);

  /* ---------------- 5. Gửi đơn ---------------- */
  section('5. Khách gửi đơn');
  const submit = await api('/order/submit', { method: 'POST', tableToken: tToken });
  check('POST /order/submit -> pending', submit.status === 200 && submit.data?.status === 'pending', submit.data?.status);
  const orderNo = submit.data?.order_no;
  check('Có mã đơn', !!orderNo, orderNo);

  const doubleSubmit = await api('/order/submit', { method: 'POST', tableToken: tToken });
  check('Gửi lại đơn đã gửi -> lỗi', doubleSubmit.status >= 400, `status ${doubleSubmit.status}`);

  const track = await api(`/order/${orderNo}`, { tableToken: tToken });
  check('Khách theo dõi được đơn của mình', track.status === 200 && track.data?.status === 'pending');

  /* ---------------- 6. Nhân viên nhận order ---------------- */
  section('6. Nhân viên "order" xác nhận nhận order');
  const lo = await login('order', '1234');
  check('Đăng nhập order/1234', lo.status === 200 && !!lo.data?.token, lo.data?.user?.full_name);
  const tkOrder = lo.data?.token;
  check('Role của order là staff', lo.data?.user?.role === 'staff', lo.data?.user?.role);

  const meOrder = await api('/auth/me', { token: tkOrder });
  check('GET /auth/me', meOrder.status === 200 && meOrder.data?.username === 'order');

  const pending = await api('/staff/orders/pending', { token: tkOrder });
  check('Danh sách chờ xác nhận có đơn của mình',
    pending.status === 200 && pending.data?.some((o) => o.order_no === orderNo),
    `${pending.data?.length} đơn chờ`);

  const confirm = await api(`/staff/orders/${orderNo}/confirm`, { method: 'POST', token: tkOrder });
  check('Xác nhận đơn -> confirmed', confirm.status === 200 && confirm.data?.status === 'confirmed', confirm.data?.status);
  check('Ghi nhận NV nhận order', confirm.data?.received_by_name === lo.data?.user?.full_name,
    `received_by_name="${confirm.data?.received_by_name}"`);

  const adminBlocked = await api('/admin/order-history', { token: tkOrder });
  check('NV KHÔNG được xem lịch sử của Admin -> 403', adminBlocked.status === 403, `status ${adminBlocked.status}`);
  const usersBlocked = await api('/admin/users', { token: tkOrder });
  check('NV KHÔNG được quản lý tài khoản -> 403', usersBlocked.status === 403, `status ${usersBlocked.status}`);

  /* ---------------- 7. Phục vụ & thanh toán ---------------- */
  section('7. Phục vụ & thanh toán');
  const served = await api(`/staff/orders/${orderNo}/serve`, { method: 'POST', token: tkOrder, body: { served: true } });
  check('Đánh dấu đã phục vụ', served.status === 200 && served.data?.status === 'served', served.data?.status);

  const unpaid = await api('/staff/orders/unpaid', { token: tkOrder });
  check('Danh sách chưa thanh toán có đơn', unpaid.status === 200 && unpaid.data?.some((o) => o.order_no === orderNo),
    `${unpaid.data?.length} hóa đơn`);
  const unpaidRow = unpaid.data?.find((o) => o.order_no === orderNo);
  const optCount = (unpaidRow?.items ?? []).reduce((s, i) => s + (i.options?.length ?? 0), 0);
  check('Danh sách của NV có kèm tuỳ chọn món', optCount > 0, `${optCount} tuỳ chọn`);

  const transfer = await api(`/staff/orders/${orderNo}/pay`, { method: 'POST', token: tkOrder, body: { method: 'transfer' } });
  check('Chuyển khoản bị chặn -> 403', transfer.status === 403, `status ${transfer.status}: ${transfer.json?.error?.message ?? ''}`);

  const lc = await login('check', '1234');
  check('Đăng nhập check/1234', lc.status === 200 && !!lc.data?.token, lc.data?.user?.full_name);
  const tkCheck = lc.data?.token;
  check('Role của check cũng là staff', lc.data?.user?.role === 'staff', lc.data?.user?.role);
  check('order và check là 2 tài khoản khác nhau', lc.data?.user?.id !== lo.data?.user?.id);

  const pay = await api(`/staff/orders/${orderNo}/pay`, { method: 'POST', token: tkCheck, body: { method: 'cash' } });
  check('Thu tiền mặt -> paid', pay.status === 200 && pay.data?.status === 'paid', pay.data?.status);
  check('Ghi nhận NV thanh toán', pay.data?.paid_by_name === lc.data?.user?.full_name,
    `paid_by_name="${pay.data?.paid_by_name}"`);
  check('Có giờ hoàn tất thanh toán', !!pay.data?.paid_at, pay.data?.paid_at);
  check('Hình thức thanh toán = cash', pay.data?.payment_method === 'cash', pay.data?.payment_method);
  check('NV nhận order và NV thanh toán là 2 người khác nhau',
    pay.data?.received_by_name !== pay.data?.paid_by_name,
    `${pay.data?.received_by_name} -> ${pay.data?.paid_by_name}`);

  const payAgain = await api(`/staff/orders/${orderNo}/pay`, { method: 'POST', token: tkCheck, body: { method: 'cash' } });
  check('Thanh toán lần 2 -> lỗi', payAgain.status >= 400, `status ${payAgain.status}`);

  /* ---------------- 8. Lịch sử của Admin ---------------- */
  section('8. Admin xem lịch sử & báo cáo');
  const la = await login('admin', '1234');
  check('Đăng nhập admin/1234', la.status === 200 && !!la.data?.token, la.data?.user?.full_name);
  const tkAdmin = la.data?.token;
  check('Role admin', la.data?.user?.role === 'admin', la.data?.user?.role);

  const history = await api('/admin/order-history?limit=10', { token: tkAdmin });
  const rec = history.data?.rows?.find((o) => o.order_no === orderNo);
  check('Admin thấy đơn trong lịch sử', history.status === 200 && !!rec, `tổng ${history.data?.total} đơn`);
  check('Lịch sử lưu tên khách', rec?.customer_name === 'Nguyễn Test', `${rec?.customer_name} / ${rec?.customer_phone}`);
  check('Lịch sử lưu giờ bắt đầu', !!rec?.started_at, rec?.started_at);
  check('Lịch sử lưu giờ thanh toán', !!rec?.paid_at, rec?.paid_at);
  check('Lịch sử lưu NV nhận order', rec?.received_by_name === 'order' || !!rec?.received_by_name, rec?.received_by_name);
  check('Lịch sử lưu NV thanh toán', rec?.paid_by_name === 'check' || !!rec?.paid_by_name, rec?.paid_by_name);
  check('Lịch sử lưu số món', Number(rec?.item_count) >= 2, `${rec?.item_count} món`);

  const reports = await api('/admin/reports', { token: tkAdmin });
  // so sánh theo id tài khoản, không phải tên hiển thị
  const staffRow = reports.data?.byStaff?.find((s) => s.id === lc.data?.user?.id);
  check('Doanh thu tổng = tổng các NV', reports.status === 200 && !!staffRow,
    staffRow ? `${staffRow.full_name}: ${staffRow.revenue}đ / ${staffRow.paid_orders} đơn` : 'không thấy');
  const sumStaff = (reports.data?.byStaff ?? []).reduce((s, r) => s + Number(r.revenue), 0);
  check('Tổng doanh thu khớp tổng doanh thu theo NV',
    Math.abs(sumStaff - Number(reports.data?.totals?.revenue)) < 0.01,
    `${sumStaff} vs ${reports.data?.totals?.revenue}`);
  const tableRow = reports.data?.byTable?.find((t) => t.code === lookup.data.code);
  check('Báo cáo doanh thu theo bàn', !!tableRow, tableRow ? `${tableRow.code}: ${tableRow.revenue}đ` : 'không thấy');

  const adminUsers = await api('/admin/users', { token: tkAdmin });
  check('Admin xem được danh sách tài khoản', adminUsers.status === 200 && adminUsers.data?.length >= 3, `${adminUsers.data?.length} tài khoản`);

  const qr = await api(`/staff/tables/${lookup.data.id}/qr`, { token: tkOrder });
  check('Sinh mã QR cho bàn', qr.status === 200 && String(qr.data?.qr ?? '').startsWith('data:image/png'),
    qr.data?.url);

  /* ---------------- 9. Cơ sở & phân quyền theo cơ sở ---------------- */
  section('9. Cơ sở (chi nhánh) & phân quyền theo cơ sở');
  const branches = await api('/admin/branches', { token: tkAdmin });
  const branchList = branches.data ?? [];
  check('GET /admin/branches trả về các cơ sở', branches.status === 200 && branchList.length >= 2,
    branchList.map((b) => b.name).join(' | '));
  const branchTrungTam = branchList.find((b) => /trung tâm/i.test(b.name));
  const branchPhiaNam = branchList.find((b) => /phía nam/i.test(b.name));
  check('Có 2 cơ sở mẫu', !!branchTrungTam && !!branchPhiaNam,
    `${branchTrungTam?.name} (${branchTrungTam?.table_count} bàn) / ${branchPhiaNam?.name} (${branchPhiaNam?.table_count} bàn)`);
  check('Mỗi cơ sở có địa chỉ', !!branchTrungTam?.address, branchTrungTam?.address);

  const lq = await login('quan', '1234');
  check('Đăng nhập NV cơ sở Phía Nam (quan/1234)', lq.status === 200 && !!lq.data?.token, lq.data?.user?.full_name);
  const tkQuan = lq.data?.token;
  check('NV được gán đúng cơ sở', lq.data?.user?.branch_name === branchPhiaNam?.name, lq.data?.user?.branch_name);

  const quanOrders = await api('/staff/orders?limit=200', { token: tkQuan });
  const quanTables = await api('/staff/tables', { token: tkQuan });
  const quanBranchIds = new Set((quanTables.data ?? []).map((t) => t.branch_id));
  check('NV chỉ thấy bàn của cơ sở mình',
    (quanTables.data ?? []).length > 0 && [...quanBranchIds].every((id) => id === branchPhiaNam?.id),
    `${(quanTables.data ?? []).length} bàn / ${[...quanBranchIds].join(',')}`);
  check('NV không thấy bàn của cơ sở khác',
    !(quanTables.data ?? []).some((t) => t.code === lookup.data.code),
    `bàn ${lookup.data.code} thuộc ${branchTrungTam?.name}`);

  const crossConfirm = await api(`/staff/orders/${orderNo}/confirm`, { method: 'POST', token: tkQuan });
  check('NV không xử lý được đơn của cơ sở khác -> 403', crossConfirm.status === 403,
    `${crossConfirm.status}: ${crossConfirm.json?.error?.message ?? ''}`);

  const adminOrdersAll = await api('/staff/orders?limit=200', { token: tkAdmin });
  check('Admin cũng dùng được API nhân viên', adminOrdersAll.status === 200,
    `${(adminOrdersAll.data?.rows ?? []).length} đơn tất cả cơ sở`);
  const adminFiltered = await api(`/staff/orders?limit=200&branch_id=${branchPhiaNam.id}`, { token: tkAdmin });
  const filteredRows = adminFiltered.data?.rows ?? [];
  const adminAllCount = (adminOrdersAll.data?.rows ?? []).length;

  // Tạo đơn tại cơ sở Phía Nam để kiểm tra mã giảm giá
  const lookupD1 = await api('/tables/lookup?q=D1');
  const joinD1 = await api('/session/join', {
    method: 'POST',
    body: { qrToken: lookupD1.data?.qr_token, name: 'Khách Chi Nhánh', phone: `09${String(Date.now() + 7).slice(-8)}` },
  });
  check('Vào bàn D1 (cơ sở Phía Nam)', joinD1.status === 201, joinD1.data?.table?.branch_name);
  const tTokenD1 = joinD1.data?.token;

  await api('/order/current', { tableToken: tTokenD1 });
  const addD1 = await api('/order/items', {
    method: 'POST',
    tableToken: tTokenD1,
    body: { dishId: noOptions.id, quantity: 3 },
  });
  const subtotalD1 = Number(addD1.data?.subtotal ?? 0);
  check('Thêm món vào đơn chi nhánh', addD1.status === 201, `tạm tính ${subtotalD1}đ`);

  const submitD1 = await api('/order/submit', { method: 'POST', tableToken: tTokenD1 });
  const orderNo2 = submitD1.data?.order_no;
  check('Gửi đơn tại cơ sở Phía Nam', submitD1.status === 200 && !!orderNo2, orderNo2);

  const quanPending = await api('/staff/orders/pending', { token: tkQuan });
  check('NV Phía Nam thấy đơn của cơ sở mình',
    quanPending.data?.some((o) => o.order_no === orderNo2), `${quanPending.data?.length} đơn chờ`);

  const orderPending = await api('/staff/orders/pending', { token: tkOrder });
  check('NV Trung tâm KHÔNG thấy đơn của cơ sở khác',
    !orderPending.data?.some((o) => o.order_no === orderNo2), `${orderPending.data?.length} đơn chờ`);

  check('Admin lọc được theo cơ sở',
    filteredRows.length > 0 && filteredRows.every((o) => o.table_branch_id === branchPhiaNam.id),
    `${filteredRows.length}/${adminAllCount} đơn @ ${branchPhiaNam.name}`);

  /* ---------------- 10. Mã giảm giá ---------------- */
  section('10. Mã giảm giá do Admin tạo');

  const codes = await api('/admin/discount-codes', { token: tkAdmin });
  check('GET /admin/discount-codes', codes.status === 200 && (codes.data?.length ?? 0) >= 3,
    (codes.data ?? []).map((c) => `${c.code} -${c.percent}%`).join(' | '));

  const preview = await api('/staff/discount-codes/preview', {
    method: 'POST', token: tkQuan, body: { orderNo: orderNo2, code: 'giam10' },
  });
  const expectTotal = Math.max(0, subtotalD1 - Math.round((subtotalD1 * 10) / 100));
  check('Xem trước mã GIAM10 (không phân biệt hoa/thường)',
    preview.status === 200 && preview.data?.percent === 10, `-${preview.data?.percent}% = ${preview.data?.discount_amount}đ`);
  check('Số tiền sau giảm đúng',
    Math.abs(Number(preview.data?.total) - expectTotal) < 1,
    `${preview.data?.total} vs ${expectTotal}`);

  const previewLower = await api('/staff/discount-codes/preview', {
    method: 'POST', token: tkQuan, body: { orderNo: orderNo2, code: '  GIAM10 ' },
  });
  check('Mã bỏ khoảng trắng vẫn nhận', previewLower.status === 200, previewLower.data?.code);

  const badCode = await api('/staff/discount-codes/preview', {
    method: 'POST', token: tkQuan, body: { orderNo: orderNo2, code: 'KHONGTONTAI' },
  });
  check('Mã không tồn tại -> 400', badCode.status === 400, badCode.json?.error?.message);

  const offCode = await api('/staff/discount-codes/preview', {
    method: 'POST', token: tkQuan, body: { orderNo: orderNo2, code: 'GIAM20' },
  });
  check('Mã đã ngừng hoạt động -> 400', offCode.status === 400, offCode.json?.error?.message);

  const expiredCode = await api('/staff/discount-codes/preview', {
    method: 'POST', token: tkQuan, body: { orderNo: orderNo2, code: 'CHAOBAN' },
  });
  check('Mã đã hết hạn -> 400', expiredCode.status === 400, expiredCode.json?.error?.message);

  const payCode = await api(`/staff/orders/${orderNo2}/pay`, {
    method: 'POST', token: tkQuan, body: { method: 'cash', discount_code: 'GIAM10' },
  });
  check('Thu tiền kèm mã giảm giá -> paid', payCode.status === 200 && payCode.data?.status === 'paid',
    payCode.data?.status);
  check('Lưu mã giảm giá vào đơn', payCode.data?.discount_code === 'GIAM10',
    `${payCode.data?.discount_code} (-${payCode.data?.discount_percent}%)`);
  check('Tổng tiền đã trừ giảm',
    Math.abs(Number(payCode.data?.total) - expectTotal) < 1,
    `tạm tính ${payCode.data?.subtotal} − giảm ${payCode.data?.discount} = ${payCode.data?.total}`);

  const histCode = await api('/admin/order-history?limit=5', { token: tkAdmin });
  const recCode = histCode.data?.rows?.find((o) => o.order_no === orderNo2);
  check('Lịch sử hiển thị mã giảm giá', recCode?.discount_code === 'GIAM10',
    `${recCode?.discount_code} / giảm ${recCode?.discount}đ`);

  const histPhiaNam = (await api(`/admin/order-history?limit=200&branch_id=${branchPhiaNam.id}`, { token: tkAdmin })).data?.rows ?? [];
  check('Lịch sử Admin lọc theo cơ sở',
    histPhiaNam.length > 0 && histPhiaNam.every((o) => o.table_branch_name === branchPhiaNam.name),
    `${histPhiaNam.length} đơn @ ${branchPhiaNam.name}`);

  const repCode = await api('/admin/reports', { token: tkAdmin });
  check('Báo cáo tổng hợp theo mã giảm giá',
    (repCode.data?.byDiscount ?? []).some((d) => d.code === 'GIAM10'),
    (repCode.data?.byDiscount ?? []).map((d) => `${d.code}: ${d.orders} đơn`).join(' | '));

  /* ---------------- 11. Đã bỏ lịch sử của khách ---------------- */
  section('11. Khách KHÔNG còn xem lịch sử order');
  const mine = await api('/order/mine', { tableToken: tToken });
  check('GET /api/order/mine đã bị gỡ -> 404', mine.status === 404, `status ${mine.status}`);

  /* ---------------- Kết quả ---------------- */
  console.log(`\n\x1b[1mKẾT QUẢ: ${pass} đạt, ${fail} lỗi\x1b[0m`);
  if (fail) {
    console.log(`\x1b[31mCác mục lỗi:\x1b[0m\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n\x1b[31mLỖI: ${e.message}\x1b[0m`);
  console.error(e.stack);
  process.exit(1);
});