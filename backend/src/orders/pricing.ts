import type pg from "pg";
import { ApiError } from "../http.js";
import {
  bestPromotion,
  roadFee,
  type PricedLine,
} from "../checkout/pricing.js";
import {
  coverageMeters,
  RoutingError,
  type RoutingProvider,
} from "../checkout/routing.js";
export async function quotePrice(
  db: pg.PoolClient,
  routing: RoutingProvider,
  o: any,
  branchId: string,
  privateDetails: any,
  options: {
    manualDeliveryYer?: string;
    unitPrices: { unitId: string; priceYer: string }[];
  },
) {
  const b = (
    await db.query(
      `SELECT b.id,b.latitude::float8,b.longitude::float8,b.delivery_enabled,b.coverage_radius_m,d.base_yer::text,d.per_km_yer::text,d.max_distance_m,d.version FROM branches b LEFT JOIN delivery_rules d ON d.branch_id=b.id WHERE b.id=$1 AND b.active`,
      [branchId],
    )
  ).rows[0];
  if (!b) throw new ApiError(409, "BRANCH_UNAVAILABLE", "فرع التنفيذ غير متاح");
  const units = (
    await db.query(
      `SELECT i.quantity,u.id,u.product_id,u.unit_kind,u.pieces_per_unit,coalesce(bp.price_yer,u.price_yer)::text price_yer,p.category_id,p.name_ar,p.version,
 coalesce((SELECT jsonb_agg(jsonb_build_object('attribute',a.name_ar,'value',v.value_ar) ORDER BY a.id) FROM product_attribute_values pa JOIN attributes a ON a.id=pa.attribute_id JOIN attribute_values v ON v.id=pa.value_id WHERE pa.product_id=p.id),'[]') attributes
 FROM order_request_items i JOIN product_units u ON u.id=i.unit_id AND u.active AND u.archived_at IS NULL JOIN products p ON p.id=u.product_id AND p.active JOIN categories c ON c.id=p.category_id AND c.active LEFT JOIN branch_unit_prices bp ON bp.unit_id=u.id AND bp.branch_id=$2 AND bp.active WHERE i.order_id=$1
 AND NOT EXISTS(SELECT 1 FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id WHERE ca.category_id=p.category_id AND ca.required AND (NOT a.active OR NOT EXISTS(SELECT 1 FROM product_attribute_values pa JOIN attribute_values v ON v.id=pa.value_id AND v.active WHERE pa.product_id=p.id AND pa.attribute_id=ca.attribute_id))) ORDER BY u.id`,
      [o.id, branchId],
    )
  ).rows;
  const count = Number(
    (
      await db.query(
        "SELECT count(*) n FROM order_request_items WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
  );
  if (!units.length || units.length !== count)
    throw new ApiError(
      409,
      "ITEM_UNAVAILABLE",
      "منتج أو وحدة أو خاصية مطلوبة غير متاحة",
    );
  if (
    options.unitPrices.some((x) => !units.some((u) => u.id === x.unitId)) ||
    (o.kind === "wholesale" && options.unitPrices.length !== units.length)
  )
    throw new ApiError(
      422,
      "LINE_PRICES_REQUIRED",
      "حدد سعر كل وحدة للجملة؛ لا ترسل وحدات خارج الطلب",
    );
  const lines: PricedLine[] = units.map((u) => {
    const price =
      options.unitPrices.find((x) => x.unitId === u.id)?.priceYer ??
      u.price_yer;
    return {
      unitId: u.id,
      productId: u.product_id,
      categoryId: u.category_id,
      quantity: u.quantity,
      unitPriceYer: price,
      lineTotalYer: (BigInt(price) * BigInt(u.quantity)).toString(),
      name_ar: u.name_ar,
      attributes: u.attributes,
      unitKind: u.unit_kind,
      piecesPerUnit: u.pieces_per_unit,
      productVersion: u.version,
      catalogPriceYer: u.price_yer,
    };
  });
  const address = privateDetails.address_snapshot;
  let delivery: any;
  if (options.manualDeliveryYer !== undefined)
    delivery = {
      pricingMode: "manual",
      fee_yer: options.manualDeliveryYer,
      distance_m: null,
      base_yer: "0",
      per_km_yer: "0",
      routing_source: "manager_manual",
    };
  else {
    if (
      !b.delivery_enabled ||
      !b.coverage_radius_m ||
      !b.max_distance_m ||
      b.base_yer === null
    )
      throw new ApiError(
        409,
        "MANUAL_DELIVERY_REQUIRED",
        "التوصيل غير مهيأ؛ يلزم رسم يدوي بسبب موثق",
      );
    if (coverageMeters(b, address) > b.coverage_radius_m)
      throw new ApiError(
        409,
        "OUTSIDE_COVERAGE",
        "العنوان خارج التغطية؛ راجع رسمًا يدويًا بسبب موثق",
      );
    const route = await routing.route(b, address).catch((e) => {
      if (e instanceof RoutingError)
        throw new ApiError(
          409,
          e.code,
          "تعذر تسعير الطريق؛ يلزم رسم إداري يدوي بسبب موثق",
        );
      throw e;
    });
    if (route.distanceMeters > b.max_distance_m)
      throw new ApiError(
        409,
        "OUTSIDE_COVERAGE",
        "الطريق يتجاوز الحد؛ راجع رسمًا يدويًا بسبب موثق",
      );
    delivery = {
      ...roadFee(route.distanceMeters, b.base_yer, b.per_km_yer),
      pricingMode: "road",
      routing_source: route.source,
      raw_distance_m: route.distanceMeters,
      data_version: route.dataVersion,
    };
  }
  const at = (await db.query("SELECT now() at")).rows[0].at;
  const promos = (
    await db.query(
      "SELECT * FROM promotions WHERE active AND starts_at<=now() AND ends_at>now() AND (governorate_id IS NULL OR governorate_id=$1)",
      [o.governorate_id],
    )
  ).rows;
  const promotion = bestPromotion(
    promos,
    o.governorate_id,
    o.kind,
    lines,
    delivery.fee_yer,
    at,
  );
  const subtotal = lines.reduce((n, l) => n + BigInt(l.lineTotalYer), 0n),
    pd = promotion?.target === "products" ? BigInt(promotion.saving_yer) : 0n,
    dd = promotion?.target === "delivery" ? BigInt(promotion.saving_yer) : 0n,
    total = subtotal - pd + BigInt(delivery.fee_yer) - dd;
  if (
    [subtotal, total, BigInt(delivery.fee_yer)].some(
      (n) => n > 9223372036854775807n,
    )
  )
    throw new ApiError(422, "PRICE_OUT_OF_RANGE", "المبلغ خارج نطاق التخزين");
  // Stable comparison includes source prices, product facts, rule version and the exact chosen promotion.
  const fingerprint = {
    branch: b,
    privateDetailsId: privateDetails.id,
    lines,
    delivery,
    promotion,
  };
  return {
    lines,
    delivery,
    promotion,
    subtotal: subtotal.toString(),
    productDiscount: pd.toString(),
    deliveryDiscount: dd.toString(),
    total: total.toString(),
    snapshot: {
      fingerprint,
      options: {
        ...(options.manualDeliveryYer !== undefined
          ? { manualDeliveryYer: options.manualDeliveryYer }
          : {}),
        unitPrices: options.unitPrices,
      },
    },
  };
}
