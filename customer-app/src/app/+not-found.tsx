import { useRouter } from 'expo-router';
import { Action, Card, Header, Page, Txt } from '../ui/components';
export default function NotFound() {
  const router = useRouter();
  return <Page><Header title="الصفحة غير موجودة" subtitle="يمكنك العودة إلى البداية" /><Card><Txt>لم نعثر على الصفحة المطلوبة.</Txt><Action title="العودة للرئيسية" onPress={() => router.replace('/')} /></Card></Page>;
}
