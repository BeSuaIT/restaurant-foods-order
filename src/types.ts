export type UserRole = 'admin' | 'staff';

export type OrderStatus = 'draft' | 'pending' | 'confirmed' | 'served' | 'paid' | 'cancelled';

export type PaymentMethod = 'cash' | 'transfer';

export type ActorType = 'customer' | 'staff' | 'admin' | 'system';

export interface Branch {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  note: string | null;
  /** Vĩ độ (chuỗn để JS không làm tròn sai) */
  lat: string | null;
  /** Kinh độ */
  lng: string | null;
  is_active: boolean;
  created_at: string;
  /** Số bàn / số nhân viên (API quản trị) */
  table_count?: number;
  user_count?: number;
}

/** Mã giảm giá do Admin tạo */
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
  created_at: string;
}

/** Thông báo nội bộ do Admin soạn gửi cho nhân viên */
export interface Announcement {
  id: number;
  title: string;
  /** HTML đã được lọc an toàn ở server */
  content: string;
  image_url: string | null;
  is_published: boolean;
  published_at: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Thông báo + trạng thái đã đọc của người đang đăng nhập */
export interface AnnouncementWithRead extends Announcement {
  is_read: boolean;
  read_at: string | null;
}

export interface PublicUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  /** null = xem tất cả cơ sở (Admin) */
  branch_id: number | null;
  branch_name: string | null;
}

export interface SessionUser extends PublicUser {
  is_active: boolean;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: UserRole;
  full_name: string;
  branch_id: number | null;
}

/** Nhóm lựa chọn đi kèm của món (VD: "Nhân thêm", "Sốt chấm") */
export interface OptionGroup {
  id: number;
  name: string;
  description: string | null;
  is_required: boolean;
  is_multiple: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  items: OptionItem[];
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

export interface DishOptionGroupRef {
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
  option_groups?: DishOptionGroupRef[];
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
  options: OrderItemOption[];
}

export interface OrderEvent {
  id: number;
  event_type: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  actor_type: ActorType;
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
  qr_token: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  /** Chỉ có trong API quản trị / nhân viên */
  qr_url?: string;
  active_order_count?: number;
}

export interface TableSession {
  token: string;
  table_id: number;
  table_code: string;
  table_name: string;
  branch_name: string | null;
  customer_name: string;
  customer_phone: string;
  created_at: string;
}
