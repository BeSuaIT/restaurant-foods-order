/* ==================================================================
 *  KIỂM TRA TÍNH NĂNG (chạy sau khi triển khai)
 *
 *  `node tools/e2e.mjs`           - hồi quy luồng order cũ (91 mục)
 *  `node tools/verify-features.mjs` - các tính năng bổ sung (62 mục):
 *      đơn chưa order, mã giảm giá giới hạn lượt, thông báo nội bộ,
 *      toạ độ cơ sở, biểu đồ báo cáo doanh thu, bản in thẻ QR.
 *
 *  Biến môi trường:
 *      BASE   - địa chỉ server (mặc định http://100.100.1.5)
 *
 *  Tài khoản dùng để kiểm tra: admin / order / check / quan, mật khẩu 1234.
 *
 *  LƯU Ý: script có tạo và xoá dữ liệu thật (đơn nháp, mã giảm giá dạng
 *  LIMIT..., thông báo tạm). Chỉ chạy trên môi trường thử nghiệm.
 * ================================================================== */

const BASE = process.env.BASE ?? 'http://100.100.1.5';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra = '') {
  pass += 1;
  console.log(`  ✔ ${name}${extra ? ` \x1b[90m(${extra})\x1b[0m` : ''}`);
}
function bad(name, extra = '') {
  fail += 1;
  failures.push(name);
  console.log(`  ✖ ${name}${extra ? ` \x1b[90m(${extra})\x1b[0m` : ''}`);
}
function check(name, cond, extra = '') {
  cond ? ok(name, extra) : bad(name, extra);
  return cond;
}
function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function api(path, { method = 'GET', token, body, tableToken } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tableToken) headers['x-table-token'] = tableToken;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let j = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    j = { message: txt.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, data: j?.data, message: j?.message, raw: j };
}

const login = async (username, password) =>
  (await api('/auth/login', { method: 'POST', body: { username, password } })).data?.token;

/* ------------------------------------------------------------------ */
section('0. Đăng nhập & mật khẩu mặc định 1234');
const tkAdmin = await login('admin', '1234');
check('admin/1234', !!tkAdmin);
const tkOrder = await login('order', '1234');
check('order/1234', !!tkOrder);
const tkCheck = await login('check', '1234');
check('check/1234', !!tkCheck);
const tkQuan = await login('quan', '1234');
check('quan/1234', !!tkQuan);
const wrong = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: '1224' } });
check('mật khẩu cũ 1224 bị từ chối', wrong.status === 401, `${wrong.status}`);

/* ------------------------------------------------------------------ */
section('1. Thông báo nội bộ');
{
  const r = await api('/admin/announcements', { token: tkAdmin });
  const list0 = Array.isArray(r.data) ? r.data : [];
  check('GET /admin/announcements (danh sách)', r.ok, `${list0.length} thông báo`);

  // tạo thông báo có HTML + script để kiểm tra lọc
  const made = await api('/admin/announcements', {
    method: 'POST',
    token: tkAdmin,
    body: {
      title: 'Kiểm tra thông báo tự động',
      content:
        '<h3>Tiêu đề phụ</h3><p>Xin chào <b>anh chị</b>, <i>lịch</i> <u>20/11</u>.</p>' +
        '<ul><li>Mục 1</li><li>Mục 2</li></ul><script>alert(1)</script><img src=x onerror=alert(2)>',
      is_published: true,
    },
  });
  check('POST /admin/announcements', made.ok, made.message ?? '');
  const id = made.data?.id;
  check('script bị lọc khỏi nội dung', !String(made.data?.content ?? '').includes('<script'));
  check('onerror bị lọc', !String(made.data?.content ?? '').includes('onerror'));
  check('thẻ h3/ul/li/b/i/u được giữ', /<h3>/.test(made.data?.content ?? '') && /<ul>/.test(made.data?.content ?? ''));

  const short = await api('/admin/announcements', {
    method: 'POST',
    token: tkAdmin,
    body: { title: 'ab', content: '<p>x</p>', is_published: true },
  });
  check('tiêu đề quá ngắn bị từ chối', short.status === 409 || short.status === 400, `${short.status}`);

  // Nhân viên thấy + chưa đọc
  const seen = await api('/staff/announcements', { token: tkCheck });
  check('GET /staff/announcements (NV thấy thông báo đã đăng)', seen.ok, `${seen.data?.rows?.length} cái`);
  const uc = await api('/staff/announcements/unread-count', { token: tkCheck });
  check('GET /staff/announcements/unread-count', uc.ok, `${uc.data?.unread_count} chưa đọc`);
  const n0 = Number(uc.data?.unread_count ?? 0);
  check('có ít nhất 1 thông báo chưa đọc', n0 > 0, `${n0}`);

  const read1 = await api(`/staff/announcements/${id}/read`, { method: 'POST', token: tkCheck });
  check('POST đánh dấu đã đọc', read1.ok, `còn ${read1.data?.unread_count} chưa đọc`);

  const all = await api('/staff/announcements/read-all', { method: 'POST', token: tkCheck });
  check('POST đánh dấu đọc tất cả', all.ok, `còn ${all.data?.unread_count}`);

  // sửa + gỡ đăng
  const upd = await api(`/admin/announcements/${id}`, {
    method: 'PATCH',
    token: tkAdmin,
    body: { title: 'Kiểm tra thông báo (đã sửa)', content: '<p>Nội dung mới</p>', is_published: false },
  });
  check('PATCH /admin/announcements/:id', upd.ok && upd.data?.is_published === false);

  const hidden = await api('/staff/announcements', { token: tkCheck });
  check(
    'thông báo gỡ đăng không còn hiện với NV',
    !(hidden.data?.rows ?? []).some((a) => a.id === id),
  );

  // NV không được gọi API quản trị thông báo
  const forbidden = await api('/admin/announcements', { token: tkCheck });
  check('NV không được xem API quản trị thông báo -> 403', forbidden.status === 403, `${forbidden.status}`);

  const del = await api(`/admin/announcements/${id}`, { method: 'DELETE', token: tkAdmin });
  check('DELETE /admin/announcements/:id', del.ok, del.data?.message ?? '');
}

