import fs from 'node:fs';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

async function main() {
  if (!fs.existsSync(config.schemaPath)) {
    throw new Error(`Không tìm thấy file schema: ${config.schemaPath}`);
  }

  const sql = fs.readFileSync(config.schemaPath, 'utf8');
  console.log(`Đang áp dụng schema từ ${config.schemaPath} ...`);
  await pool.query(sql);
  console.log('[OK] Đã tạo/cập nhật toàn bộ bảng.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[MIGRATE] Lỗi:', err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
