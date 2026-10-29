import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';
import { fonts, palette } from './theme-model';
import { useTheme } from './theme-provider';
import { appInfo } from '../config';

export function Txt({ style, weight = 'regular', ...props }: TextProps & { weight?: keyof typeof fonts }) {
  const { colors } = useTheme();
  return <Text {...(Platform.OS === 'web' ? { lang: 'ar' } : {})} {...props} style={[{ fontFamily: fonts[weight], color: colors.text, fontSize: 16, lineHeight: 27, textAlign: Platform.OS === 'web' ? 'right' : 'left', writingDirection: 'rtl' }, style]} />;
}
export function Page({ children }: PropsWithChildren) {
  const { colors, name } = useTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
    <View {...(Platform.OS === 'web' ? { dir: 'rtl' as const } : {})} testID={`theme-${name}`} style={{ flex: 1, direction: 'rtl' }}>
      <ScrollView contentContainerStyle={styles.scroll}><View style={styles.page}>{children}</View></ScrollView>
    </View>
  </SafeAreaView>;
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

const styles = StyleSheet.create({ scroll: { flexGrow: 1, paddingBottom: 28 }, page: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 22 } });
