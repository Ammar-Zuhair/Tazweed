import type pg from "pg";
import type { Db } from "../db.js";
import { ApiError, notFound } from "../http.js";
import type { preview } from "./contracts.js";
import type { z } from "zod";
import { bestPromotion, roadFee, type PricedLine } from "./pricing.js";
import {
  coverageMeters,
  RoutingError,
  type RoutingProvider,
} from "./routing.js";
export async function catalogContext(db: Db, gov: string) {
  const row = (
    await db.query(
      `SELECT g.id governorate_id,g.name_ar governorate_name,b.id catalog_branch_id,b.name_ar branch_name,b.latitude::float8,b.longitude::float8,b.coverage_radius_m,b.delivery_enabled,d.base_yer::text,d.per_km_yer::text,d.rounding,d.max_distance_m,d.version rule_version FROM governorates g JOIN branches b ON b.id=g.catalog_branch_id AND b.governorate_id=g.id AND b.active LEFT JOIN delivery_rules d ON d.branch_id=b.id WHERE g.id=$1 AND g.active`,
      [gov],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      409,
      "CATALOG_UNCONFIGURED",
      "لم يحدد فرع كتالوج نشط لهذه المحافظة",
    );
  return row;
}
export async function customerMaintenance(db: Db, lock=false) {
  const m = (
    await db.query("SELECT enabled,message_ar FROM customer_maintenance"+(lock?" FOR SHARE":""))
  ).rows[0];
  if (m?.enabled) throw new ApiError(503, "MAINTENANCE", m.message_ar);
}
export async function previewCart(
  pool: pg.Pool,
  provider: RoutingProvider,
  customerId: string,
  input: z.infer<typeof preview>,
) {
  const db = await pool.connect();
  try {
    // Coherent, READ ONLY snapshot: no expiry reconciliation, audit, outbox, quote or hold writes.
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await customerMaintenance(db);
    const at = (await db.query("SELECT transaction_timestamp() AS at")).rows[0]
      .at as Date;
    const address = (
      await db.query(
        "SELECT governorate_id,latitude::float8,longitude::float8 FROM addresses WHERE id=$1 AND user_id=$2 AND archived_at IS NULL",
        [input.addressId, customerId],
      )
    ).rows[0];
    if (!address) throw notFound();
    if (address.governorate_id !== input.governorateId)
      throw new ApiError(
        422,
        "ADDRESS_GOVERNORATE_MISMATCH",
        "عنوان التوصيل لا يخص المحافظة المختارة؛ اختر عنوانًا فيها لإعادة التسعير",
      );
    const branch = await catalogContext(db, input.governorateId);
    const units = (
      await db.query(
        `SELECT u.id,u.product_id,u.unit_kind,u.pieces_per_unit,coalesce(bp.price_yer,u.price_yer)::text price_yer,p.category_id,p.name_ar,p.version,coalesce(s.sellable,false) sellable,coalesce(s.on_hand-s.reserved,0)::text free FROM product_units u JOIN products p ON p.id=u.product_id AND p.active JOIN categories c ON c.id=p.category_id AND c.active LEFT JOIN branch_unit_prices bp ON bp.unit_id=u.id AND bp.branch_id=$1 AND bp.active LEFT JOIN stock_levels s ON s.branch_id=$1 AND s.product_id=p.id WHERE u.id=ANY($2::uuid[]) AND u.active AND u.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id WHERE ca.category_id=p.category_id AND ca.required AND (NOT a.active OR NOT EXISTS(SELECT 1 FROM product_attribute_values pa JOIN attribute_values v ON v.id=pa.value_id AND v.active WHERE pa.product_id=p.id AND pa.attribute_id=ca.attribute_id)))`,
        [branch.catalog_branch_id, input.items.map((v) => v.unitId)],
      )
    ).rows;
    const lines: PricedLine[] = [];
    const needed = new Map<string, bigint>();
    for (const item of input.items) {
      const u = units.find((v) => v.id === item.unitId);
      if (!u)
        throw new ApiError(
          409,
          "ITEM_UNAVAILABLE",
          "منتج أو وحدة غير متاح؛ راجع السلة",
          { unitId: item.unitId },
        );
      const pieces = BigInt(u.pieces_per_unit) * BigInt(item.quantity);
      needed.set(u.product_id, (needed.get(u.product_id) ?? 0n) + pieces);
      lines.push({
        unitId: u.id,
        productId: u.product_id,
        categoryId: u.category_id,
        name_ar: u.name_ar,
        productVersion: u.version,
        unitKind: u.unit_kind,
        piecesPerUnit: u.pieces_per_unit,
        quantity: item.quantity,
        unitPriceYer: u.price_yer,
        lineTotalYer: (BigInt(u.price_yer) * BigInt(item.quantity)).toString(),
      });
    }
    for (const u of units)
      if (!u.sellable || (needed.get(u.product_id) ?? 0n) > BigInt(u.free))
        throw new ApiError(
          409,
          "ITEM_UNAVAILABLE",
          "الكمية المختارة غير متاحة في فرع المحافظة",
          { productId: u.product_id },
        );
    let delivery: any = {
      status: "review_required",
      reason: "DELIVERY_UNCONFIGURED",
      pricingMode: null,
      fee_yer: null,
      route: null,
      snapshot: null,
    };
    if (
      branch.delivery_enabled &&
      branch.coverage_radius_m &&
      branch.max_distance_m &&
      branch.base_yer !== null
    ) {
      if (coverageMeters(branch, address) > branch.coverage_radius_m)
        delivery = {
          ...delivery,
          status: "outside_coverage",
          reason: "OUTSIDE_COVERAGE",
        };
      else
        try {
          const route = await provider.route(branch, address);
          // Check unrounded road distance against coverage; only billing drops fractional km.
          if (route.distanceMeters > branch.max_distance_m)
            delivery = {
              ...delivery,
              status: "outside_coverage",
              reason: "ROAD_LIMIT_EXCEEDED",
            };
          else {
            const fee = roadFee(
              route.distanceMeters,
              branch.base_yer,
              branch.per_km_yer,
            );
            delivery = {
              status: "estimated",
              reason: null,
              pricingMode: "road",
              ...fee,
              route: {
                geometry: route.geometry,
                duration_seconds: route.durationSeconds,
              },
              snapshot: {
                ...fee,
                rule_version: branch.rule_version,
                coverage_radius_m: branch.coverage_radius_m,
                max_distance_m: branch.max_distance_m,
                routing_source: route.source,
                raw_distance_m: route.distanceMeters,
                data_version: route.dataVersion,
                calculated_at: at.toISOString(),
              },
            };
          }
        } catch (e) {
          if (!(e instanceof RoutingError)) throw e;
          delivery = { ...delivery, reason: e.code };
        }
    }
    const promos = (
      await db.query(
        "SELECT * FROM promotions WHERE active AND starts_at<=$1 AND ends_at>$1 AND (governorate_id IS NULL OR governorate_id=$2)",
        [at, input.governorateId],
      )
    ).rows;
    const selected =
      delivery.fee_yer !== null
        ? bestPromotion(
            promos,
            input.governorateId,
            input.kind,
            lines,
            delivery.fee_yer,
            at,
          )
        : null;
    const subtotal = lines.reduce((sum, l) => sum + BigInt(l.lineTotalYer), 0n),
      productDiscount =
        selected?.target === "products" ? BigInt(selected.saving_yer) : 0n,
      deliveryDiscount =
        selected?.target === "delivery" ? BigInt(selected.saving_yer) : 0n;
    const maxYer = 9223372036854775807n;
    if (
      subtotal > maxYer ||
      (delivery.fee_yer !== null &&
        (BigInt(delivery.fee_yer) > maxYer ||
          subtotal -
            productDiscount +
            BigInt(delivery.fee_yer) -
            deliveryDiscount >
            maxYer))
    )
      throw new ApiError(
        422,
        "PRICE_OUT_OF_RANGE",
        "إعداد السعر يتجاوز نطاق مبالغ الطلب؛ راجع الإدارة",
      );
    const result = {
      source: "backend",
      previewOnly: true,
      reservationCreated: false,
      executionBranchId: null,
      reviewStage: "awaiting_branch",
      catalogBranchId: branch.catalog_branch_id,
      governorateId: input.governorateId,
      addressId: input.addressId,
      kind: input.kind,
      calculatedAt: at.toISOString(),
      pricingMode:
        input.kind === "wholesale" ? "wholesale_reference" : "retail_estimate",
      items: lines,
      delivery,
      promotion: selected,
      promotionSelection:
        input.kind === "wholesale"
          ? "excluded_wholesale"
          : delivery.fee_yer === null
            ? "pending_delivery"
            : "greatest_saving_id_asc",
      estimatedTotals: {
        subtotal_yer: subtotal.toString(),
        product_discount_yer: productDiscount.toString(),
        delivery_before_discount_yer: delivery.fee_yer,
        delivery_discount_yer: deliveryDiscount.toString(),
        delivery_customer_yer:
          delivery.fee_yer === null
            ? null
            : (BigInt(delivery.fee_yer) - deliveryDiscount).toString(),
        total_yer:
          delivery.fee_yer === null
            ? null
            : (
                subtotal -
                productDiscount +
                BigInt(delivery.fee_yer) -
                deliveryDiscount
              ).toString(),
      },
      notice:
        "معاينة تقديرية بلا حجز أو إذن دفع؛ يحدد المدير فرع التنفيذ والعرض النهائي بعد إرسال الطلب",
    };
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
