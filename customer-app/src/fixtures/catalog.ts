import type { Category, CategoryId, Governorate, Product } from '../domain/types';
export const governorates: Governorate[] = [
  { id: 'aden', name: 'عدن', catalogBranch: { id: 'demo-aden', name: 'فرع عدن التجريبي' }, center: { latitude: 12.80, longitude: 45.03 } },
  { id: 'sanaa', name: 'صنعاء', catalogBranch: { id: 'demo-sanaa', name: 'فرع صنعاء التجريبي' }, center: { latitude: 15.35, longitude: 44.20 } },
  { id: 'unconfigured', name: 'محافظة بلا إعداد تجريبي', catalogBranch: null, center: { latitude: 13.58, longitude: 44.02 } },
];
const brand = { id: 'brand', label: 'العلامة', values: [{ id: 'madar', label: 'مدار' }, { id: 'quwwa', label: 'قوة' }, { id: 'shams', label: 'شمس' }] };
export const categories: Category[] = [
  { id: 'oils', name: 'الزيوت', icon: 'water-outline', subtitle: 'حماية تدوم', filters: [brand, { id: 'viscosity', label: 'اللزوجة', values: [{ id: '15w40', label: '15W-40' }, { id: '20w50', label: '20W-50' }] }] },
  { id: 'batteries', name: 'البطاريات', icon: 'battery-charging-outline', subtitle: 'طاقة تبدأ معك', filters: [brand, { id: 'capacity', label: 'السعة', values: [{ id: '70ah', label: '70 أمبير' }, { id: '100ah', label: '100 أمبير' }] }] },
  { id: 'tires', name: 'الإطارات', icon: 'disc-outline', subtitle: 'ثبات على الطريق', filters: [brand, { id: 'size', label: 'المقاس', values: [{ id: '205-55-r16', label: '205/55 R16' }, { id: '195-65-r15', label: '195/65 R15' }] }] },
  { id: 'solar', name: 'الطاقة الشمسية', icon: 'sunny-outline', subtitle: 'نهارك أكثر إشراقًا', filters: [brand, { id: 'power', label: 'القدرة', values: [{ id: '150w', label: '150 واط' }, { id: '200w', label: '200 واط' }] }] },
  { id: 'filters', name: 'الفلاتر', icon: 'funnel-outline', subtitle: 'تفاصيل تصنع الفرق', filters: [brand, { id: 'filter-type', label: 'النوع', values: [{ id: 'air', label: 'هواء' }, { id: 'oil', label: 'زيت' }] }] },
  { id: 'patches', name: 'الرقع', icon: 'construct-outline', subtitle: 'عناية عملية', filters: [brand, { id: 'patch-size', label: 'الحجم', values: [{ id: 'small', label: 'صغير' }, { id: 'large', label: 'كبير' }] }] },
];
const make = (id: string, name: string, categoryId: CategoryId, attributes: Record<string, string>, piece: number, carton: number | null, piecesPerCarton: number | null, color: string, extra: Partial<Product> = {}): Product => ({
  id, sku: `DEMO-${id.toUpperCase()}`, name, categoryId, brand: attributes.brand === 'madar' ? 'مدار' : attributes.brand === 'shams' ? 'شمس' : 'قوة',
  origin: 'بلد منشأ تجريبي', description: 'منتج توضيحي لمراجعة تجربة تزويد. الصور المرسومة والأسعار والخصائص بيانات تجريبية، وليست كتالوج المتجر الفعلي.', attributes, piecesPerCarton,
  prices: { aden: { piece, carton, available: true }, sanaa: { piece: piece + 150, carton: carton === null ? null : carton + 500, available: true } }, color, featured: true, ...extra,
});
export const products: Product[] = [
  make('oil-15', 'زيت محرك مدار 15W-40', 'oils', { brand: 'madar', viscosity: '15w40' }, 2300, 25200, 12, '#F47A13'),
  make('oil-20', 'زيت محرك قوة 20W-50', 'oils', { brand: 'quwwa', viscosity: '20w50' }, 2100, 22800, 12, '#176088', { prices: { aden: { piece: 2100, carton: 22800, available: false }, sanaa: { piece: 2250, carton: 23300, available: true } } }),
  make('battery-70', 'بطارية قوة 70 أمبير', 'batteries', { brand: 'quwwa', capacity: '70ah' }, 45000, null, null, '#176088'),
  make('battery-100', 'بطارية مدار 100 أمبير', 'batteries', { brand: 'madar', capacity: '100ah' }, 62000, null, null, '#F47A13'),
  make('tire-16', 'إطار مدار 205/55 R16', 'tires', { brand: 'madar', size: '205-55-r16' }, 32000, null, null, '#082A48'),
  make('tire-15', 'إطار قوة 195/65 R15', 'tires', { brand: 'quwwa', size: '195-65-r15' }, 28500, null, null, '#176088'),
  make('solar-150', 'لوح شمس 150 واط', 'solar', { brand: 'shams', power: '150w' }, 39000, null, null, '#176088'),
  make('solar-200', 'لوح شمس 200 واط', 'solar', { brand: 'shams', power: '200w' }, 48000, null, null, '#082A48'),
  make('filter-air', 'فلتر هواء مدار', 'filters', { brand: 'madar', 'filter-type': 'air' }, 3800, 41000, 12, '#DCA45C'),
  make('filter-oil', 'فلتر زيت قوة', 'filters', { brand: 'quwwa', 'filter-type': 'oil' }, 2600, 28000, 12, '#F47A13'),
  make('patch-small', 'رقع قوة صغيرة', 'patches', { brand: 'quwwa', 'patch-size': 'small' }, 350, 3200, 10, '#082A48'),
  make('patch-large', 'رقع مدار كبيرة', 'patches', { brand: 'madar', 'patch-size': 'large' }, 550, 5000, 10, '#176088'),
];
export const productById = (id: string) => products.find(product => product.id === id);
export const governorateById = (id: string | null) => governorates.find(governorate => governorate.id === id);
export const categoryById = (id: string) => categories.find(category => category.id === id);
