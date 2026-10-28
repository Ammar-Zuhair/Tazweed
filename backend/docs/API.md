# عقد REST التنفيذي — يتحول إلى OpenAPI أثناء التنفيذ
Base=/api/v1؛ JSON؛ Authorization Bearer؛ الوقت ISO8601 UTC؛ pagination cursor+limit≤100. خطأ موحد {code,message,details,requestId}. 401 غير موثق،403 غير مخول،409 تعارض نسخة/مخزون،422 إدخال،429 rate limit،503 صيانة/اعتماد خارجي. لا تفاصيل stack في الإنتاج.

| المجموعة | المسارات والوظيفة |
|---|---|
| إعداد عام | GET /public/config?app&platform&build؛ /public/governorates؛ /public/branches?governorateId |
| هوية | POST /auth/register/start و/register/verify؛ /auth/login/start و/login/verify؛ /auth/otp/resend؛ /auth/password-reset/start و/verify؛ /auth/refresh؛ /auth/logout |
| حساب | GET/PATCH /me؛ GET/POST /me/addresses؛ PATCH/DELETE /me/addresses/:id؛ POST /me/deletion-requests؛ GET /me/deletion-requests/:id |
| كتالوج | GET /catalog/categories؛ /catalog/categories/:id/filters؛ /catalog/products?governorateId&categoryId&attributeValueIds&cursor؛ /catalog/products/:id |
| إدارة كتالوج | CRUD /admin/categories و/attributes و/attributes/:id/values و/products و/products/:id/units؛ PUT /admin/categories/:id/attributes |
| جغرافيا | CRUD /admin/governorates و/branches؛ مواقع الفرع ونطاقه وتعرفة التوصيل |
| مخزون | GET /admin/inventory؛ POST /admin/inventory/receipts و/adjustments و/transfers؛ GET /admin/inventory/movements |
| تسعير وسلة | POST /checkout/quote (unitId,quantity,addressId,kind)؛ POST /orders (quoteId أو طلب جملة غير مسعر، Idempotency-Key) |
| عميل طلبات | GET /orders و/orders/:id؛ POST /orders/:id/quotes/:revision/accept أو/decline؛ POST /orders/:id/cancel؛ /orders/:id/cancellation-requests |
| تحويل | GET /orders/:id/payment-methods؛ POST /orders/:id/payments (quoteRevision,methodId,receiptNumber,amount,mediaId) |
| إدارة الطلب | GET /admin/orders؛ GET /admin/orders/:id (يشمل تنبيه بلاغات العميل)؛ POST /:id/quotes و/:id/confirm و/:id/reject و/:id/assign |
| اعتماد دفع | POST /admin/payments/:id/approve أو/reject مع expectedOrderRevision، التحويل المعتمد لا يحذف |
| موصل | GET /courier/orders و/orders/:id؛ POST /courier/orders/:id/start و/deliver؛ GET /courier/earnings?from&to؛ لا endpoint reject |
| مستحقات | GET /admin/couriers/:id/earnings؛ POST /admin/settlements؛ GET /admin/settlements |
| جودة | POST /orders/:id/review؛ POST /orders/:id/complaints؛ POST /courier/orders/:id/customer-flags؛ POST /admin/customer-flags؛ PATCH /admin/complaints/:id |
| محتوى | CRUD /admin/banners و/promotions؛ GET /home?governorateId |
| إشعارات | POST/DELETE /devices/push-tokens؛ GET /notifications؛ PATCH /notifications/:id/read؛ POST /admin/campaigns؛ POST /admin/campaigns/:id/schedule أو/cancel |
| تشغيل | PUT /admin/customer-maintenance؛ CRUD /admin/app-releases؛ CRUD /admin/staff/roles/permissions/scopes؛ GET /admin/audit |
| تقرير | POST /admin/reports/monthly-sales (month,year,branchIds)؛ GET /admin/reports/:id؛ GET /admin/reports/:id/download الخاص |
| ملفات | POST /media/uploads (purpose,mime,size) → uploadId,putUrl؛ POST /media/uploads/:id/complete؛ GET /media/:id/access |
| ويب | GET /privacy /terms /support /delete-account؛ POST /web/account-deletion/start و/verify؛ GET /health/live و/health/ready |

## توضيحات عقود إلزامية
- request quote لا يقبل أسعارًا من العميل. كل reply للعميل يحذف stock counts والتكلفة وflags والملاحظات الداخلية.
- تفاصيل order تحتوي status وreviewStage وquoteRevision وtotals وpaymentStatus وallowedActions محسوبة من الخادم؛ allowedActions لا تغني عن التحقق عند التنفيذ.
- paymentMethod snapshot يحتوي الاسم والرقم والمستفيد اللذين ظهرَا للعميل. لا تغير بيانات تحويل طلب سابق بتعديل المحفظة.
- assign يحتاج courierId وexpectedVersion؛ start/deliver لا يعملان إلا على الطلب المسند للمستخدم الحالي.
- كل mutation مالية/مخزنية يتطلب idempotency، وكل تعديل متنافس expectedVersion/If-Match.
- أنشئ OpenAPI بأمثلة نجاح/فشل واختبارات تطابق قبل الربط. هذا جدول نطاق لا ملف OpenAPI مكتمل.
