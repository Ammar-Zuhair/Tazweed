import { governorateById, productById } from './catalog';
import type { Product } from '../domain/types';

export type Promotion = { id: string; eyebrow: string; title: string; body: string; action: string; destination: string; icon: 'water-outline' | 'flash-outline' | 'battery-charging-outline'; color: string };
const promotions: Promotion[] = [
  { id: 'demo-saving', eyebrow: 'عروض تزويد', title: 'وفّر في كل مشوار', body: 'اكتشف أفضل توفير على المنتجات أو التوصيل في معاينة العروض.', action: 'اكتشف العروض', destination: '/offers', icon: 'flash-outline', color: '#102D46' },
  { id: 'demo-oils', eyebrow: 'عناية بالمحرك', title: 'ابدأ يومك بسلاسة', body: 'اختر زيتك بالعلامة واللزوجة، واطلب بالحبة أو الكرتون.', action: 'تسوّق الزيوت', destination: '/categories?category=oils', icon: 'water-outline', color: '#17445B' },
  { id: 'demo-power', eyebrow: 'طاقة على الطريق', title: 'جاهز للانطلاق؟', body: 'اعثر على بطارية سيارتك حسب العلامة والسعة المناسبة.', action: 'تسوّق البطاريات', destination: '/categories?category=batteries', icon: 'battery-charging-outline', color: '#603821' },
];
// Separate illustrative daily demand fixtures. These are never derived from featured flags.
const dailyDemand: Record<string, { productId: string; demoOrders: number }[]> = {
  aden: [{ productId: 'oil-15', demoOrders: 36 }, { productId: 'battery-70', demoOrders: 28 }, { productId: 'filter-air', demoOrders: 23 }, { productId: 'tire-16', demoOrders: 18 }, { productId: 'patch-small', demoOrders: 15 }, { productId: 'solar-150', demoOrders: 12 }],
  sanaa: [{ productId: 'battery-100', demoOrders: 42 }, { productId: 'oil-20', demoOrders: 35 }, { productId: 'solar-200', demoOrders: 26 }, { productId: 'tire-15', demoOrders: 22 }, { productId: 'filter-oil', demoOrders: 17 }, { productId: 'patch-large', demoOrders: 11 }],
};
export type DailyProducts = { day: string; timezone: 'UTC'; source: 'local-preview'; rows: { product: Product; demoOrders: number }[] };
export function previewPromotions(governorateId: string | null): Promotion[] {
  return governorateById(governorateId)?.catalogBranch ? promotions.map(row => ({ ...row })) : [];
}
export function previewDailyProducts(governorateId: string | null, day: string): DailyProducts {
  const entries = governorateId && governorateById(governorateId)?.catalogBranch ? dailyDemand[governorateId] ?? [] : [];
  return { day, timezone: 'UTC', source: 'local-preview', rows: entries.slice(0, 6).map(row => ({ product: productById(row.productId)!, demoOrders: row.demoOrders })) };
}
