/* ------------------------------------------------------------------ *
 *  Lọc HTML an toàn cho nội dung thông báo nội bộ
 *
 *  Nội dung thông báo do Admin soạn và nhân viên đọc trong trình duyệt
 *  (render bằng dangerouslySetInnerHTML) nên phải lọc ở SERVER trước khi
 *  lưu — không phụ thuộc giao diện bên nhà hàng có làm gì.
 *
 *  Cách làm: allow-list thẻ + thuộc tính, bỏ toàn bộ thẻ không nằm trong danh sách
 *  (chỉ bỏ nội dung của chúng với những thẫng "nguy hiểm" như script/style).
 *  Không dùng regex thay thế chuỗi một lần vì cách đó dễ bị bypass.
 * ------------------------------------------------------------------ */

/** Thẻ được phép, kèm danh sách thuộc tính được phép cho từng thẻ. */
const ALLOWED_TAGS: Record<string, Set<string>> = {
  p: new Set(),
  br: new Set(),
  strong: new Set(),
  b: new Set(),
  em: new Set(),
  i: new Set(),
  u: new Set(),
  s: new Set(),
  del: new Set(),
  ins: new Set(),
  sub: new Set(),
  sup: new Set(),
  h1: new Set(),
  h2: new Set(),
  h3: new Set(),
  h4: new Set(),
  h5: new Set(),
  h6: new Set(),
  ul: new Set(),
  ol: new Set(),
  li: new Set(),
  blockquote: new Set(),
  pre: new Set(),
  code: new Set(),
  hr: new Set(),
  a: new Set(['href', 'title', 'target', 'rel']),
  span: new Set(['style']),
  div: new Set(['style']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  table: new Set(),
  thead: new Set(),
  tbody: new Set(),
  tr: new Set(),
  th: new Set(),
  td: new Set(['colspan', 'rowspan']),
  figure: new Set(),
  figcaption: new Set(),
};

/** Nội dung của thẻ này bị xoá hẳn (kể cả text bên trong). */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
]);

/** Chỉ cho phép các thuộc tính style này (màu chữ, cỡ chữ, canh, đậm/nghiêng). */
const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'text-align',
  'text-decoration',
]);

/** So khớp thẻ mở/đóng, ví dụ <p class="x">, </p>, <br/> */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>/g;
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');

/** Chỉ cho phép URL an toàn (chống javascript:/data:). */
function sanitizeUrl(raw: string): string | null {
  const url = decodeEntities(raw).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!url) return null;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // javascript:, data:, vbscript:...
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./') || url.startsWith('../')) return url;
  return null; // URL tương đối lạ -> bỏ cho chắc
}

/** Lọc giá trị thuộc tính style, chỉ giữ các thuộc tính trong allow-list. */
function sanitizeStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of decodeEntities(raw).split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    // chặn url(...) và expression(...) bên trong value
    if (/url\s*\(|expression|javascript:/i.test(value)) continue;
    if (!value) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

/** Lọc toàn bộ chuỗi thuộc tính của 1 thẻ. */
function sanitizeAttrs(tag: string, attrBlob: string): string {
  const allowed = ALLOWED_TAGS[tag];
  if (!allowed) return '';

  const out: string[] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrBlob)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (!allowed.has(name)) continue;

    if (name === 'style') {
      const style = sanitizeStyle(value);
      if (style) out.push(`style="${escapeHtml(style)}"`);
      continue;
    }

    if (name === 'href' || name === 'src') {
      const url = sanitizeUrl(value);
      if (!url) continue;
      out.push(`${name}="${escapeHtml(url)}"`);
      // link mở tab mới luôn an toàn hơn (noopener tránh tabnabbing)
      if (name === 'href') out.push('target="_blank"', 'rel="noopener noreferrer"');
      continue;
    }

    // các thuộc tính còn lại đều là số/không rủi ro -> escape rồi gắn lại
    out.push(`${name}="${escapeHtml(value)}"`);
  }
  return out.join(' ');
}

/**
 * Lọc HTML thông báo.
 * - Thẻ không nằm trong allow-list nhưng không nguy hiểm -> bỏ thẻ, giữ nội dung.
 * - Thẻ nguy hiểm (script/style/iframe...) -> bỏ cả thẻ lẫn nội dung.
 * - Thuộc tính không được phép -> bỏ.
 * @param html HTML thô do trình soạn thảo gửi lên
 * @param maxLen độ dài tối đa (chặn payload quá lớn)
 */
export function sanitizeHtml(html: unknown, maxLen = 20_000): string {
  const input = String(html ?? '');
  if (!input.trim()) return '';
  const clipped = input.length > maxLen ? input.slice(0, maxLen) : input;

  let out = '';
  /** đang bỏ nội dung của thẻ nguy hiểm */
  let dropping: string | null = null;
  let dropDepth = 0;

  TAG_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG_RE.exec(clipped)) !== null) {
    const raw = m[0];
    const tag = m[1].toLowerCase();
    const attrBlob = m[2] ?? '';
    const isClosing = raw.startsWith('</');

    // đang trong vùng bỏ -> chỉ đếm thẻ mở/đóng để thoát đúng chỗ
    if (dropping) {
      if (tag === dropping) {
        if (isClosing) {
          dropDepth -= 1;
          if (dropDepth <= 0) dropping = null;
        } else if (!raw.endsWith('/>')) {
          dropDepth += 1;
        }
      }
      continue;
    }

    // chừa lại text nằm giữa 2 thẻ
    const text = clipped.slice(last, m.index);
    if (text.trim()) out += escapeHtml(decodeEntities(text));
    last = m.index + raw.length;

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!isClosing && !raw.endsWith('/>')) {
        dropping = tag;
        dropDepth = 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS[tag]) continue; // thẻ lạ -> bỏ thẻ, giữ nội dung

    if (isClosing) {
      out += `</${tag}>`;
      continue;
    }

    const attrs = sanitizeAttrs(tag, attrBlob);
    out += attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
  }

  const tail = clipped.slice(last);
  if (tail.trim() && !dropping) out += escapeHtml(decodeEntities(tail));

  return out.trim();
}

/** Bỏ mọi thẻ, chỉ giữ text thuần dùng để tạo mô tả/đoạn trích (previews). */
export function htmlToText(html: unknown, maxLen = 200): string {
  const raw = String(html ?? '').replace(/<[^>]*>/g, ' ');
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}