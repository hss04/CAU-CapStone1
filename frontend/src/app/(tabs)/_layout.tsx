import { Tabs } from 'expo-router/js-tabs';

import { BottomTabBar } from '@/components/navigation/BottomTabBar';
import { Colors } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        sceneStyle: { backgroundColor: Colors.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="space" options={{ title: 'Space' }} />
      <Tabs.Screen name="plants" options={{ title: 'Plants' }} />
      <Tabs.Screen name="my-page" options={{ title: 'My Page' }} />
    </Tabs>
  );
}
