import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Thứ tự: token + layout chung, rồi biểu đồ, cuối cùng là quy tắc in
// (phải sau cùng để @media print đè lên được mọi rule trước đó).
import './styles.css';
import './charts.css';
import './print.css';

const el = document.getElementById('root');
if (!el) throw new Error('Không tìm thấy phần tử #root');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
