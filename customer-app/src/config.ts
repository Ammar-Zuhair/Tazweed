import type { IconName } from './ui/components';
export const appInfo = {
  "roleLabel": "تطبيق العميل",
  "greeting": "أهلًا بك في تزويد",
  "headline": "كل ما يدفعك\nإلى الأمام.",
  "description": "عناية بمركبتك وطاقة ليومك. اكتشف عالم تزويد في تجربة عربية واضحة وبسيطة.",
  "sectionTitle": "عالم تزويد",
  "features": [
    {
      "icon": "water-outline",
      "title": "عناية وأداء",
      "body": "زيوت وبطاريات وإطارات. خيارات لمركبتك من اسم تثق به."
    },
    {
      "icon": "sunny-outline",
      "title": "طاقة للمستقبل",
      "body": "حلول الطاقة الشمسية ضمن عالم تزويد."
    }
  ],
  icon: require('../assets/icon.png'),
} satisfies { roleLabel: string; greeting: string; headline: string; description: string; sectionTitle: string; icon: number; features: { icon: IconName; title: string; body: string }[] };
