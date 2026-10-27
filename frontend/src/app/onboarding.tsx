import { ArrowRight } from 'lucide-react-native';
import { useRef, useState, type ComponentRef, type ComponentType } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import {
  CareIllustration,
  IntroIllustration,
  RecommendIllustration,
  ScanIllustration,
} from '@/components/onboarding/OnboardingIllustrations';
import { APP_NAME } from '@/constants/app';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useGarden } from '@/store/GardenProvider';

interface Page {
  eyebrow: string;
  title: string;
  description: string;
  Illustration: ComponentType;
}

const PAGES: Page[] = [
  {
    eyebrow: 'Welcome',
    title: '우리 집에서\n식물이 가장 좋아할 곳은\n어디일까요?',
    description: '방의 구조와 빛을 분석해\n식물에게 꼭 맞는 자리를 찾아드려요.',
    Illustration: IntroIllustration,
  },
  {
    eyebrow: 'Step 01 · Scan',
    title: '방을 한 번\n둘러봐 주세요.',
    description: '창문과 공간 구조를 확인해\n빛 환경을 분석해요.',
    Illustration: ScanIllustration,
  },
  {
    eyebrow: 'Step 02 · Placement',
    title: '식물에게 맞는 위치를\n찾아드려요.',
    description: '식물 특성과 우리 집 환경을 비교해\n더 좋은 위치를 추천해요.',
    Illustration: RecommendIllustration,
  },
  {
    eyebrow: 'Step 03 · Care',
    title: '배치 후에도\n함께 관리해요.',
    description: '물주기와 오늘의 햇빛을 확인하고\n식물 상태를 관리해보세요.',
    Illustration: CareIllustration,
  },
];

export default function OnboardingScreen() {
  const { actions } = useGarden();
  // RN 0.88부터 ScrollView가 함수 컴포넌트라 ref 타입을 props에서 꺼낸다
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const isLast = index === PAGES.length - 1;

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.brandDot} />
          <AppText variant="bodyStrong" color={Colors.deepGreen}>
            {APP_NAME}
          </AppText>
        </View>
        {!isLast ? (
          <Pressable hitSlop={12} onPress={actions.completeOnboarding}>
            <AppText variant="captionStrong" color={Colors.textSecondary}>
              건너뛰기
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.flex} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            scrollEventThrottle={16}>
            {PAGES.map(({ eyebrow, title, description, Illustration }, i) => (
              <View key={i} style={[styles.page, { width }]}>
                <View style={styles.illustration}>
                  <Illustration />
                </View>
                <View style={styles.texts}>
                  <AppText variant="label" color={Colors.primary}>
                    {eyebrow}
                  </AppText>
                  <AppText variant="title" style={styles.title}>
                    {title}
                  </AppText>
                  <AppText variant="body" color={Colors.textSecondary} style={styles.description}>
                    {description}
                  </AppText>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <Pressable key={i} hitSlop={6} onPress={() => goTo(i)}>
              <View style={[styles.dot, i === index && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
        <PrimaryButton
          title={isLast ? '시작하기' : '다음'}
          icon={isLast ? undefined : ArrowRight}
          iconPosition="right"
          tone={isLast ? 'deep' : 'primary'}
          onPress={() => (isLast ? actions.completeOnboarding() : goTo(index + 1))}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: { flex: 1 },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screen,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderTopLeftRadius: 0,
    backgroundColor: Colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  page: {
    flex: 1,
    paddingHorizontal: Spacing.screen + 6,
  },
  illustration: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  texts: {
    paddingBottom: Spacing.lg,
  },
  title: {
    marginTop: Spacing.md,
  },
  description: {
    marginTop: Spacing.md,
    lineHeight: 23,
  },
  footer: {
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    gap: Spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#D5DBD0',
  },
  dotActive: {
    width: 26,
    backgroundColor: Colors.primary,
  },
});
