import { categories, governorateById, productById, products } from '../fixtures/catalog';
import type { CartLine, OrderLine, Product } from './types';
export class PreviewError extends Error { constructor(message: string, readonly code = 'PREVIEW_VALIDATION') { super(message); } }
export const demand: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new PreviewError(message); };
export function priceOf(product: Product, governorateId: string | null, unit: CartLine['unit']) {
  const branch = governorateId ? product.prices[governorateId] : undefined;
  return branch ? branch[unit] : null;
}
export function piecesOf(line: CartLine) {
  const product = productById(line.productId); demand(product, 'المنتج غير موجود.');
  demand(Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 999, 'الكمية من 1 إلى 999 في المعاينة.');
  demand(line.unit === 'piece' || product.piecesPerCarton, 'وحدة الكرتون غير متاحة لهذا المنتج.');
  return line.quantity * (line.unit === 'carton' ? product.piecesPerCarton! : 1);
}
export function snapshotLines(lines: CartLine[], governorateId: string): OrderLine[] {
  demand(governorateById(governorateId)?.catalogBranch, 'لم يهيأ كتالوج هذه المحافظة.');
  demand(lines.length, 'السلة فارغة.');
  return lines.map(line => {
    const product = productById(line.productId); demand(product, 'المنتج غير موجود.'); piecesOf(line);
    demand(product.prices[governorateId]?.available, `${product.name} غير متوفر في المحافظة المختارة.`);
    const price = priceOf(product, governorateId, line.unit); demand(price !== null && price !== undefined, 'سعر الوحدة غير مهيأ.');
    return { ...line, name: product.name, unitPrice: price, piecesPerUnit: line.unit === 'carton' ? product.piecesPerCarton! : 1 };
  });
}
export type CatalogQuery = { governorateId: string | null; categoryId?: string; search?: string; filters?: Record<string, string[]>; sort?: 'featured' | 'price-asc' | 'price-desc' | 'name' };
export function filterCatalog(query: CatalogQuery): Product[] {
  if (!governorateById(query.governorateId)?.catalogBranch) return [];
  const validAttributes = query.categoryId ? categories.find(c => c.id === query.categoryId)?.filters.map(a => a.id) ?? [] : ['brand'];
  const term = (query.search ?? '').trim().toLowerCase();
  const rows = products.filter(product => (!query.categoryId || product.categoryId === query.categoryId) &&
    (!term || `${product.name} ${product.sku} ${product.brand}`.toLowerCase().includes(term)) &&
    Object.entries(query.filters ?? {}).every(([attribute, values]) => !validAttributes.includes(attribute) || !values.length || values.includes(product.attributes[attribute] ?? '')));
  return [...rows].sort((a, b) => query.sort === 'price-asc' ? (priceOf(a, query.governorateId, 'piece') ?? 0) - (priceOf(b, query.governorateId, 'piece') ?? 0) : query.sort === 'price-desc' ? (priceOf(b, query.governorateId, 'piece') ?? 0) - (priceOf(a, query.governorateId, 'piece') ?? 0) : query.sort === 'name' ? a.name.localeCompare(b.name, 'ar') : Number(b.featured) - Number(a.featured) || a.id.localeCompare(b.id));
}
export const subtotalOf = (lines: OrderLine[]) => lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
export const normalizeDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
export function normalizePhone(value: string) {
  let digits = normalizeDigits(value).replace(/[\s()+-]/g, '');
  if (digits.startsWith('00967')) digits = digits.slice(2);
  if (!digits.startsWith('967')) digits = `967${digits}`;
  demand(/^9677[01378]\d{7}$/.test(digits), 'أدخل رقمًا يمنيًا صحيحًا من 9 أرقام يبدأ بـ7.');
  return digits;
}
