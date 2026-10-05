import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/Toast';

import { Landing } from './pages/customer/Landing';
import { Join } from './pages/customer/Join';
import { Menu } from './pages/customer/Menu';
import { OrderStatusPage } from './pages/customer/OrderStatus';

import { Login } from './pages/Login';
import { StaffOrders } from './pages/staff/StaffOrders';
import { StaffPayments } from './pages/staff/StaffPayments';
import { StaffTables } from './pages/staff/StaffTables';

import { AdminDashboard, AdminReports } from './pages/admin/AdminDashboard';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminDishes } from './pages/admin/AdminDishes';
import { AdminOptionGroups } from './pages/admin/AdminOptionGroups';
import { AdminTables } from './pages/admin/AdminTables';
import { AdminHistory } from './pages/admin/AdminHistory';
import { AdminDiscountCodes } from './pages/admin/AdminDiscountCodes';
import { AdminSettings } from './pages/admin/AdminSettings';

/** Cuộn lên đầu khi đổi trang */
function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="c-join">
      <div className="c-join-card">
        <div className="c-join-logo">🤔</div>
        <h1>Không tìm thấy trang</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          Đường dẫn bạn truy cập không tồn tại.
        </p>
        <a className="btn btn-block btn-lg" href="/">
          Về trang chủ
        </a>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ScrollTop />
        <Routes>
          {/* ============ KHÁCH HÀNG ============ */}
          <Route path="/" element={<Landing />} />
          {/* Quét mã QR trên bàn -> nhập tên + SĐT */}
          <Route path="/t/:slug" element={<Join />} />
          {/* Nhập tay mã bàn -> cũng qua bước nhập thông tin */}
          <Route path="/join/:slug" element={<Join />} />
          {/* Màn order */}
          <Route path="/menu" element={<Menu />} />
          {/* Màn chờ nhân viên xác nhận */}
          <Route path="/order/:orderNo" element={<OrderStatusPage />} />

          {/* ============ NHÂN VIÊN (Admin cũng dùng được) ============ */}
          <Route path="/staff/login" element={<Login mode="staff" />} />
          <Route path="/staff" element={<Navigate to="/staff/orders" replace />} />
          <Route path="/staff/orders" element={<StaffOrders />} />
          <Route path="/staff/payments" element={<StaffPayments />} />
          <Route path="/staff/tables" element={<StaffTables />} />

          {/* ============ ADMIN ============ */}
          <Route path="/admin/login" element={<Login mode="admin" />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/dishes" element={<AdminDishes />} />
          <Route path="/admin/option-groups" element={<AdminOptionGroups />} />
          <Route path="/admin/tables" element={<AdminTables />} />
          <Route path="/admin/discount-codes" element={<AdminDiscountCodes />} />
          <Route path="/admin/history" element={<AdminHistory />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/admin/settings" element={<AdminSettings />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
