export const quoteStatuses = {
  sent: "مرسلة",
  accepted: "مقبولة",
  superseded: "نسخة سابقة",
  declined: "مرفوضة من العميل",
} as const;
export const receiptOutcomes = {
  image_rejected: "رفض الصورة للتصحيح",
  transfer_verified: "تحويل متحقق خارجيًا",
  transfer_rejected: "تحويل مرفوض بعد التحقق",
} as const;
export const holdStates = {
  active: "نشط",
  consumed: "مصروف",
  released: "محرر بقرار",
  expired: "منتهٍ",
} as const;
export const exceptionNames = {
  overpayment: "مبلغ زائد",
  underpayment: "تحويل ناقص",
  late_transfer: "تحويل متأخر",
  stock_unavailable: "تعذر المخزون بعد التحويل",
  cash_shortfall: "نقص تحصيل النقد",
  cash_uncollected: "نقد غير محصل",
} as const;
export const stockModes = {
  receive: "إدخال",
  adjust: "تسوية",
  count: "جرد",
  transfer: "نقل",
} as const;
