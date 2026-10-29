import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { appInfo } from '../config';
import { useFoundation } from '../data/foundation-provider';
import type { Scenario } from '../data/foundation-repository';
import { Action, Card, Header, Icon, Page, Row, SectionTitle, StatusPanel, Txt } from './components';
import { palette, type ThemePreference } from './theme-model';
import { useTheme } from './theme-provider';

export function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, retry } = useFoundation();
  return <Page>
    <Header title={appInfo.greeting} subtitle={appInfo.roleLabel} />
    <View style={{ backgroundColor: palette.navy, borderRadius: 26, padding: 24, overflow: 'hidden', gap: 16 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ backgroundColor: '#173E5E', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}><Txt weight="medium" style={{ color: '#FFC08C', fontSize: 13 }}>معك في كل خطوة</Txt></View>
        <View style={{ width: 64, height: 64, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 3 }}><Image source={appInfo.icon} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel={`أيقونة ${appInfo.roleLabel}`} /></View>
      </Row>
      <Txt weight="bold" style={{ color: '#FFFFFF', fontSize: 31, lineHeight: 46, maxWidth: 500 }}>{appInfo.headline}</Txt>
      <Txt style={{ color: '#D7E3ED', lineHeight: 29, maxWidth: 540 }}>{appInfo.description}</Txt>
      <Action title="تعرّف على تزويد" icon="arrow-back-outline" onPress={() => router.push('/about')} />
    </View>
    <Row style={{ marginVertical: 20, backgroundColor: colors.surface, padding: 12, borderRadius: 12 }}>
      <Icon name="flask-outline" color={colors.primary} size={18} /><Txt testID="fake-label" style={{ fontSize: 13, color: colors.textMuted, flex: 1 }}>معاينة تجريبية · لا توجد بيانات تشغيلية</Txt>
    </Row>
    <SectionTitle>{appInfo.sectionTitle}</SectionTitle>
    {status === 'ready' ? <View testID="state-ready" style={{ gap: 12 }}>
      {appInfo.features.map(item => <Card key={item.title}>
        <Row style={{ alignItems: 'flex-start' }}><View style={{ padding: 11, borderRadius: 13, backgroundColor: colors.background }}><Icon name={item.icon} color={colors.primary} size={25} /></View>
          <View style={{ flex: 1 }}><Txt weight="bold" style={{ fontSize: 18 }}>{item.title}</Txt><Txt style={{ color: colors.textMuted, marginTop: 4, fontSize: 14 }}>{item.body}</Txt></View></Row>
      </Card>)}
    </View> : <StatusPanel status={status} retry={retry} />}
    <Row style={{ marginTop: 22, paddingVertical: 8 }}><Icon name="sparkles-outline" color={colors.primary} size={18} /><Txt style={{ color: colors.textMuted, fontSize: 13, flex: 1 }}>تزويد. جودة تثق بها، وتجربة تستحقها.</Txt></Row>
  </Page>;
}

export function AboutScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { setScenario, scenario } = useFoundation();
  const scenarios: { id: Scenario; title: string }[] = [{ id: 'ready', title: 'جاهز' }, { id: 'loading', title: 'تحميل' }, { id: 'empty', title: 'فارغ' }, { id: 'error', title: 'خطأ' }];
  return <Page><Header title="عن تزويد" subtitle="الاسم الذي يجمع احتياجاتك" />
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Image source={appInfo.icon} style={{ width: 130, height: 130, borderRadius: 28, backgroundColor: '#FFFFFF' }} resizeMode="contain" accessibilityLabel="شعار تزويد" />
      <Txt weight="bold" style={{ fontSize: 25, textAlign: 'center' }}>ثقة تدفعك إلى الأمام</Txt>
      <Txt style={{ textAlign: 'center', color: colors.textMuted }}>زيوت وبطاريات وإطارات وطاقة شمسية.{ '\n' }هوية واحدة، وخيارات تصنع الفرق.</Txt>
    </Card>
    <View style={{ marginTop: 28 }}><SectionTitle>ألوان من هويتنا</SectionTitle><Row style={{ gap: 8 }}>{[{ color: palette.navy, label: 'الكحلي' }, { color: palette.orange, label: 'البرتقالي' }, { color: palette.blue, label: 'الأزرق' }].map(item => <View key={item.color} style={{ flex: 1, gap: 7 }}><View style={{ height: 50, borderRadius: 12, backgroundColor: item.color }} /><Txt style={{ textAlign: 'center', fontSize: 13 }}>{item.label}</Txt></View>)}</Row></View>
    <View style={{ marginTop: 28 }}><SectionTitle>تجربة حالات المعاينة</SectionTitle><Txt style={{ color: colors.textMuted, marginBottom: 14, fontSize: 14 }}>بيانات تجريبية فقط. اختر حالة لمراجعة ظهورها في الرئيسية.</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>{scenarios.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`معاينة ${item.title}`} accessibilityState={{ selected: scenario === item.id }} aria-pressed={scenario === item.id} onPress={() => { setScenario(item.id); router.navigate('/'); }} style={{ flexGrow: 1, minWidth: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><Txt weight="medium">{item.title}</Txt></Pressable>)}</Row>
    </View>
  </Page>;
}

export function SettingsScreen() {
  const { colors, preference, setPreference, persistenceError } = useTheme();
  const choices: { id: ThemePreference; title: string; body: string; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
    { id: 'system', title: 'حسب الجهاز', body: 'يتبع مظهر جهازك تلقائيًا', icon: 'phone-portrait-outline' },
    { id: 'light', title: 'الوضع الفاتح', body: 'مساحات مشرقة وتفاصيل واضحة', icon: 'sunny-outline' },
    { id: 'dark', title: 'الوضع المظلم', body: 'هدوء أكثر في الإضاءة المنخفضة', icon: 'moon-outline' },
  ];
  return <Page><Header title="الإعدادات" subtitle="تجربة تناسبك" /><SectionTitle>مظهر التطبيق</SectionTitle>
    <Txt style={{ color: colors.textMuted, marginBottom: 18 }}>اختر مظهرك المفضل. نحفظ اختيارك للمرة القادمة.</Txt>
    <View accessibilityRole="radiogroup" style={{ gap: 12 }}>{choices.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.title} accessibilityState={{ checked: preference === item.id }} aria-checked={preference === item.id} onPress={() => setPreference(item.id)} style={{ borderRadius: 18, padding: 18, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: preference === item.id ? colors.primary : colors.border }}>
      <Row><Icon name={item.icon} color={preference === item.id ? colors.primary : colors.textMuted} /><View style={{ flex: 1 }}><Txt weight="bold">{item.title}</Txt><Txt style={{ color: colors.textMuted, fontSize: 13 }}>{item.body}</Txt></View><Icon name={preference === item.id ? 'radio-button-on' : 'radio-button-off'} color={preference === item.id ? colors.primary : colors.textMuted} /></Row>
    </Pressable>)}</View>
    {persistenceError && <Txt accessibilityRole="alert" style={{ marginTop: 12, color: colors.primary }}>تعذر حفظ التفضيل على هذا الجهاز. يطبق المظهر لهذه الجلسة فقط.</Txt>}
    <Card style={{ marginTop: 28 }}><Row><Icon name="language-outline" /><Txt weight="bold">العربية</Txt></Row><Txt style={{ color: colors.textMuted }}>واجهة من اليمين إلى اليسار، بخط Tajawal.</Txt></Card>
    <Txt style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 24 }}>تزويد · {appInfo.roleLabel} · إصدار المعاينة 0.1.0</Txt>
  </Page>;
}
