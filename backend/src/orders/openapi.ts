import { z } from "zod";
import * as c from "./contracts.js";
const row = z.object({ id: z.uuid() }).loose();
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/),
  time = z.iso.datetime();
const quote = row.extend({
  revision: z.number().int().positive(),
  branch_id: z.uuid(),
  status: z.enum([
    "draft",
    "sent",
    "accepted",
    "declined",
    "superseded",
    "expired",
  ]),
  subtotal_yer: amount,
  product_discount_yer: amount,
  delivery_yer: amount,
  delivery_discount_yer: amount,
  total_yer: amount,
  expires_at: time,
  accepted_at: time.nullable(),
  items: z.array(
    row.extend({
      unit_id: z.uuid(),
      quantity: z.number().int().positive(),
      pieces_per_unit: z.number().int().positive(),
      unit_price_yer: amount,
      line_total_yer: amount,
      unit_snapshot: z.string(),
      name_snapshot: z.string(),
      attributes_snapshot: z.array(
        z.object({ attribute: z.string(), value: z.string() }),
      ),
    }),
  ),
});
const payment = row.extend({
  quote_id: z.uuid(),
  instruction_id: z.uuid(),
  receipt_number: z.string(),
  amount_yer: amount,
  approved_amount_yer: amount.nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  attempts: z.array(
    row.extend({
      attempt_number: z.number().int().positive(),
      media_id: z.uuid(),
      submitted_at: time,
      outcome: z
        .enum(["image_rejected", "transfer_verified", "transfer_rejected"])
        .nullable(),
      verified_amount_yer: amount.nullable(),
      note: z.string().nullable(),
    }),
  ),
});
const instructions = row.extend({
  quote_id: z.uuid(),
  revision: z.number().int().positive(),
  expected_amount_yer: amount,
  method_snapshot: z
    .object({
      name_ar: z.string(),
      beneficiary: z.string(),
      destination_number: z.string(),
      instructions_ar: z.string().nullable(),
    })
    .loose(),
});
const hold = row.extend({
  quote_id: z.uuid(),
  branch_id: z.uuid(),
  product_id: z.uuid(),
  pieces: amount,
  state: z.enum(["active", "consumed", "released", "expired"]),
  hold_kind: z.enum(["timed", "receipt_review"]),
  expires_at: time.nullable(),
  protected_at: time.nullable(),
  overdue: z.boolean(),
});
const financial = row.extend({
  kind: z.string(),
  amount_yer: amount,
  reason: z.string(),
  status: z.enum(["open", "resolved"]),
  resolutions: z.array(
    row.extend({
      direction: z.enum([
        "refund_to_customer",
        "received_from_customer",
        "write_off",
        "other",
      ]),
      amount_yer: amount,
      reason: z.string(),
      reference: z.string(),
      occurred_at: time,
    }),
  ),
});
const operation = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  quoteId: z.uuid().optional(),
  paymentId: z.uuid().optional(),
  instructionId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  exceptionId: z.uuid().optional(),
});
const list = z.object({
  items: z.array(row),
  nextCursor: z.uuid().nullable(),
  source: z.literal("backend"),
});
const detail = z
  .object({
    source: z.literal("backend"),
    order: row.extend({
      order_number: amount,
      version: z.number().int().positive(),
      status: z.enum([
        "pending_review",
        "confirmed",
        "on_the_way",
        "delivered",
        "rejected",
        "cancelled",
      ]),
      review_stage: z.string(),
      current_quote_id: z.uuid().nullable(),
      branch_id: z.uuid().nullable(),
      catalog_branch_id: z.uuid(),
      kind: z.enum(["retail", "wholesale"]),
      payment_kind: z.enum(["transfer", "cash_on_delivery"]).nullable(),
    }),
    catalogBranchId: z.uuid(),
    executionBranchId: z.uuid().nullable(),
    quoteRevision: z.number().int().positive().nullable(),
    paymentKind: z.enum(["transfer", "cash_on_delivery"]).nullable(),
    quoteValidity: z.enum(["none", "valid", "protected", "expired"]),
    paymentStatus: z.string(),
    allowedActions: z.array(z.string()),
    availableAddresses: z.array(
      row.extend({ label: z.string(), description: z.string().nullable() }),
    ),
    privateDetails: z.object({
      address_snapshot: z.record(z.string(), z.unknown()),
      contact_snapshot: z.record(z.string(), z.unknown()),
      redacted_at: z.string().nullable(),
    }),
    requestedItems: z.array(
      z
        .object({ unit_id: z.uuid(), quantity: z.number().int().positive() })
        .loose(),
    ),
    quotes: z.array(quote),
    payments: z.array(payment),
    instructions: z.array(instructions),
    holds: z.array(hold),
    exceptions: z.array(financial),
    openExceptions: z.number().int(),
    cancellations: z.array(row),
    events: z.array(
      z.object({ event_type: z.string(), created_at: z.string() }),
    ),
    hasCustomerFlag: z.boolean(),
    flags: z.array(row),
    cashCollected: z.boolean(),
    cashNotice: z.string().nullable(),
  })
  .loose();
