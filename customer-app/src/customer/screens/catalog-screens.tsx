import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Action, Card, Icon, Row, SectionTitle, Txt } from '../../ui/components';
import { useTheme } from '../../ui/theme-provider';
import { useCustomer, useCustomerClock } from '../../data/customer-provider';
import { customerRepository } from '../../data/customer-repository';
import { categories, categoryById, governorateById, productById } from '../../fixtures/catalog';
import { priceOf, type CatalogQuery } from '../../domain/catalog';
import { PromotionList } from '../promotion-list';
import type { DailyProducts, Promotion } from '../../fixtures/home';
import type { Product, UnitKind } from '../../domain/types';
import { Chip, Chips, Empty, Field, go, Hint, InlineError, money, ProductArt, ProductGrid, ProvinceContent, Quantity, Shell, Sheet, Skeleton, unitLabel } from '../components';

function useCatalog(query: CatalogQuery) {
  const { state } = useCustomer();
  const [result, setResult] = useState<{ rows: Product[]; status: 'loading' | 'ready' | 'error'; error: string }>({ rows: [], status: 'loading', error: '' });
  const key = JSON.stringify(query);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController(); setResult({ rows: [], status: 'loading', error: '' });
    customerRepository.catalog(JSON.parse(key), state.scenario, controller.signal).then(rows => setResult({ rows, status: 'ready', error: '' })).catch(error => { if (!controller.signal.aborted) setResult({ rows: [], status: 'error', error: error.message }); });
    return () => controller.abort();
  }, [key, state.scenario]));
  return result;
}
function useHomeFeed(day: string) {
  const { state } = useCustomer();
  const [feed, setFeed] = useState<{ status: 'loading' | 'ready' | 'error'; promotions: Promotion[]; popular: DailyProducts | null; error: string }>({ status: 'loading', promotions: [], popular: null, error: '' });
  useFocusEffect(useCallback(() => {
    const controller = new AbortController(); setFeed({ status: 'loading', promotions: [], popular: null, error: '' });
    Promise.all([customerRepository.promotions(state.governorateId, state.scenario, controller.signal), customerRepository.popularToday(state.governorateId, day, state.scenario, controller.signal)])
      .then(([promotions, popular]) => { if (!controller.signal.aborted) setFeed({ status: 'ready', promotions, popular, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setFeed({ status: 'error', promotions: [], popular: null, error: error.message }); });
    return () => controller.abort();
  }, [day, state.governorateId, state.scenario]));
  return feed;
}
export function HomeScreen() {
  const { state, send } = useCustomer(); const { colors } = useTheme(); const [search, setSearch] = useState('');
  const day = new Date(useCustomerClock()).toISOString().slice(0, 10); const feed = useHomeFeed(day); const gov = governorateById(state.governorateId);
  return <Shell title="تزويد" back={false} subtitle="كل ما تحتاجه، أقرب إليك">
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Chip label={`التوصيل إلى ${gov?.name ?? 'اختر المحافظة'}`} onPress={() => go('/province')} /><Chip label={`الإشعارات (${state.notifications.filter(n => !n.read).length})`} onPress={() => go('/notifications')} /></Row>
    <View testID="home-promotions"><SectionTitle>عروض لك</SectionTitle>{feed.status === 'loading' ? <Skeleton /> : feed.status === 'error' ? <InlineError title={feed.error} retry={() => send({ type: 'scenario', scenario: 'normal' })} /> : feed.promotions.length ? <PromotionList key={state.governorateId} promotions={feed.promotions} /> : <Hint>لا عروض متاحة في هذه المعاينة.</Hint>}</View>
    <View testID="home-categories" style={{ gap: 8 }}><SectionTitle>تسوّق حسب القسم</SectionTitle><Row style={{ flexWrap: 'wrap', gap: 10, alignItems: 'stretch' }}>{categories.map(category => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={`تصفح ${category.name}`} onPress={() => go(`/categories?category=${category.id}`)} style={{ width: '30%', flexGrow: 1, minHeight: 132, backgroundColor: colors.surface, borderRadius: 20, padding: 12, gap: 6, borderWidth: 1, borderColor: colors.border }}><View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, borderRadius: 15 }}><Icon name={category.icon as never} color={colors.primary} size={26} /></View><Txt weight="bold" style={{ fontSize: 14 }}>{category.name}</Txt><Txt style={{ fontSize: 11, lineHeight: 19, color: colors.textMuted }}>{category.subtitle}</Txt></Pressable>)}</Row></View>
    <View testID="home-popular" style={{ gap: 12 }}><SectionTitle>الأكثر طلبًا اليوم</SectionTitle><Txt style={{ fontSize: 12, color: colors.textMuted }}>ترتيب تجريبي في {gov?.name} · {day} UTC · ليس إحصاء مبيعات فعليًا</Txt>{!gov?.catalogBranch ? <Empty text="لم يهيأ فرع الكتالوج لهذه المحافظة في المعاينة." title="تغيير المحافظة" onPress={() => go('/province')} /> : feed.status === 'loading' ? <Skeleton /> : feed.status === 'error' ? <Hint warning>{feed.error}</Hint> : feed.popular?.rows.length ? <ProductGrid products={feed.popular.rows.map(row => row.product)} /> : <Empty text="لا توجد منتجات في ترتيب اليوم التجريبي." title="استعادة البيانات التجريبية" onPress={() => send({ type: 'scenario', scenario: 'normal' })} />}</View>
    <Field label="ماذا تحتاج اليوم؟" placeholder="ابحث عن زيت، بطارية، إطار…" value={search} onChangeText={setSearch} returnKeyType="search" onSubmitEditing={() => go(`/categories?search=${encodeURIComponent(search)}`)} /><Action secondary title="بحث في الكتالوج" onPress={() => go(`/categories?search=${encodeURIComponent(search)}`)} />
    <Action secondary title="كل المنتجات" onPress={() => go('/categories')} /><Hint>سعر وتوفر الكتالوج من {gov?.catalogBranch?.name ?? 'فرع غير مهيأ'}. فرع التنفيذ ينتظر اختيار المدير بعد إرسال الطلب.</Hint><Action secondary title="أدوات المعاينة وحالات الأخطاء" onPress={() => go('/preview-lab')} />
  </Shell>;
}
export function CatalogScreen() {
  const params = useLocalSearchParams<{ category?: string; search?: string }>(); const { state, send } = useCustomer();
  const [categoryId, setCategory] = useState(params.category ?? ''); const [search, setSearch] = useState(params.search ?? ''); const [filters, setFilters] = useState<Record<string, string[]>>({}); const [draft, setDraft] = useState<Record<string, string[]>>({}); const [sort, setSort] = useState<CatalogQuery['sort']>('featured'); const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null);
  useEffect(() => { setCategory(params.category ?? ''); setSearch(params.search ?? ''); setFilters({}); setDraft({}); setSheet(null); }, [params.category, params.search]);
  const category = categoryById(categoryId); const catalog = useCatalog({ governorateId: state.governorateId, categoryId: categoryId || undefined, search, filters, sort });
  const attributes = category?.filters ?? categories[0]!.filters.filter(attribute => attribute.id === 'brand');
  const chooseCategory = (id: string) => { setCategory(id); setFilters({}); setDraft({}); router.setParams({ category: id, search }); };
  return <Shell title="الأقسام والمنتجات" back={false}><Field label="البحث عن منتج" value={search} onChangeText={setSearch} placeholder="اسم المنتج أو رمزه" /><Chips><Chip label="جميع الأقسام" selected={!categoryId} onPress={() => chooseCategory('')} />{categories.map(item => <Chip key={item.id} label={item.name} selected={categoryId === item.id} onPress={() => chooseCategory(item.id)} />)}</Chips><Row><View style={{ flex: 1 }}><Action secondary title={`الفلاتر (${Object.values(filters).flat().length})`} icon="options-outline" onPress={() => { setDraft(filters); setSheet('filters'); }} /></View><View style={{ flex: 1 }}><Action secondary title="ترتيب المنتجات" icon="swap-vertical-outline" onPress={() => setSheet('sort')} /></View></Row><Txt>{category?.subtitle ?? 'منتجات محافظتك في مكان واحد'}</Txt>{catalog.status === 'loading' ? <Skeleton /> : catalog.status === 'error' ? <InlineError title={catalog.error} retry={() => send({ type: 'scenario', scenario: 'normal' })} /> : catalog.rows.length ? <><Txt>{catalog.rows.length} نتيجة · شارات توفر فقط</Txt><ProductGrid products={catalog.rows} /></> : <Empty text="لا نتائج مطابقة. جرّب تغيير البحث أو الفلاتر أو المحافظة." title="مسح البحث والفلاتر" onPress={() => { setSearch(''); setFilters({}); send({ type: 'scenario', scenario: 'normal' }); }} />}<Sheet visible={sheet === 'filters'} title={`فلاتر ${category?.name ?? 'جميع الأقسام'}`} close={() => setSheet(null)}>{attributes.map(attribute => <View key={attribute.id} style={{ gap: 8 }}><Txt weight="bold">{attribute.label}</Txt><Chips>{attribute.values.map(value => <Chip key={value.id} label={value.label} selected={draft[attribute.id]?.includes(value.id)} onPress={() => setDraft(old => ({ ...old, [attribute.id]: old[attribute.id]?.includes(value.id) ? old[attribute.id]!.filter(id => id !== value.id) : [...(old[attribute.id] ?? []), value.id] }))} />)}</Chips></View>)}<Action title="تطبيق الفلاتر" onPress={() => { setFilters(draft); setSheet(null); }} /><Action secondary title="مسح الفلاتر" onPress={() => setDraft({})} /></Sheet><Sheet visible={sheet === 'sort'} title="ترتيب المنتجات" close={() => setSheet(null)}>{([['featured', 'المختارة'], ['price-asc', 'السعر: الأقل أولًا'], ['price-desc', 'السعر: الأعلى أولًا'], ['name', 'الاسم']] as const).map(([value, label]) => <Chip key={value} label={label} selected={sort === value} onPress={() => { setSort(value); setSheet(null); }} />)}</Sheet></Shell>;
}
export function ProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>(); const product = productById(id ?? ''); const { state, send } = useCustomer(); const { colors } = useTheme(); const [unit, setUnit] = useState<UnitKind>('piece'); const [quantity, setQuantity] = useState(1); const [valid, setValid] = useState(true); const [view, setView] = useState(0);
  const cartQuantity = state.cart.find(line => line.productId === id && line.unit === unit)?.quantity ?? 0;
  useEffect(() => { setQuantity(cartQuantity || 1); setValid(true); }, [id, unit, cartQuantity]);
  if (!product) return <Shell title="تفاصيل المنتج"><Empty text="هذا المنتج غير موجود في المعاينة." /></Shell>;
  const available = !!product.prices[state.governorateId ?? '']?.available; const price = priceOf(product, state.governorateId, unit);
  return <Shell title={product.name}><ProductArt product={product} view={view} height={250} /><Chips>{[0, 1, 2].map(index => <Chip key={index} label={`صورة ${index + 1}`} selected={view === index} onPress={() => setView(index)} />)}</Chips><Hint>ثلاثة رسوم توضيحية للمعاينة، وليست صورًا تجارية للمنتج.</Hint><Txt weight="bold" style={{ fontSize: 24, color: colors.primary }}>{price == null ? 'السعر غير مهيأ' : money(price)} / {unitLabel(unit)}</Txt><Txt>{available ? 'متوفر' : 'غير متوفر'} · سعر {governorateById(state.governorateId)?.catalogBranch?.name ?? 'الفرع غير المهيأ'}</Txt><Txt>{product.description}</Txt><Card><Txt>الماركة: {product.brand}</Txt><Txt>المنشأ: {product.origin}</Txt><Txt>الرمز: {product.sku}</Txt>{Object.entries(product.attributes).filter(([key]) => key !== 'brand').map(([key, value]) => { const attribute = categoryById(product.categoryId)?.filters.find(row => row.id === key); return <Txt key={key}>{attribute?.label}: {attribute?.values.find(row => row.id === value)?.label ?? value}</Txt>; })}</Card><Chips><Chip label="حبة" selected={unit === 'piece'} onPress={() => setUnit('piece')} />{product.piecesPerCarton && <Chip label="كرتون" selected={unit === 'carton'} onPress={() => setUnit('carton')} />}</Chips>{product.piecesPerCarton && <Hint>الكرتون = {product.piecesPerCarton} حبة · سعره مستقل: {money(priceOf(product, state.governorateId, 'carton') ?? 0)}. لا نحسبه بضرب سعر الحبة.</Hint>}<Quantity key={`${id}-${unit}`} value={quantity} onChange={setQuantity} canIncrease={available && price != null} onValidityChange={setValid} /><Txt>الكمية النهائية عند الحفظ: {quantity} {unitLabel(unit)} · يعادل {quantity * (unit === 'carton' ? product.piecesPerCarton! : 1)} حبة في سلتك، دون عرض مخزون الفرع.</Txt><Action title={cartQuantity ? "تحديث الكمية" : "إضافة إلى السلة"} icon="bag-add-outline" disabled={!valid || ((!available || price == null) && (!cartQuantity || quantity > cartQuantity))} onPress={() => send({ type: 'cart-set', productId: product.id, unit, quantity }, 'حُدّثت الكمية النهائية في السلة التجريبية.')} /></Shell>;
}
export function ProvinceScreen() { return <Shell title="المحافظة" utility><ProvinceContent /></Shell>; }
export function OffersScreen() { return <Shell title="عروض تزويد"><Card><Icon name="flash-outline" size={36} /><SectionTitle>أفضل توفير واحد</SectionTitle><Txt>المعاينة تقارن توفير المنتجات بنسبة 3٪ مع توفير توصيل حتى150ر.ي، وتختار الأعلى فقط. كسر التعادل بالمعرّف لضمان نتيجة ثابتة.</Txt><Txt>قيم العروض تجريبية، ولا تكديس بينها. عروض الجملة تظهر بعد مراجعة الإدارة ولا نطبق عليها عرض التجزئة تلقائيًا.</Txt><Action title="تصفح المنتجات" onPress={() => go('/categories')} /></Card></Shell>; }
