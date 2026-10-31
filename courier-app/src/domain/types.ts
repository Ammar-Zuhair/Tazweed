export type Status = "confirmed" | "on_the_way" | "delivered";
export type Scenario = "ready" | "loading" | "empty" | "error" | "offline";
export type Task = {
  id: string;
  number: string;
  version: number;
  assignmentId: string;
  courierId: string;
  active: boolean;
  expiresAt: number;
  assignedAt: number;
  seen: boolean;
  branch: string;
  status: Status;
  customer: string;
  phone: string;
  address: {
    description: string;
    landmark: string;
    latitude: number;
    longitude: number;
  };
  items: {
    name: string;
    sku: string;
    unit: string;
    quantity: number;
    pieces: number;
  }[];
  total: number;
  paymentKind: "cash_on_delivery" | "transfer";
  feeBefore: number;
  discount: number;
  bps: number;
  commission: number;
  deliveredAt?: number;
  startedAt?: number;
};
export type Cash = {
  id: string;
  orderId: string;
  courierId: string;
  assignmentId: string;
  amount: number;
  reference: string;
  at: number;
};
export type CashException = {
  id: string;
  orderId: string;
  courierId: string;
  assignmentId: string;
  expected: number;
  collected: number;
  amount: number;
  kind: "cash_shortfall" | "cash_uncollected" | "overpayment";
  reason: string;
  at: number;
};
export type Report = {
  id: string;
  orderId: string;
  courierId: string;
  kind: "delivery_issue" | "customer_flag";
  reason: string;
  details: string;
  image?: string;
  status: "open" | "processing" | "resolved";
  response?: string;
  at: number;
};
export type Earning = {
  id: string;
  orderId: string;
  courierId: string;
  number: string;
  base: number;
  discount: number;
  bps: number;
  amount: number;
  at: number;
};
export type Settlement = {
  id: string;
  courierId: string;
  earningIds: string[];
  amount: number;
  reference: string;
  proof: string;
  actor: string;
  at: number;
  reversal?: { reference: string; reason: string; proof: string; at: number };
};
export type Remittance = {
  id: string;
  courierId: string;
  collectionIds: string[];
  amount: number;
  reference: string;
  proof: string;
  actor: string;
  at: number;
  reversal?: { reference: string; reason: string; proof: string; at: number };
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  orderId?: string;
  read: boolean;
  at: number;
};
export type Command = {
  key: string;
  orderId: string;
  assignmentId: string;
  expectedVersion: number;
} & (
  | { type: "start" | "deliver" }
  | { type: "collect"; amount: number; reference: string }
  | { type: "cash_exception"; reason: string }
  | {
      type: "report";
      kind: Report["kind"];
      reason: string;
      details: string;
      image?: string;
    }
);
export type ServerState = {
  tasks: Task[];
  cash: Cash[];
  exceptions: CashException[];
  reports: Report[];
  earnings: Earning[];
  settlements: Settlement[];
  remittances: Remittance[];
  notices: Notice[];
  receipts: Record<string, { payload: string; actor: string }>;
};
export type Snapshot = Omit<ServerState, "receipts"> & {
  syncedAt: number;
  validUntil: number;
  source: "fake";
};
export type Pending = {
  command: Command;
  status: "sending" | "pending_network" | "failed";
  error?: string;
};
export type Challenge = {
  phone: string;
  expiresAt: number;
  resendAt: number;
  attempts: number;
  used: boolean;
};
