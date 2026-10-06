/* ==================================================================
 *  Kiểu dữ liệu dùng chung với backend
 * ================================================================== */

/** admin = quản trị · staff = phục vụ bàn · kitchen = phục vụ bếp */
export type UserRole = 'admin' | 'staff' | 'kitchen';

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Quản trị',
  staff: 'Phục vụ bàn',
  kitchen: 'Phục vụ bếp',
};

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'sent_kitchen'
  | 'kitchen_accepted'
  | 'ready_to_serve'
  | 'served'
  | 'paid'
  | 'cancelled';

/** Bếp thấy 2 trạng thái này (chờ nhận + đang làm). */
export const KITCHEN_STATUSES: OrderStatus[] = ['sent_kitchen', 'kitchen_accepted'];
/** Đơn chờ phục vụ bàn nhận lại từ bếp. */
export const READY_FOR_WAITER_STATUSES: OrderStatus[] = ['ready_to_serve'];
/** Đơn còn đang chạy — bàn đang phục vụ, chưa thanh toán. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'sent_kitchen',
  'kitchen_accepted',
  'ready_to_serve',
  'served',
];
export type PaymentMethod = 'cash' | 'transfer';

export interface Branch {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  note: string | null;
  /** Vĩ độ (chuỗi) */
  lat: string | null;
  /** Kinh độ (chuỗi) */
  lng: string | null;
  is_active: boolean;
  created_at?: string;
  table_count?: number;
  user_count?: number;
}

export interface DiscountCode {
  id: number;
  code: string;
  description: string | null;
  percent: number;
  /** null = không giới hạn số lần dùng */
  usage_limit: number | null;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  used_count: number;
  created_at?: string;
}

export interface StaffUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  /** null = nhìn thấy tất cả cơ sở (Admin) */
  branch_id: number | null;
  branch_name: string | null;
}

export interface OptionItem {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface DishOptionGroup {
  id: number;
  name: string;
  description: string | null;
  is_required: boolean;
  is_multiple: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  items: OptionItem[];
}

export interface Dish {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  price: number;
  is_available: boolean;
  is_active: boolean;
  sort_order: number;
  option_groups?: DishOptionGroup[];
}

export interface OrderItemOption {
  id?: number;
  group_name: string;
  option_name: string;
  price_delta: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  dish_id: number | null;
  dish_name: string;
  dish_image_url: string | null;
  unit_price: number;
  quantity: number;
  note: string | null;
  options_total: number;
  line_total: number;
  sort_order: number;
  /** null = bếp chưa tick món này */
  kitchen_done_at: string | null;
  kitchen_done_by_name: string | null;
  options: OrderItemOption[];
}

export interface OrderEvent {
  id: number;
  event_type: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  actor_type: string;
  actor_name: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface Order {
  id: number;
  order_no: string;
  table_id: number | null;
  table_code: string | null;
  table_name: string | null;
  table_area: string | null;
  /** Cơ sở của bàn (null nếu bàn chưa gán cơ sở) */
  table_branch_id?: number | null;
  table_branch_name?: string | null;
  table_branch_address?: string | null;
  table_branch_phone?: string | null;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  note: string | null;
  subtotal: number;
  discount: number;
  total: number;
  discount_code_id: number | null;
  discount_code: string | null;
  discount_percent: number;
  discount_amount: number;
  payment_method: PaymentMethod | null;
  received_by: number | null;
  received_by_name: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  /** Phục vụ bàn chuyển đơn qua bếp */
  sent_to_kitchen_at: string | null;
  sent_to_kitchen_by_name: string | null;
  /** Bếp nhận đơn */
  kitchen_received_at: string | null;
  kitchen_received_by_name: string | null;
  /** Bếp làm xong, trả lại phục vụ bàn */
  kitchen_done_at: string | null;
  kitchen_done_by_name: string | null;
  served_at: string | null;
  served_by: number | null;
  paid_at: string | null;
  paid_by: number | null;
  paid_by_name: string | null;
  started_at: string;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  events?: OrderEvent[];
}

export interface RestTable {
  id: number;
  code: string;
  name: string;
  area: string | null;
  seats: number;
  branch_id: number | null;
  branch_name: string | null;
  qr_token?: string;
  is_active: boolean;
  note: string | null;
  created_at?: string;
  qr_url?: string;
  active_order_count?: number;
}

export interface AdminUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  note: string | null;
  branch_id: number | null;
  branch_name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  received_orders: number;
  paid_orders: number;
}

export interface OptionGroupFull extends Omit<DishOptionGroup, 'items'> {
  items: OptionItem[];
  dish_count: number;
  is_active: boolean;
  created_at?: string;
}

export interface DishAdmin extends Omit<Dish, 'option_groups'> {
  option_group_ids: number[];
  created_at?: string;
}

export interface DashboardStats {
  today: { orders: number; revenue: number; items: number; cash: number };
  counts: Record<OrderStatus, number>;
  topDishes: { name: string; quantity: number; revenue: number }[];
  recentStaff: { full_name: string; received: number; paid: number }[];
}

/* Nhãn tiếng Việt cho trạng thái */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Đang chọn món',
  pending: 'Chờ nhận order',
  confirmed: 'Đã nhận order',
  sent_kitchen: 'Chờ bếp nhận',
  kitchen_accepted: 'Bếp đang làm',
  ready_to_serve: 'Bếp đã xong',
  served: 'Đã phục vụ',
  paid: 'Đã thanh toán',
  cancelled: 'Đã huỷ',
};

export const STATUS_TONE: Record<OrderStatus, string> = {
  draft: '',
  pending: 'badge-warn',
  confirmed: 'badge-info',
  sent_kitchen: 'badge-warn',
  kitchen_accepted: 'badge-info',
  ready_to_serve: 'badge-brand',
  served: 'badge-brand',
  paid: 'badge-ok',
  cancelled: 'badge-danger',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
};

/* Nhãn sự kiện trong nhật ký order */
export const EVENT_LABEL: Record<string, string> = {
  created: 'Bắt đầu phiên order',
  item_added: 'Thêm món',
  item_updated: 'Đổi số lượng',
  item_removed: 'Bỏ món',
  items_cleared: 'Xoá toàn bộ giỏ',
  note_updated: 'Cập nhật ghi chú',
  submitted: 'Khách gửi đơn',
  confirmed: 'Phục vụ bàn nhận order',
  sent_kitchen: 'Chuyển qua bếp',
  kitchen_accepted: 'Bếp nhận đơn',
  kitchen_item_done: 'Bếp tick món xong',
  kitchen_item_undone: 'Bếp bỏ tick món',
  kitchen_finished: 'Bếp làm xong, trả phục vụ bàn',
  served: 'Đã phục vụ món',
  unserved: 'Mở lại đơn',
  cancelled: 'Huỷ đơn',
  paid: 'Thanh toán',
};
