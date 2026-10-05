import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from './config.js';
import type { JwtPayload, SessionUser } from './types.js';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function signStaffToken(user: SessionUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    branch_id: user.branch_id ?? null,
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as SignOptions);
}

export function verifyStaffToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwt.secret);
  if (typeof decoded === 'string') throw new Error('Token không hợp lệ');
  return decoded as unknown as JwtPayload;
}
