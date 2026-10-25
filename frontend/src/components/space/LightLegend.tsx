import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { LIGHT_LEGEND } from '@/services/space/lightAnalysis';

export interface LightLegendProps {
  showPlant?: boolean;
  showWindow?: boolean;
  showRecommendation?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 평면도 하단 범례: 빛 단계 + 마커 */
export function LightLegend({ showPlant = true, showWindow = true, showRecommendation = false, style }: LightLegendProps) {
  return (
    <View style={[styles.row, style]}>
      {LIGHT_LEGEND.map((l) => (
        <View key={l.level} style={styles.item}>
          <View style={[styles.swatch, { backgroundColor: l.color }]} />
          <AppText variant="small" color={Colors.textSecondary}>
            {l.label}
          </AppText>
        </View>
      ))}
      {showWindow ? (
        <View style={styles.item}>
          <View style={styles.window} />
          <AppText variant="small" color={Colors.textSecondary}>
            창문
          </AppText>
        </View>
      ) : null}
      {showPlant ? (
        <View style={styles.item}>
          <View style={[styles.dot, { borderColor: Colors.primary }]} />
          <AppText variant="small" color={Colors.textSecondary}>
            식물
          </AppText>
        </View>
      ) : null}
      {showRecommendation ? (
        <>
          <View style={styles.item}>
            <View style={[styles.dot, { borderColor: Colors.markerGray }]} />
            <AppText variant="small" color={Colors.textSecondary}>
              현재
            </AppText>
          </View>
          <View style={styles.item}>
            <View style={[styles.dot, { borderColor: Colors.white, backgroundColor: Colors.primary }]} />
            <AppText variant="small" color={Colors.textSecondary}>
              추천
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: Spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(53,82,58,0.08)',
  },
  window: {
    width: 14,
    height: 5,
    borderRadius: 2,
    backgroundColor: Colors.waterSoft,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: Colors.water,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    backgroundColor: Colors.white,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.12)',
  },
});
