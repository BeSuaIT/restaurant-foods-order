import { useEffect, useRef, useState } from 'react';

/* ================================================================== *
 *  SOẠN THẢO NỘI DUNG THÔNG BÁO
 *
 *  Dùng contenteditable + document.execCommand: gọn, không cần thêm thư viện
 *  soạn thảo nặng (khoảng 300kb) và giữ đúng nhu cầu "trình bày như bài viết
 *  với các định dạng cơ bản".
 *
 *  HTML do editor sinh ra được server lọc lại theo allow-list trước khi lưu
 *  (xem src/sanitize.ts), nên phía đọc render bằng dangerouslySetInnerHTML an toàn.
 * ================================================================== */

interface ToolbarBtn {
  cmd: string;
  label: string;
  title: string;
  /** Tham số cho formatBlock (VD: '<h3>') */
  arg?: string;
  /** Nút đổi khối văn bản, không áp dụng khi đang bôi đen chữ */
  block?: boolean;
}

const TOOLS: ToolbarBtn[] = [
  { cmd: 'bold', label: 'B', title: 'In đậm' },
  { cmd: 'italic', label: 'I', title: 'In nghiêng' },
  { cmd: 'underline', label: 'U', title: 'Gạch chân' },
  { cmd: 'formatBlock', label: 'H', title: 'Tiêu đề nhỏ', block: true, arg: '<h3>' },
  { cmd: 'formatBlock', label: '¶', title: 'Đoạn văn bản', block: true, arg: '<p>' },
  { cmd: 'insertUnorderedList', label: '•—', title: 'Danh sách nét' },
  { cmd: 'insertOrderedList', label: '1—', title: 'Danh sách đánh số' },
  { cmd: 'formatBlock', label: '❝', title: 'Trích dẫn', block: true, arg: '<blockquote>' },
  { cmd: 'removeFormat', label: '⌫', title: 'Xoá định dạng' },
];

interface EditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /**
   * id của <label> hiển thị phía trên. Truyền vào thì vùng soạn dùng
   * aria-labelledby trỏ tới nhãn đó, thay cho aria-label viết cứng — nhờ vậy
   * trình đọc màn hình đọc đúng chữ nhãn người dùng thấy.
   */
  labelId?: string;
}

export function RichEditor({ value, onChange, placeholder, minHeight = 200, labelId }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Nạp giá trị ban đầu / khi đổi từ API mà không phá vỡ con trỏ soạn thảo.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!focused && el.innerHTML !== value) el.innerHTML = value;
  }, [value, focused]);

  const exec = (tool: ToolbarBtn) => {
    // Giữ con trỏ trong vùng soạn thảo khi bấm nút (mousedown sẽ blur nên chặn mặc định)
    ref.current?.focus();
    if (tool.cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, tool.arg ?? '<p>');
    } else {
      document.execCommand(tool.cmd, false);
    }
    onChange(ref.current?.innerHTML ?? '');
  };

  const insertLink = () => {
    const url = window.prompt('Nhập đường dẫn (https://...):', 'https://');
    if (!url) return;
    ref.current?.focus();
    document.execCommand('createLink', false, url);
    onChange(ref.current?.innerHTML ?? '');
  };

  return (
    <div className="rt">
      <div className="rt-toolbar no-print">
        {TOOLS.map((t) => (
          <button
            key={t.title}
            type="button"
            className="rt-btn"
            title={t.title}
            // eslint-disable-next-line react/no-mouse-event
            onMouseDown={(e) => {
              e.preventDefault();
              exec(t);
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="rt-btn"
          title="Chèn liên kết"
          onMouseDown={(e) => {
            e.preventDefault();
            insertLink();
          }}
        >
          🔗
        </button>
        <span className="rt-hint grow">Định dạng: in đậm, in nghiêng, gạch chân, tiêu đề, danh sách, trích dẫn, liên kết</span>
      </div>

      <div
        ref={ref}
        className={`rt-area ${focused ? 'focus' : ''}`}
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={labelId ? undefined : 'Nội dung thông báo'}
        aria-labelledby={labelId}
        data-placeholder={placeholder ?? 'Nhập nội dung thông báo...'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Hiển thị nội dung đã lọc
 * ------------------------------------------------------------------ */

export function RichView({ html, className = '' }: { html: string; className?: string }) {
  return (
    <div
      className={`rt-view ${className}`}
      // HTML đã được server lọc allow-list thẻ/thuộc tính (src/sanitize.ts)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}