import { z } from "zod";
const ascii = (value: string) =>
  value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
export const phone = z
  .string()
  .max(32)
  .transform((s) => ascii(s).replace(/[ ()-]/g, ""))
  .transform((s) =>
    s.startsWith("00967")
      ? "+" + s.slice(2)
      : s.startsWith("+967")
        ? s
        : "+967" + s,
  )
  .pipe(z.string().regex(/^\+9677[01378][0-9]{7}$/, "رقم جوال يمني غير صالح"));
export const password = z
  .string()
  .min(12)
  .max(128)
  .refine((s) => Buffer.byteLength(s, "utf8") <= 512);
export const name = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export const app = z.enum(["customer", "admin", "courier"]);
export type App = z.infer<typeof app>;
export const deviceId = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const base = { app, deviceId };
export const registerStart = z.strictObject({
  ...base,
  app: z.literal("customer"),
  phone,
  password,
  name,
});
export const loginStart = z.strictObject({ ...base, phone, password });
export const resetStart = z.strictObject({ ...base, phone });
export const proof = z.strictObject({
  ...base,
  challengeId: z.uuid(),
  preauthToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^[0-9]{6}$/),
});
export const resend = proof.omit({ code: true });
export const resetVerify = proof.extend({ newPassword: password });
export const refresh = z.strictObject({
  ...base,
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const profile = z.strictObject({ name });
export const address = z.strictObject({
  governorateId: z.uuid(),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().default(false),
});
export const addressPatch = address
  .omit({ isDefault: true })
  .partial()
  .extend({ isDefault: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const role = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/),
  name,
  permissions: z
    .array(z.string().min(1).max(70))
    .min(1)
    .max(100)
    .refine((a) => new Set(a).size === a.length),
});
export const staff = z.strictObject({
  phone,
  password,
  name,
  kind: z.enum(["staff", "courier"]),
});
export const grant = z.strictObject({
  roleId: z.uuid(),
  branchId: z.uuid().nullable(),
});
export const status = z.strictObject({
  status: z.enum(["active", "disabled"]),
});
export const uuid = z.uuid();
export const branchQuery = z.strictObject({
  branchId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
