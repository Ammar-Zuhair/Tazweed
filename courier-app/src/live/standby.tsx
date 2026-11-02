import { Page, Header, Card, Txt, Action } from "../ui/components";
import { useRouter } from "expo-router";
export default function Standby() {
  const router = useRouter();
  return (
    <Page>
      <Header title="تزويد — الموصل" subtitle="متابعة التوصيل" />
      <Card>
        <Txt weight="bold">هذه الصفحة غير متاحة حاليًا</Txt>
        <Txt>يمكن متابعة مهامك ومستحقاتك ونقد المتجر من صفحاتها.</Txt>
        <Action title="فتح المهام" onPress={() => router.replace("/")} />
      </Card>
    </Page>
  );
}
