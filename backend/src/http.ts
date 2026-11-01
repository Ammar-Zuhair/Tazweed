import type { Request, Response, NextFunction } from "express";
import type { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
export const invalidAuth = () =>
  new ApiError(401, "AUTH_FAILED", "تعذر التحقق من بيانات الدخول");
export const invalidChallenge = () =>
  new ApiError(401, "CHALLENGE_INVALID", "الرمز أو التحدي غير صالح");
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "تحقق من الحقول المطلوبة",
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
      })),
    );
  return result.data;
}
export function notFound() {
  return new ApiError(404, "NOT_FOUND", "المورد غير موجود");
}
export const forbidden = () =>
  new ApiError(403, "FORBIDDEN", "لا تملك صلاحية لهذا الإجراء والنطاق");
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  let e = error instanceof ApiError ? error : null;
  if (!e && error && typeof error === "object") {
    const v = error as { type?: string; code?: string };
    if (v.type === "entity.too.large")
      e = new ApiError(413, "BODY_TOO_LARGE", "حجم الطلب أكبر من المسموح");
    else if (v.type === "entity.parse.failed")
      e = new ApiError(400, "INVALID_JSON", "صيغة JSON غير صالحة");
    else if (v.code === "23505")
      e = new ApiError(409, "CONFLICT", "تعارض مع بيانات موجودة");
    else if (v.code === "P0001" || v.code === "23514")
      e = new ApiError(
        409,
        "STATE_CONFLICT",
        "العملية تتعارض مع الحالة أو السجل المحفوظ",
      );
    else if (v.code === "23503")
      e = new ApiError(422, "INVALID_REFERENCE", "مرجع غير صالح");
  }
  if (!e) {
    const sqlState =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : null;
    res.locals.safeError?.({
      event: "request_error",
      requestId: res.locals.requestId,
      code: sqlState ?? "UNEXPECTED",
    });
    e =
      sqlState && /^(08|53|57)/.test(sqlState)
        ? new ApiError(503, "SERVICE_UNAVAILABLE", "الخدمة غير متاحة مؤقتًا")
        : new ApiError(500, "INTERNAL_ERROR", "تعذر إكمال العملية");
  }
  if (e.status === 429) res.set("Retry-After", "60");
  res.status(e.status).json({
    error: {
      code: e.code,
      message: e.message,
      details: e.details,
      requestId: res.locals.requestId,
    },
  });
}
