import fs from 'node:fs';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

/**
 * Áp dụng `sql/schema.sql` — chạy lại nhiều lần cũng an toàn (idempotent).
 *
 * LƯU Ý QUAN TRỌNG — vì sao phải tách `ALTER TYPE ... ADD VALUE`:
 * PostgreSQL cho phép ALTER TYPE ADD VALUE trong transaction, NHƯNG giá trị vừa
 * thêm KHÔNG được dùng lại trong cùng transaction đó. Nếu gửi cả file schema
 * bằng `pool.query(sql)` (một lần = một transaction ngầm) thì các câu
 * `CREATE INDEX ... WHERE status IN ('sent_kitchen', ...)` sẽ báo:
 *
 *   ERROR: unsafe use of new value "sent_kitchen" of enum type order_status
 *
 * Vì vậy: chạy hết câu ALTER TYPE trước (mỗi câu là transaction riêng, commit
 * ngay), xong mới chạy phần còn lại của schema.
 */
const ALTER_TYPE_ADD_VALUE = /^[ \t]*ALTER\s+TYPE\s+\w+\s+ADD\s+VALUE\b[^;]*;/gim;

async function main() {
  if (!fs.existsSync(config.schemaPath)) {
    throw new Error(`Không tìm thấy file schema: ${config.schemaPath}`);
  }

  const sql = fs.readFileSync(config.schemaPath, 'utf8');
  console.log(`Đang áp dụng schema từ ${config.schemaPath} ...`);

  // 1) Enum: chạy riêng, commit ngay để giá trị mới dùng được ở bước 2.
  const alters: string[] = [];
  for (const m of sql.matchAll(ALTER_TYPE_ADD_VALUE)) {
    alters.push(m[0].trim());
  }
  let rest = sql.replace(ALTER_TYPE_ADD_VALUE, '');

  for (const stmt of alters) {
    await pool.query(stmt);
    console.log(`  [enum] ${stmt}`);
  }

  // 2) Toàn bộ DDL còn lại (bảng, cột, index, ràng buộc).
  await pool.query(rest);
  console.log(`  [ddl ] ${rest.split(';').length - 1} câu lệnh`);

  console.log('[OK] Đã tạo/cập nhật toàn bộ bảng.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[MIGRATE] Lỗi:', err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});