import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Design tokens — 앱 전체에서 색상 / 간격 / 라운드 / 그림자 / 타이포를 통일하기 위한 단일 소스.
 * 새 화면을 만들 때는 반드시 이 파일의 값만 사용한다.
 */

export const Colors = {
  background: '#F7F7F1',
  surface: '#FFFFFF',
  surfaceMuted: '#FBFBF7',
  lightGreen: '#EEF3E8',
  lightGreenStrong: '#E2EBD9',
  primary: '#587A5B',
  primarySoft: '#8AA58A',
  deepGreen: '#35523A',
  text: '#263229',
  textSecondary: '#768077',
  textTertiary: '#A3ABA2',
  mutedGreen: '#A0AA9F',
  border: '#E9EAE1',
  divider: '#F0F1EA',
  sunlight: '#F2B84B',
  sunlightSoft: '#FCF2DA',
  sunlightDeep: '#B9831F',
  water: '#77AAC0',
  waterSoft: '#E7F1F5',
  waterDeep: '#4D8199',
  clay: '#C48B63',
  claySoft: '#F6E8DD',
  clayDeep: '#9E6641',
  markerGray: '#9AA29A',
  overlay: 'rgba(30, 42, 33, 0.28)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  /** 화면 좌우 기본 여백 */
  screen: 22,
} as const;

export const Radius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 28,
  pill: 999,
} as const;

export const Shadows = {
  none: {} as ViewStyle,
  soft: { boxShadow: '0px 6px 22px rgba(53, 82, 58, 0.07)' } as ViewStyle,
  card: { boxShadow: '0px 10px 30px rgba(53, 82, 58, 0.08)' } as ViewStyle,
  floating: { boxShadow: '0px 14px 36px rgba(38, 50, 41, 0.14)' } as ViewStyle,
  button: { boxShadow: '0px 8px 18px rgba(53, 82, 58, 0.22)' } as ViewStyle,
} as const;

/** 로드되는 폰트 패밀리 이름 (useFonts의 key와 동일해야 한다) */
export const FontFamily = {
  serif: 'CormorantGaramond_600SemiBold',
  serifKo: 'GowunBatang_400Regular',
  /** 개발 확인용 화면(숫자/로그) */
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  }),
  sans: Platform.select({
    web: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', Pretendard, 'Malgun Gothic', 'Noto Sans KR', 'Segoe UI', Roboto, sans-serif",
    default: undefined,
  }),
} as const;

export type TypographyVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'value'
  | 'valueLarge'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'captionStrong'
  | 'small'
  | 'eyebrow'
  | 'label'
  | 'button';

type VariantStyle = TextStyle & { serif?: boolean };

/**
 * serif === true 인 variant는 AppText에서
 * - 영문/숫자 → Cormorant Garamond
 * - 한글 포함 → Gowun Batang (크기 자동 보정)
 * 으로 자동 선택된다.
 */
export const Typography: Record<TypographyVariant, VariantStyle> = {
  display: { serif: true, fontSize: 33, lineHeight: 40, letterSpacing: -0.3 },
  title: { serif: true, fontSize: 30, lineHeight: 36, letterSpacing: -0.2 },
  heading: { serif: true, fontSize: 24, lineHeight: 30 },
  value: { serif: true, fontSize: 27, lineHeight: 32 },
  valueLarge: { serif: true, fontSize: 40, lineHeight: 44 },
  h1: { fontSize: 22, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  h2: { fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.3 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: -0.1 },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  small: { fontSize: 11.5, lineHeight: 16, fontWeight: '500' },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 1.8, textTransform: 'uppercase' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
};

export const Layout = {
  /** 웹에서 시연할 때 모바일 폭으로 고정 */
  maxAppWidth: 440,
  tabBarHeight: 64,
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
} as const;

export const IconStroke = 1.6;
