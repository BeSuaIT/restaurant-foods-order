/**
 * Công cụ triển khai lên Ubuntu Server qua SSH (password auth).
 *
 * Cách dùng:
 *   node tools/deploy.mjs preflight     # kiểm tra môi trường server
 *   node tools/deploy.mjs upload        # đóng gói + tải mã nguồn lên server
 *   node tools/deploy.mjs setup         # cài đặt deps, build, migrate, seed
 *   node tools/deploy.mjs service       # tạo systemd service + nginx, khởi động
 *   node tools/deploy.mjs all           # chạy toàn bộ
 *   node tools/deploy.mjs check         # kiểm tra API sau khi triển khai
 *
 * Thông tin kết nối lấy từ biến môi trường hoặc file tools/deploy.config.json
 */
import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 *  Cấu hình kết nối
 * ------------------------------------------------------------------ */

const cfgFile = path.join(__dirname, 'deploy.config.json');
const fileCfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};

export const CFG = {
  host: process.env.DEPLOY_HOST ?? fileCfg.host ?? '100.100.1.5',
  port: Number(process.env.DEPLOY_PORT ?? fileCfg.port ?? 22),
  username: process.env.DEPLOY_USER ?? fileCfg.username ?? 'root',
  password: process.env.DEPLOY_PASSWORD ?? fileCfg.password ?? '',
  appDir: process.env.DEPLOY_DIR ?? fileCfg.appDir ?? '/opt/ttth-order',
  dbName: process.env.DEPLOY_DB_NAME ?? fileCfg.dbName ?? 'ttth_order',
  dbUser: process.env.DEPLOY_DB_USER ?? fileCfg.dbUser ?? 'ttth_order',
  dbPass: process.env.DEPLOY_DB_PASS ?? fileCfg.dbPass ?? '',
  publicPort: process.env.DEPLOY_PORT_HTTP ?? fileCfg.publicPort ?? 80,
  nodeMajor: fileCfg.nodeMajor ?? '22',
};

/* ------------------------------------------------------------------ *
 *  Trợ giúp SSH
 * ------------------------------------------------------------------ */

function connect() {
  return new Promise((resolve, reject) => {
    if (!CFG.password) {
      reject(new Error('Thiếu mật khẩu SSH. Đặt DEPLOY_PASSWORD hoặc sửa tools/deploy.config.json'));
      return;
    }
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(new Error(`SSH lỗi: ${err.message}`)))
      .connect({
        host: CFG.host,
        port: CFG.port,
        username: CFG.username,
        password: CFG.password,
        readyTimeout: 30000,
        keepaliveInterval: 15000,
      });
  });
}

