import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { House, Map as MapIcon, Sprout, UserRound, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

const TAB_META: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'Home', icon: House },
  space: { label: 'Space', icon: MapIcon },
  plants: { label: 'Plants', icon: Sprout },
  'my-page': { label: 'My Page', icon: UserRound },
};

/** 얇은 line icon + 대문자 라벨의 하단 탭 */
export function BottomTabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const color = focused ? Colors.primary : Colors.mutedGreen;
        const Icon = meta.icon;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptic.selection();
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            onPress={onPress}
            style={styles.item}>
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Icon size={22} color={color} strokeWidth={focused ? 1.8 : 1.5} />
            </View>
            <AppText variant="label" color={color} style={styles.label}>
              {meta.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    boxShadow: '0px -6px 24px rgba(53, 82, 58, 0.06)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  iconWrap: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: Colors.lightGreen,
  },
  label: {
    fontSize: 10.5,
    letterSpacing: 1,
    fontWeight: '600',
  },
});
