import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';

import type { ChipTone } from '@/components/common/StatusChip';
import { Colors } from '@/constants/theme';
import type { WeatherCondition } from '@/types';

const ICONS: Record<WeatherCondition, { day: LucideIcon; night?: LucideIcon }> = {
  sunny: { day: Sun, night: Moon },
  partlyCloudy: { day: CloudSun, night: CloudMoon },
  cloudy: { day: Cloud },
  foggy: { day: CloudFog },
  drizzle: { day: CloudDrizzle },
  rainy: { day: CloudRain },
  snowy: { day: CloudSnow },
  stormy: { day: CloudLightning },
};

export function weatherTone(condition: WeatherCondition): Extract<ChipTone, 'sun' | 'neutral' | 'water'> {
  if (condition === 'sunny' || condition === 'partlyCloudy') return 'sun';
  if (condition === 'cloudy' || condition === 'foggy') return 'neutral';
  return 'water';
}

const TONE_COLOR = { sun: Colors.sunlightDeep, neutral: Colors.markerGray, water: Colors.waterDeep } as const;

export interface WeatherIconProps {
  condition: WeatherCondition;
  isDay?: boolean;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function WeatherIcon({ condition, isDay = true, size = 20, color, strokeWidth = 1.8 }: WeatherIconProps) {
  const set = ICONS[condition];
  const Icon = !isDay && set.night ? set.night : set.day;
  return <Icon size={size} color={color ?? TONE_COLOR[weatherTone(condition)]} strokeWidth={strokeWidth} />;
}
