import { Pool, types } from 'pg';
import { config } from './config.js';

/**
 * node-postgres trả về NUMERIC dưới dạng string để giữ chính xác số thập phân.
 * Ở đây mọi tiền trong hệ thống đều là số nguyên VND nên ép sang number là an toàn.
 */
types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10))); // bigint

export const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('[db] Lỗi pool không mong đợi:', err.message);
});

export type SqlParam = string | number | boolean | null | Date | object | string[] | number[];

export async function query<T = Record<string, unknown>>(
  text: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: SqlParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Chạy trong transaction, tự rollback khi có lỗi. */
export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback error */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
