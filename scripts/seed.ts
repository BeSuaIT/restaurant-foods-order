import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool, query, queryOne } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

/* ------------------------------------------------------------------ *
 *  Ảnh mẫu: tự sinh SVG để hệ thống chạy được ngay mà không cần mạng.
 *  Khi lên chính thức, Admin có thể thay bằng ảnh thật qua màn "Quản lý món ăn".
 * ------------------------------------------------------------------ */

const SEED_IMG_DIR = path.join(config.uploadDir, 'seed');

const PALETTES: [string, string][] = [
  ['#ff8a3d', '#ff5722'],
  ['#ffb74d', '#fb8c00'],
  ['#81c784', '#2e7d32'],
  ['#64b5f6', '#1565c0'],
  ['#e57373', '#b71c1c'],
  ['#ba68c8', '#6a1b9a'],
  ['#4dd0e1', '#00838f'],
  ['#ffd54f', '#f57f17'],
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function makeSvg(title: string, emoji: string, index: number): string {
  const [c1, c2] = PALETTES[index % PALETTES.length];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const words = title.split(' ');
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(' ');
  const l2 = words.slice(mid).join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <circle cx="660" cy="110" r="150" fill="#ffffff" opacity="0.12"/>
  <circle cx="140" cy="500" r="190" fill="#ffffff" opacity="0.10"/>
  <text x="400" y="300" font-size="170" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  <text x="400" y="420" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle"
        font-family="Segoe UI, Roboto, Arial, sans-serif">${esc(l1)}</text>
  ${l2 ? `<text x="400" y="472" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle"
        font-family="Segoe UI, Roboto, Arial, sans-serif">${esc(l2)}</text>` : ''}
</svg>`;
}

/* ------------------------------------------------------------------ *
 *  Dữ liệu mẫu
 * ------------------------------------------------------------------ */

const BRANCHES = [
  {
    key: 'trung-tam',
    name: 'Cơ sở Trung tâm',
    address: 'Số 123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    phone: '02838220001',
    note: 'Cơ sở chính - 2 tầng + phòng riêng',
  },
  {
    key: 'phia-nam',
    name: 'Cơ sở Phía Nam',
    address: 'Số 456 Cách Mạng Tháng 8, Phường 15, Quận 3, TP. Hồ Chí Minh',
    phone: '02838220002',
    note: 'Chi nhánh phía Nam',
  },
];

const USERS = [
  { username: 'admin', password: '1234', full_name: 'Quản trị nhà hàng', role: 'admin', branch: null as string | null, phone: '0900000001', note: 'Tài khoản Admin mặc định - xem tất cả cơ sở' },
  { username: 'order', password: '1234', full_name: 'Nguyễn Văn An', role: 'staff', branch: 'trung-tam', phone: '0900000002', note: 'Nhân viên phục vụ' },
  { username: 'check', password: '1234', full_name: 'Trần Thị Bình', role: 'staff', branch: 'trung-tam', phone: '0900000003', note: 'Nhân viên phục vụ' },
  { username: 'quan', password: '1234', full_name: 'Lê Minh Quân', role: 'staff', branch: 'phia-nam', phone: '0900000004', note: 'Nhân viên phục vụ cơ sở Phía Nam' },
  { username: 'bep', password: '1234', full_name: 'Phan Thị Bếp', role: 'kitchen', branch: 'trung-tam', phone: '0900000005', note: 'Nhân viên phục vụ bếp' },
];

const TABLES = [
  { code: 'A1', name: 'Bàn 1', area: 'Tầng 1', seats: 4, branch: 'trung-tam' },
  { code: 'A2', name: 'Bàn 2', area: 'Tầng 1', seats: 4, branch: 'trung-tam' },
  { code: 'A3', name: 'Bàn 3', area: 'Tầng 1', seats: 2, branch: 'trung-tam' },
  { code: 'A4', name: 'Bàn 4', area: 'Tầng 1', seats: 6, branch: 'trung-tam' },
  { code: 'A5', name: 'Bàn 5', area: 'Tầng 1', seats: 4, branch: 'trung-tam' },
  { code: 'B1', name: 'Bàn 6', area: 'Tầng 2', seats: 4, branch: 'trung-tam' },
  { code: 'B2', name: 'Bàn 7', area: 'Tầng 2', seats: 8, branch: 'trung-tam' },
  { code: 'B3', name: 'Bàn 8', area: 'Tầng 2', seats: 4, branch: 'trung-tam' },
  { code: 'C1', name: 'Bàn VIP 1', area: 'Phòng riêng', seats: 10, branch: 'trung-tam' },
  { code: 'C2', name: 'Bàn VIP 2', area: 'Phòng riêng', seats: 12, branch: 'trung-tam' },
  { code: 'D1', name: 'Bàn 1 (CN)', area: 'Tầng 1', seats: 4, branch: 'phia-nam' },
  { code: 'D2', name: 'Bàn 2 (CN)', area: 'Tầng 1', seats: 4, branch: 'phia-nam' },
  { code: 'D3', name: 'Bàn 3 (CN)', area: 'Tầng 1', seats: 6, branch: 'phia-nam' },
  { code: 'D4', name: 'Bàn 4 (CN)', area: 'Khu vực ngoài trời', seats: 4, branch: 'phia-nam' },
];

const DISCOUNT_CODES = [
  {
    code: 'GIAM10',
    description: 'Giảm 10% mọi hóa đơn',
    percent: 10,
    days: 3650,
    is_active: true,
  },
  {
    code: 'GIAM20',
    description: 'Giảm 20% (chương trình thử nghiệm)',
    percent: 20,
    days: 3650,
    is_active: false,
  },
  {
    code: 'CHAOBAN',
    description: 'Giảm 5% cho mùa giảm giá - đã hết hạn',
    percent: 5,
    startOffsetDays: -60,
    endOffsetDays: -30,
    is_active: true,
  },
];

const OPTION_GROUPS = [
  {
    name: 'Nhân thêm',
    description: 'Chọn thêm nhân cho món chính',
    is_required: false,
    is_multiple: true,
    min_select: 0,
    max_select: 5,
    sort_order: 1,
    items: [
      { name: 'Thịt nướng', price_delta: 15000 },
      { name: 'Trứng ốp la', price_delta: 8000 },
      { name: 'Xúc xích', price_delta: 8000 },
      { name: 'Pate', price_delta: 12000 },
      { name: 'Gà sốt cay', price_delta: 18000 },
      { name: 'Tôm súng', price_delta: 25000 },
    ],
  },
  {
    name: 'Sốt chấm',
    description: 'Chọn sốt ăn kèm',
    is_required: false,
    is_multiple: true,
    min_select: 0,
    max_select: 3,
    sort_order: 2,
    items: [
      { name: 'Sốt tương', price_delta: 0, is_default: true },
      { name: 'Sốt cà chua', price_delta: 0 },
      { name: 'Sốt mè nướng', price_delta: 0 },
      { name: 'Sốt mỡ heo', price_delta: 0 },
      { name: 'Sốt tiêu chanh', price_delta: 0 },
    ],
  },
  {
    name: 'Mức cay',
    description: 'Chọn độ cay của món',
    is_required: true,
    is_multiple: false,
    min_select: 1,
    max_select: 1,
    sort_order: 3,
    items: [
      { name: 'Không cay', price_delta: 0 },
      { name: 'Cay nhẹ', price_delta: 0 },
      { name: 'Cay vừa', price_delta: 0, is_default: true },
      { name: 'Cay nặng', price_delta: 0 },
    ],
  },
  {
    name: 'Size phần',
    description: 'Chọn khẩu phần',
    is_required: true,
    is_multiple: false,
    min_select: 1,
    max_select: 1,
    sort_order: 4,
    items: [
      { name: 'Phần nhỏ', price_delta: -10000 },
      { name: 'Phần vừa', price_delta: 0, is_default: true },
      { name: 'Phần lớn', price_delta: 20000 },
    ],
  },
  {
    name: 'Topping',
    description: 'Thêm topping',
    is_required: false,
    is_multiple: true,
    min_select: 0,
    max_select: 4,
    sort_order: 5,
    items: [
      { name: 'Phô mai', price_delta: 12000 },
      { name: 'Bò lúc lắc', price_delta: 15000 },
      { name: 'Súp ngon', price_delta: 10000 },
      { name: 'Trứng muối', price_delta: 10000 },
      { name: 'Hành phi', price_delta: 5000 },
    ],
  },
];

type SeedDish = {
  name: string;
  emoji: string;
  price: number;
  category: string;
  description: string;
  groups: string[];
};

const DISHES: SeedDish[] = [
  { name: 'Phở Bò', emoji: '🍜', price: 55000, category: 'Món chính', description: 'Phở bò truyền thống nước dùng ngọt than, tô phở ăn kèm đầy đủ.', groups: ['Nhân thêm', 'Topping'] },
  { name: 'Phở Gà', emoji: '🍲', price: 50000, category: 'Món chính', description: 'Phở gà ta thơm ngon, nước dùng ninh từ xương gà.', groups: ['Nhân thêm', 'Topping'] },
  { name: 'Bún Bò Huế', emoji: '🍝', price: 60000, category: 'Món chính', description: 'Bún bò Huế đậm đà, nước dùng cay nồng đặc trưng miền Trung.', groups: ['Mức cay', 'Sốt chấm', 'Topping'] },
  { name: 'Bánh Mì Thịt Nướng', emoji: '🥖', price: 35000, category: 'Ăn sáng', description: 'Bánh mì thịt nướng char bỏ lòng, kèm rau mùi tươi cà chua.', groups: ['Nhân thêm', 'Sốt chấm'] },
  { name: 'Bánh Mì Trứng', emoji: '🥪', price: 25000, category: 'Ăn sáng', description: 'Bánh mì trứng chiên giòn, nhanh và bổ dưỡng.', groups: ['Nhân thêm', 'Sốt chấm'] },
  { name: 'Bánh Mì Đặc Biệt', emoji: '🥙', price: 65000, category: 'Ăn sáng', description: 'Bánh mì đặc biệt đầy đủ chả, thịt, trứng, pate, xúc xích.', groups: ['Nhân thêm', 'Sốt chấm'] },
  { name: 'Cơm Tấm', emoji: '🍚', price: 45000, category: 'Cơm', description: 'Cơm tấm sườn bì chả, dưa leo muối và nước mắm pha.', groups: ['Sốt chấm', 'Topping'] },
  { name: 'Cơm Gà Sốt Mè', emoji: '🍗', price: 55000, category: 'Cơm', description: 'Cơm gà sốt mè dừa thơm ngon, ăn kèm rau củ.', groups: ['Mức cay', 'Topping'] },
  { name: 'Cơm Chiên Giòn', emoji: '🍛', price: 70000, category: 'Cơm', description: 'Cơm chiên giòn với tôm, trứng cút và rau củ đầy màu sắc.', groups: ['Sốt chấm', 'Topping'] },
  { name: 'Gỏi Cuốn', emoji: '🥬', price: 35000, category: 'Khai vị', description: 'Gỏi cuốn tôm thịt cuộn mềm, chấm mắm tôm chua cay.', groups: ['Sốt chấm'] },
  { name: 'Nem Lụi Cuốn', emoji: '🌯', price: 40000, category: 'Khai vị', description: 'Nem lụi cuốn thơm lừng, nhân thịt nướng và măng chua.', groups: ['Sốt chấm'] },
  { name: 'Chả Giò', emoji: '🥟', price: 35000, category: 'Khai vị', description: 'Chả giò giòn rụm nhân tôm thịt.', groups: ['Sốt chấm'] },
  { name: 'Canh Chua', emoji: '🍲', price: 38000, category: 'Món chính', description: 'Canh chua chuẩn vị miền Nam với đậu bắp và khứa.', groups: ['Mức cay'] },
  { name: 'Tôm Rang Muối', emoji: '🦐', price: 95000, category: 'Món chính', description: 'Tôm súng rang muối giòn tanh, vị mặn ngọt hấp dẫn.', groups: ['Size phần'] },
  { name: 'Bò Lúc Lắc', emoji: '🥩', price: 125000, category: 'Món chính', description: 'Bò Mỹ lúc lắc sốt tiêu chanh, ăn kèm rau củ.', groups: ['Size phần', 'Sốt chấm'] },
  { name: 'Cá Kho Tộ', emoji: '🐟', price: 110000, category: 'Món chính', description: 'Cá kho tộ dậy mùi thơm, nước sốt sánh đặc ăn cơm.', groups: ['Size phần'] },
  { name: 'Trà Đá', emoji: '🧋', price: 15000, category: 'Nước', description: 'Trà đá chanh giải nhiệt.', groups: [] },
  { name: 'Cà Phê Đen', emoji: '☕', price: 18000, category: 'Nước', description: 'Cà phê đen pha phin truyền thống.', groups: [] },
  { name: 'Bạc Xỉu', emoji: '🥛', price: 22000, category: 'Nước', description: 'Bạc xỉu đá sữa tươi mát lạnh.', groups: [] },
  { name: 'Nước Suối', emoji: '🥤', price: 10000, category: 'Nước', description: 'Nước suối khoáng thiên nhiên.', groups: [] },
  { name: 'Chè Đậu Xanh', emoji: '🍮', price: 25000, category: 'Tráng miệng', description: 'Chè đậu xanh nấu sánh mịn, ăn kèm đường.', groups: [] },
  { name: 'Bánh Flan', emoji: '🍮', price: 22000, category: 'Tráng miệng', description: 'Bánh flan trứng béo ngậy caramel.', groups: [] },
];

/* ------------------------------------------------------------------ *
 *  Chạy seed
 * ------------------------------------------------------------------ */

async function main() {
  console.log('==============================================');
  console.log('  NẠP DỮ LIỆU MẪU');
  console.log('==============================================');

  fs.mkdirSync(SEED_IMG_DIR, { recursive: true });

  /* 0. Cơ sở (chi nhánh) */
  const branchIdByKey = new Map<string, number>();
  for (const b of BRANCHES) {
    const existing = await queryOne<{ id: number }>('SELECT id FROM branches WHERE name = $1', [b.name]);
    if (existing) {
      await query('UPDATE branches SET address=$2, phone=$3, note=$4, is_active=TRUE WHERE id=$1', [
        existing.id,
        b.address,
        b.phone,
        b.note,
      ]);
      branchIdByKey.set(b.key, existing.id);
      console.log(`  [=] Cơ sở "${b.name}" đã có -> đã cập nhật thông tin`);
    } else {
      const row = await queryOne<{ id: number }>(
        'INSERT INTO branches (name, address, phone, note) VALUES ($1,$2,$3,$4) RETURNING id',
        [b.name, b.address, b.phone, b.note],
      );
      branchIdByKey.set(b.key, row!.id);
      console.log(`  [+] Cơ sở "${b.name}"`);
    }
  }
  const defaultBranchId = branchIdByKey.get('trung-tam')!;

  /* 1. Tài khoản */
  for (const u of USERS) {
    const branchId = u.branch ? branchIdByKey.get(u.branch)! : null;
    const exists = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = $1', [u.username]);
    if (exists) {
      const hash = await hashPassword(u.password);
      await query(
        'UPDATE users SET password_hash = $2, full_name = $3, role = $4, phone = $5, note = $6, branch_id = $7 WHERE username = $1',
        [u.username, hash, u.full_name, u.role, u.phone, u.note, branchId],
      );
      console.log(`  [=] Tài khoản ${u.username}/${u.password} đã có -> đã reset mật khẩu & cập nhật thông tin`);
    } else {
      const hash = await hashPassword(u.password);
      await query(
        'INSERT INTO users (username, password_hash, full_name, role, phone, note, branch_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [u.username, hash, u.full_name, u.role, u.phone, u.note, branchId],
      );
      console.log(`  [+] Tài khoản ${u.username}/${u.password} (${u.role}${branchId ? '' : ' - tất cả cơ sở'}) - ${u.full_name}`);
    }
  }

  /* 2. Bàn (gán theo cơ sở) */
  for (const [i, t] of TABLES.entries()) {
    const branchId = branchIdByKey.get(t.branch) ?? defaultBranchId;
    const exists = await queryOne<{ id: number; branch_id: number | null }>(
      'SELECT id, branch_id FROM rest_tables WHERE code = $1',
      [t.code],
    );
    if (exists) {
      if (exists.branch_id !== branchId) {
        await query('UPDATE rest_tables SET branch_id = $2 WHERE id = $1', [exists.id, branchId]);
        console.log(`  [~] Bàn ${t.code} -> chuyển sang cơ sở khác`);
      }
    } else {
      await query('INSERT INTO rest_tables (code, name, area, seats, branch_id) VALUES ($1,$2,$3,$4,$5)', [
        t.code,
        t.name,
        t.area,
        t.seats,
        branchId,
      ]);
      console.log(`  [+] Bàn ${t.code} - ${t.name} (${t.area})`);
    }
    if (i === 0) continue;
  }

  // Bàn cũ chưa gán cơ sở -> gán vào cơ sở mặc định
  await query('UPDATE rest_tables SET branch_id = $1 WHERE branch_id IS NULL', [defaultBranchId]);

  /* 2b. Mã giảm giá */
  const dayMs = 24 * 60 * 60 * 1000;
  const iso = (t: number) => new Date(t).toISOString();
  for (const d of DISCOUNT_CODES) {
    const now = Date.now();
    const startAt = d.startOffsetDays !== undefined ? iso(now + d.startOffsetDays * dayMs) : null;
    const endAt =
      d.endOffsetDays !== undefined
        ? iso(now + d.endOffsetDays * dayMs)
        : d.days !== undefined
          ? iso(now + d.days * dayMs)
          : null;

    const exists = await queryOne<{ id: number }>('SELECT id FROM discount_codes WHERE upper(code) = $1', [d.code]);
    if (exists) {
      await query(
        `UPDATE discount_codes SET description=$2, percent=$3, start_at=$4, end_at=$5, is_active=$6 WHERE id=$1`,
        [exists.id, d.description, d.percent, startAt, endAt, d.is_active],
      );
    } else {
      await query(
        `INSERT INTO discount_codes (code, description, percent, start_at, end_at, is_active)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [d.code, d.description, d.percent, startAt, endAt, d.is_active],
      );
      console.log(`  [+] Mã giảm giá ${d.code} (-${d.percent}%)`);
    }
  }

  /* 3. Nhóm lựa chọn */
  const groupIdByName = new Map<string, number>();
  for (const g of OPTION_GROUPS) {
    let id: number;
    const exists = await queryOne<{ id: number }>('SELECT id FROM option_groups WHERE name = $1', [g.name]);
    if (exists) {
      id = exists.id;
      await query(
        `UPDATE option_groups SET description=$2, is_required=$3, is_multiple=$4, min_select=$5, max_select=$6, sort_order=$7
          WHERE id=$1`,
        [id, g.description, g.is_required, g.is_multiple, g.min_select, g.max_select, g.sort_order],
      );
    } else {
      const row = await queryOne<{ id: number }>(
        `INSERT INTO option_groups (name, description, is_required, is_multiple, min_select, max_select, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [g.name, g.description, g.is_required, g.is_multiple, g.min_select, g.max_select, g.sort_order],
      );
      id = row!.id;
      console.log(`  [+] Nhóm lựa chọn "${g.name}" (${g.is_multiple ? 'chọn nhiều' : 'chọn 1'})`);
    }
    groupIdByName.set(g.name, id);

    for (const [idx, it] of g.items.entries()) {
      const existsItem = await queryOne('SELECT id FROM option_items WHERE group_id = $1 AND name = $2', [id, it.name]);
      if (!existsItem) {
        await query(
          'INSERT INTO option_items (group_id, name, price_delta, is_default, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [id, it.name, it.price_delta, it.is_default ?? false, idx],
        );
      }
    }
  }

  /* 4. Món ăn + ảnh SVG */
  for (const [idx, d] of DISHES.entries()) {
    const file = `${slugify(d.name)}.svg`;
    const abs = path.join(SEED_IMG_DIR, file);
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, makeSvg(d.name, d.emoji, idx), 'utf8');
    }
    const imageUrl = `/uploads/seed/${file}`;

    let dishId: number;
    const exists = await queryOne<{ id: number }>('SELECT id FROM dishes WHERE name = $1', [d.name]);
    if (exists) {
      dishId = exists.id;
      await query(
        'UPDATE dishes SET description=$2, category=$3, image_url=$4, price=$5, sort_order=$6 WHERE id=$1',
        [dishId, d.description, d.category, imageUrl, d.price, idx],
      );
    } else {
      const row = await queryOne<{ id: number }>(
        `INSERT INTO dishes (name, description, category, image_url, price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [d.name, d.description, d.category, imageUrl, d.price, idx],
      );
      dishId = row!.id;
    }

    await query('DELETE FROM dish_option_groups WHERE dish_id = $1', [dishId]);
    for (const [gi, gname] of d.groups.entries()) {
      const gid = groupIdByName.get(gname);
      if (gid) {
        await query('INSERT INTO dish_option_groups (dish_id, group_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
          dishId,
          gid,
          gi,
        ]);
      }
    }
  }
  console.log(`  [+] ${DISHES.length} món ăn (kèm ảnh minh hoạ tại /uploads/seed)`);

  /* 5. Cài đặt nhà hàng */
  await query(
    `INSERT INTO dishes (name, description, category, image_url, price, sort_order)
     VALUES ('Bún Chả Cá Lóc', 'Món đặc trưng miền Trung, nước dùng ngọt than và đầy đủ topping.', 'Món chính', NULL, 58000, 999)
     ON CONFLICT DO NOTHING`,
  );

  console.log('==============================================');
  console.log('  HOÀN TẤT! Tài khoản đăng nhập:');
  console.log('  --------------------------------------------');
  console.log('  Admin              : admin / 1234  (xem tất cả cơ sở)');
  console.log('  NV Cơ sở Trung tâm : order / 1234  (Nguyễn Văn An)');
  console.log('  NV Cơ sở Trung tâm : check / 1234  (Trần Thị Bình)');
  console.log('  NV Cơ sở Phía Nam  : quan / 1234   (Lê Minh Quân)');
  console.log('  PV Bếp Trung tâm  : bep / 1234    (Phan Thị Bếp)');
  console.log('  --------------------------------------------');
  console.log('  URL:');
  console.log(`    Khách      : ${config.publicUrl}/`);
  console.log(`    Phục vụ bàn: ${config.publicUrl}/staff`);
  console.log(`    Phục vụ bếp: ${config.publicUrl}/kitchen`);
  console.log(`    Quản trị   : ${config.publicUrl}/admin`);
  console.log(`  Mã giảm giá mẫu   : GIAM10 (-10%)`);
  console.log(`  PUBLIC_URL         : ${config.publicUrl}`);
  console.log('==============================================');

  await pool.end();
}

main().catch(async (err) => {
  console.error('[SEED] Lỗi:', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