/* ------------------------------------------------------------------ */
section('2. Đơn chưa order (draft)');
{
  const qrToken = (await api('/tables/lookup?q=A1')).data?.qr_token;
  check('tra cứu được mã QR bàn A1', !!qrToken);
  const join = await api('/session/join', {
    method: 'POST',
    body: { qrToken, name: 'Khách Draft', phone: '0900000999' },
  });
  check('khách tạo phiên (bước nhập tên/SĐT)', join.status === 201 && !!join.data?.token, join.message ?? '');
  const tableToken = join.data?.token;

  const drafts = await api('/staff/orders/drafts', { token: tkCheck });
  check('GET /staff/orders/drafts', drafts.ok, `${drafts.data?.total ?? 0} đơn nháp`);
  const mine = (drafts.data?.rows ?? []).find((o) => o.customer_phone === '0900000999');
  check('đơn nháp của khách hiện ở tab đơn chưa order', !!mine, mine?.order_no);
  check('đơn nháp có tên + SĐT khách', mine?.customer_name === 'Khách Draft' && mine?.customer_phone === '0900000999');

  if (mine) {
    const del = await api(`/staff/orders/${mine.order_no}/draft`, { method: 'DELETE', token: tkCheck });
    check('DELETE /staff/orders/:orderNo/draft', del.ok, del.message ?? '');
    const again = await api(`/staff/orders/${mine.order_no}/draft`, { method: 'DELETE', token: tkCheck });
    check('xoá lần 2 -> báo lỗi (không còn tồn tại)', !again.ok, `${again.status}`);
  }

  // Khách tự bỏ phiên
  const j2 = await api('/session/join', { method: 'POST', body: { qrToken, name: 'Khách Bỏ', phone: '0900000888' } });
  const tt2 = j2.data?.token;
  const before = (await api('/staff/orders/drafts', { token: tkCheck })).data?.total ?? 0;
  const leave = await api('/order/session', { method: 'DELETE', tableToken: tt2 });
  check('DELETE /api/order/session (khách tự kết thúc phiên)', leave.ok, leave.message ?? '');
  const after = (await api('/staff/orders/drafts', { token: tkCheck })).data?.total ?? 0;
  check('đơn nháp giảm 1 sau khi khách bỏ phiên', after === before - 1, `${before} -> ${after}`);

  const d2 = (await api('/staff/orders/drafts', { token: tkCheck })).data?.rows?.find((o) => o.customer_phone === '0900000888');
  check('không còn đơn nháp của khách đã bỏ phiên', !d2);
  const sessAfter = await api('/session/me', { tableToken: tt2 });
  check('phiên đã bị đóng (token không còn dùng được)', !sessAfter.ok, `${sessAfter.status}`);
  void tableToken;
}

