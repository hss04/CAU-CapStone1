import { Droplet } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, Spacing } from '@/constants/theme';

export interface WaterCycleProps {
  intervalDays: number;
  daysSinceWatered: number;
}

/** 물주기 주기 타임라인 — 지난 날은 채워지고, 마지막 칸이 물 주는 날 */
export function WaterCycle({ intervalDays, daysSinceWatered }: WaterCycleProps) {
  const days = Math.min(intervalDays, 14);
  const passed = Math.min(daysSinceWatered, days);

  return (
    <View>
      <View style={styles.row}>
        {Array.from({ length: days }, (_, i) => {
          const isToday = i === passed - 1 || (passed === 0 && i === 0);
          const filled = i < passed;
          const isLast = i === days - 1;
          return (
            <View key={i} style={styles.item}>
              <View
                style={[
                  styles.dot,
                  filled && styles.dotFilled,
                  isLast && styles.dotLast,
                  isToday && styles.dotToday,
                ]}>
                {isLast ? <Droplet size={11} color={filled ? Colors.white : Colors.water} strokeWidth={2.2} /> : null}
              </View>
              {i < days - 1 ? <View style={[styles.line, filled && i < passed - 1 && styles.lineFilled]} /> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.labels}>
        <AppText variant="small" color={Colors.textTertiary}>
          마지막 물주기
        </AppText>
        <AppText variant="small" color={Colors.textTertiary}>
          다음 물주기
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E6EEF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFilled: {
    backgroundColor: Colors.water,
  },
  dotLast: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.water,
    backgroundColor: Colors.white,
  },
  dotToday: {
    borderWidth: 3,
    borderColor: '#CFE3EC',
  },
  line: {
    flex: 1,
    height: 2,
    backgroundColor: '#E6EEF1',
    marginHorizontal: 2,
  },
  lineFilled: {
    backgroundColor: Colors.water,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
});