export function addOrdersOpenapi(doc: any) {
  function add(
    method: string,
    path: string,
    body?: z.ZodType,
    response: z.ZodType = operation,
  ) {
    const parameters: any[] = [
      {
        in: "header",
        name: "X-Client-App",
        required: true,
        schema: {
          type: "string",
          enum: [path.startsWith("/admin") ? "admin" : "customer"],
        },
      },
    ];
    for (const match of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: "path",
        name: match[1],
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (method === "get" && (path === "/orders" || path === "/admin/orders"))
      parameters.push(
        {
          in: "query",
          name: "cursor",
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
      );
    if (method === "post" && !path.includes("payment-methods"))
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,100}$" },
      });
    const json = (schema: z.ZodType) =>
      z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    const error = {
      description: "Rejected; no partial operation committed",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      },
    };
    doc.paths["/api/v1" + path] ??= {};
    doc.paths["/api/v1" + path][method] = {
      summary: "Phase08 " + method + " " + path,
      security: [{ bearerAuth: [] }],
      parameters,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(body) } },
            },
          }
        : {}),
      responses: {
        200: {
          description: "Backend authoritative result",
          content: { "application/json": { schema: json(response) } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map((code) => [
            code,
            error,
          ]),
        ),
      },
    };
  }
  add("post", "/orders", c.submit);
  for (const prefix of ["/orders", "/admin/orders"]) {
    add("get", prefix, undefined, list);
    add("get", prefix + "/{id}", undefined, detail);
  }
  for (const [path, schema] of [
    ["decision", c.decision],
    ["payment-kind", c.paymentKind],
    ["instructions", c.instruction],
    ["cancel", c.reason],
    ["receipts", c.receipt],
  ] as const)
    add("post", "/orders/{id}/" + path, schema);
  add(
    "get",
    "/orders/{id}/payment-methods",
    undefined,
    z.object({ items: z.array(row) }),
  );
  add("post", "/orders/{id}/payments/{paymentId}/images", c.attempt);
  for (const [path, schema] of [
    ["quotes", c.issue],
    ["confirm", c.version],
    ["reject", c.reason],
    ["cancel-review", c.cancelReview],
    ["exceptions", c.exception],
    ["settlements", c.settlement],
    ["resolve", c.resolve],
  ] as const)
    add("post", "/admin/orders/{id}/" + path, schema);
  add("post", "/admin/orders/{id}/payments/{paymentId}/review", c.review);
  add(
    "get",
    "/admin/payment-methods",
    undefined,
    z.object({ items: z.array(row) }),
  );
  add("post", "/admin/payment-methods", c.method, row);
  add("put", "/admin/payment-methods/{id}", c.method, row);
  doc.info.version = "0.8.0";
  doc.info.title = "Tazweed Phase08 orders and manual payments";
  doc.info.description =
    "PostgreSQL-authoritative order revisions, customer acceptance, atomic branch/stock holds, manual transfer receipt attempts/reviews, COD confirmation and documented external resolutions. Dispatch/cash collection/commission writes remain deferred to09. Real OTP/R2/Routing tests await the owner.";
  return doc;
}
