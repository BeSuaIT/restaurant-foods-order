import { createApp, assertDatabase } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { DRAFT_TTL_HOURS, purgeStaleDrafts } from './services/order.service.js';

/** Chu kỳ quét đơn nháp quá hạn (ms). */
const PURGE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Dọn đơn nháp quá 24h + phiên bàn bỏ quên.
 *
 * Khách quét QR rồi đi mất (không order) sẽ để lại 1 đơn nháp trong DB. Nếu không
 * dọn thì số mã đơn rác tích luỹ mỗi ngày và màn "Danh sách Order" của nhân viên
 * nhiễm đầy đơn chưa gửi. Chạy 1 lần lúc khởi động rồi lặp mỗi 30 phút.
 */
function startDraftPurge(): void {
  const run = async () => {
    try {
      const { orders, sessions } = await purgeStaleDrafts();
      if (orders > 0 || sessions > 0) {
        console.log(`  [dọn dẹp] Đã xoá ${orders} đơn chưa gửi + ${sessions} phiên bàn quá hạn (${DRAFT_TTL_HOURS}h).`);
      }
    } catch (err) {
      console.error('[dọn dẹp] Lỗi khi xoá đơn nháp quá hạn:', err);
    }
  };

  void run();
  const timer = setInterval(() => void run(), PURGE_INTERVAL_MS);
  timer.unref(); // không giữ tiến trình sống
}

async function main() {
  console.log('==============================================');
  console.log('  HỆ THỐNG ORDER ĐỒ ĂN - RESTAURANT ORDERING');
  console.log('==============================================');
  console.log(`  Môi trường : ${config.nodeEnv}`);
  console.log(`  Database   : ${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`  Public URL : ${config.publicUrl}`);
  console.log('----------------------------------------------');

  await assertDatabase();
  console.log('  [OK] Kết nối PostgreSQL thành công');

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('----------------------------------------------');
    console.log(`  [OK] Server chạy tại http://0.0.0.0:${config.port}`);
    console.log(`  Khách hàng  : ${config.publicUrl}/`);
    console.log(`  Phục vụ bàn  : ${config.publicUrl}/staff`);
    console.log(`  Phục vụ bếp : ${config.publicUrl}/kitchen`);
    console.log(`  Quản trị    : ${config.publicUrl}/admin`);
    console.log('==============================================');
    startDraftPurge();
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${signal}] Đang tắt server...`);

    // Chốt kẹt: quá 10s vẫn chưa dừng được thì ép tắt.
    const bail = setTimeout(() => {
      console.error('[shutdown] Không đóng được trong 10s — ép tắt tiến trình.');
      process.exit(1);
    }, 10_000);
    bail.unref();

    // server.close() chỉ hoàn tất khi MỌI kết nối đang mở kết thúc, mà kết nối
    // SSE (/api/stream) là long-lived nên không bao giờ tự đóng. Cho các request
    // đang xử lý 2s rồi mới cắt, nếu không mỗi lần restart sẽ treo tới hết
    // timeout và systemd ghi nhận exit code 1 (FAILURE).
    const force = setTimeout(() => {
      console.log('[shutdown] Cắt các kết nối còn treo (SSE).');
      server.closeAllConnections();
    }, 2_000);
    force.unref();

    server.close(() => {
      console.log('[shutdown] HTTP server đã đóng — đang đóng kết nối database.');
      void pool
        .end()
        .catch((err: unknown) => console.error('[shutdown] Lỗi khi đóng pool:', err))
        .finally(() => {
          clearTimeout(bail);
          clearTimeout(force);
          console.log('[shutdown] Tắt server thành công.');
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
}

main().catch((err) => {
  console.error('\n[FATAL] Không thể khởi động:', err instanceof Error ? err.message : err);
  process.exit(1);
});
