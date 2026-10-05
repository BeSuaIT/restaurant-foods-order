# 🍜 Hệ thống Order đồ ăn cho nhà hàng (QR từ bàn)

Ứng dụng web đặt món qua **QR dán trên bàn**, nhân viên nhận order & thu tiền trên điện thoại/máy tính bảng, Admin quản lý món ăn – bàn QR – cơ sở – mã giảm giá – lịch sử. Chạy trên **PostgreSQL**, giao diện **tiếng Việt**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/Node-%3E%3D20-5FA04E)
![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-4169E1)
![React 18](https://img.shields.io/badge/React-18-61DAFB)

---

## Màn hình

| Vai trò | Đường dẫn | Dùng để |
| --- | --- | --- |
| Khách | `/` hoặc `/t/<mã-bàn>` | Quét QR → vào bàn → chọn món → gửi đơn → theo dõi trạng thái |
| Nhân viên | `/staff` | Nhận order · phục vụ · thu tiền · xem bàn đang phục vụ |
| Quản trị | `/admin` | Món ăn · nhóm tuỳ chọn · bàn & mã QR · cơ sở · mã giảm giá · tài khoản · lịch sử · báo cáo |

> Hệ thống **không có đăng ký** — mọi tài khoản do Admin cấp.

---

## Tính năng

### 👤 Khách
- Quét QR trên bàn → nhập **họ tên + số điện thoại** một lần, phiên bàn giữ bằng cookie/token.
- Menu theo cơ sở, món có **ảnh + mô tả + giá**, kèm **nhóm tuỳ chọn** do Admin gắn vào (thêm nhân, mức cay, sốt…).
- **Tuỳ chọn một lựa chọn vẫn bấm đổi được** (chuyển từ món này sang tuỳ chọn khác trong cùng nhóm).
- Giỏ hàng: thêm/bớt số lượng, sửa tuỳ chọn từng món, ghi chú cho nhà bếp.
- Màn hình trạng thái đơn **tự cập nhật bằng SSE**, có fallback polling 8s nếu mạng chặn.
- **Không xem lịch sử order** — lịch sử thuộc về nhà hàng (chỉ Admin xem được).

### 👨‍🍳 Nhân viên
- Danh sách đơn **đang chờ xác nhận** → *Xác nhận nhận order* / *Huỷ* / *Xem bill*.
- Hệ thống ghi lại **ai nhận order** và **ai thu tiền** (có thể là hai người khác nhau).
- Đơn đã phục vụ → màn **Hóa đơn chưa thanh toán**: nhập **mã giảm giá** (xem trước số tiền giảm), hoặc thu **tiền mặt**.
- Bản đồ **bàn đang phục vụ** theo trạng thái đơn, tự cập nhật.
- **Chỉ thấy cơ sở của mình.** Thử xử lý đơn của cơ sở khác sẽ nhận `403`.
- **Admin cũng dùng được màn nhân viên** và có thêm ô *lọc theo cơ sở*.

### 🛠 Admin
- **Món ăn**: tên, ảnh, mô tả, giá, sẵn có/hết hàng, bật/tắt, gắn nhóm tuỳ chọn, giá riêng theo tuỳ chọn.
- **Nhóm tuỳ chọn**: nhiều lựa chọn hay chỉ một, bắt buộc hay không, giới hạn số lựa chọn tối đa.
- **Bàn & mã QR**: tạo bàn theo cơ sở, **in thẻ QR hàng loạt** khổ A4, tạo lại QR khi đổi địa chỉ server.
- **Cơ sở (chi nhánh)**: tên + địa chỉ + SĐT + ghi chú; mọi bàn, tài khoản, đơn đều thuộc một cơ sở.
- **Mã giảm giá**: mã + % giảm + khoảng thời gian áp dụng + bật/tắt.
- **Tài khoản**: phân vai trò, gán cơ sở, đặt lại mật khẩu.
- **Lịch sử order**: khách (tên + SĐT), giờ bắt đầu, giờ thanh toán, NV nhận order, NV thu tiền, mã giảm giá.
- **Báo cáo doanh thu**: theo ngày / theo nhân viên / theo cơ sở / theo mã giảm giá.
- Lọc theo cơ sở trên mọi màn báo cáo và vận hành.

### 🧾 Hóa đơn
- Bill là **popup phủ lên giao diện** (không phải trang riêng): ✕ đóng, bấm ra ngoài, hoặc `Esc`.
- In khổ giấy nhiệt **80mm**. Đầu bill in **tên cơ sở + địa chỉ + SĐT**, kèm mã đơn, bàn, khách, NV nhận order, NV thu tiền và toàn bộ tuỳ chọn của từng món.
- Tính năng *"In trang này"* đã bị gỡ toàn hệ thống.

---

## Luồng nghiệp vụ

```
Khách quét QR trên bàn
   └─> Nhập họ tên + số điện thoại
        └─> Chọn món (kèm tuỳ chọn: thêm nhân, sốt, mức cay...)
             └─> "Gửi đơn" → màn "Đang chờ nhân viên xác nhận"
                  └─> NV bấm "Xác nhận nhận order"
                       └─> Màn khách TỰ ĐỘNG CẬP NHẬT (SSE) + thông báo
                            └─> NV đánh dấu "Đã phục vụ xong"
                                 └─> Màn "Hóa đơn chưa thanh toán"
                                      └─> NV thu tiền (có thể nhập mã giảm giá của khách)
                 └─> Mở popup hóa đơn & in bill 80mm (có ghi NV nhận order / NV thu tiền)
```

Trạng thái đơn: `draft` → `pending` → `confirmed` → `served` → `paid` (kèm `cancelled`).

Tính tiền: `(giá món + tổng tiền tuỳ chọn) × số lượng`, trừ thêm mã giảm giá (nếu có).

---

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Backend | Node.js ≥ 20 · Express 4 · TypeScript (ESM, `module: NodeNext`) · `pg` · `zod` |
| Database | PostgreSQL (schema: `sql/schema.sql`) |
| Frontend | React 18 · Vite 6 · TypeScript · react-router-dom 6 · **CSS thuần** (không framework UI) |
| Xác thực | JWT (`jsonwebtoken` + `bcryptjs`) cho nhân viên/Admin · token phiên bàn cho khách |
| Realtime | SSE (`/api/stream`) + fallback polling 8s |
| QR | `qrcode` (sinh PNG server-side) |
| Ảnh | `multer` (JPG/PNG/WEBP/GIF/AVIF, tối đa 5MB) |

Một tiến trình Express phục vụ **cả API lẫn** bản build frontend tĩnh; nginx làm reverse proxy.

---

## Bắt đầu nhanh

Yêu cầu: **Node.js ≥ 20** và một PostgreSQL đang chạy (15 trở lên).

```bash
# 1. Cài dependency (backend + frontend)
npm install
npm --prefix web install

# 2. Tạo file cấu hình
cp .env.example .env      # Windows: copy .env.example .env
#    sửa DB_* cho đúng máy bạn, và đặt JWT_SECRET chuỗi dài >= 32 ký tự

# 3. Tạo bảng + nạp dữ liệu mẫu (2 cơ sở, 4 tài khoản, 14 bàn, mã giảm giá, 24 món)
npm run db:setup

# 4. Chạy thử
npm run dev               # API :3000 + web :5173 (Vite proxy sang API)
```

Mở <http://localhost:5173>.

Chạy như production:

```bash
npm run build             # build web/dist rồi build dist/
npm start                 # Express phục vụ cả API và web tại :3000
```

### Tài khoản mẫu (tạo bởi `npm run db:seed`)

| Tài khoản | Mật khẩu | Vai trò | Cơ sở | Dùng để |
| --- | --- | --- | --- | --- |
| `admin` | `1234` | Admin | Tất cả | Quản trị + nhận order/thu tiền như nhân viên |
| `order` | `1224` | Nhân viên | Cơ sở Trung tâm | Nhận order |
| `check` | `1234` | Nhân viên | Cơ sở Trung tâm | Thu tiền |
| `quan` | `1234` | Nhân viên | Cơ sở Phía Nam | Minh hoạ nhân viên ở cơ sở khác |

> `order` và `check` **cùng là nhân viên, quyền giống hệt**. Tách ra chỉ để minh hoạ việc hệ thống ghi được **ai nhận order** và **ai thu tiền**.
>
> ⚠️ Đây là tài khoản demo với mật khẩu yếu — **xoá hoặc đổi mật khẩu trước khi đưa lên Internet**.

---

## Cấu trúc thư mục

```
├── sql/schema.sql              # Toàn bộ schema PostgreSQL (bảng, enum, trigger) + khối nâng cấp idempotent
├── scripts/
│   ├── migrate.ts              # Áp dụng schema.sql
│   └── seed.ts                 # Nạp cơ sở, tài khoản, bàn, mã giảm giá, nhóm tuỳ chọn, món + ảnh
├── src/
│   ├── app.ts                  # Khởi tạo Express, gắn router, phục vụ web/dist
│   ├── server.ts               # Điểm vào, kiểm tra DB, tắt server sạch (cắt SSE)
│   ├── config.ts               # Đọc biến môi trường
│   ├── db.ts                   # Pool + helper query/transaction
│   ├── auth.ts                 # Ký/kiểm tra JWT, so khớp mật khẩu
│   ├── bus.ts                  # Event bus in-memory cho SSE
│   ├── middleware/             # auth (JWT / phiên bàn), xử lý lỗi
│   ├── routes/
│   │   ├── customer.ts         # Tra cứu bàn, vào bàn, menu, giỏ hàng, gửi đơn
│   │   ├── auth.ts             # Đăng nhập nhân viên/Admin (kèm cơ sở)
│   │   ├── staff.ts            # Nhận order, phục vụ, thu tiền (kèm mã giảm giá), bàn, QR
│   │   ├── admin.ts            # Cơ sở, mã giảm giá, tài khoản, món, nhóm tuỳ chọn, bàn QR, lịch sử, báo cáo
│   │   ├── stream.ts           # Endpoint SSE
│   │   └── upload.ts           # Tải ảnh món ăn
│   ├── services/
│   │   ├── order.service.ts    # Giá, tuỳ chọn, chuyển trạng thái đơn, sự kiện
│   │   └── branch.ts           # Phạm vi cơ sở + kiểm tra mã giảm giá
│   └── types.ts                # Kiểu dữ liệu dùng chung
├── web/                        # Frontend React (Vite)
│   └── src/
│       ├── components/
│       │   ├── AppLayout.tsx   # Khung + sidebar (phân nhóm theo quyền)
│       │   ├── BillModal.tsx   # Popup xem/in hóa đơn 80mm
│       │   └── Modal.tsx       # Hộp thoại dùng chung
│       └── pages/
│           ├── customer/       # Landing, Join, Menu, OrderStatus
│           ├── staff/          # StaffOrders, StaffPayments, StaffTables
│           └── admin/          # Dashboard, Reports, History, Users, Dishes,
│                               # OptionGroups, Tables, DiscountCodes, Settings
├── tools/
│   ├── deploy.mjs              # Triển khai qua SSH (máy Windows → server Linux)
│   ├── deploy.config.json      # Thông tin server — KHÔNG commit (đã gitignore)
│   └── e2e.mjs                 # Kiểm thử tự động toàn bộ luồng nghiệp vụ
└── .env.example                # Mẫu cấu hình
```

---

## Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` sẽ bắt buộc `JWT_SECRET` dài ≥ 32 ký tự |
| `PORT` | `3000` | Cổng API |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `5432` | Kết nối PostgreSQL |
| `DB_NAME` | `ttth_order` | Tên database |
| `DB_USER` / `DB_PASSWORD` | — | Tài khoản database |
| `JWT_SECRET` | — | **Bắt buộc** khi chạy production |
| `JWT_EXPIRES_IN` | `12h` | Thời hạn token đăng nhập |
| `PUBLIC_URL` | `http://localhost:3000` | Địa chỉ public để **dựng mã QR** trỏ đúng |
| `UPLOAD_DIR` | `./uploads` | Nơi lưu ảnh món ăn (tự tạo nếu chưa có) |
| `WEB_DIST_DIR` | `./web/dist` | Bản build frontend |
| `SCHEMA_PATH` | `./sql/schema.sql` | File schema cho migrate |

> ⚠️ `PUBLIC_URL` rất quan trọng: nếu sai, mã QR in ra sẽ trỏ về sai địa chỉ và khách không mở được menu.

---

## npm scripts

| Lệnh | Tác dụng |
| --- | --- |
| `npm run dev` | Chạy API + web ở chế độ phát triển |
| `npm run dev:api` / `npm run dev:web` | Chạy riêng từng phần |
| `npm run build` | Build frontend (`web/dist`) rồi backend (`dist/`) |
| `npm start` | Chạy bản đã build |
| `npm run db:migrate` | Áp dụng schema (idempotent, chạy lại được) |
| `npm run db:seed` | Nạp dữ liệu mẫu |
| `npm run db:setup` | `migrate` + `seed` |
| `npm run typecheck` | Kiểm tra kiểu cả `src/` và `scripts/` |

---

## API

Tất cả trả về `{ ok: true, data }` hoặc `{ ok: false, error }`.

**Khách** — `/api`

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `GET` | `/tables/lookup?code=` | Tìm bàn từ mã QR |
| `POST` | `/session/join` | Vào bàn (tên + SĐT) → nhận token phiên bàn |
| `GET` | `/session/me` | Thông tin phiên bàn hiện tại |
| `GET` | `/menu` | Menu + nhóm tuỳ chọn của cơ sở |
| `GET` | `/order/current` | Đơn đang mở của bàn |
| `POST` `PATCH` `DELETE` | `/order/items`, `/order/items/:itemId` | Thêm / sửa / xoá món trong giỏ |
| `PATCH` | `/order/note` | Ghi chú cho nhà bếp |
| `POST` | `/order/submit` | Gửi đơn |
| `GET` | `/order/:orderNo` | Theo dõi trạng thái đơn |

**Xác thực** — `/api/auth`

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `POST` | `/login` | Đăng nhập nhân viên/Admin |
| `GET` | `/me` | Thông tin tài khoản đang đăng nhập |

**Nhân viên** — `/api/staff` *(yêu cầu JWT, tự giới hạn theo cơ sở)*

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `GET` | `/orders`, `/orders/pending`, `/orders/unpaid` | Đơn theo trạng thái |
| `GET` | `/orders/:orderNo` | Chi tiết đơn |
| `POST` | `/orders/:orderNo/confirm` | Xác nhận nhận order |
| `POST` | `/orders/:orderNo/serve` | Đã phục vụ xong |
| `POST` | `/orders/:orderNo/reject` | Huỷ đơn |
| `POST` | `/orders/:orderNo/assign` | Gán nhân viên phục vụ |
| `POST` | `/orders/:orderNo/pay` | Thu tiền (`cash` \| `transfer`, có thể kèm `discount_code`) |
| `POST` | `/discount-codes/preview` | Xem trước số tiền giảm |
| `GET` | `/tables`, `/tables/:id/qr`, `/branches`, `/stats`, `/staff-list` | Bàn, QR, cơ sở, thống kê |

**Admin** — `/api/admin` *(yêu cầu JWT vai trò admin)*

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `GET POST PATCH DELETE` | `/branches`, `/branches/:id` | Cơ sở |
| `GET POST PATCH DELETE` | `/discount-codes`, `/discount-codes/:id` | Mã giảm giá |
| `GET POST PATCH DELETE` | `/users`, `/users/:id` | Tài khoản |
| `POST` | `/users/:id/reset-password` | Đặt lại mật khẩu |
| `GET POST PATCH DELETE` | `/option-groups`, `/option-groups/:id` | Nhóm tuỳ chọn |
| `GET POST PATCH DELETE` | `/dishes`, `/dishes/:id` | Món ăn |
| `PATCH` | `/dishes/:id/availability` | Bật/tắt sẵn có |
| `GET POST PATCH DELETE` | `/tables`, `/tables/:id` | Bàn |
| `POST` | `/tables/:id/regenerate-qr`, `/tables/qr-sheet` | Tạo lại QR, in thẻ QR hàng loạt |
| `GET` | `/order-history`, `/orders`, `/reports`, `/stats` | Lịch sử, đơn, báo cáo, thống kê |

**Khác**

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `GET` | `/api/stream` | Server-Sent Events (thay đổi trạng thái đơn) |
| `POST` `DELETE` | `/api/upload/image` | Tải / xoá ảnh món ăn |

---

## Kiểm thử

Bộ test tự động mô phỏng đúng thao tác thật (91 kiểm tra trong 11 nhóm), chạy trên bản đã triển khai:

```bash
node tools/e2e.mjs                        # mặc định PUBLIC_URL trong .env
node tools/e2e.mjs http://localhost:3000
```

Nội dung kiểm tra:

- Sức khoẻ dịch vụ, menu, nhóm tuỳ chọn.
- Quét QR → vào bàn → thêm món kèm tuỳ chọn → gửi đơn.
- **Tính tiền** = `(giá món + tổng tiền tuỳ chọn) × số lượng`.
- Nhân viên `order` xác nhận → ghi đúng **NV nhận order**; `check` thu tiền → ghi đúng **NV thu tiền** là người khác.
- Phân quyền: nhân viên không truy cập được `/api/admin/*` (403).
- Thanh toán: **chuyển khoản bị chặn (403)**, tiền mặt thành công.
- **Cơ sở**: NV cơ sở khác không thấy bàn/đơn của cơ sở mình, xử lý đơn cơ sở khác → 403; Admin lọc được theo cơ sở.
- **Mã giảm giá**: xem trước mã hợp lệ, từ chối mã sai/tắt/hết hạn, thu tiền kèm mã và lưu đúng vào đơn + lịch sử + báo cáo.
- `/api/order/mine` đã bị gỡ (404) — khách không xem được lịch sử order.

> Lưu ý: mỗi lần chạy sẽ tạo thêm đơn đã thanh toán trong lịch sử/báo cáo.

---

## Triển khai lên server

Deploy được điều khiển từ máy Windows qua SSH (thư viện `ssh2`, không cần `plink`/`sshpass`).

Thông tin server lưu trong `tools/deploy.config.json` — **đã được gitignore** vì chứa mật khẩu:

```json
{
  "host": "100.100.1.5",
  "port": 22,
  "username": "root",
  "password": "...",
  "appDir": "/opt/ttth-order",
  "dbName": "ttth_order",
  "dbUser": "ttth_order",
  "dbPass": "tự sinh ở lần chạy đầu rồi lưu lại",
  "publicPort": 80,
  "nodeMajor": "22"
}
```

```bash
cd tools && npm install && cd ..

node tools/deploy.mjs preflight   # kiểm tra OS, Node, PostgreSQL, nginx
node tools/deploy.mjs install     # cài Node.js, PostgreSQL, nginx
node tools/deploy.mjs db          # tạo role + database
node tools/deploy.mjs upload      # đóng gói và tải mã nguồn lên /opt/ttth-order
node tools/deploy.mjs env         # sinh file .env (JWT_SECRET ngẫu nhiên)
node tools/deploy.mjs build       # npm ci + build API và web
node tools/deploy.mjs migrate     # tạo bảng + nạp dữ liệu mẫu
node tools/deploy.mjs service     # systemd + nginx
node tools/deploy.mjs check       # kiểm tra sau khi triển khai

node tools/deploy.mjs all         # chạy tất cả
```

Gộp nhiều bước bằng dấu phẩy: `node tools/deploy.mjs upload,build,service,check`.

Hình thức triển khai:

| Thành phần | Chi tiết |
| --- | --- |
| Thư mục ứng dụng | `/opt/ttth-order` |
| systemd | `ttth-order.service` → `/usr/bin/node /opt/ttth-order/dist/server.js`, `Restart=always` |
| Cổng nội bộ | `3000` |
| nginx | Cổng `80` → proxy sang `127.0.0.1:3000` |
| Database | `ttth_order`, user `ttth_order` |

Xem log:

```bash
journalctl -u ttth-order -f --since "10 min ago"
```

> **Lưu ý khi deploy lại:** bước `build` cài **toàn bộ** dependency (kể cả `dev`) vì cần `typescript` để build và `tsx` để chạy migrate/seed. Bước `migrate` sẽ `npm prune --omit=dev` **sau khi** seed xong.

---

## Ghi chú kỹ thuật

Một số điểm dễ sai đã được xử lý trong mã nguồn:

- **Đọc sau commit.** Các hàm ghi trong `withTransaction` **không** đọc lại bằng pool bên trong transaction (pool là connection khác, không thấy dữ liệu chưa commit) — luôn đọc lại **sau** khi transaction kết thúc.
- **Router phải giới hạn theo path.** `publicRouter` được mount ở `/api`; middleware bắt phiên bàn chỉ gắn với path cụ thể (`/order`, `/session/me`), nếu không sẽ chặn nhầm `/api/staff/*` và `/api/admin/*`.
- **Tuỳ chọn phải đi kèm cả danh sách.** `attachDetails()` nạp options cho cả đơn đơn lẻ lẫn danh sách, để bill in ra luôn có tuỳ chọn của khách.
- **Schema phải nâng cấp được DB cũ.** Index trên cột mới (`branch_id`) **không** khai báo ngay cạnh `CREATE TABLE` — vì `CREATE TABLE IF NOT EXISTS` bỏ qua bảng đã tồn tại, index sẽ hỏng vì cột chưa có. Index tạo ở khối nâng cấp cuối `sql/schema.sql`, **sau** các câu `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Kiểm tra mã giảm giá trước khi mở transaction.** `markPaid()` gọi `checkDiscountCode()` ngoài `withTransaction` để trả về thông báo lỗi tiếng Việt rõ ràng (mã sai / đã tắt / hết hạn) thay vì lỗi ràng buộc SQL.
- **Tắt server phải cắt kết nối SSE.** `server.close()` chỉ xong khi *mọi* kết nối đóng, mà `/api/stream` là long-lived và không bao giờ tự kết thúc. `src/server.ts` cho request đang xử lý 2s rồi `closeAllConnections()`, và luôn `process.exit(0)` sau khi `pool.end()` xong.

### Xoá mềm

Để không phá vỡ lịch sử order:

- **Món ăn / bàn** đã có trong lịch sử → ẩn hoặc vô hiệu hoá thay vì xoá hẳn.
- **Mục tuỳ chọn** không còn dùng → đặt `is_active = false` thay vì `DELETE`.
- **Cơ sở / mã giảm giá** còn đang được tham chiếu → đặt `is_active = false` thay vì `DELETE`.

---

## Giới hạn đã biết

- **Thanh toán chuyển khoản chưa mở.** Nút 🏦 *Chuyển khoản* luôn bị khoá và server cũng chặn:
  `POST /api/staff/orders/:orderNo/pay { "method": "transfer" } → 403`.
  Muốn mở: bỏ nhánh `forbidden` trong `src/routes/staff.ts` và bỏ thuộc tính `disabled` ở `web/src/pages/staff/StaffPayments.tsx`.
- **Realtime chỉ đúng với một tiến trình.** Bus sự kiện nằm trong bộ nhớ tiến trình Node. Nếu chạy nhiều tiến trình (hoặc nhiều máy) cần đổi sang Redis Pub/Sub.
- **Không có giỏ hàng nhiều bàn** — mỗi phiên bàn là một đơn độc lập.

---

## License

[MIT](LICENSE) © 2026 Bê Sửa
