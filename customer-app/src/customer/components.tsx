import { useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Action, Card, Header, Icon, Page, Row, SectionTitle, Txt } from '../ui/components';
import { useTheme } from '../ui/theme-provider';
import { fonts } from '../ui/theme-model';
import { useCustomer } from '../data/customer-provider';
import { governorates, governorateById, productById } from '../fixtures/catalog';
import { priceOf } from '../domain/catalog';
import type { Product } from '../domain/types';

export const money = (value: number) => `${value.toLocaleString('en-US')} ر.ي`;
export const unitLabel = (value: string) => value === 'carton' ? 'كرتون' : 'حبة';
export function go(path: string) { router.push(path as never); }
export function Back({ title = 'رجوع' }: { title?: string }) { return <Action secondary title={title} icon="arrow-forward-outline" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />; }
export function Hint({ children, warning = false }: PropsWithChildren<{ warning?: boolean }>) {
  const { colors } = useTheme();
  return <View style={{ padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: warning ? colors.primary : colors.border }}><Txt style={{ fontSize: 14, lineHeight: 24, color: colors.textMuted }}>{children}</Txt></View>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 6 }}><Txt weight="medium">{label}</Txt><TextInput accessibilityLabel={label} placeholderTextColor={colors.textMuted} {...props} style={[{ fontFamily: fonts.regular, fontSize: 16, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 13, minHeight: 52, textAlign: 'right', writingDirection: 'rtl' }, props.style]} /></View>;
}
export function Chip({ label, selected = false, onPress, testID }: { label: string; selected?: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} testID={testID} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', maxWidth: '100%', flexShrink: 1, paddingHorizontal: 15, paddingVertical: 7, borderRadius: 24, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface }}><Txt weight={selected ? 'bold' : 'regular'} style={{ fontSize: 14, color: selected ? colors.primary : colors.text }}>{label}</Txt></Pressable>;
}
export function Chips({ children }: PropsWithChildren) { return <Row style={{ flexWrap: 'wrap', gap: 8 }}>{children}</Row>; }
export function Pair({ label, value }: { label: string; value: string }) { const { colors } = useTheme(); return <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt style={{ color: colors.textMuted, flexShrink: 1 }}>{label}</Txt><Txt weight="bold" style={{ flexShrink: 1 }}>{value}</Txt></Row>; }
export function Quantity({ value, onChange, label = 'الكمية' }: { value: number; onChange: (n: number) => void; label?: string }) {
  return <View style={{ gap: 8 }}><Txt>{label}</Txt><Row><Chip label="إنقاص الكمية" onPress={() => onChange(Math.max(1, value - 1))} /><Txt weight="bold" accessibilityLabel={`${label}: ${value}`}>{value}</Txt><Chip label="زيادة الكمية" onPress={() => onChange(Math.min(999, value + 1))} /></Row></View>;
}
export function Sheet({ visible, title, close, children }: PropsWithChildren<{ visible: boolean; title: string; close: () => void }>) {
  const { colors } = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}><View style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' }}><Pressable accessibilityRole="button" accessibilityLabel="إغلاق النافذة" onPress={close} style={{ flex: 1, minHeight: 30 }} /><View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, gap: 16, direction: 'rtl', width: '100%', maxWidth: 820, alignSelf: 'center' }}><SectionTitle>{title}</SectionTitle><ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 10 }}>{children}</ScrollView><Action title="إغلاق" secondary onPress={close} /></View></View></Modal>;
}
export function ProductArt({ product, view = 0, height = 135 }: { product: Product; view?: number; height?: number }) {
  const kind = product.categoryId;
  return <View accessibilityLabel={`رسم توضيحي تجريبي ${product.name}، زاوية ${view + 1}`} accessibilityRole="image" style={{ height, borderRadius: 16, backgroundColor: '#E9EEF3', overflow: 'hidden' }}><Svg width="100%" height="100%" viewBox="0 0 300 180">
    <Circle cx="150" cy="90" r="76" fill="#D9E2EA" /><Path d="M35 145H265" stroke="#CBD6E0" strokeWidth="2" />
    <G transform={`rotate(${view === 1 ? -10 : view === 2 ? 9 : 0},150,90) translate(${view === 2 ? -9 : 0},0)`}>{(kind === 'tires' || kind === 'patches') ? <><Circle cx="150" cy="88" r={kind === 'tires' ? 63 : 46} fill="#183349" /><Circle cx="150" cy="88" r="31" fill={product.color} /><Circle cx="150" cy="88" r="18" fill="#D9E2EA" /><Path d="M100 53L111 67M185 46L178 63M198 118L181 112M111 132L120 117" stroke="#718293" strokeWidth="5" /></> : kind === 'solar' ? <><Rect x="72" y="31" width="156" height="116" rx="5" fill="#143B5B" stroke={product.color} strokeWidth="6" /><Path d="M111 34V144M150 34V144M189 34V144M75 69H225M75 107H225" stroke="#8DB1CD" strokeWidth="2" /></> : <><Path d={kind === 'oils' ? 'M112 29H162V52L192 70V151H100V58H112Z' : 'M94 52H205V142H94Z'} fill={product.color} stroke="#173A54" strokeWidth="3" /><Rect x="111" y="80" width="77" height="43" rx="5" fill="#F7FAFC" /><Path d="M140 84L127 106H145L139 119L165 96H147L155 84Z" fill="#173A54" />{kind === 'batteries' && <Path d="M111 42V54M184 42V54" stroke="#173A54" strokeWidth="12" />}</>}
    </G><SvgText x="150" y="169" textAnchor="middle" fontSize="10" fill="#183349">TAZWEED · DEMO · {view + 1}</SvgText>
  </Svg></View>;
}
export function ProductCard({ product }: { product: Product }) {
  const { state } = useCustomer(); const { colors } = useTheme(); const available = !!product.prices[state.governorateId ?? '']?.available;
  return <Pressable accessibilityRole="button" accessibilityLabel={`تفاصيل ${product.name}`} onPress={() => go(`/product?id=${product.id}`)} style={{ width: '48%', flexGrow: 1, maxWidth: 380, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 12, gap: 8 }}><ProductArt product={product} /><Txt style={{ fontSize: 13, color: colors.textMuted }}>{product.brand}</Txt><Txt weight="bold" numberOfLines={2} style={{ minHeight: 52 }}>{product.name}</Txt><Txt weight="bold" style={{ color: colors.primary }}>{money(priceOf(product, state.governorateId, 'piece') ?? 0)}</Txt><Txt style={{ fontSize: 13, color: colors.textMuted }}>{available ? 'متوفر' : 'غير متوفر'} · للحبة</Txt></Pressable>;
}
export function ProductGrid({ products }: { products: Product[] }) { return <Row style={{ flexWrap: 'wrap', alignItems: 'stretch', gap: 12 }}>{products.map(product => <ProductCard key={product.id} product={product} />)}</Row>; }
export function Skeleton() { const { colors } = useTheme(); return <View testID="catalog-loading" accessibilityLabel="جارٍ تحميل المنتجات" style={{ gap: 12 }}><ActivityIndicator color={colors.primary} /><Row>{[1, 2].map(id => <View key={id} style={{ flex: 1, height: 215, backgroundColor: colors.border, borderRadius: 20 }} />)}</Row><Txt>نحمّل كتالوج المعاينة…</Txt></View>; }
export function LoginPrompt() { return <Card><Icon name="person-circle-outline" size={40} /><SectionTitle>أكمل الدخول التجريبي</SectionTitle><Txt>طلباتك وعناوينك وبياناتك الشخصية تظهر بعد التحقق المحلي. لا تستخدم معلومات حساسة.</Txt><Action title="تسجيل الدخول" onPress={() => go('/auth')} /><Action secondary title="إنشاء حساب تجريبي" onPress={() => go('/auth?mode=register')} /></Card>; }
export function ProvinceContent() {
  const { state, send } = useCustomer();
  return <View style={{ gap: 16 }}><SectionTitle>أين تريد التوصيل؟</SectionTitle><Txt>المحافظة تحدد فرع الكتالوج والسعر والتوفر. يختار المدير فرع التنفيذ بعد إرسال الطلب.</Txt>{state.cart.length > 0 && <Hint warning>لن نحذف السلة عند التغيير. ستراجع أسعار وتوفر الفرع الجديد، وقد تحتاج عنوانًا من المحافظة الجديدة.</Hint>}{governorates.map(gov => <Action key={gov.id} secondary={state.governorateId !== gov.id} title={gov.name} onPress={() => { if (send({ type: 'governorate', id: gov.id }, 'تم تغيير محافظة المعاينة.').ok) router.replace('/'); }} />)}<Hint>أسماء الفروع والتغطية والأسعار بيانات تجريبية للمراجعة فقط.</Hint></View>;
}
export function GateContent() {
  const { state, send, notify } = useCustomer(); const maintenance = state.gate === 'maintenance';
  if (state.gate === 'normal' || (state.gate === 'optional-update' && state.updateDismissed)) return <Card><SectionTitle>التطبيق متاح في المعاينة</SectionTitle><Action title="فتح الرئيسية" onPress={() => go('/')} /></Card>;
  return <View testID={`gate-${state.gate}`} style={{ gap: 18 }}><View style={{ backgroundColor: '#102D46', borderRadius: 26, padding: 28, gap: 18 }}><Icon name={maintenance ? 'construct-outline' : 'download-outline'} color="#FF8B3D" size={52} /><Txt weight="bold" style={{ color: '#FFFFFF', fontSize: 28, lineHeight: 40 }}>{maintenance ? 'نعود إليك قريبًا' : state.gate === 'required-update' ? 'يلزم تحديث تزويد' : 'نسخة جديدة بانتظارك'}</Txt><Txt style={{ color: '#D9E2EA' }}>{maintenance ? 'صيانة تجريبية. يمكنك متابعة الطلبات الجارية وإجراءاتها أو طلب حذف الحساب.' : 'بوابة إصدار محلية للمراجعة. رابط المتجر لم يضبط بعد؛ لا تنزيل أو تحديث حقيقي.'}</Txt></View>{maintenance ? <Action title="إعادة المحاولة" onPress={() => notify('ما زالت الصيانة التجريبية مفعلة. غيّر السيناريو من أدوات المعاينة.')} /> : <Action title="معلومات التحديث" onPress={() => notify('لم يزود رابط متجر معتمد. هذه شاشة محاكاة، ولا تنفذ تحديثًا فعليًا.')} />}{state.gate === 'optional-update' && <Action secondary title="لاحقًا" onPress={() => send({ type: 'dismiss-update' })} />}<Action secondary title="الطلبات الجارية" onPress={() => go('/orders')} /><Action secondary title="الدعم" onPress={() => go('/support')} /><Action secondary title="الخصوصية وحذف الحساب" onPress={() => go('/privacy')} /><Action secondary title="أدوات المعاينة" onPress={() => go('/preview-lab')} /></View>;
}
export function Shell({ title, subtitle, children, utility = false, cart = true, back = true }: PropsWithChildren<{ title: string; subtitle?: string; utility?: boolean; cart?: boolean; back?: boolean }>) {
  const { state, ready } = useCustomer(); const { colors } = useTheme();
  const blocked = !utility && (state.gate === 'maintenance' || state.gate === 'required-update' || (state.gate === 'optional-update' && !state.updateDismissed));
  return <View style={{ flex: 1 }}><Page><Header title={title} subtitle={subtitle ?? 'تزويد · كل ما تحتاجه، في مكان واحد'} /><View style={{ gap: 18, paddingBottom: state.cart.length && cart ? 98 : 24 }}>
    {back && <Row style={{ flexWrap: 'wrap' }}><Back /><Chip label="الرئيسية" onPress={() => router.replace('/')} /></Row>}<Hint>معاينة محلية · بيانات وأسعار وعمليات تجريبية دون دفع أو رسائل حقيقية.</Hint>
    {!ready ? <Skeleton /> : blocked ? <GateContent /> : !state.governorateId && !utility ? <ProvinceContent /> : children}

  </View></Page>{!!state.cart.length && cart && !blocked && state.governorateId && <View style={{ position: 'absolute', bottom: 12, left: 20, right: 20, maxWidth: 780, alignSelf: 'center', width: '90%', borderRadius: 16, backgroundColor: colors.background }}><Action title={`السلة · ${state.cart.reduce((sum, line) => sum + line.quantity, 0)} وحدة`} icon="bag-outline" onPress={() => go('/cart')} /></View>}</View>;
}
export function InlineError({ title, retry }: { title: string; retry: () => void }) { return <Card testID="catalog-error"><Icon name="cloud-offline-outline" size={36} /><Txt>{title}</Txt><Action title="إعادة المحاولة" onPress={retry} /></Card>; }
export function Empty({ text, title = 'استعرض المنتجات', onPress = () => go('/categories') }: { text: string; title?: string; onPress?: () => void }) { return <Card testID="empty-state"><Icon name="file-tray-outline" size={38} /><Txt>{text}</Txt><Action secondary title={title} onPress={onPress} /></Card>; }
export function LocalPhoto({ uri }: { uri: string | null }) { return !uri ? null : uri.startsWith('preview:') ? <Card><Icon name="receipt-outline" size={42} /><Txt>صورة اختبار تجريبية · DEMO</Txt><Txt>لا تمثل إيصالًا أو دفعة حقيقية.</Txt></Card> : <Image source={{ uri }} style={{ width: '100%', height: 210, borderRadius: 14 }} resizeMode="contain" accessibilityLabel="الصورة المحلية المختارة للمراجعة" />; }
export function PhotoPicker({ value, onChange }: { value: string | null; onChange: (uri: string | null) => void }) {
  const { notify } = useCustomer(); const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.65 }); if (!result.canceled && result.assets[0]) onChange(result.assets[0].uri); }
    catch { notify('تعذر فتح الصور. تحقق من إذن الصور أو استخدم صورة الاختبار.'); } finally { setBusy(false); }
  };
  return <View style={{ gap: 12 }}><LocalPhoto uri={value} /><Action secondary title={busy ? 'جارٍ اختيار الصورة…' : 'اختيار صورة من الجهاز'} disabled={busy} icon="image-outline" onPress={pick} /><Action secondary title="استخدام صورة اختبار" onPress={() => onChange('preview:receipt')} />{value && <Action secondary title="إزالة الصورة" onPress={() => onChange(null)} />}<Hint>اختر صورة اختبار فقط. تبقى في ذاكرة التطبيق، ولا ترفع إلى خادم.</Hint></View>;
}
export function CopyAction({ title, value }: { title: string; value: string }) { const { notify } = useCustomer(); return <Action secondary title={title} icon="copy-outline" onPress={async () => { try { await Clipboard.setStringAsync(value); notify('تم النسخ.'); } catch { notify(`تعذر النسخ تلقائيًا؛ النص هو: ${value}`); } }} />; }
export function CartLineName({ productId }: { productId: string }) { return <Txt weight="bold">{productById(productId)?.name ?? 'منتج تجريبي'}</Txt>; }

/** One feedback layer across navigation, rather than a copy in every retained screen. */
export function Feedback() {
  const { message, notify } = useCustomer(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  if (!message) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="إغلاق التنبيه" onPress={() => notify('')} style={{ position: 'absolute', zIndex: 10, top: insets.top + 12, left: 16, right: 16, maxWidth: 780, alignSelf: 'center', direction: 'rtl' }}><Card testID="feedback" style={{ borderWidth: 2, borderColor: colors.primary, padding: 14 }}><Txt accessibilityLiveRegion="polite">{message}</Txt><Txt style={{ fontSize: 12 }}>اضغط لإغلاق التنبيه</Txt></Card></Pressable>;
}
