import { z } from "zod";
import { id, text, money } from "../catalog/contracts.js";
import { version } from "../orders/contracts.js";
import { phone, password } from "../identity/contracts.js";
export const positive = money.refine(
  (v) => /^[1-9][0-9]*$/.test(v),
  "يلزم مبلغ موجب",
);
export const reference = text.refine(
  (v) => /[\p{L}\p{N}]/u.test(v),
  "يلزم مرجع مفهوم",
);
export const assign = version.extend({ courierId: id, reason: text });
export const start = version;
export const deliver = version.extend({ cashExceptionId: id.optional() });
export const collect = version.extend({
  amountYer: positive,
  reference,
  collectedAt: z.iso.datetime({ offset: true }),
});
export const cashException = version.extend({ reason: text });
export const adjust = z.strictObject({
  amountYer: z.string().regex(/^-?[1-9][0-9]{0,11}$/),
  reason: text,
  reference,
  proofMediaId: id,
  collectedAt: z.iso.datetime({ offset: true }),
});
export const allocation = z
  .strictObject({
    courierId: id,
    sourceIds: z.array(id).max(100).default([]),
    reversalCreditIds: z.array(id).max(100).default([]),
    totalYer: positive,
    reference,
  })
  .refine(
    (v) =>
      v.sourceIds.length + v.reversalCreditIds.length > 0 &&
      new Set([...v.sourceIds, ...v.reversalCreditIds]).size ===
        v.sourceIds.length + v.reversalCreditIds.length,
    "اختر بنودًا غير مكررة",
  );
export const reverse = z.strictObject({
  reason: text,
  reference,
  proofMediaId: id,
});
export const profile = z.strictObject({
  name: text,
  phone,
  password,
  branchIds: z.array(id).min(1).max(100),
  commissionBps: z.number().int().min(0).max(10000).nullable(),
  active: z.boolean(),
});
export const configure = profile.omit({ phone: true, password: true });
export const rate = z.strictObject({
  commissionBps: z.number().int().min(0).max(10000),
});
export const branches = z.strictObject({
  branchIds: z.array(id).min(1).max(100),
});
export const flag = version.extend({
  details: text,
  kind: z.enum(["customer_flag", "delivery_problem"]).default("customer_flag"),
  attachmentId: id.optional(),
});
export const adminFlag = flag.extend({ orderId: id });
export const review = version.extend({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).default(""),
});
export const complaint = version.extend({
  details: text,
  attachmentId: id.optional(),
});
export const complaintUpdate = version.extend({
  status: z.enum(["open", "in_progress", "resolved"]),
  response: text,
});
export const flagUpdate = version.extend({
  status: z.enum(["open", "reviewed", "dismissed"]),
  note: text,
});
