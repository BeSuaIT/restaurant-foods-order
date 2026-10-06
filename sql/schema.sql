-- =============================================================
--  HỆ THỐNG ORDER ĐỒ ĂN - SCHEMA POSTGRESQL
--  Database: ttth_order
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------
-- ENUM
-- -------------------------------------------------------------
-- staff = phục vụ bàn, kitchen = phục vụ bếp
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff', 'kitchen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Type đã tồn tại từ lần chạy trước thì bổ sung giá trị mới.
-- LƯU Ý: các câu "ALTER TYPE ... ADD VALUE" được scripts/migrate.ts tách ra chạy
-- trước & commit riêng, vì PG không cho dùng giá trị enum vừa thêm trong cùng
-- transaction (sẽ báo "unsafe use of new value ... of enum type").
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'kitchen';

-- Quy trình đầy đủ (bếp tham gia):
--   draft → pending (khách gửi) → confirmed (PV bàn nhận)
--   → sent_kitchen (PV bàn chuyển bếp) → kitchen_accepted (bếp nhận)
--   → ready_to_serve (bếp làm xong, trả PV bàn) → served (PV bàn nhận) → paid
-- sent_kitchen/kitchen_accepted/ready_to_serve chỉ tồn tại ở DB mới;
-- quy trình cũ (không qua bếp) vẫn chạy được vì confirmed → served vẫn hợp lệ.
-- (3 câu ALTER TYPE bên dưới do scripts/migrate.ts chạy riêng — xem ghi chú enum.)
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('draft', 'pending', 'confirmed', 'served', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'sent_kitchen';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'kitchen_accepted';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ready_to_serve';

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------
-- CƠ SỞ (chi nhánh) — Admin tạo & quản lý trong "Cài đặt"
-- Mỗi bàn và mỗi nhân viên thuộc 1 cơ sở.
-- Nhân viên chỉ thấy order/bàn của cơ sở mình; Admin xem tất cả.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  note       TEXT,
  -- Tọa độ địa lý — phục vụ tính năng chấm công (định vị bản thân/nhân viên trong bán kính cơ sở)
  lat        NUMERIC(10,7),
  lng        NUMERIC(10,7),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- TÀI KHOẢN (do Admin tạo - không có chức năng đăng ký)
-- branch_id NULL = nhìn thấy tất cả các cơ sở (mặc định cho Admin)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'staff',
  phone         TEXT,
  note          TEXT,
  branch_id     INT REFERENCES branches(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- (index idx_users_branch tạo ở khối "NÂNG CẤP DB CŨ" cuối file)

-- -------------------------------------------------------------
-- BÀN + MÃ QR (mỗi bàn thuộc 1 cơ sở)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rest_tables (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,          -- mã ngắn hiển thị: A1, B2...
  name       TEXT NOT NULL,                 -- "Bàn 1 - Tầng 1"
  area       TEXT,                          -- khu vực: "Tầng 1", "Ngoài trời"...
  seats      INT  NOT NULL DEFAULT 4,
  branch_id  INT REFERENCES branches(id) ON DELETE SET NULL,
  qr_token   TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- (index idx_rest_tables_branch tạo ở khối "NÂNG CẤP DB CŨ" cuối file)

-- -------------------------------------------------------------
-- MÃ GIẢM GIÁ (Admin tạo: mã + % + thời gian áp dụng + số lần dùng tối đa)
-- Nhân viên nhập mã ở màn hình thanh toán để giảm tiền cho khách.
-- usage_limit NULL = không giới hạn số lần sử dụng
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_codes (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,        -- lưu dạng chữ HOA, VD: "GIAM10"
  description  TEXT,
  percent      INT  NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  usage_limit  INT  CHECK (usage_limit IS NULL OR usage_limit > 0),
  start_at     TIMESTAMPTZ,
  end_at       TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  used_count   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(upper(code));

-- Phiên của khách tại bàn (quét QR -> nhập tên + SĐT -> có token)
CREATE TABLE IF NOT EXISTS table_sessions (
  id             SERIAL PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  table_id       INT  NOT NULL REFERENCES rest_tables(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_table_sessions_table ON table_sessions(table_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_seen ON table_sessions(last_seen_at);

-- -------------------------------------------------------------
-- NHÓM LỰA CHỌN ĐI KÈM (VD: "Nhân thêm", "Sốt chấm", "Mức cay")
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS option_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  min_select  INT  NOT NULL DEFAULT 0,
  max_select  INT  NOT NULL DEFAULT 1,
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS option_items (
  id          SERIAL PRIMARY KEY,
  group_id    INT  NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price_delta NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_option_items_group ON option_items(group_id);

-- -------------------------------------------------------------
-- MÓN ĂN
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dishes (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  category     TEXT,
  image_url    TEXT,
  price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,   -- còn món / hết món
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,   -- còn hiển thị trong menu
  sort_order   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dishes_active ON dishes(is_active, sort_order);

CREATE TABLE IF NOT EXISTS dish_option_groups (
  dish_id    INT NOT NULL REFERENCES dishes(id)       ON DELETE CASCADE,
  group_id   INT NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (dish_id, group_id)
);

-- -------------------------------------------------------------
-- ORDER
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  order_no         TEXT NOT NULL UNIQUE,
  table_id         INT REFERENCES rest_tables(id) ON DELETE SET NULL,
  session_token    TEXT REFERENCES table_sessions(token) ON DELETE SET NULL,

  -- thông tin khách
  customer_name    TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,

  status           order_status NOT NULL DEFAULT 'draft',
  note             TEXT,

  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- mã giảm giá do nhân viên nhập lúc thanh toán
  discount_code_id     INT REFERENCES discount_codes(id) ON DELETE SET NULL,
  discount_code        TEXT,
  discount_percent     INT  NOT NULL DEFAULT 0,
  discount_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,

  payment_method   payment_method,

  -- nhân viên nhận order (xác nhận món)
  received_by      INT REFERENCES users(id) ON DELETE SET NULL,
  received_by_name TEXT,
  confirmed_at     TIMESTAMPTZ,
  rejected_reason  TEXT,

  -- phục vụ bếp nhận đơn (sau khi phục vụ bàn chuyển qua)
  kitchen_received_at     TIMESTAMPTZ,
  kitchen_received_by     INT REFERENCES users(id) ON DELETE SET NULL,
  kitchen_received_by_name TEXT,
  -- bếp làm xong, chờ/phục vụ bàn nhận lại
  kitchen_done_at         TIMESTAMPTZ,
  kitchen_done_by         INT REFERENCES users(id) ON DELETE SET NULL,
  kitchen_done_by_name    TEXT,
  -- bếp trả lại cho phục vụ bàn; phục vụ bàn nhận -> served
  sent_to_kitchen_at       TIMESTAMPTZ,
  sent_to_kitchen_by       INT REFERENCES users(id) ON DELETE SET NULL,
  sent_to_kitchen_by_name  TEXT,

  -- phục vụ
  served_at        TIMESTAMPTZ,
  served_by        INT REFERENCES users(id) ON DELETE SET NULL,

  -- thanh toán
  paid_at          TIMESTAMPTZ,
  paid_by          INT REFERENCES users(id) ON DELETE SET NULL,
  paid_by_name     TEXT,

  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- thời gian bắt đầu order
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_token);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id               SERIAL PRIMARY KEY,
  order_id         INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id          INT REFERENCES dishes(id) ON DELETE SET NULL,
  dish_name        TEXT NOT NULL,
  dish_image_url   TEXT,
  unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity         INT  NOT NULL DEFAULT 1,
  note             TEXT,
  options_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order       INT  NOT NULL DEFAULT 0,
  -- Bếp tick từng món đã xong. NULL = chưa làm xong.
  kitchen_done_at      TIMESTAMPTZ,
  kitchen_done_by      INT REFERENCES users(id) ON DELETE SET NULL,
  kitchen_done_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_item_options (
  id            SERIAL PRIMARY KEY,
  order_item_id INT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_name    TEXT NOT NULL,
  option_name   TEXT NOT NULL,
  price_delta   NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_item_options_item ON order_item_options(order_item_id);

-- Nhật ký mọi thao tác (dùng cho lịch sử / in bill)
CREATE TABLE IF NOT EXISTS order_events (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  from_status order_status,
  to_status   order_status,
  actor_type  TEXT NOT NULL DEFAULT 'system',   -- customer | staff | kitchen | admin | system
  actor_id    TEXT,
  actor_name  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

-- -------------------------------------------------------------
-- Hàm trợ giúp
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['users','rest_tables','option_groups','dishes','orders','branches','discount_codes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t, t
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- NÂNG CẤP DB CŨ (idempotent) — chạy lại schema.sql không mất dữ liệu
-- -------------------------------------------------------------
ALTER TABLE users          ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE rest_tables    ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS discount_code_id INT REFERENCES discount_codes(id) ON DELETE SET NULL;
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS discount_code TEXT;
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS discount_percent INT NOT NULL DEFAULT 0;
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE branches       ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
ALTER TABLE branches       ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS usage_limit INT;
CREATE INDEX IF NOT EXISTS idx_users_branch        ON users(branch_id);
CREATE INDEX IF NOT EXISTS idx_rest_tables_branch  ON rest_tables(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch       ON orders(table_id);
-- Dọn đơn nháp (draft) quá hạn: index riêng cho status='draft'
CREATE INDEX IF NOT EXISTS idx_orders_draft        ON orders(created_at) WHERE status = 'draft';

-- -------------------------------------------------------------
-- PHỤC VỤ BẾP (thêm sau) — nhật ký ai nhận/đã làm xong/trả lại
-- -------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_received_at     TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_received_by     INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_received_by_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_done_at         TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_done_by         INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_done_by_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sent_to_kitchen_at       TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sent_to_kitchen_by       INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sent_to_kitchen_by_name  TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kitchen_done_at      TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kitchen_done_by      INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kitchen_done_by_name TEXT;
-- Bảng kế bếp hay đọc 2 trạng thái này nhất -> index riêng theo cơ sở.
CREATE INDEX IF NOT EXISTS idx_orders_kitchen ON orders(created_at)
  WHERE status IN ('sent_kitchen', 'kitchen_accepted');

-- -------------------------------------------------------------
-- GỠ TÍNH NĂNG THÔNG BÁO NỘI BỘ (đã bỏ khỏi hệ thống) — dọn bảng cũ nếu còn.
-- -------------------------------------------------------------
DROP TABLE IF EXISTS announcement_reads;
DROP TABLE IF EXISTS announcements;

