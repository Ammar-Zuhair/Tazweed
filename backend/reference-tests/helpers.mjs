import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const schema = readFileSync(
  new URL("../database/schema.sql", import.meta.url),
  "utf8",
);
export async function makeFixture() {
  const db = new PGlite();
  await db.exec(schema);
  const insert = async (table, data) => {
    const keys = Object.keys(data);
    return (
      await db.query(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        Object.values(data),
      )
    ).rows[0];
  };
  const gov = await insert("governorates", { name_ar: "محافظة اختبار وهمية" });
  const branch = await insert("branches", {
    governorate_id: gov.id,
    name_ar: "فرع كتالوج اختبار",
    latitude: 15,
    longitude: 44,
  });
  const other = await insert("branches", {
    governorate_id: gov.id,
    name_ar: "فرع تاريخي لاختيار الإدارة",
    latitude: 15.1,
    longitude: 44.1,
  });
  await db.query("UPDATE governorates SET catalog_branch_id=$1 WHERE id=$2", [
    branch.id,
    gov.id,
  ]);
  const users = [];
  for (const [i, kind] of [
    "customer",
    "customer",
    "staff",
    "courier",
    "courier",
  ].entries()) {
    users.push(
      await insert("users", {
        phone_e164: `+96777700000${i + 1}`,
        name_ar: `حساب اختبار ${i}`,
        password_hash: "TEST_ONLY",
        kind,
        status: "active",
      }),
    );
  }
  const [customer, otherCustomer, staff, courier, otherCourier] = users;
  for (const c of [courier, otherCourier]) {
    await insert("courier_profiles", { user_id: c.id, commission_bps: 2000 });
    for (const b of [branch, other])
      await insert("courier_branches", { courier_id: c.id, branch_id: b.id });
  }
  const category = await insert("categories", { name_ar: "زيوت اختبار" });
  const tires = await insert("categories", { name_ar: "إطارات اختبار" });
  const viscosity = await insert("attributes", {
    code: "viscosity",
    name_ar: "لزوجة اختبار",
  });
  const size = await insert("attributes", {
    code: "size",
    name_ar: "مقاس اختبار",
  });
  const oilValue = await insert("attribute_values", {
    attribute_id: viscosity.id,
    value_ar: "20W50",
  });
  const sizeValue = await insert("attribute_values", {
    attribute_id: size.id,
    value_ar: "TEST_SIZE",
  });
  await insert("category_attributes", {
    category_id: category.id,
    attribute_id: viscosity.id,
    required: true,
  });
  await insert("category_attributes", {
    category_id: tires.id,
    attribute_id: size.id,
  });
  const product = await insert("products", {
    sku: "TEST-OIL",
    category_id: category.id,
    name_ar: "زيت اختبار",
  });
  const product2 = await insert("products", {
    sku: "TEST-OIL-2",
    category_id: category.id,
    name_ar: "زيت اختبار آخر",
  });
  await insert("product_attribute_values", {
    product_id: product.id,
    category_id: category.id,
    attribute_id: viscosity.id,
    value_id: oilValue.id,
  });
  const piece = await insert("product_units", {
    product_id: product.id,
    unit_kind: "piece",
    pieces_per_unit: 1,
    price_yer: 5000,
  });
  const carton = await insert("product_units", {
    product_id: product.id,
    unit_kind: "carton",
    pieces_per_unit: 12,
    price_yer: 58000,
  });
  for (const b of [branch, other])
    await insert("stock_levels", {
      branch_id: b.id,
      product_id: product.id,
      on_hand: 100,
    });
  const method = await insert("payment_methods", {
    name_ar: "تحويل اختبار",
    beneficiary: "مستفيد اختبار",
    destination_number: "TEST_ONLY",
  });
  const promotion = await insert("promotions", {
    name_ar: "خصم اختبار",
    target: "delivery",
    discount_kind: "fixed",
    value: 100,
    starts_at: "2020-01-01T00:00:00Z",
    ends_at: "2040-01-01T00:00:00Z",
  });

  async function newOrder(options = {}) {
    const { unassigned = false, ...overrides } = options;
    const order = await insert("orders", {
      customer_id: customer.id,
      governorate_id: gov.id,
      catalog_branch_id: branch.id,
      ...(unassigned
        ? {}
        : {
            branch_id: branch.id,
            branch_selected_by: staff.id,
            branch_selected_at: new Date().toISOString(),
          }),
      kind: "retail",
      payment_kind: "cash_on_delivery",
      ...overrides,
    });
    const details = await insert("order_private_details", {
      order_id: order.id,
      revision: 1,
      address_snapshot: JSON.stringify({
        latitude: 15,
        longitude: 44,
        description: "عنوان اختبار",
      }),
      contact_snapshot: JSON.stringify({ label: "بيانات اختبار" }),
    });
    return { ...order, detailsId: details.id };
  }
  async function newQuote(order, options = {}) {
    const { accept = true, send = true, line = {}, ...overrides } = options;
    const discount =
      (overrides.delivery_discount_yer ?? 0) +
      (overrides.product_discount_yer ?? 0);
    const quote = await insert("order_quotes", {
      order_id: order.id,
      branch_id: order.branch_id ?? branch.id,
      private_details_id: order.detailsId,
      revision: 1,
      subtotal_yer: 5000,
      delivery_yer: 400,
      total_yer: 5400 - discount,
      distance_m: 2800,
      base_yer: 300,
      per_km_yer: 50,
      routing_source: "TEST_ROUTING",
      delivery_rule_snapshot: "{}",
      ...(discount
        ? {
            promotion_id: promotion.id,
            promotion_snapshot: JSON.stringify({ id: promotion.id }),
          }
        : {}),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...overrides,
    });
    await insert("quote_items", {
      quote_id: quote.id,
      product_id: product.id,
      unit_id: piece.id,
      name_snapshot: "زيت اختبار",
      unit_snapshot: "حبة",
      pieces_per_unit: 1,
      quantity: 1,
      unit_price_yer: 5000,
      line_total_yer: 5000,
      ...line,
    });
    await db.query("UPDATE orders SET current_quote_id=$1 WHERE id=$2", [
      quote.id,
      order.id,
    ]);
    if (send)
      await db.query("UPDATE order_quotes SET status='sent' WHERE id=$1", [
        quote.id,
      ]);
    if (accept && send)
      await db.query(
        "UPDATE order_quotes SET status='accepted',accepted_by=$1,accepted_at=now() WHERE id=$2",
        [customer.id, quote.id],
      );
    return (
      await db.query("SELECT * FROM order_quotes WHERE id=$1", [quote.id])
    ).rows[0];
  }
  async function reserve(order, quote, options = {}) {
    const pieces = options.pieces ?? 1;
    await db.query(
      "UPDATE stock_levels SET reserved=reserved+$1 WHERE branch_id=$2 AND product_id=$3",
      [pieces, quote.branch_id, product.id],
    );
    return insert("stock_reservations", {
      order_id: order.id,
      quote_id: quote.id,
      branch_id: quote.branch_id,
      product_id: product.id,
      pieces,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...options,
    });
  }
  async function confirm(order) {
    await db.query(
      "UPDATE orders SET status='confirmed',confirmed_at=now() WHERE id=$1",
      [order.id],
    );
  }
  async function dispatch(order, quote) {
    return insert("order_assignments", {
      order_id: order.id,
      courier_id: courier.id,
      assigned_by: staff.id,
      commission_bps: 2000,
      delivery_fee_before_discount_yer: quote.delivery_yer,
      delivery_discount_yer: quote.delivery_discount_yer,
      commission_yer: Math.round((quote.delivery_yer * 2000) / 10000),
    });
  }
  async function media(purpose = "receipt") {
    return insert("media_objects", {
      owner_id: customer.id,
      object_key: `test/${crypto.randomUUID()}`,
      visibility: "private",
      purpose,
      mime_type: "image/png",
      size_bytes: 100,
      status: "verified",
    });
  }
  async function transfer(
    order,
    quote,
    { amount = quote.total_yer, receipt = crypto.randomUUID() } = {},
  ) {
    const instruction = await insert("payment_instructions", {
      order_id: order.id,
      quote_id: quote.id,
      method_id: method.id,
      revision: 1,
      method_snapshot: JSON.stringify({
        name_ar: method.name_ar,
        beneficiary: method.beneficiary,
        destination_number: method.destination_number,
      }),
      expected_amount_yer: quote.total_yer,
    });
    const payment = await insert("payments", {
      order_id: order.id,
      quote_id: quote.id,
      method_id: method.id,
      instruction_id: instruction.id,
      receipt_number: receipt,
      normalized_receipt_number: receipt,
      amount_yer: amount,
    });
    const receiptMedia = await media();
    const attempt = await insert("payment_receipt_attempts", {
      payment_id: payment.id,
      attempt_number: 1,
      media_id: receiptMedia.id,
      submitted_by: customer.id,
    });
    return { instruction, payment, attempt, receiptMedia };
  }
  async function review(
    payment,
    attempt,
    outcome = "transfer_verified",
    amount = payment.amount_yer,
  ) {
    return insert("payment_receipt_reviews", {
      payment_id: payment.id,
      attempt_id: attempt.id,
      reviewer_id: staff.id,
      outcome,
      ...(outcome === "transfer_verified"
        ? { verified_amount_yer: amount }
        : {}),
      note: "مراجعة اختبار موثقة",
    });
  }
  async function cashDelivery(options = {}) {
    const order = await newOrder();
    const quote = await newQuote(order, options);
    await reserve(order, quote);
    await confirm(order);
    const assignment = await dispatch(order, quote);
    await db.query("UPDATE orders SET status='on_the_way' WHERE id=$1", [
      order.id,
    ]);
    const collection = await insert("cash_collections", {
      order_id: order.id,
      assignment_id: assignment.id,
      courier_id: courier.id,
      amount_yer: quote.total_yer,
      reference: "TEST_CASH",
      recorded_by: courier.id,
      collected_at: new Date().toISOString(),
    });
    await db.query(
      "UPDATE orders SET status='delivered',delivered_at=now() WHERE id=$1",
      [order.id],
    );
    const earning = await insert("courier_earnings", {
      courier_id: courier.id,
      order_id: order.id,
      assignment_id: assignment.id,
      entry_type: "delivery",
      amount_yer: assignment.commission_yer,
    });
    return { order, quote, assignment, collection, earning };
  }
  async function reject(
    callback,
    codes = ["23502", "23503", "23505", "23514", "P0001"],
  ) {
    await db.exec("SAVEPOINT expected_rejection");
    let caught;
    try {
      await callback();
    } catch (error) {
      caught = error;
    }
    await db.exec("ROLLBACK TO SAVEPOINT expected_rejection");
    await db.exec("RELEASE SAVEPOINT expected_rejection");
    assert.ok(caught, "Expected SQL rejection");
    assert.ok(
      codes.includes(caught.code),
      `Unexpected error ${caught.code}: ${caught.message}`,
    );
    return caught.code;
  }
  return {
    db,
    insert,
    reject,
    gov,
    branch,
    other,
    customer,
    otherCustomer,
    staff,
    courier,
    otherCourier,
    category,
    tires,
    viscosity,
    size,
    oilValue,
    sizeValue,
    product,
    product2,
    piece,
    carton,
    method,
    promotion,
    newOrder,
    newQuote,
    reserve,
    confirm,
    dispatch,
    media,
    transfer,
    review,
    cashDelivery,
  };
}

export async function readCatalog(db) {
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const columns = (
    await db.query(
      "SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attgenerated AS generated,a.attidentity AS identity,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",
    )
  ).rows;
  const constraints = (
    await db.query(
      "SELECT c.relname AS table_name,co.conname AS name,pg_get_constraintdef(co.oid) AS definition FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,co.conname",
    )
  ).rows;
  const triggers = (
    await db.query(
      "SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
    )
  ).rows;
  return { tables, columns, constraints, triggers };
}
