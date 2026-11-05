import { z } from "zod";
export const id = z.uuid(),
  app = z.enum(["customer", "admin", "courier"]),
  platform = z.enum(["android", "ios"]);
export const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: id.optional(),
  })
  .strict();
export const version = z.number().int().positive();
export const token = z
  .object({
    token: z
      .string()
      .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/),
    projectId: id,
    platform,
    soundEnabled: z.boolean(),
  })
  .strict();
export const maintenance = z
  .object({
    enabled: z.boolean(),
    message: z.string().trim().min(1).max(500),
    expectedVersion: version,
  })
  .strict();
export const publicConfig = z
  .object({
    app,
    platform,
    build: z.coerce.number().int().min(0).max(2147483647),
  })
  .strict();
export const release = z
  .object({
    app,
    platform,
    minimumBuild: z.number().int().positive().max(2147483647),
    latestBuild: z.number().int().positive().max(2147483647),
    latestVersion: z.string().trim().min(1).max(40),
    storeUrl: z.url().max(500),
    message: z.string().trim().max(500),
    binaryConfirmed: z.literal(true),
    expectedVersion: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.latestBuild >= v.minimumBuild);
export const audience = z
  .object({
    kind: z.enum(["all", "customers", "couriers"]),
    branchId: id.nullable().default(null),
  })
  .strict();
export const campaign = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(500),
    audience,
  })
  .strict();
export const schedule = z
  .object({
    expectedVersion: version,
    scheduledAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const cancel = z.object({ expectedVersion: version }).strict();
