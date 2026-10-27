// 필요한 굵기만 서브패스로 import (패키지 루트에서 import하면 모든 굵기가 번들에 포함됨)
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond/600SemiBold';
import { GowunBatang_400Regular } from '@expo-google-fonts/gowun-batang/400Regular';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/common/Toast';
import { Colors, Layout } from '@/constants/theme';
import { AuthProvider } from '@/store/AuthProvider';
import { GardenProvider, useGarden } from '@/store/GardenProvider';
import { LightForecastProvider } from '@/store/LightForecastProvider';
import { WeatherProvider } from '@/store/WeatherProvider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    CormorantGaramond_600SemiBold,
    GowunBatang_400Regular,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <GardenProvider>
          {/* 날씨와 주간 광환경(DLI)은 서로 다른 데이터라 Provider를 나눈다 */}
          <WeatherProvider>
            <LightForecastProvider>
              <AppFrame>
                <ToastProvider>
                  <StatusBar style="dark" />
                  <RootNavigator />
                </ToastProvider>
              </AppFrame>
            </LightForecastProvider>
          </WeatherProvider>
        </GardenProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { state } = useGarden();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}>
      <Stack.Protected guard={state.hasOnboarded}>
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="plant/[id]" />
        <Stack.Screen name="recommendation/[id]" />
        <Stack.Screen name="light/[plantId]" />
        <Stack.Screen name="room-location" />
        <Stack.Screen name="add-plant" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="login" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="room-scan" />
        <Stack.Screen
          name="window-scan/[windowId]/index"
          options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#0E1511' } }}
        />
        <Stack.Screen name="window-scan/[windowId]/result" />
      </Stack.Protected>
      <Stack.Protected guard={!state.hasOnboarded}>
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  );
}

/** 웹에서 시연할 때 휴대폰 폭으로 가운데 정렬 */
function AppFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <View style={styles.flex}>{children}</View>;
  return (
    <View style={styles.webOuter}>
      <View style={styles.webInner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  webOuter: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#E3E8DD',
  },
  webInner: {
    flex: 1,
    width: '100%',
    maxWidth: Layout.maxAppWidth,
    overflow: 'hidden',
    backgroundColor: Colors.background,
    boxShadow: '0px 0px 40px rgba(38, 50, 41, 0.12)',
  },
});
