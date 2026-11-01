import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Fixture } from "../phase05/helpers.js";
export async function seed(f: Fixture, withLogins = true) {
  await f.owner.query("SET statement_timeout=180000");
  await f.owner.query(
    "TRUNCATE users,governorates,categories,promotions,outbox_events CASCADE",
  );
  await f.owner.query("DELETE FROM auth_rate_buckets");
  await f.owner.query("UPDATE customer_maintenance SET enabled=false");
  const customer = await f.user("770008001"),
    staff = await f.user("770008002", "staff");
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) SELECT $1,id,true FROM roles WHERE code='general_admin'",
    [staff.id],
  );
  let token = withLogins ? (await f.login(customer)).accessToken : "",
    admin = withLogins ? (await f.login(staff, "admin")).accessToken : "";
  const g = randomUUID(),
    b = randomUUID(),
    b2 = randomUUID(),
    cat = randomUUID(),
    product = randomUUID(),
    piece = randomUUID(),
    carton = randomUUID(),
    address = randomUUID(),
    method = randomUUID();
  await f.owner.query(
    "INSERT INTO governorates(id,name_ar) VALUES($1,'محافظة اختبار08')",
    [g],
  );
  await f.owner.query(
    "INSERT INTO branches(id,governorate_id,name_ar,latitude,longitude,coverage_radius_m,delivery_enabled) VALUES($1,$2,'فرع أول',15,44,20000,false),($3,$2,'فرع ثان',15,44,20000,false)",
    [b, g, b2],
  );
  await f.owner.query(
    "UPDATE governorates SET catalog_branch_id=$2 WHERE id=$1",
    [g, b],
  );
  await f.owner.query(
    "INSERT INTO delivery_rules(branch_id,base_yer,per_km_yer,max_distance_m) VALUES($1,300,50,20000),($2,300,50,20000)",
    [b, b2],
  );
  await f.owner.query("UPDATE branches SET delivery_enabled=true");
  await f.owner.query(
    "INSERT INTO categories(id,name_ar) VALUES($1,'قسم اختبار08')",
    [cat],
  );
  await f.owner.query(
    "INSERT INTO products(id,category_id,sku,name_ar) VALUES($1,$2,'TEST08','زيت اختبار08')",
    [product, cat],
  );
  await f.owner.query(
    "INSERT INTO product_units(id,product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,$2,'piece',1,100),($3,$2,'carton',12,1000)",
    [piece, product, carton],
  );
  for (const branch of [b, b2]) {
    await f.owner.query(
      "INSERT INTO stock_levels(branch_id,product_id,on_hand) VALUES($1,$2,100)",
      [branch, product],
    );
    await f.owner.query(
      "INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,actor_id,note) VALUES($1,$2,100,'receipt',$3,'تهيئة اختبار معزول')",
      [branch, product, staff.id],
    );
  }
  await f.owner.query(
    "INSERT INTO addresses(id,user_id,governorate_id,label,latitude,longitude) VALUES($1,$2,$3,'منزل اختبار08',15.01,44.01)",
    [address, customer.id, g],
  );
  await f.owner.query(
    "INSERT INTO payment_methods(id,name_ar,beneficiary,destination_number,instructions_ar) VALUES($1,'جهة اختبار غير قابلة للدفع','مستفيد اختبار','TEST-08-NOT-PAYABLE','تعليمات اختبار')",
    [method],
  );
  const post = (
    path: string,
    body: any,
    asAdmin = false,
    key = randomUUID(),
    asToken?: string,
  ) =>
    f.request(
      "POST",
      "/api/v1" + path,
      body,
      asToken ?? (asAdmin ? admin : token),
      asAdmin ? "admin" : "customer",
      { "Idempotency-Key": key },
    );
  const get = async (id: string, asAdmin = false) => {
    const r = await f.request(
      "GET",
      `/api/v1/${asAdmin ? "admin/" : ""}orders/${id}`,
      undefined,
      asAdmin ? admin : token,
      asAdmin ? "admin" : "customer",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const submit = async (
    kind = "retail",
    paymentKind = "cash_on_delivery",
    quantity = 1,
  ) => {
    const r = await post("/orders", {
      governorateId: g,
      addressId: address,
      kind,
      paymentKind,
      items: [{ unitId: piece, quantity }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.id;
  };
  const quote = async (id: string, branchId = b, extra: any = {}) => {
    const d = await get(id);
    const r = await post(
      `/admin/orders/${id}/quotes`,
      {
        expectedVersion: d.order.version,
        branchId,
        reason: "عرض اختبار موثق",
        ...extra,
      },
      true,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const accept = async (id: string) => {
    const d = await get(id);
    const r = await post(`/orders/${id}/decision`, {
      expectedVersion: d.order.version,
      quoteId: d.order.current_quote_id,
      accept: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const media = async (owner = customer.id, purpose = "receipt") =>
    (
      await f.owner.query(
        "INSERT INTO media_objects(owner_id,object_key,visibility,purpose,mime_type,size_bytes,status) VALUES($1,$2,'private',$3,'image/webp',100,'verified') RETURNING id",
        [owner, "private/test/" + randomUUID(), purpose],
      )
    ).rows[0].id;
  const instructions = async (id: string) => {
    const d = await get(id);
    const r = await post(`/orders/${id}/instructions`, {
      expectedVersion: d.order.version,
      methodId: method,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.instructionId;
  };
  const receipt = async (id: string, amountYer = "500", ref = randomUUID()) => {
    const ins = await instructions(id);
    const d = await get(id);
    const r = await post(`/orders/${id}/receipts`, {
      expectedVersion: d.order.version,
      instructionId: ins,
      receiptNumber: ref,
      amountYer,
      mediaId: await media(),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.paymentId;
  };
  const review = async (
    id: string,
    pid: string,
    outcome = "transfer_verified",
    amount = "500",
    stockAction = "consume_on_confirmation",
  ) => {
    const d = await get(id);
    return post(
      `/admin/orders/${id}/payments/${pid}/review`,
      {
        expectedVersion: d.order.version,
        attemptId: d.payments.find((p: any) => p.id === pid).attempts.at(-1).id,
        outcome,
        ...(outcome === "transfer_verified"
          ? { verifiedAmountYer: amount }
          : {}),
        note: "مراجعة اختبار موثقة",
        stockAction,
      },
      true,
    );
  };
  const confirm = async (id: string, key = randomUUID()) => {
    const r = await post(
      `/admin/orders/${id}/confirm`,
      { expectedVersion: (await get(id)).order.version },
      true,
      key,
    );
    if (r.status === 500)
      console.error(
        "Isolated error states",
        f.logs.filter((l) => l.event === "request_error"),
      );
    return r;
  };
  return {
    setTokens: (values: { customer?: string; admin?: string }) => {
      token = values.customer ?? token;
      admin = values.admin ?? admin;
    },
    customer,
    staff,
    token,
    admin,
    g,
    b,
    b2,
    cat,
    product,
    piece,
    carton,
    address,
    method,
    post,
    get,
    submit,
    quote,
    accept,
    media,
    instructions,
    receipt,
    review,
    confirm,
  };
}
