/** admin = quản trị · staff = phục vụ bàn · kitchen = phục vụ bếp */
export type UserRole = 'admin' | 'staff' | 'kitchen';

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Quản trị',
  staff: 'Phục vụ bàn',
  kitchen: 'Phục vụ bếp',
};

/**
 * Quy trình đơn:
 *   draft            khách đang chọn món (chưa gửi)
 *   pending          ① khách đã gửi — chờ phục vụ bàn nhận
 *   confirmed        ② phục vụ bàn đã nhận
 *   sent_kitchen     ③ phục vụ bàn chuyển qua bếp
 *   kitchen_accepted ④ bếp đã nhận (đang nấu, tick từng món)
 *   ready_to_serve   ⑥ bếp làm xong, trả lại phục vụ bàn
 *   served           ⑦ phục vụ bàn đã phục vụ khách
 *   paid             ⑧ khách thanh toán — đơn hoàn thành
 *   cancelled        đơn bị huỷ
 */
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

/** Bếp chỉ được tick món khi đơn đang ở trạng thái bếp nhận. */
export const KITCHEN_STATUSES: OrderStatus[] = ['sent_kitchen', 'kitchen_accepted'];

/** Đơn chờ phục vụ bàn nhận lại từ bếp. */
export const READY_FOR_WAITER_STATUSES: OrderStatus[] = ['ready_to_serve'];

/**
 * Đơn còn đang chạy — bàn đang phục vụ, chưa thanh toán.
 * Gồm cả các bước qua bếp, nên bàn có đơn ở bếp vẫn bị tính là "đang dùng".
 */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'sent_kitchen',
  'kitchen_accepted',
  'ready_to_serve',
  'served',
];

export type PaymentMethod = 'cash' | 'transfer';

export type ActorType = 'customer' | 'staff' | 'kitchen' | 'admin' | 'system';

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
  /** ③ phục vụ bàn chuyển đơn qua bếp */
  sent_to_kitchen_at: string | null;
  sent_to_kitchen_by_name: string | null;
  /** ④ phục vụ bếp nhận đơn */
  kitchen_received_at: string | null;
  kitchen_received_by: number | null;
  kitchen_received_by_name: string | null;
  /** ⑥ bếp làm xong món, trả lại phục vụ bàn */
  kitchen_done_at: string | null;
  kitchen_done_by: number | null;
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
