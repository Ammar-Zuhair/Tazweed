import type { IconName } from './ui/components';
export const appInfo = {
  "roleLabel": "تطبيق الموصل",
  "greeting": "رفيقك في الطريق",
  "headline": "خطوات واضحة.\nفي كل مشوار.",
  "description": "مساحتك في تزويد، أينما أخذتك الطريق. تجربة خفيفة وتفاصيل يسهل الوصول إليها.",
  "sectionTitle": "مساحتك على الطريق",
  "features": [
    {
      "icon": "bicycle-outline",
      "title": "بداية الرحلة",
      "body": "هذه معاينة لهوية تطبيق الموصل. لا توجد مهام أو طلبات فعلية بعد."
    },
    {
      "icon": "wallet-outline",
      "title": "وضوح في المستحقات",
      "body": "العمولة ومال المتجر مساران مستقلان. الأرصدة والسجلات تضاف في مرحلتها."
    }
  ],
  icon: require('../assets/icon.png'),
} satisfies { roleLabel: string; greeting: string; headline: string; description: string; sectionTitle: string; icon: number; features: { icon: IconName; title: string; body: string }[] };
