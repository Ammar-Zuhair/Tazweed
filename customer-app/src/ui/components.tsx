import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useId, type PropsWithChildren } from 'react';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { fonts, palette } from './theme-model';
import { useTheme } from './theme-provider';
import { appInfo } from '../config';

export function Txt({ style, weight = 'regular', ...props }: TextProps & { weight?: keyof typeof fonts }) {
  const { colors } = useTheme();
  const resolved = StyleSheet.flatten(style);
  const size = resolved?.fontSize ?? 16;
  const fontSize = size <= 12 ? size + 2 : size <= 16 ? size + 1 : size;
  const lineHeight = size <= 16 ? Math.max(resolved?.lineHeight ?? 27, Math.ceil(fontSize * 1.5)) : resolved?.lineHeight ?? 27;
  const face = weight === 'regular' ? 'medium' : weight;
  return <Text {...(Platform.OS === 'web' ? { lang: 'ar' } : {})} {...props} style={[{ color: colors.text, textAlign: Platform.OS === 'web' ? 'right' : 'left', writingDirection: 'rtl' }, style, { fontFamily: fonts[face], fontSize, lineHeight }]} />;
}
export function Page({ children }: PropsWithChildren) {
  const { colors, name } = useTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
    <View {...(Platform.OS === 'web' ? { dir: 'rtl' as const } : {})} testID={`theme-${name}`} style={{ flex: 1, direction: 'rtl' }}>
      <OrangeBackdrop dark={name === 'dark'} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}><View style={styles.page}>{children}</View></ScrollView>
    </View>
  </SafeAreaView>;
}
/** Decorative layer shared by every customer page; never participates in touch or accessibility. */
function OrangeBackdrop({ dark }: { dark: boolean }) {
  const id = useId().replace(/:/g, '');
  const ring = dark ? '#FFA13D80' : '#F47A136B';
  const glow = (size: number, suffix: string) => <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <Defs><RadialGradient id={`${id}-${suffix}`} cx="48%" cy="45%" r="55%">
      <Stop offset="0" stopColor="#FFD077" stopOpacity={dark ? 0.42 : 0.36} />
      <Stop offset="0.48" stopColor="#FF941F" stopOpacity={dark ? 0.32 : 0.28} />
      <Stop offset="1" stopColor="#F47A13" stopOpacity={dark ? 0.10 : 0.08} />
    </RadialGradient></Defs>
    <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#${id}-${suffix})`} />
    <Circle cx={size / 2} cy={size / 2} r={size * 0.36} fill="none" stroke="#FFB04A" strokeOpacity={dark ? 0.30 : 0.24} strokeWidth="1.5" />
  </Svg>;
  return <View testID="orange-backdrop" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
    <View style={{ position: 'absolute', width: 340, height: 340, top: -110, right: -130 }}>{glow(340, 'top')}</View>
    <View style={{ position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 28, borderColor: ring, top: '36%', left: -155 }} />
    <View style={{ position: 'absolute', width: 420, height: 420, bottom: -210, right: -170 }}>{glow(420, 'bottom')}</View>
    <View style={{ position: 'absolute', width: 70, height: 70, borderRadius: 35, borderWidth: 2, borderColor: dark ? '#FFBD688C' : '#F47A1380', top: '30%', right: 18 }} />
  </View>;
}
export function Row({ children, style, ...props }: ViewProps) {
  return <View {...props} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>{children}</View>;
}
export function Card({ children, style, ...props }: ViewProps) {
  const { colors } = useTheme();
  return <View {...props} style={[{ padding: 20, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 12 }, style]}>{children}</View>;
}
export type IconName = keyof typeof Ionicons.glyphMap;
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.text} accessible={false} />;
}
export function Action({ title, onPress, icon, secondary = false, disabled = false, testID }: { title: string; onPress: () => void; icon?: IconName; secondary?: boolean; disabled?: boolean; testID?: string }) {
  const { colors, name } = useTheme();
  const ink = secondary ? colors.text : name === 'dark' ? palette.navyDeep : '#FFFFFF';
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: secondary ? colors.border : colors.primary, backgroundColor: secondary ? colors.surface : colors.primary, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 })}>
    {icon && <Icon name={icon} color={ink} size={20} />}<Txt weight="bold" style={{ color: ink, flexShrink: 1 }}>{title}</Txt>
  </Pressable>;
}
export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors, name, setPreference } = useTheme();
  return <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}>
    <Row style={{ flex: 1 }}><Image source={appInfo.icon} style={{ width: 50, height: 50, borderRadius: 14, backgroundColor: '#FFFFFF' }} resizeMode="contain" accessibilityLabel={`شعار تزويد ${appInfo.roleLabel}`} />
      <View style={{ flex: 1 }}><Txt weight="bold" style={{ fontSize: 22 }}>{title}</Txt><Txt style={{ color: colors.textMuted, fontSize: 13, lineHeight: 22 }}>{subtitle}</Txt></View></Row>
    <Pressable accessibilityRole="button" accessibilityLabel={name === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع المظلم'} onPress={() => setPreference(name === 'dark' ? 'light' : 'dark')} style={{ padding: 12, borderRadius: 16, backgroundColor: colors.surface }}><Icon name={name === 'dark' ? 'sunny-outline' : 'moon-outline'} /></Pressable>
  </Row>;
}
export function SectionTitle({ children }: PropsWithChildren) {
  return <Txt weight="bold" style={{ fontSize: 21, lineHeight: 32, marginBottom: 14 }}>{children}</Txt>;
}
export function StatusPanel({ status, retry }: { status: 'loading' | 'empty' | 'error'; retry: () => void }) {
  const { colors } = useTheme();
  const title = status === 'loading' ? 'نجهّز مساحتك…' : status === 'error' ? 'تعذر تحميل المعاينة' : 'مساحة لبداية جديدة';
  return <Card testID={`state-${status}`} style={{ alignItems: 'center', paddingVertical: 30 }}>
    {status === 'loading' ? <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="جارٍ التحميل" /> : <Icon name={status === 'error' ? 'cloud-offline-outline' : 'file-tray-outline'} size={36} color={colors.primary} />}
    <Txt weight="bold" style={{ fontSize: 20, textAlign: 'center' }} accessibilityLiveRegion="polite">{title}</Txt>
    <Txt style={{ color: colors.textMuted, textAlign: 'center' }}>{status === 'error' ? 'لم نتمكن من إظهار البيانات. حاول مجددًا.' : status === 'empty' ? 'لا توجد بيانات في هذه المعاينة حاليًا.' : 'لحظات ونكون معك.'}</Txt>
    {status !== 'loading' && <Action title={status === 'error' ? 'إعادة المحاولة' : 'عرض المعاينة'} icon="refresh-outline" onPress={retry} />}
  </Card>;
}

const styles = StyleSheet.create({ scroll: { flexGrow: 1, paddingBottom: 28 }, page: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 18 } });
