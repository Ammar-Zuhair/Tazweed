import { Router } from "express";
import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  authenticate,
  requirePermission,
  requestContext,
} from "../identity/access.js";
import { parse, ApiError, notFound } from "../http.js";
import { policy, policySections, termsSections } from "./policy.js";
import { DeletionService, deletionDto } from "./service.js";
import * as c from "./contracts.js";
import { escapeHtml } from "../reports/service.js";
export function privacyRouter(s: DeletionService) {
  const r = Router(),
    ctx = (req: any, res: any) => requestContext(req, res.locals.requestId);
  r.get("/api/v1/public/legal", (_req, res) =>
    res.json({
      policy: policy(s.config),
      privacy: policySections(s.config),
      terms: termsSections,
    }),
  );
  r.use(
    "/assets/legal",
    express.static(
      fileURLToPath(new URL("../../public/legal", import.meta.url)),
      { fallthrough: false },
    ),
  );
  r.get("/assets/tajawal.ttf", (_req, res) =>
    res.sendFile(
      fileURLToPath(
        new URL("../../public/Tajawal-Medium.ttf", import.meta.url),
      ),
    ),
  );
  for (const path of ["/privacy", "/terms", "/support", "/delete-account"])
    r.get(path, (_req, res) => {
      const title = (
          {
            "/privacy": "الخصوصية",
            "/terms": "شروط الاستخدام",
            "/support": "الدعم",
            "/delete-account": "حذف الحساب",
          } as any
        )[path],
        p = policy(s.config);
      const sections =
        path === "/privacy"
          ? policySections(s.config)
          : path === "/terms"
            ? termsSections
            : [
                {
                  title:
                    path === "/support"
                      ? "التواصل مع تزويد"
                      : "طلب حذف حساب تزويد",
                  body:
                    path === "/support"
                      ? `الدعم: ${p.supportPhone || "لم يهيأ رقم الدعم"} · البريد: ${p.email || "لم يهيأ بريد الخصوصية"}. لا إرسال أو اتصال تلقائي. يمكن تقديم الحذف أدناه دون تطبيق.`
                      : "أدخل الرقم المسجل ثم الرمز الذي يصلك لتأكيد حذف الحساب. يبطل التحقق جلساتك؛ تبقى متابعة الطلبات الجارية بتسجيل دخول جديد حتى إغلاق الالتزامات. بعد الحذف لا يمكن استعادة الحساب. لا يلزم الاتصال بالدعم لبدء الطلب.",
                },
              ];
      const form =
        path === "/delete-account"
          ? `<form id="deletion"><label>رقم الجوال<input id="phone" type="tel" autocomplete="tel" required maxlength="32" dir="ltr"></label><label>نوع الحساب<select id="account"><option value="web">حساب تزويد</option></select></label><label><input id="confirm" type="checkbox" required>أطلب حذف الحساب وبياناته وفق سياسة الاحتفاظ.</label><button id="start">إرسال رمز الحذف</button></form><form id="verification" hidden><label>رمز التحقق<input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required dir="ltr"></label><button>تأكيد حذف الحساب</button><button type="button" id="again">إرسال رمز جديد بعد انتهاء الانتظار</button></form><p id="message" role="status" aria-live="polite"></p><section id="receipt" hidden><h2>متابعة الطلب</h2><p>احفظ رقم المتابعة والمفتاح السري؛ لا تشارك المفتاح.</p><label>رقم المتابعة<input id="requestId" dir="ltr"></label><label>مفتاح المتابعة السري<input id="receiptToken" type="password" dir="ltr" autocomplete="off"></label><button id="status">تحديث الحالة</button></section><button id="recover">لدي رقم متابعة ومفتاح سري</button><script src="/assets/legal/deletion.js" defer></script>`
          : "";
      res
        .type("html")
        .send(
          `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — تزويد</title><link rel="stylesheet" href="/assets/legal/style.css"><body><header><a href="/privacy">تزويد</a><nav><a href="/privacy">الخصوصية</a><a href="/terms">الشروط</a><a href="/support">الدعم</a><a href="/delete-account">حذف الحساب</a></nav></header><main><h1>${title}</h1>${!p.approved ? '<p class="notice">إعدادات السياسة وبيانات المالك غير مكتملة. هذه بيئة مراجعة؛ لا موعد قانوني أو حذف مكتمل مفترض.</p>' : ""}${sections.map((x) => `<section><h2>${escapeHtml(x.title)}</h2><p>${escapeHtml(x.body)}</p></section>`).join("")}${form}</main></body></html>`,
        );
    });
  // No cookies, login redirect or app install. Only JSON + browser custom header; same-origin script.
  const web = (req: any, _res: any, next: any) => {
    if (!req.is("application/json") || req.get("X-Deletion-Flow") !== "1")
      throw new ApiError(403, "WEB_FLOW_REQUIRED", "استخدم نموذج الحذف الموثق");
    next();
  };
  r.post("/web/account-deletion/start", web, async (req, res) => {
    const v = parse(c.start, req.body);
    if (v.app !== "web")
      throw new ApiError(422, "INVALID_APP", "نوع الحساب غير صالح");
    res.status(202).json(await s.start(v, ctx(req, res)));
  });
  r.post("/web/account-deletion/verify", web, async (req, res) => {
    const v = parse(c.proof, req.body);
    if (v.app !== "web")
      throw new ApiError(422, "INVALID_APP", "نوع الحساب غير صالح");
    res.json(await s.verify(v, ctx(req, res)));
  });
  r.post("/web/account-deletion/status", web, async (req, res) => {
    const v = parse(c.status, req.body);
    res.json(await s.status(v.requestId, v.receiptToken));
  });
  r.post("/api/v1/account-deletion/verify", async (req, res) =>
    res.json(await s.verify(parse(c.proof, req.body), ctx(req, res))),
  );
  r.post("/api/v1/account-deletion/status", async (req, res) => {
    const v = parse(c.status, req.body);
    res.json(await s.status(v.requestId, v.receiptToken));
  });
  // API copy for native transport and same-origin Expo proxy; X-Client-App and bearer remain mandatory.
  r.use(
    "/api/v1/me/deletion-requests",
    authenticate(s.auth.pool, s.auth.security),
  );
  r.post("/api/v1/me/deletion-requests/start", async (req, res) => {
    const v = parse(c.start, req.body),
      i = res.locals.identity;
    if (v.app !== i.app)
      throw new ApiError(422, "INVALID_APP", "نوع التطبيق لا يطابق الجلسة");
    res.status(202).json(await s.start(v, ctx(req, res), i));
  });
  r.post("/api/v1/me/deletion-requests", async (req, res) => {
    const v = parse(c.proof, req.body),
      i = res.locals.identity;
    if (v.app !== i.app)
      throw new ApiError(422, "INVALID_APP", "نوع التطبيق لا يطابق الجلسة");
    res.json(await s.verify(v, ctx(req, res), i));
  });
  r.get("/api/v1/me/deletion-requests/:id", async (req, res) => {
    const id = parse(z.uuid(), req.params.id),
      row = (
        await s.auth.pool.query(
          "SELECT * FROM deletion_requests WHERE id=$1 AND user_id=$2",
          [id, res.locals.identity.id],
        )
      ).rows[0];
    if (!row) throw notFound();
    res.json(deletionDto(row));
  });
  r.use(
    "/api/v1/admin/deletion-requests",
    authenticate(s.auth.pool, s.auth.security),
  );
  r.get("/api/v1/admin/deletion-requests", async (_req, res) => {
    await requirePermission(
      s.auth.pool,
      res.locals.identity,
      "privacy.manage",
      null,
    );
    res.json({
      items: (
        await s.auth.pool.query(
          "SELECT * FROM deletion_requests ORDER BY created_at DESC LIMIT 100",
        )
      ).rows.map((x) => ({
        ...deletionDto(x),
        userId: x.user_id,
        reviewCode: x.review_code,
      })),
    });
  });
  r.post("/api/v1/admin/deletion-requests/:id/process", async (req, res) => {
    await requirePermission(
      s.auth.pool,
      res.locals.identity,
      "privacy.manage",
      null,
    );
    parse(z.strictObject({}), req.body);
    const id = parse(z.uuid(), req.params.id);
    res.json({ processed: await s.processOne(id, res.locals.identity) });
  });
  return r;
}
