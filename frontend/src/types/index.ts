export * from './plant';
export * from './room';
export * from './scan';
export * from './windowScan';

export type CharacterState = 'healthy' | 'thirsty' | 'veryThirsty' | 'happy';

export type WeatherCondition = 'sunny' | 'partlyCloudy' | 'cloudy' | 'rainy';

export interface WeatherSnapshot {
  temperature: number;
  condition: WeatherCondition;
  conditionLabel: string;
  humidity: number;
  sunlight: 'high' | 'medium' | 'low';
  sunlightLabel: string;
  bestLightWindow: string;
  location: string;
}

export interface UserProfile {
  name: string;
  nameEn: string;
  email: string;
  joinedAt: string;
}

export interface NotificationSettings {
  watering: boolean;
  environment: boolean;
}
