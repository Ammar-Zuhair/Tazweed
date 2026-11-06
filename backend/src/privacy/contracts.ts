import { z } from "zod";
import { phone, deviceId } from "../identity/contracts.js";
export const app = z.enum(["customer", "admin", "courier", "web"]);
export const start = z.strictObject({
  phone,
  deviceId,
  app,
  confirm: z.literal(true),
});
export const proof = z.strictObject({
  deviceId,
  app,
  challengeId: z.uuid(),
  preauthToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^[0-9]{6}$/),
  confirm: z.literal(true),
});
export const status = z.strictObject({
  requestId: z.uuid(),
  receiptToken: z.string().regex(/^[a-f0-9]{64}$/),
});
