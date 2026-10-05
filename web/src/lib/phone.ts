/* ------------------------------------------------------------------ *
 *  Kiểm tra số điện thoại Việt Nam
 * ------------------------------------------------------------------ */

export function normalizeVnPhone(input: string): string {
  const raw = (input ?? '').replace(/[^\d+]/g, '');
  if (raw.startsWith('+84')) return '0' + raw.slice(3);
  if (raw.startsWith('84') && raw.length >= 11) return '0' + raw.slice(2);
  return raw.startsWith('0') ? raw : raw;
}

export function isValidVnPhone(input: string): boolean {
  return /^0\d{9,10}$/.test(normalizeVnPhone(input));
}