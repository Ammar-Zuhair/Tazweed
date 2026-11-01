import { Page, Header, Card, Txt } from "../ui/components";
export default function Standby() {
  return (
    <Page>
      <Header title="تزويد — الموصل" subtitle="الخادم هو مصدر بيانات المهام" />
      <Card>
        <Txt weight="bold">خدمة المهام قيد الربط</Txt>
        <Txt>
          لا توجد مهام أو أرصدة محلية معتمدة. ستتاح المهام والتحصيل والمستحقات
          عند ربط خدمات الموصل.
        </Txt>
      </Card>
    </Page>
  );
}
