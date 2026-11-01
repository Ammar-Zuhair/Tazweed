import { z } from "zod";
import { id, text, money } from "../catalog/contracts.js";
import { preview } from "../checkout/contracts.js";
export const submit = preview.extend({
  paymentKind: z.enum(["transfer", "cash_on_delivery"]),
});
export const version = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export const issue = version
  .extend({
    branchId: id,
    addressId: id.optional(),
    reason: text,
    manualDeliveryYer: money.optional(),
    carryVerifiedMoney: z.boolean().default(false),
    unitPrices: z
      .array(z.strictObject({ unitId: id, priceYer: money }))
      .max(100)
      .default([]),
  })
  .refine(
    (v) =>
      new Set(v.unitPrices.map((x) => x.unitId)).size === v.unitPrices.length,
    "وحدة مكررة",
  );
export const decision = version.extend({ quoteId: id, accept: z.boolean() });
export const paymentKind = version.extend({
  paymentKind: z.enum(["transfer", "cash_on_delivery"]),
});
export const instruction = version.extend({ methodId: id });
export const receipt = version.extend({
  instructionId: id,
  receiptNumber: z.string().trim().min(1).max(100),
  amountYer: money.refine((v) => v !== "0"),
  mediaId: id,
});
export const attempt = version.extend({ mediaId: id });
export const review = version
  .extend({
    attemptId: id,
    outcome: z.enum([
      "image_rejected",
      "transfer_verified",
      "transfer_rejected",
    ]),
    verifiedAmountYer: money.optional(),
    note: text,
    stockAction: z.enum([
      "keep_for_correction",
      "release_after_review",
      "consume_on_confirmation",
    ]),
  })
  .refine(
    (v) =>
      v.outcome === "transfer_verified"
        ? v.verifiedAmountYer !== undefined &&
          /^[1-9][0-9]*$/.test(v.verifiedAmountYer)
        : v.verifiedAmountYer === undefined,
    "يلزم مبلغ موجب للتحويل المعتمد فقط",
  )
  .refine(
    (v) =>
      v.stockAction !== "consume_on_confirmation" ||
      v.outcome === "transfer_verified",
    "الاستهلاك عند التأكيد بعد اعتماد التحويل",
  );
export const reason = version.extend({ reason: text });
export const cancelReview = version.extend({
  requestId: id,
  approve: z.boolean(),
  reason: text,
});
export const method = z.strictObject({
  branchId: id.nullable(),
  name_ar: text,
  beneficiary: text,
  destination_number: text,
  instructions_ar: z.string().max(2000),
  active: z.boolean(),
});
export const exception = version.extend({
  kind: z.enum([
    "overpayment",
    "underpayment",
    "late_transfer",
    "stock_unavailable",
    "other",
  ]),
  amountYer: money,
  reason: text,
});
export const settlement = version.extend({
  exceptionId: id,
  direction: z.enum([
    "refund_to_customer",
    "received_from_customer",
    "write_off",
    "other",
  ]),
  amountYer: money,
  reason: text,
  reference: text.refine(
    (v) => /[\p{L}\p{N}]/u.test(v),
    "يلزم مرجع يتضمن حروفًا أو أرقامًا",
  ),
  proofMediaId: id,
  occurredAt: z.iso.datetime({ offset: true }),
});
export const resolve = version.extend({ exceptionId: id, reason: text });