/** Chạy lệnh trên server, trả về { code, stdout, stderr } */
function runCmd(conn, cmd, { timeout = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Lệnh quá thời gian chờ: ${cmd.slice(0, 80)}...`));
      }, timeout);

      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 0, stdout, stderr });
      });
      stream.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        if (process.env.DEPLOY_VERBOSE) process.stdout.write(s);
      });
      stream.stderr.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        if (process.env.DEPLOY_VERBOSE) process.stderr.write(s);
      });
    });
  });
}

/** Chạy lệnh, in log, ném lỗi nếu thất bại */
async function sh(conn, cmd, opts = {}) {
  console.log(`\n\x1b[36m$ ${cmd}\x1b[0m`);
  const res = await runCmd(conn, cmd, opts);
  if (res.code !== 0) {
    console.log(res.stdout.slice(-3000));
    console.error(res.stderr.slice(-3000));
    throw new Error(`Lệnh thất bại (exit ${res.code}): ${cmd.slice(0, 100)}`);
  }
  const tail = res.stdout.trim().split('\n').slice(-14).join('\n');
  if (tail) console.log(tail);
  return res;
}

/** Sudo không cần khi đã là root */
async function shSudo(conn, cmd, opts) {
  return process.getuid && process.getuid() === 0 ? sh(conn, cmd, opts) : sh(conn, `sudo -S bash -c ${JSON.stringify(cmd)}`, opts);
}

/* ------------------------------------------------------------------ *
 *  Đóng gói mã nguồn
 * ------------------------------------------------------------------ */

function makeTarball() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
  const out = path.join(os.tmpdir(), `ttth-order-${stamp}.tar.gz`);

  // file loại trừ: không gửi node_modules / build / file nhạy cảm
  const args = [
    '-czf', out,
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=.git',
    '--exclude=.env',
    '--exclude=tools',
    '--exclude=*.log',
    '--exclude=uploads/seed',
    '-C', ROOT,
    '.',
  ];

  execFileSync('tar', args, { stdio: 'pipe' });
  const size = fs.statSync(out).size;
  console.log(`Đã đóng gói: ${out} (${(size / 1024).toFixed(0)} KB)`);
  return out;
}

/** Tải file lên server bằng SFTP */
function upload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const size = fs.statSync(localPath).size;
      let done = 0;
      let lastPct = 0;

      const rs = fs.createReadStream(localPath);
      const ws = sftp.createWriteStream(remotePath);

      rs.on('data', (chunk) => {
        done += chunk.length;
        const pct = Math.floor((done / size) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`\r  Tải lên: ${pct}%   `);
        }
      });
      ws.on('close', () => {
        process.stdout.write('\r  Tải lên: 100%  \n');
        sftp.end();
        resolve();
      });
      ws.on('error', reject);
      rs.on('error', reject);
      rs.pipe(ws);
    });
  });
}

/* ------------------------------------------------------------------ *
 *  Các bước triển khai
 * ------------------------------------------------------------------ */

async function preflight(conn) {
  console.log('\n\x1b[1m=== KIỂM TRA SERVER ===\x1b[0m');
  const r = await runCmd(conn, 'cat /etc/os-release | head -3; echo "---"; uname -m; echo "---"; nproc; echo "---"; free -m | head -2; echo "---"; df -h / | tail -1');
  console.log(r.stdout);

  const checks = [
    { cmd: 'command -v node', name: 'Node.js' },
    { cmd: 'command -v psql', name: 'PostgreSQL client' },
    { cmd: 'command -v systemctl', name: 'systemd' },
    { cmd: 'command -v nginx', name: 'nginx' },
    { cmd: 'curl -fsS -o /dev/null -w "%{http_code}" https://deb.nodesource.com 2>/dev/null || echo no', name: 'Kết nối Internet' },
  ];

  for (const c of checks) {
    const res = await runCmd(conn, c.cmd, { timeout: 30000 });
    const ok = res.code === 0 && res.stdout.trim() && res.stdout.trim() !== 'no';
    console.log(`  ${ok ? '\x1b[32m✔\x1b[0m' : '\x1b[33m✖\x1b[0m'} ${c.name}: ${res.stdout.trim().slice(0, 60) || 'chưa cài'}`);
  }
}

async function installDeps(conn) {
  console.log('\n\x1b[1m=== CÀI ĐẶT PHẦN MỀM ===\x1b[0m');

  await sh(conn, 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq', { timeout: 300000 });

  // Node.js — thử NodeSource trước, nếu lỗi (codename Ubuntu quá mới) thì dùng repo của Ubuntu
  const nodeOk = await runCmd(conn, `node -v 2>/dev/null | grep -o "^v${CFG.nodeMajor}" || echo none`, { timeout: 30000 });
  if (!nodeOk.stdout.includes(`v${CFG.nodeMajor}`)) {
    const ns = await runCmd(
      conn,
      `curl -fsSL https://deb.nodesource.com/setup_${CFG.nodeMajor}.x -o /tmp/ns.sh && bash /tmp/ns.sh >/tmp/ns.log 2>&1; echo EXIT=$?`,
      { timeout: 300000 },
    );
    if (!ns.stdout.includes('EXIT=0')) {
      console.log('  \x1b[33m!NodeSource không dùng được, chuyển sang kho Node của Ubuntu\x1b[0m');
      console.log((await runCmd(conn, 'tail -5 /tmp/ns.log')).stdout);
    }
    await sh(conn, 'export DEBIAN_FRONTEND=noninteractive; apt-get install -y nodejs 2>&1 | tail -3', { timeout: 600000 });
  }
  const nv = await runCmd(conn, 'node -v');
  const major = Number((nv.stdout.match(/v(\d+)/) ?? [])[1] ?? 0);
  console.log(`  Node.js: ${nv.stdout.trim()}`);
  if (major < 20) throw new Error(`Node.js ${nv.stdout.trim()} quá cũ, cần >= 20`);

  // PostgreSQL + nginx + build tools
  await sh(
    conn,
    'export DEBIAN_FRONTEND=noninteractive; apt-get install -y postgresql postgresql-contrib nginx build-essential curl ca-certificates tar 2>&1 | tail -3',
    { timeout: 900000 },
  );
  await sh(conn, 'systemctl enable --now postgresql || true; systemctl enable --now nginx || true', { timeout: 120000 });

  const pv = await runCmd(conn, 'psql --version');
  console.log(`  PostgreSQL: ${pv.stdout.trim()}`);
}

async function setupDatabase(conn) {
  console.log('\n\x1b[1m=== THIẾT LẬP DATABASE ===\x1b[0m');
  // Mật khẩu ưu tiên: biến môi trường > config file > sinh ngẫu nhiên (lưu lại config để lần sau dùng lại)
  let pass = process.env.DEPLOY_DB_PASS ?? fileCfg.dbPass ?? '';
  if (!pass) {
    pass = crypto.randomBytes(18).toString('base64url');
    fileCfg.dbPass = pass;
    fs.writeFileSync(cfgFile, `${JSON.stringify(fileCfg, null, 2)}\n`, 'utf8');
    console.log('  Đã sinh mật khẩu DB mới và lưu vào tools/deploy.config.json');
  }

  // Idempotent: luôn đảm bảo role tồn tại VÀ có đúng mật khẩu này.
  // SQL được base64-encode rồi decode trên server để khỏi lo lồng dấu nháy.
  const roleSql = `
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CFG.dbUser}') THEN
    CREATE ROLE ${CFG.dbUser} LOGIN PASSWORD '${pass}';
  ELSE
    ALTER ROLE ${CFG.dbUser} WITH LOGIN PASSWORD '${pass}';
  END IF;
END
$do$;
`;
  await runPsql(conn, roleSql, { timeout: 60000 });

  const hasDb = await runCmd(
    conn,
    `su - postgres -c "psql -tAc \\"SELECT 1 FROM pg_database WHERE datname='${CFG.dbName}'\\""`,
  );
  if (hasDb.stdout.trim() !== '1') {
    await runPsql(conn, `CREATE DATABASE ${CFG.dbName} OWNER ${CFG.dbUser} ENCODING 'UTF8';`, { timeout: 120000 });
    console.log(`  Đã tạo database '${CFG.dbName}'`);
  }

  const res = await runPsql(conn, `SELECT 1;`, { timeout: 60000, db: CFG.dbName });
  const ok = res.stdout.trim() === '1';
  console.log(`  Database '${CFG.dbName}' (user '${CFG.dbUser}'): ${ok ? '\x1b[32mOK\x1b[0m' : '\x1b[31mTHẤT BẠI\x1b[0m'}`);
  if (!ok) throw new Error('Không truy vấn được database vừa thiết lập');
  return pass;
}

/** Chạy SQL với user postgres; mã hoá base64 để tránh lỗi escape dấu nháy */
async function runPsql(conn, sql, { timeout = 60000, db = 'postgres' } = {}) {
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const target = db === 'postgres' ? '' : ` ${db}`;
  return runCmd(
    conn,
    `echo ${b64} | base64 -d | su - postgres -c "psql -v ON_ERROR_STOP=1 -q -tA${target}"`,
    { timeout },
  );
}

async function uploadCode(conn) {
  console.log('\n\x1b[1m=== TẢI MÃ NGUỒN LÊN SERVER ===\x1b[0m');
  const tar = makeTarball();
  const remoteTar = `/tmp/ttth-order.tar.gz`;

  await upload(conn, tar, remoteTar);
  console.log(`  Đã tải lên ${CFG.host}:${remoteTar}`);

  // tar không tự xoá file đã bị xoá ở local → dọn trước các thư mục mã nguồn
  // do repo quản lý (giữ nguyên node_modules, uploads, .env, web/dist).
  const managedDirs = ['src', 'scripts', 'sql', 'web/src'].map((d) => `${CFG.appDir}/${d}`).join(' ');
  await sh(conn, `mkdir -p ${CFG.appDir} && rm -rf ${managedDirs} && tar -xzf ${remoteTar} -C ${CFG.appDir} && rm -f ${remoteTar}`, { timeout: 180000 });
  console.log(`  Đã giải nén vào ${CFG.appDir}`);

  fs.unlinkSync(tar);
}

async function writeEnv(conn, dbPass) {
  console.log('\n\x1b[1m=== TẠO FILE .ENV ===\x1b[0m');
  const jwt = crypto.randomBytes(48).toString('base64url');
  const env = `# Sinh tự động lúc ${new Date().toISOString()}
NODE_ENV=production
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=${CFG.dbName}
DB_USER=${CFG.dbUser}
DB_PASSWORD=${dbPass}

JWT_SECRET=${jwt}
JWT_EXPIRES_IN=12h

PUBLIC_URL=http://${CFG.host}
UPLOAD_DIR=${CFG.appDir}/uploads
WEB_DIST_DIR=${CFG.appDir}/web/dist
`;

  const tmp = path.join(os.tmpdir(), 'ttth.env');
  fs.writeFileSync(tmp, env, 'utf8');
  await upload(conn, tmp, `${CFG.appDir}/.env`);
  fs.unlinkSync(tmp);
  console.log(`  PUBLIC_URL = http://${CFG.host}`);
  console.log('  JWT_SECRET đã sinh ngẫu nhiên');
}

async function buildApp(conn) {
  console.log('\n\x1b[1m=== CÀI ĐẶT & BUILD ===\x1b[0m');
  // Cài TOÀN BỘ deps (kể cả dev) vì cần typescript + vite + tsx để build.
  // Dev deps sẽ được prune ở bước migrate sau khi seed xong.
  await sh(conn, `cd ${CFG.appDir} && mkdir -p uploads && npm ci --no-audit --no-fund 2>&1 | tail -5`, { timeout: 900000 });
  await sh(conn, `cd ${CFG.appDir}/web && npm ci --no-audit --no-fund 2>&1 | tail -5`, { timeout: 900000 });

  // Build API (tsc)
  const api = await runCmd(conn, `cd ${CFG.appDir} && ./node_modules/.bin/tsc -p tsconfig.json`, { timeout: 600000 });
  if (api.code !== 0) {
    console.log(api.stdout.slice(-4000));
    console.error(api.stderr.slice(-4000));
    throw new Error(`Build API (tsc) thất bại (exit ${api.code})`);
  }
  if (!api.stdout.trim() && !api.stderr.trim()) console.log('  Build API: OK');

  // Build web (tsc -b && vite build)
  const web = await runCmd(conn, `cd ${CFG.appDir}/web && npm run build`, { timeout: 900000 });
  if (web.code !== 0) {
    console.log(web.stdout.slice(-3000));
    console.error(web.stderr.slice(-3000));
    throw new Error('Build web (vite) thất bại');
  }
  console.log(web.stdout.trim().split('\n').slice(-6).join('\n'));

  // Xác nhận artifact thực sự tồn tại
  const art = await runCmd(conn, `test -f ${CFG.appDir}/dist/server.js -a -d ${CFG.appDir}/web/dist && echo YES || echo NO`);
  if (!art.stdout.includes('YES')) throw new Error('Thiếu artifact sau build (dist/server.js hoặc web/dist)');
  console.log('  Artifact: dist/server.js + web/dist ✔');
}

async function migrateAndSeed(conn) {
  console.log('\n\x1b[1m=== TẠO BẢNG & NẠP DỮ LIỆU MẪU ===\x1b[0m');
  await sh(conn, `cd ${CFG.appDir} && set -a && . ./.env && set +a && ./node_modules/.bin/tsx scripts/migrate.ts`, { timeout: 300000 });
  await sh(conn, `cd ${CFG.appDir} && set -a && . ./.env && set +a && ./node_modules/.bin/tsx scripts/seed.ts`, { timeout: 300000 });
  // Đã xong migrate/seed -> bỏ dev deps cho nhẹ và an toàn hơn
  await sh(conn, `cd ${CFG.appDir} && npm prune --omit=dev --no-audit --no-fund 2>&1 | tail -3`, { timeout: 300000 });
  console.log('  Đã gỡ dev dependencies');
}

async function setupService(conn) {
  console.log('\n\x1b[1m=== CẤU HÌNH SYSTEMD & NGINX ===\x1b[0m');

  const unit = `[Unit]
Description=TTTH Order - He thong order do an nha hang
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${CFG.appDir}
ExecStart=/usr/bin/node ${CFG.appDir}/dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`;
  fs.writeFileSync(path.join(os.tmpdir(), 'ttth.service'), unit, 'utf8');
  await upload(conn, path.join(os.tmpdir(), 'ttth.service'), '/etc/systemd/system/ttth-order.service');
  fs.unlinkSync(path.join(os.tmpdir(), 'ttth.service'));

  const nginx = `server {
    listen ${CFG.publicPort};
    listen [::]:${CFG.publicPort};
    server_name _;

    client_max_body_size 8m;

    # Tài nguyên tĩnh được cache
    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        expires 7d;
    }

    # Server-Sent Events: cần tắt buffering
    location /api/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
`;
  fs.writeFileSync(path.join(os.tmpdir(), 'ttth.nginx'), nginx, 'utf8');
  await upload(conn, path.join(os.tmpdir(), 'ttth.nginx'), '/etc/nginx/sites-available/ttth-order');
  fs.unlinkSync(path.join(os.tmpdir(), 'ttth.nginx'));

  await sh(conn, 'systemctl daemon-reload && systemctl enable ttth-order && systemctl restart ttth-order', { timeout: 120000 });
  await sh(conn, `ln -sf /etc/nginx/sites-available/ttth-order /etc/nginx/sites-enabled/ttth-order && rm -f /etc/nginx/sites-enabled/default && nginx -t`, { timeout: 60000 });
  await sh(conn, 'systemctl reload nginx || systemctl restart nginx', { timeout: 60000 });
  console.log('  Đã cấu hình xong systemd + nginx');
}

async function check(conn) {
  console.log('\n\x1b[1m=== KIỂM TRA SAU TRIỂN KHAI ===\x1b[0m');

  const svc = await runCmd(conn, 'systemctl is-active ttth-order');
  console.log(`  Service ttth-order: ${svc.stdout.trim() || 'N/A'} ${svc.stdout.trim() === 'active' ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m'}`);

  const health = await runCmd(conn, `curl -fsS http://127.0.0.1:3000/api/health 2>&1 || echo FAIL`);
  console.log(`  Health API: ${health.stdout.trim()}`);

  const web = await runCmd(conn, `curl -fsS -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:${CFG.publicPort}/ 2>&1 || echo FAIL`);
  console.log(`  Web qua nginx: ${web.stdout.trim()}`);

  // Đăng nhập thử
  const login = await runCmd(
    conn,
    `curl -fsS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"1234"}' 2>&1 | head -c 200`,
  );
  console.log(`  Đăng nhập admin: ${login.code === 0 && login.stdout.includes('token') ? '\x1b[32mOK\x1b[0m' : '\x1b[31mFAIL\x1b[0m ' + login.stdout.slice(0, 120)}`);

  const menu = await runCmd(conn, `curl -fsS http://127.0.0.1:3000/api/menu 2>&1 | head -c 120`);
  console.log(`  Menu API: ${menu.code === 0 ? '\x1b[32mOK\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);

  const logs = await runCmd(conn, 'journalctl -u ttth-order -n 25 --no-pager 2>&1 | tail -22');
  console.log('\n  --- Nhật ký dịch vụ ---');
  console.log(logs.stdout);
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */

const steps = {
  preflight,
  install: installDeps,
  db: setupDatabase,
  upload: uploadCode,
  env: async (conn) => {
    const pass = await setupDatabase(conn);
    await writeEnv(conn, pass);
  },
  build: buildApp,
  migrate: migrateAndSeed,
  service: setupService,
  check,
};

async function main() {
  const arg = (process.argv[2] ?? 'all').toLowerCase();

  if (arg === 'help' || arg === '-h') {
    console.log(Object.keys(steps).join('\n'));
    return;
  }

  console.log(`\x1b[1mKết nối ${CFG.username}@${CFG.host}:${CFG.port}...\x1b[0m`);
  const conn = await connect();
  console.log('\x1b[32m✔ Đã kết nối\x1b[0m');

  try {
    const list = arg === 'all'
      ? ['preflight', 'install', 'upload', 'env', 'build', 'migrate', 'service', 'check']
      : arg.split(',').map((s) => s.trim()).filter(Boolean);

    for (const s of list) {
      const fn = steps[s];
      if (!fn) throw new Error(`Bước không hợp lệ: "${s}". Các bước hợp lệ: ${Object.keys(steps).join(', ')}`);
      await fn(conn);
    }

    console.log('\n\x1b[32m\x1b[1m✔ HOÀN TẤT!\x1b[0m');
    console.log(`\n  Khách hàng  : http://${CFG.host}/`);
    console.log(`  Phục vụ bàn  : http://${CFG.host}/staff`);
    console.log(`  Phục vụ bếp : http://${CFG.host}/kitchen`);
    console.log(`  Quản trị    : http://${CFG.host}/admin`);
    console.log(`\n  Tài khoản: admin/1234 · order/1234 · check/1234 · bep/1234\n`);
  } finally {
    conn.end();
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31m✖ LỖI: ${err.message}\x1b[0m`);
  process.exit(1);
});