/* ------------------------------------------------------------------ */
section('3. Mã giảm giá giới hạn số lần sử dụng');
{
  const code = `LIMIT${Date.now().toString().slice(-6)}`;
  const created = await api('/admin/discount-codes', {
    method: 'POST',
    token: tkAdmin,
    body: { code, description: 'Test giới hạn lượt', percent: 5, usage_limit: 2, start_at: null, end_at: null, is_active: true },
  });
  check('POST tạo mã có usage_limit=2', created.ok, created.message ?? '');
  check('usage_limit được lưu', Number(created.data?.usage_limit) === 2, `${created.data?.usage_limit}`);

  const patch = await api(`/admin/discount-codes/${created.data.id}`, {
    method: 'PATCH',
    token: tkAdmin,
    body: { code, percent: 5, usage_limit: 0, is_active: true },
  });
  check('PATCH usage_limit=0 -> không giới hạn', patch.ok && patch.data?.usage_limit === null, `${patch.data?.usage_limit}`);

  await api(`/admin/discount-codes/${created.data.id}`, {
    method: 'PATCH',
    token: tkAdmin,
    body: { code, percent: 5, usage_limit: 1, is_active: true },
  });

  const { data: codes } = await api('/admin/discount-codes', { token: tkAdmin });
  const found = (codes ?? []).find((c) => c.code === code);
  check('danh sách có cột đã dùng / giới hạn', found && 'used_count' in found && 'usage_limit' in found, `${found?.used_count}/${found?.usage_limit}`);

  // tạo + thanh toán 1 đơn dùng mã này để tiêu 1 lượt
  const qrToken = (await api('/tables/lookup?q=A1')).data?.qr_token;
  const join = await api('/session/join', { method: 'POST', body: { qrToken, name: 'Test Lượt', phone: '0900000777' } });
  const tt = join.data?.token;
  const menu = await api('/menu');
  const dId = menu.data?.dishes?.[0]?.id;
  await api('/order/items', { method: 'POST', tableToken: tt, body: { dishId: dId, quantity: 1 } });
  const sub = await api('/order/submit', { method: 'POST', tableToken: tt });
  check('tạo & gửi đơn dùng mã giới hạn', sub.ok, sub.data?.order_no ?? sub.message);
  const orderNo = sub.data?.order_no;
  if (!orderNo) throw new Error('không tạo được đơn');

  await api(`/staff/orders/${orderNo}/confirm`, { method: 'POST', token: tkOrder });
  await api(`/staff/orders/${orderNo}/serve`, { method: 'POST', token: tkOrder, body: { served: true } });

  const pv1 = await api('/staff/discount-codes/preview', { method: 'POST', token: tkOrder, body: { orderNo, code } });
  check('xem trước mã khi còn lượt', pv1.ok, `${pv1.data?.discount_amount}đ`);
  const pay1 = await api(`/staff/orders/${orderNo}/pay`, { method: 'POST', token: tkOrder, body: { method: 'cash', discount_code: code } });
  check('thanh toán lần 1 với mã', pay1.ok && pay1.data?.status === 'paid', pay1.message ?? '');

  const { data: codes2 } = await api('/admin/discount-codes', { token: tkAdmin });
  const f2 = (codes2 ?? []).find((c) => c.code === code);
  check('used_count = 1', Number(f2?.used_count) === 1, `${f2?.used_count}/${f2?.usage_limit}`);

  // đơn thứ 2: hết lượt
  const join2 = await api('/session/join', { method: 'POST', body: { qrToken, name: 'Test Lượt 2', phone: '0900000666' } });
  const tt2 = join2.data?.token;
  await api('/order/items', { method: 'POST', tableToken: tt2, body: { dishId: dId, quantity: 1 } });
  const sub2 = await api('/order/submit', { method: 'POST', tableToken: tt2 });
  check('tạo đơn thứ 2', sub2.ok, sub2.data?.order_no ?? sub2.message);
  const order2 = sub2.data?.order_no;
  await api(`/staff/orders/${order2}/confirm`, { method: 'POST', token: tkOrder });
  await api(`/staff/orders/${order2}/serve`, { method: 'POST', token: tkOrder, body: { served: true } });

  const pv2 = await api('/staff/discount-codes/preview', { method: 'POST', token: tkOrder, body: { orderNo: order2, code } });
  check('xem trước mã khi ĐÃ HẾT lượt -> lỗi', !pv2.ok && /hết lượt/i.test(pv2.message ?? ''), pv2.message ?? '');
  const pay2 = await api(`/staff/orders/${order2}/pay`, { method: 'POST', token: tkOrder, body: { method: 'cash', discount_code: code } });
  check('thanh toán với mã đã hết lượt -> lỗi', !pay2.ok, pay2.message ?? '');
  const plainPay = await api(`/staff/orders/${order2}/pay`, { method: 'POST', token: tkOrder, body: { method: 'cash' } });
  check('thanh toán không mã vẫn được', plainPay.ok, plainPay.data?.status ?? plainPay.message);
}

