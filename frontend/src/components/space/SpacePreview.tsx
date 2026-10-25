import { Compass, Maximize2, PanelsTopLeft } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Plant, Room } from '@/types';

import { FloorPlanGrid } from './FloorPlanGrid';

export interface SpacePreviewProps {
  room: Room;
  plants?: Plant[];
  onPress?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

/** HOME / 스캔 완료 화면에서 쓰는 공간 요약 카드 */
export function SpacePreview({ room, plants = [], onPress, actionLabel, onAction }: SpacePreviewProps) {
  const widthM = (room.cols * room.cellSizeM).toFixed(1);
  const heightM = (room.rows * room.cellSizeM).toFixed(1);

  return (
    <Card onPress={onPress} padding={Spacing.lg} radius={Radius.xl}>
      <View style={styles.row}>
        <View style={styles.planWrap}>
          <FloorPlanGrid
            room={room}
            compact
            markers={plants.map((p) => ({ id: p.id, position: p.location.position }))}
          />
        </View>
        <View style={styles.info}>
          <AppText variant="heading">{room.name}</AppText>
          <View style={styles.metaList}>
            <Meta icon={Compass} text={room.orientationLabel} />
            <Meta icon={PanelsTopLeft} text={`창문 ${room.windows.length}개`} />
            <Meta icon={Maximize2} text={`${widthM} × ${heightM}m`} />
          </View>
          <View style={styles.plantsPill}>
            <View style={styles.greenDot} />
            <AppText variant="small" color={Colors.deepGreen}>
              식물 {plants.length}개 배치됨
            </AppText>
          </View>
        </View>
      </View>
      {actionLabel ? (
        <SecondaryButton title={actionLabel} onPress={onAction} size="md" style={styles.action} />
      ) : null}
    </Card>
  );
}

function Meta({ icon: Icon, text }: { icon: typeof Compass; text: string }) {
  return (
    <View style={styles.meta}>
      <Icon size={14} color={Colors.textSecondary} strokeWidth={1.7} />
      <AppText variant="caption" color={Colors.textSecondary}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  planWrap: {
    width: '46%',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  info: {
    flex: 1,
    gap: Spacing.sm,
  },
  metaList: {
    gap: 6,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plantsPill: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: Colors.lightGreen,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  action: {
    marginTop: Spacing.lg,
  },
});
