export const permissionNames = {
  "catalog.write": "إدارة الكتالوج",
  "attributes.write": "الخصائص والفلاتر",
  "inventory.adjust": "تسوية المخزون",
  "inventory.transfer": "نقل المخزون",
  "orders.review": "قراءة الطلبات",
  "orders.reprice": "إصدار التسعيرات",
  "orders.confirm": "تأكيد الطلب",
  "orders.reject": "رفض الطلب",
  "orders.assign": "إسناد الموصل",
  "payments.verify": "مراجعة التحويلات الخاصة",
  "couriers.manage": "إدارة الموصلين",
  "commissions.settle": "تسوية وعكس العمولة",
  "cash.remit": "استلام نقد المتجر",
  "cash.reverse": "عكس توريد النقد",
  "financial-exceptions.resolve": "معالجة استثناءات المال",
  "reports.read": "قراءة التقارير",
  "promotions.write": "العروض والبنرات",
  "notifications.broadcast": "البث العام",
  "maintenance.write": "صيانة العميل",
  "releases.write": "الإصدارات",
  "staff.manage": "الموظفون والأدوار",
  "audit.read": "سجل التدقيق",
  "customer-flags.read": "تفاصيل بلاغات العميل",
  "complaints.manage": "الشكاوى والتقييمات",
  "branches.write": "المحافظات والفروع",
  "payment-methods.write": "وسائل التحويل",
} as const;
export type Permission = keyof typeof permissionNames;
export type Grant = { roleId: string; branchId: string | null };
export type Role = { id: string; name: string; permissions: Permission[] };
export type Staff = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  grants: Grant[];
};
export type Province = {
  id: string;
  name: string;
  active: boolean;
  order: number;
  catalogBranchId: string | null;
};
export type Branch = {
  id: string;
  provinceId: string;
  name: string;
  active: boolean;
  latitude: number;
  longitude: number;
  coverage: number;
  maxDistance: number;
  base: number;
  perKm: number;
  deliveryEnabled: boolean;
};
export type Attribute = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  values: { id: string; name: string; active: boolean; order: number }[];
};
export type Category = {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  order: number;
  image: string;
  attributes: {
    attributeId: string;
    required: boolean;
    filterable: boolean;
    order: number;
  }[];
};
export type Unit = {
  id: string;
  kind: "piece" | "carton";
  pieces: number;
  price: number;
  active: boolean;
  used: boolean;
};
export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  origin: string;
  categoryId: string;
  active: boolean;
  images: string[];
  values: Record<string, string>;
  units: Unit[];
  branchPrices: Record<string, Record<string, number>>;
};
export type Stock = {
  branchId: string;
  productId: string;
  onHand: number;
  reserved: number;
};
export type Movement = {
  id: string;
  branchId: string;
  productId: string;
  delta: number;
  reason: string;
  at: number;
  actor: string;
  transferId?: string;
  orderId?: string;
};
export type Line = {
  productId: string;
  unitId: string;
  name: string;
  unitName: string;
  quantity: number;
  pieces: number;
  price: number;
  sourcePrice: number;
};
export type Quote = {
  id: string;
  revision: number;
  branchId: string;
  items: Line[];
  subtotal: number;
  delivery: number;
  deliveryDiscount: number;
  productDiscount: number;
  total: number;
  pricingMode: "road" | "manual";
  distance: number | null;
  base: number;
  perKm: number;
  reason: string;
  promotionId: string | null;
  status: "sent" | "accepted" | "superseded" | "declined";
  acceptedAt?: number;
  acceptedBy?: string;
  createdAt: number;
  expiresAt: number;
};
export type Reservation = {
  id: string;
  orderId: string;
  quoteId: string;
  branchId: string;
  productId: string;
  pieces: number;
  state: "active" | "consumed" | "released" | "expired";
  kind: "timed" | "receipt_review";
  expiresAt: number | null;
  protectedAt?: number;
};
export type Receipt = {
  id: string;
  submittedAt: number;
  image: string;
  review?: {
    outcome: "image_rejected" | "transfer_verified" | "transfer_rejected";
    amount?: number;
    reason: string;
    actor: string;
    at: number;
    holdAction: "keep" | "release";
  };
};
export type Payment = {
  id: string;
  instructionId: string;
  quoteId: string;
  methodId: string;
  number: string;
  reported: number;
  instructions: {
    method: string;
    beneficiary: string;
    destination: string;
    amount: number;
  };
  attempts: Receipt[];
  approved?: number;
};
export type PaymentInstruction = {
  id: string;
  quoteId: string;
  methodId: string;
  at: number;
  snapshot: Payment["instructions"];
};
export type Assignment = {
  id: string;
  courierId: string;
  at: number;
  endedAt?: number;
  base: number;
  discount: number;
  bps: number;
  commission: number;
};
export type Order = {
  id: string;
  customerId: string;
  customer: string;
  phone: string;
  address: string;
  catalogBranchId: string;
  branchId: string | null;
  kind: "retail" | "wholesale";
  paymentKind: "transfer" | "cash";
  status:
    | "pending_review"
    | "confirmed"
    | "on_the_way"
    | "delivered"
    | "rejected"
    | "cancelled";
  version: number;
  items: Line[];
  quotes: Quote[];
  payments: Payment[];
  instructions: PaymentInstruction[];
  assignments: Assignment[];
  createdAt: number;
  confirmedAt?: number;
  deliveredAt?: number;
  flagAcknowledged: boolean;
  cancellationRequested: boolean;
  events: { at: number; text: string }[];
  revalidations: {
    quoteId: string;
    at: number;
    validUntil: number;
    reason: string;
  }[];
  deliveryIssues: {
    id: string;
    reason: string;
    at: number;
    response?: string;
    reviewedAt?: number;
    reviewedBy?: string;
  }[];
};
export type Courier = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  branchIds: string[];
  bps: number | null;
};
export type LedgerSource = {
  id: string;
  courierId: string;
  branchId: string;
  orderId: string;
  amount: number;
  at: number;
  reference: string;
};
export type Payout = {
  id: string;
  courierId: string;
  amount: number;
  sourceIds: string[];
  branchIds: string[];
  reference: string;
  reason: string;
  proof: string;
  at: number;
  actor: string;
};
export type Reversal = {
  id: string;
  payoutId: string;
  courierId: string;
  branchIds: string[];
  amount: number;
  reference: string;
  reason: string;
  proof: string;
  at: number;
  actor: string;
};
export type Exception = {
  id: string;
  orderId: string;
  kind:
    | "overpayment"
    | "underpayment"
    | "late_transfer"
    | "stock_unavailable"
    | "cash_shortfall"
    | "cash_uncollected";
  amount: number;
  reason: string;
  at: number;
  resolution?: {
    direction: "refund" | "received" | "write_off" | "other";
    amount: number;
    reason: string;
    reference: string;
    proof: string;
    actor: string;
    at: number;
  };
};
export type Method = {
  id: string;
  name: string;
  beneficiary: string;
  destination: string;
  instructions: string;
  active: boolean;
  branchId: string | null;
  order: number;
};
export type Promotion = {
  id: string;
  name: string;
  target: "products" | "delivery";
  discountKind: "fixed" | "percent";
  value: number;
  branchId: string | null;
  categoryId: string | null;
  productId: string | null;
  startsAt: number;
  endsAt: number;
  active: boolean;
};
export type Banner = {
  id: string;
  title: string;
  image: string;
  branchId: string | null;
  categoryId: string | null;
  productId: string | null;
  active: boolean;
  order: number;
  startsAt: number;
  endsAt: number;
};
export type Campaign = {
  id: string;
  title: string;
  body: string;
  branchId: string | null;
  audience: "all" | "customers" | "couriers";
  scheduledAt: number;
  status: "draft" | "scheduled_local" | "cancelled";
};
export type Complaint = {
  id: string;
  orderId: string;
  type: "complaint" | "flag" | "rating";
  text: string;
  status: "open" | "in_progress" | "resolved";
  response: string;
  rating?: number;
};
export type Release = {
  app: "customer" | "admin" | "courier";
  platform: "android" | "ios";
  environment: "staging" | "production";
  minimum: number;
  latest: number;
  version: string;
  url: string;
  message: string;
};
export type AdminState = {
  source: "fake";
  now: number;
  counter: number;
  session: string | null;
  selectedBranch: string | null;
  challenge: {
    staffId: string;
    attempts: number;
    expiresAt: number;
    resendAt: number;
  } | null;
  roles: Role[];
  staff: Staff[];
  provinces: Province[];
  branches: Branch[];
  attributes: Attribute[];
  categories: Category[];
  products: Product[];
  stock: Stock[];
  movements: Movement[];
  orders: Order[];
  reservations: Reservation[];
  couriers: Courier[];
  earnings: LedgerSource[];
  cash: LedgerSource[];
  settlements: Payout[];
  remittances: Payout[];
  commissionReversals: Reversal[];
  cashReversals: Reversal[];
  exceptions: Exception[];
  methods: Method[];
  promotions: Promotion[];
  banners: Banner[];
  campaigns: Campaign[];
  complaints: Complaint[];
  releases: Release[];
  maintenance: { enabled: boolean; message: string };
  settings: {
    holdMinutes: number;
    lateAlertMinutes: number;
    privacy: string;
    support: string;
  };
  audit: {
    id: string;
    actor: string;
    action: string;
    branchId: string | null;
    summary: string;
    at: number;
  }[];
};
export type Command =
  | { type: "login"; phone: string; password: string }
  | { type: "otp"; code: string }
  | { type: "resend" }
  | { type: "logout" }
  | { type: "clock" }
  | { type: "scope"; branchId: string | null }
  | { type: "attribute"; value: Attribute }
  | { type: "category"; value: Category }
  | { type: "product"; value: Product }
  | { type: "province"; value: Province }
  | { type: "branch"; value: Branch }
  | {
      type: "stock";
      branchId: string;
      productId: string;
      mode: "receive" | "adjust" | "count" | "transfer";
      pieces: number;
      toBranchId?: string;
      reason: string;
      confirmed: boolean;
    }
  | {
      type: "quote";
      orderId: string;
      expectedVersion: number;
      branchId: string;
      prices: number[];
      deliveryMode: "road" | "manual";
      manualDelivery: number;
      reason: string;
      confirmed: boolean;
    }
  | {
      type: "preview-accept";
      orderId: string;
      paymentKind: "transfer" | "cash";
    }
  | {
      type: "preview-instructions";
      orderId: string;
      methodId: string;
    }
  | {
      type: "preview-receipt";
      orderId: string;
      number: string;
      amount: number;
      methodId: string;
    }
  | {
      type: "receipt-review";
      orderId: string;
      outcome: "image_rejected" | "transfer_verified" | "transfer_rejected";
      amount: number;
      reason: string;
      externalChecked: boolean;
      holdAction: "keep" | "release";
      confirmed: boolean;
    }
  | { type: "revalidate"; orderId: string; reason: string; confirmed: boolean }
  | {
      type: "confirm";
      orderId: string;
      expectedVersion: number;
      flagAcknowledged: boolean;
      confirmed: boolean;
    }
  | {
      type: "close-order";
      orderId: string;
      status: "rejected" | "cancelled";
      reason: string;
      confirmed: boolean;
    }
  | {
      type: "assign";
      orderId: string;
      courierId: string;
      reason: string;
      confirmed: boolean;
    }
  | {
      type: "preview-courier";
      orderId: string;
      stage: "on_the_way" | "delivered";
      collected: number;
      reference: string;
      reason: string;
    }
  | { type: "preview-time"; minutes: number }
  | {
      type: "delivery-issue";
      orderId: string;
      reason: string;
      preview: boolean;
      confirmed: boolean;
    }
  | { type: "courier"; value: Courier; reason: string; confirmed: boolean }
  | {
      type: "payout";
      kind: "commission" | "cash";
      courierId: string;
      sourceIds: string[];
      reference: string;
      reason: string;
      proof: string;
      confirmed: boolean;
    }
  | {
      type: "reverse";
      kind: "commission" | "cash";
      payoutId: string;
      reference: string;
      reason: string;
      proof: string;
      confirmed: boolean;
    }
  | {
      type: "resolve-exception";
      id: string;
      direction: "refund" | "received" | "write_off" | "other";
      amount: number;
      reference: string;
      reason: string;
      proof: string;
      confirmed: boolean;
    }
  | { type: "method"; value: Method }
  | { type: "promotion"; value: Promotion }
  | { type: "banner"; value: Banner }
  | { type: "campaign"; value: Campaign; confirmed: boolean }
  | {
      type: "complaint";
      id: string;
      status: Complaint["status"];
      response: string;
    }
  | { type: "role"; value: Role; confirmed: boolean }
  | { type: "staff"; value: Staff; confirmed: boolean }
  | {
      type: "maintenance";
      enabled: boolean;
      message: string;
      confirmed: boolean;
    }
  | { type: "release"; value: Release; confirmed: boolean }
  | { type: "settings"; value: AdminState["settings"]; confirmed: boolean };
