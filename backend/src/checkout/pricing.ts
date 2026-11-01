export type Promotion = {
  id: string;
  name_ar: string;
  governorate_id: string | null;
  category_id: string | null;
  product_id: string | null;
  target: "products" | "delivery";
  discount_kind: "fixed" | "percent";
  value: string;
  starts_at: Date | string;
  ends_at: Date | string;
  active: boolean;
};
export type PricedLine = {
  unitId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  unitPriceYer: string;
  lineTotalYer: string;
  [key: string]: unknown;
};
export function roadFee(distanceMeters: number, base: string, perKm: string) {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > 2147483647
  )
    throw Error("Invalid road distance");
  const distance_m = Math.floor(distanceMeters),
    billed_km = Math.floor(distance_m / 1000);
  return {
    distance_m,
    billed_km,
    base_yer: base,
    per_km_yer: perKm,
    rounding: "floor_km" as const,
    fee_yer: (BigInt(base) + BigInt(billed_km) * BigInt(perKm)).toString(),
  };
}
// Preserve the existing UI model: nearest whole YER, half-up; floor_km applies only to distance.
export function bestPromotion(
  promos: Promotion[],
  gov: string,
  kind: "retail" | "wholesale",
  lines: PricedLine[],
  delivery: string,
  at: Date,
) {
  if (kind === "wholesale") return null;
  const eligible = promos.flatMap((p) => {
    if (
      !p.active ||
      (p.governorate_id && p.governorate_id !== gov) ||
      new Date(p.starts_at) > at ||
      new Date(p.ends_at) <= at
    )
      return [];
    const matching = lines.filter(
      (l) =>
        (!p.category_id || p.category_id === l.categoryId) &&
        (!p.product_id || p.product_id === l.productId),
    );
    if (!matching.length) return [];
    const base =
      p.target === "delivery"
        ? BigInt(delivery)
        : matching.reduce((sum, l) => sum + BigInt(l.lineTotalYer), 0n);
    const proposed =
        p.discount_kind === "fixed"
          ? BigInt(p.value)
          : (base * BigInt(p.value) + 5000n) / 10000n,
      saving = proposed > base ? base : proposed;
    if (saving <= 0n) return [];
    return [
      {
        id: p.id,
        name_ar: p.name_ar,
        target: p.target,
        discount_kind: p.discount_kind,
        value: p.value,
        eligible_base_yer: base.toString(),
        saving_yer: saving.toString(),
      },
    ];
  });
  eligible.sort((a, b) =>
    BigInt(a.saving_yer) > BigInt(b.saving_yer)
      ? -1
      : BigInt(a.saving_yer) < BigInt(b.saving_yer)
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
  return eligible[0] ?? null;
}
