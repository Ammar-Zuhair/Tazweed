import type { IconName } from './ui/components';
export const appInfo = {
  "roleLabel": "تطبيق الإدارة",
  "greeting": "مساحة إدارة تزويد",
  "headline": "رؤية أوضح.\nإدارة أكثر تنظيمًا.",
  "description": "مساحة واحدة لفريق تزويد. بداية منظمة لمتابعة العمل والتفاصيل التي تصنع الفرق.",
  "sectionTitle": "مساحتك الإدارية",
  "features": [
    {
      "icon": "layers-outline",
      "title": "أساس منظم",
      "body": "نهيئ مساحة واضحة لفريق الإدارة. لا توجد سجلات تشغيلية في هذه المعاينة."
    },
    {
      "icon": "shield-checkmark-outline",
      "title": "وضوح ومسؤولية",
      "body": "هوية موحدة وتفاصيل مقروءة، استعدادًا لتدفقات العمل في مراحلها."
    }
  ],
  icon: require('../assets/icon.png'),
} satisfies { roleLabel: string; greeting: string; headline: string; description: string; sectionTitle: string; icon: number; features: { icon: IconName; title: string; body: string }[] };
