/** Local preview contracts. Never treat these fixtures as server-authorized facts. */
export type CategoryId = 'oils' | 'batteries' | 'tires' | 'solar' | 'filters' | 'patches';
export type UnitKind = 'piece' | 'carton';
export type OrderKind = 'retail' | 'wholesale';
export type OrderStatus = 'pending_review' | 'confirmed' | 'on_the_way' | 'delivered' | 'rejected' | 'cancelled';
export type PaymentKind = 'transfer' | 'cash_on_delivery';
export type PreviewScenario = 'normal' | 'loading' | 'empty' | 'error' | 'offline';
export type Gate = 'normal' | 'maintenance' | 'optional-update' | 'required-update';
export type Attribute = { id: string; label: string; values: { id: string; label: string }[] };
export type Category = { id: CategoryId; name: string; icon: string; subtitle: string; filters: Attribute[] };
export type Product = {
  id: string; sku: string; name: string; categoryId: CategoryId; brand: string; origin: string;
  description: string; attributes: Record<string, string>; piecesPerCarton: number | null;
  prices: Record<string, { piece: number; carton: number | null; available: boolean }>;
  color: string; featured: boolean;
};
export type Governorate = { id: string; name: string; catalogBranch: { id: string; name: string } | null; center: { latitude: number; longitude: number } };
export type CartLine = { productId: string; unit: UnitKind; quantity: number };
export type Address = { id: string; label: string; governorateId: string; latitude: number; longitude: number; description: string; landmark: string; accuracy: number | null; source: 'demo-pin' | 'demo-location' };
export type OrderLine = CartLine & { name: string; piecesPerUnit: number; unitPrice: number };
export type Quote = {
  revision: number; branchId: string; branchName: string; lines: OrderLine[]; subtotal: number;
  pricingMode: 'road' | 'manual'; distanceM: number | null; billedKm: number | null; baseFee: number; perKmFee: number;
  deliveryBeforeDiscount: number; productDiscount: number; deliveryDiscount: number; total: number;
  promotionId: string | null; promotionName: string | null; reason: string;
  createdAt: number; expiresAt: number; acceptedAt: number | null; declinedAt: number | null;
};
export type PaymentInstruction = { id: string; quoteRevision: number; destination: string; beneficiary: string; method: string; expectedAmount: number };
export type Payment = {
  id: string; instruction: PaymentInstruction;
  receiptNumber: string; reportedAmount: number;
  attempts: { id: string; imageUri: string; at: number; rejectedReason: string | null }[];
  status: 'checking_receipt' | 'image_rejected' | 'verified_transfer' | 'amount_mismatch';
};
export type Order = {
  id: string; governorateId: string; catalogBranchId: string; catalogBranchName: string; kind: OrderKind;
  lines: OrderLine[]; address: Address; status: OrderStatus; stage: 'awaiting_branch' | 'awaiting_quote' | 'awaiting_acceptance' | 'awaiting_payment' | 'checking_receipt' | 'awaiting_confirmation';
  quotes: Quote[]; instructions: PaymentInstruction[]; revalidatedUntil: number | null; previewExpired: boolean; currentRevision: number | null; paymentKind: PaymentKind | null; payment: Payment | null;
  hold: 'none' | 'timed' | 'receipt_review' | 'consumed'; cancellationRequested: boolean;
  paymentStatus: 'not_selected' | 'awaiting_transfer' | 'checking_receipt' | 'verified_transfer' | 'awaiting_cash_collection' | 'collected' | 'financial_review';
  createdAt: number; events: { label: string; at: number }[]; rejectionReason: string | null;
  rating: { stars: number; comment: string } | null;
};
export type Notice = { id: string; title: string; body: string; orderId: string | null; read: boolean };
export type Complaint = { id: string; orderId: string; text: string; imageUri: string | null; status: 'new' | 'in_progress' | 'resolved' };
export type OtpChallenge = { purpose: 'login' | 'register' | 'reset' | 'delete'; phone: string; name: string; attempts: number; issuedAt: number; resendAt: number; expiresAt: number };
export type CustomerState = {
  governorateId: string | null; profile: { name: string; phone: string } | null;
  cart: CartLine[]; kind: OrderKind; addresses: Address[]; orders: Order[]; notifications: Notice[]; complaints: Complaint[];
  gate: Gate; updateDismissed: boolean; scenario: PreviewScenario; otp: OtpChallenge | null; resetVerified: boolean;
  deletionRequest: { id: string; status: 'received'; at: number } | null; nextId: number;
};
