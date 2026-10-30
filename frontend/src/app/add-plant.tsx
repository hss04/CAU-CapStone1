import { Sprout } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { Stepper } from '@/components/common/Stepper';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { LightPreferencePicker } from '@/components/plants/LightPreferencePicker';
import { LocationPicker, type LocationValue } from '@/components/plants/LocationPicker';
import { PlacementPreview } from '@/components/plants/PlacementPreview';
import { SpeciesPicker } from '@/components/plants/SpeciesPicker';
import { Colors, Spacing } from '@/constants/theme';
import { getSpecies, PLANT_SPECIES } from '@/data/plantSpecies';
import { analyzePlacement } from '@/services/placement/placementEngine';
import { useGarden } from '@/store/GardenProvider';
import type { LightPreference, PlantSpeciesId } from '@/types';
import { withEulReul } from '@/utils/korean';

export default function AddPlantScreen() {
  const { state, actions } = useGarden();
  const toast = useToast();

  const [speciesId, setSpeciesId] = useState<PlantSpeciesId | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [light, setLight] = useState<LightPreference>('brightIndirect');
  const [wateringDays, setWateringDays] = useState(7);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 서버 데이터를 쓰는 중이면 서버 카탈로그에 있는 종만 등록할 수 있다
  const { status: syncStatus } = state.sync;
  const unavailableReason = syncStatus === 'loading' ? '불러오는 중' : syncStatus === 'error' ? '서버 연결 안 됨' : '서버에 없음';
  const unavailable =
    syncStatus === 'demo'
      ? undefined
      : Object.fromEntries(PLANT_SPECIES.filter((s) => !state.serverSpecies[s.id]).map((s) => [s.id, unavailableReason]));
  const serverSpecies = speciesId ? state.serverSpecies[speciesId] : undefined;

  const selectSpecies = (id: PlantSpeciesId) => {
    const s = getSpecies(id);
    setSpeciesId(id);
    setLight(s.preferredLight);
    setWateringDays(s.wateringIntervalDays);
    if (!nameTouched || !name.trim()) setName(s.name);
  };

  const occupied = state.plants.map((p) => p.location.position);
  const preview = location
    ? analyzePlacement(state.room, { position: location.position, preferredLight: light, label: location.label }, occupied)
    : null;

  const canSubmit = !!speciesId && name.trim().length > 0 && !!location && !submitting;

  const submit = async () => {
    if (!speciesId || !location) return;
    const trimmed = name.trim();
    setSubmitting(true);
    try {
      await actions.createPlant({
        name: trimmed,
        speciesId,
        preferredLight: light,
        wateringIntervalDays: wateringDays,
        position: location.position,
        locationLabel: location.label,
      });
      toast.show(`${withEulReul(trimmed)} 등록했어요 🌱`, 'leaf');
      goBackOrHome();
    } catch (e) {
      toast.show(`등록하지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenContainer
        header={<TopBar title="식물 등록" backIcon="close" />}
        footer={
          <PrimaryButton
            title="식물 등록하기"
            icon={Sprout}
            disabled={!canSubmit}
            loading={submitting}
            onPress={submit}
          />
        }>
        <AppText variant="label" color={Colors.primary} style={styles.eyebrow}>
          New plant
        </AppText>
        <AppText variant="title" style={styles.title}>
          어떤 식물을{'\n'}데려왔나요?
        </AppText>
        <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
          식물 정보를 알려주시면 우리 집에서 가장 잘 맞는 자리를 찾아드릴게요.
        </AppText>

        <FormField label="식물 종류" required hint="종류를 고르면 광량과 물주기가 자동으로 채워져요">
          <SpeciesPicker value={speciesId} onChange={selectSpecies} unavailable={unavailable} />
          {serverSpecies ? (
            <AppText variant="caption" color={Colors.textSecondary} style={styles.dli}>
              {`필요 광량 ${serverSpecies.minDli}–${serverSpecies.maxDli} mol/m²/day (서버 기준)`}
            </AppText>
          ) : null}
        </FormField>

        <FormField label="식물 이름" required>
          <TextField
            value={name}
            onChangeText={(t) => {
              setName(t);
              setNameTouched(true);
            }}
            placeholder="예) 몬스테라, 초록이"
            maxLength={20}
            returnKeyType="done"
          />
        </FormField>

        <FormField label="선호 광량">
          <LightPreferencePicker value={light} onChange={setLight} />
        </FormField>

        <FormField label="물주기 주기">
          <Stepper value={wateringDays} onChange={setWateringDays} min={1} max={30} unit="일" caption={`${wateringDays}일마다 알려드릴게요`} />
        </FormField>

        <FormField label="현재 위치" required hint="지금 식물이 놓여 있는 자리를 골라주세요">
          <LocationPicker room={state.room} plants={state.plants} value={location} onChange={setLocation} />
        </FormField>

        {preview ? (
          <View style={styles.preview}>
            <PlacementPreview analysis={preview} speciesId={speciesId} />
          </View>
        ) : null}
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  eyebrow: {
    marginTop: Spacing.sm,
  },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  preview: {
    marginTop: Spacing.xl,
  },
  dli: {
    marginTop: Spacing.sm,
  },
});
