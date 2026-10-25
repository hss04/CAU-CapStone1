import { MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FloorPlanGrid, type FloorPlanMarker } from '@/components/space/FloorPlanGrid';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { describePosition, isPlaceable, samePosition } from '@/services/space/geometry';
import type { GridPosition, Plant, Room } from '@/types';
import { haptic } from '@/utils/haptics';

export interface LocationValue {
  position: GridPosition;
  label: string;
}

export interface LocationPickerProps {
  room: Room;
  plants: Plant[];
  value: LocationValue | null;
  onChange: (value: LocationValue) => void;
}

/** 현재 위치 선택 — 자주 쓰는 자리 칩 + 평면도에서 직접 탭 */
export function LocationPicker({ room, plants, value, onChange }: LocationPickerProps) {
  const markers: FloorPlanMarker[] = [
    ...plants.map((p) => ({ id: p.id, position: p.location.position, variant: 'ghost' as const })),
    ...(value ? [{ id: 'new', position: value.position, variant: 'plant' as const, label: '여기', showLabel: true }] : []),
  ];

  return (
    <View>
      <View style={styles.chips}>
        {room.spots.map((spot) => {
          const selected = !!value && samePosition(value.position, spot.position);
          return (
            <Pressable
              key={spot.id}
              onPress={() => {
                haptic.selection();
                onChange({ position: spot.position, label: spot.label });
              }}
              style={[styles.chip, selected && styles.chipSelected]}>
              <AppText variant="captionStrong" color={selected ? Colors.white : Colors.text}>
                {spot.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.planCard}>
        <FloorPlanGrid
          room={room}
          showWindowLabels={false}
          markers={markers}
          onCellPress={(pos) => {
            if (!isPlaceable(room, pos)) return;
            haptic.selection();
            const spot = room.spots.find((s) => samePosition(s.position, pos));
            onChange({ position: pos, label: spot?.label ?? describePosition(room, pos) });
          }}
        />
        <View style={styles.caption}>
          <MapPin size={13} color={Colors.textSecondary} strokeWidth={1.8} />
          <AppText variant="small" color={Colors.textSecondary}>
            {value ? `선택한 위치 · ${value.label}` : '평면도를 눌러 직접 위치를 고를 수도 있어요'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: Colors.deepGreen,
    borderColor: Colors.deepGreen,
  },
  planCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: Spacing.sm,
  },
});
