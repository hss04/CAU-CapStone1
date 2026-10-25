import { router } from 'expo-router';
import { ArrowRight, Check, RotateCcw, Sun } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { FadeInView } from '@/components/common/FadeInView';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { StatusChip } from '@/components/common/StatusChip';
import { FloorPlanGrid } from '@/components/space/FloorPlanGrid';
import { LightLegend } from '@/components/space/LightLegend';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { getLastScanResult } from '@/services/scan';
import { summarizeLight } from '@/services/space/lightAnalysis';
import { useGarden } from '@/store/GardenProvider';

export default function ScanCompleteScreen() {
  const { state } = useGarden();
  const result = getLastScanResult();
  const room = result?.room ?? state.room;
  const summary = summarizeLight(room);

  const stats = [
    { label: 'Windows', value: result?.windowCount ?? room.windows.length },
    { label: 'Objects', value: result?.objectCount ?? room.furniture.length },
    { label: 'Room', value: result?.roomCount ?? 1 },
  ];

  const [pop] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      damping: 10,
      stiffness: 160,
      delay: 150,
    }).start();
  }, [pop]);

  const goToSpace = () => {
    router.dismissAll();
    router.navigate('/space');
  };

  return (
    <ScreenContainer
      edges={['top']}
      footer={
        <>
          <PrimaryButton title="내 공간 확인하기" icon={ArrowRight} iconPosition="right" onPress={goToSpace} />
          <SecondaryButton title="다시 스캔하기" icon={RotateCcw} variant="ghost" size="md" onPress={() => router.replace('/room-scan')} />
        </>
      }>
      <View style={styles.hero}>
        <View style={[styles.planCard, Shadows.card]}>
          <FloorPlanGrid room={room} showWindowLabels={false} />
        </View>
        <Animated.View
          style={[
            styles.badge,
            Shadows.button,
            { transform: [{ scale: pop }], opacity: pop },
          ]}>
          <Check size={30} color={Colors.white} strokeWidth={3} />
        </Animated.View>
      </View>

      <FadeInView delay={200}>
        <AppText variant="label" color={Colors.primary} align="center">
          Scan complete
        </AppText>
        <AppText variant="title" align="center" style={styles.title}>
          공간 스캔이 완료됐어요!
        </AppText>
        <AppText variant="body" color={Colors.textSecondary} align="center" style={styles.subtitle}>
          {room.name} · {room.orientationLabel} · 약 {result?.areaM2 ?? '20'}m²의 공간을 확인했어요.
        </AppText>
      </FadeInView>

      <FadeInView delay={350} style={styles.stats}>
        {stats.map((s) => (
          <Card key={s.label} padding={Spacing.lg} radius={Radius.lg} style={styles.stat}>
            <AppText variant="label" color={Colors.textSecondary}>
              {s.label}
            </AppText>
            <AppText variant="valueLarge" style={styles.statValue}>
              {`${s.value}`}
            </AppText>
          </Card>
        ))}
      </FadeInView>

      <FadeInView delay={500}>
        <Card padding={Spacing.xl} radius={Radius.xl} style={styles.section}>
          <AppText variant="h3">감지된 가구</AppText>
          <View style={styles.chips}>
            {room.furniture.map((f) => (
              <StatusChip key={f.id} label={f.label} tone="green" size="sm" />
            ))}
          </View>
          <View style={styles.divider} />
          <View style={styles.lightRow}>
            <View style={styles.sunIcon}>
              <Sun size={18} color={Colors.sunlightDeep} strokeWidth={1.9} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">빛 환경 분석까지 끝났어요</AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                창가 쪽 {summary.high}%가 밝은 구역, 평균 일조 {summary.averageSunHours}시간이에요.
              </AppText>
            </View>
          </View>
          <LightLegend showPlant={false} style={styles.legend} />
        </Card>
      </FadeInView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    alignItems: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.huge + 4,
  },
  planCard: {
    width: 200,
    padding: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
  },
  badge: {
    position: 'absolute',
    bottom: -22,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.primary,
    borderWidth: 4,
    borderColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xxl,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    marginTop: Spacing.xs,
  },
  section: {
    marginTop: Spacing.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.lg,
  },
  lightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sunIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.sunlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    marginTop: Spacing.md,
  },
});
