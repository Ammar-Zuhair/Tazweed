import { router } from "expo-router";
import { Action, Card, Hint, Shell, Txt } from "../components";
export function CatalogScreen() {
  return (
    <Shell title="الكتالوج" back={false}>
      <Hint>
        ابدأ بالخاصية وقيمها، ثم اربطها بالقسم وفلاتره، ثم أضف المنتج ووحداته
        ومخزونه.
      </Hint>
      {[
        [
          "/attributes",
          "الخصائص وقيمها",
          "مفاتيح وقيم مسجلة، بما فيها الماركة",
        ],
        ["/categories", "الأقسام والفلاتر", "إلزام وترتيب وتصفية لكل قسم"],
        [
          "/products",
          "المنتجات والوحدات",
          "SKU ثابت وصور توضيحية وسعر مستقل للحبة والكرتون",
        ],
        ["/inventory", "مخزون الفروع", "إدخال وجرد وتسوية ونقل بسبب وسجل"],
      ].map(([path, title, body]) => (
        <Card key={path}>
          <Txt weight="bold">{title}</Txt>
          <Txt>{body}</Txt>
          <Action
            title={`إدارة ${title}`}
            secondary
            onPress={() => router.push(path as never)}
          />
        </Card>
      ))}
    </Shell>
  );
}