/* ------------------------------------------------------------------ */
section('4. Toạ độ cơ sở');
{
  const list = (await api('/admin/branches', { token: tkAdmin })).data ?? [];
  const b = list[0];
  check('GET /admin/branches trả lat/lng', 'lat' in b && 'lng' in b, `lat=${b.lat} lng=${b.lng}`);

  const patch = await api(`/admin/branches/${b.id}`, {
    method: 'PATCH',
    token: tkAdmin,
    body: { lat: '10.7769333', lng: '106.7009233' },
  });
  check('PATCH toạ độ hợp lệ', patch.ok, `${patch.data?.lat}, ${patch.data?.lng}`);

  const badLat = await api(`/admin/branches/${b.id}`, { method: 'PATCH', token: tkAdmin, body: { lat: '123' } });
  check('toạ độ ngoài khoảng bị từ chối', !badLat.ok, badLat.message ?? '');
  const badLng = await api(`/admin/branches/${b.id}`, { method: 'PATCH', token: tkAdmin, body: { lng: '-999' } });
  check('kinh độ ngoài khoảng bị từ chối', !badLng.ok, badLng.message ?? '');
  const badNum = await api(`/admin/branches/${b.id}`, { method: 'PATCH', token: tkAdmin, body: { lat: 'abc' } });
  check('toạ độ không phải số bị từ chối', !badNum.ok, badNum.message ?? '');

  const created = await api('/admin/branches', {
    method: 'POST',
    token: tkAdmin,
    body: { name: 'CS Test Toạ Độ', address: 'x', phone: null, note: null, lat: '1.5', lng: '2.5', is_active: false },
  });
  check('POST tạo cơ sở kèm toạ độ', created.ok && Number(created.data?.lat) === 1.5, created.message ?? '');
  if (created.ok) await api(`/admin/branches/${created.data.id}`, { method: 'DELETE', token: tkAdmin });
}

/* ------------------------------------------------------------------ */
section('5. Báo cáo doanh thu có biểu đồ');
{
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000).toISOString();
  const to = new Date(now.getTime() + 86400000).toISOString();
  const r = await api(`/admin/reports?from=${from}&to=${to}`, { token: tkAdmin });
  check('GET /admin/reports', r.ok, r.message ?? '');
  const d = r.data ?? {};
  check('có daily', Array.isArray(d.daily) && d.daily.length > 0, `${d.daily?.length} ngày`);
  check('có byHour (24 khung giờ)', Array.isArray(d.byHour) && d.byHour.length > 0, `${d.byHour?.length}`);
  check('có byBranch', Array.isArray(d.byBranch) && d.byBranch.length > 0, `${d.byBranch?.map((x) => x.name).join(', ')}`);
  check('có topDishes', Array.isArray(d.topDishes) && d.topDishes.length > 0, `${d.topDishes?.slice(0, 3).map((x) => `${x.name}(${x.quantity})`).join(', ')}`);
  check('có funnel', d.funnel && typeof d.funnel.paid === 'number', JSON.stringify(d.funnel));
  check('totals có items + avg_order', 'items' in (d.totals ?? {}) && 'avg_order' in (d.totals ?? {}), JSON.stringify(d.totals));
  check('byStaff / byTable / byDiscount còn nguyên', Array.isArray(d.byStaff) && Array.isArray(d.byTable) && Array.isArray(d.byDiscount));

  // lọc cơ sở
  const anyBranch = (await api('/admin/branches', { token: tkAdmin })).data?.[0];
  const rb = (await api(`/admin/reports?from=${from}&to=${to}&branch_id=${anyBranch.id}`, { token: tkAdmin })).data;
  check('lọc theo cơ sở hoạt động', rb?.totals?.revenue <= d.totals.revenue, `${rb?.totals?.revenue} <= ${d.totals.revenue}`);
}

/* ------------------------------------------------------------------ */
section('6. Bản in mã QR');
{
  const sheet = await api('/admin/tables/qr-sheet', { token: tkAdmin });
  check('GET /admin/tables/qr-sheet', sheet.ok && Array.isArray(sheet.data) && sheet.data.length > 0, `${sheet.data?.length} thẻ`);
  const first = sheet.data?.[0];
  check('thẻ có ảnh QR data url', String(first?.qr ?? '').startsWith('data:image/png;base64,'), `${Math.round(String(first?.qr ?? '').length / 1024)}KB`);
  check('thẻ có url', String(first?.url ?? '').startsWith('http'), first?.url);

  // trang in phải trả về HTML của SPA (không lỗi 404)
  const page = await fetch(`${BASE}/admin/tables/print`);
  const html = await page.text();
  check('GET /admin/tables/print trả về trang SPA', page.status === 200 && html.includes('<div id="root">'));
}

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1mKẾT QUẢ: ${pass} đạt, ${fail} lỗi\x1b[0m`);
if (failures.length) {
  console.log('\x1b[31mCác mục lỗi:\x1b[0m');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);