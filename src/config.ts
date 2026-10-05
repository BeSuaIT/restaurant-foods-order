import 'dotenv/config';
import path from 'node:path';

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const PORT = num(process.env.PORT, 3000);

const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET phải là chuỗi ngẫu nhiên dài >= 32 ký tự khi chạy production.');
}

export const config = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: PORT,

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: num(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME ?? 'ttth_order',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    max: 10,
  },

  jwt: {
    secret: JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },

  /** Địa chỉ public dùng để sinh mã QR trỏ về bàn (bắt buộc khi deploy thật) */
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, ''),

  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  webDistDir: path.resolve(process.env.WEB_DIST_DIR ?? './web/dist'),
  schemaPath: path.resolve(process.env.SCHEMA_PATH ?? './sql/schema.sql'),
} as const;

export type AppConfig = typeof config;
