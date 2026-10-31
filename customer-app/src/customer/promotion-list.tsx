import { useRef, useState } from 'react';
import { FlatList, Pressable, View, type ViewToken } from 'react-native';
import { Action, Icon, Row, Txt } from '../ui/components';
import { useTheme } from '../ui/theme-provider';
import type { Promotion } from '../fixtures/home';
import { go } from './components';

export function PromotionList({ promotions }: { promotions: Promotion[] }) {
  const { colors } = useTheme(); const [width, setWidth] = useState(300); const [position, setPosition] = useState(0);
  const list = useRef<FlatList<Promotion>>(null); const cardWidth = Math.max(240, width - 28);
  const visible = useRef(({ viewableItems }: { viewableItems: ViewToken<Promotion>[] }) => { if (viewableItems[0]?.index != null) setPosition(viewableItems[0].index); }).current;
  return <View testID="promotions" style={{ gap: 12 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <FlatList ref={list} data={promotions} horizontal keyExtractor={item => item.id} showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + 12} decelerationRate="fast" contentContainerStyle={{ gap: 12 }}
      onViewableItemsChanged={visible} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }} getItemLayout={(_, index) => ({ length: cardWidth + 12, offset: index * (cardWidth + 12), index })}
      renderItem={({ item }) => <View testID={`promotion-${item.id}`} style={{ width: cardWidth, minHeight: 280, padding: 22, gap: 12, backgroundColor: item.color, borderRadius: 26, overflow: 'hidden' }}>
        <View pointerEvents="none" accessible={false} style={{ position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 28, borderColor: '#FF9B4522', bottom: -95, left: -60 }} />
        <Row style={{ justifyContent: 'space-between' }}><Txt weight="medium" style={{ color: '#FFD1AD', fontSize: 13 }}>{item.eyebrow} · تجريبي</Txt><Icon name={item.icon} size={28} color="#FFB374" /></Row>
        <Txt weight="bold" style={{ color: '#FFFFFF', fontSize: 27, lineHeight: 38 }}>{item.title}</Txt><Txt style={{ color: '#E7EDF2', fontSize: 14, lineHeight: 24, flex: 1 }}>{item.body}</Txt>
        <Action title={item.action} onPress={() => go(item.destination)} />
      </View>} />
    <Row style={{ justifyContent: 'center', gap: 8 }}>{promotions.map((item, index) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`العرض ${index + 1} من ${promotions.length}`} accessibilityState={{ selected: position === index }} onPress={() => list.current?.scrollToIndex({ index, animated: true })} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ height: 7, width: position === index ? 26 : 7, borderRadius: 4, backgroundColor: position === index ? colors.primary : colors.border }} /></Pressable>)}</Row>
  </View>;
}
