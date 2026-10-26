import { router } from 'expo-router';
import { ChevronRight, Compass, Hand, MapPin, PanelsTopLeft, Plus, ScanLine, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { Card } from '@/components/common/Card';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/common/IconButton';
import { PageHeader } from '@/components/common/PageHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { StatusChip } from '@/components/common/StatusChip';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { FloorPlanGrid, type FloorPlanMarker } from '@/components/space/FloorPlanGrid';
import { LightLegend } from '@/components/space/LightLegend';
import { LightSummaryCard } from '@/components/space/LightSummaryCard';
import { PlantInfoSheet } from '@/components/space/PlantInfoSheet';
import { WindowDetailSheet } from '@/components/space/WindowDetailSheet';
import { LIGHT_LEVEL_LABEL, TIME_OF_DAY_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { buildMockDliMap, demoGrid, dliAt, MOCK_DLI_NOTE } from '@/services/space/dliMap';
import { describePosition, roomSizeLabel, samePosition } from '@/services/space/geometry';
import { expectedSunHours, lightLevelOf, lightValueAt, summarizeLight } from '@/services/space/lightAnalysis';
import { findWindow, windowFacingLabel, windowName, windowWidthM } from '@/services/space/windows';
import { useGarden, type DliCheck } from '@/store/GardenProvider';
import { getPlantStatus } from '@/store/selectors';
import type { GridPosition, Plant, TimeOfDay } from '@/types';

/** 'dli' = 격자별 DLI 지도 (dli_map_v2), 나머지는 창문 기반 시간대별 추정 광량 */
type MapView = TimeOfDay | 'dli';

const TIME_OPTIONS: { value: MapView; label: string }[] = [
  { value: 'dli', label: 'DLI' },
  { value: 'average', label: '하루 평균' },
  { value: 'morning', label: '오전' },
  { value: 'noon', label: '정오' },
  { value: 'afternoon', label: '오후' },
];

function dliCheckText(check: DliCheck): string | null {
  if (check.status === 'checking') return '서버 규격 검증 중…';
  if (check.status === 'ok') return '서버 규격(dli_map_v2) 검증 통과';
  if (check.status === 'error') return `서버 규격 검증 실패 · ${check.message ?? ''}`;
  return null;
}

function markerStatusOf(plant: Plant, today: Date): FloorPlanMarker['status'] {
  const s = getPlantStatus(plant, today).key;
  if (s === 'thirsty' || s === 'veryThirsty') return 'thirsty';
  if (s === 'needsLight') return 'needsLight';
  return 'ok';
}

export default function SpaceScreen() {
  const { state, today } = useGarden();
  const { room, plants } = state;
  const [view, setView] = useState<MapView>('dli');
  const showDli = view === 'dli';
  const time: TimeOfDay = showDli ? 'average' : view;
  // 서버 방은 동기화 때 만든 지도, 데모 방은 같은 형식의 예시 지도
  const dliMap = useMemo(
    () => state.dliMap ?? buildMockDliMap(room, demoGrid(room), state.today),
    [state.dliMap, room, state.today],
  );
  const checkText = state.dliMap ? dliCheckText(state.dliCheck) : null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<GridPosition | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [windowSheetOpen, setWindowSheetOpen] = useState(false);

  const selected = plants.find((p) => p.id === selectedId) ?? null;
  const selectedWindow = windowId ? findWindow(room, windowId) : undefined;
  const scannedWindowIds = Object.keys(state.windowScans);
  const summary = summarizeLight(room, time);
  const sizeLabel = roomSizeLabel(room);

  const openPlant = (id: string) => {
    setSelectedCell(null);
    setSelectedId(id);
    setSheetOpen(true);
  };

  const closeSheet = () => setSheetOpen(false);

  const openWindow = (id: string) => {
    setSelectedCell(null);
    setSheetOpen(false);
    setWindowId(id);
    setWindowSheetOpen(true);
  };

  const goAfterClose = (fn: () => void) => {
    setSheetOpen(false);
    setWindowSheetOpen(false);
    setTimeout(fn, 160);
  };

  const handleCellPress = (pos: GridPosition) => {
    const plant = plants.find((p) => samePosition(p.location.position, pos));
    if (plant) return openPlant(plant.id);
    setSelectedId(null);
    setSelectedCell((prev) => (prev && samePosition(prev, pos) ? null : pos));
  };

  const markers: FloorPlanMarker[] = plants.map((p) => ({
    id: p.id,
    position: p.location.position,
    variant: 'plant',
    label: p.name,
    showLabel: p.id === selectedId,
    status: markerStatusOf(p, today),
  }));

  const cellValue = selectedCell ? lightValueAt(room, selectedCell, time) : 0;
  const cellDli = selectedCell ? dliAt(dliMap, selectedCell.x, selectedCell.y) : null;

  return (
    <>
      <ScreenContainer>
        <PageHeader
          eyebrow="Light map"
          title="My Space"
          subtitle="내 공간의 빛 환경을 확인해보세요."
          right={<IconButton icon={ScanLine} accessibilityLabel="공간 다시 스캔" onPress={() => router.push('/room-scan')} />}
        />

        <View style={styles.roomChips}>
          <View style={[styles.roomChip, styles.roomChipActive]}>
            <View style={styles.roomDot} />
            <AppText variant="captionStrong" color={Colors.white}>
              {room.name}
            </AppText>
          </View>
          <Pressable
            onPress={() => router.push('/room-scan')}
            style={({ pressed }) => [styles.roomChip, styles.roomChipAdd, pressed && { opacity: 0.7 }]}>
            <Plus size={14} color={Colors.textSecondary} strokeWidth={2} />
            <AppText variant="captionStrong" color={Colors.textSecondary}>
              공간 추가
            </AppText>
          </Pressable>
        </View>

        <Card padding={Spacing.lg} radius={Radius.xl} style={styles.planCard}>
          <View style={styles.planHeader}>
            <View style={styles.flex}>
              <AppText variant="heading">{room.name}</AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                {sizeLabel} · 창문 {room.windows.length}개 · 식물 {plants.length}
              </AppText>
            </View>
            <StatusChip
              label={room.orientationUnknown ? room.orientationLabel : `${room.orientationLabel} · ${room.orientation}`}
              tone={room.orientationUnknown ? 'neutral' : 'sun'}
              icon={Compass}
              size="sm"
            />
          </View>

          <SegmentedControl options={TIME_OPTIONS} value={view} onChange={setView} size="sm" style={styles.segment} />

          <View style={styles.planWrap}>
            <FloorPlanGrid
              room={room}
              timeOfDay={time}
              dli={showDli ? dliMap.totalDli : null}
              markers={markers}
              selectedMarkerId={selectedId}
              onMarkerPress={openPlant}
              onCellPress={handleCellPress}
              selectedCell={selectedCell}
              onWindowPress={openWindow}
              selectedWindowId={windowSheetOpen ? windowId : null}
              scannedWindowIds={scannedWindowIds}
            />
          </View>

          <LightLegend style={styles.legend} dli={showDli} />
          {showDli ? (
            <AppText variant="small" color={Colors.textTertiary} style={styles.dliNote}>
              {`${dliMap.date} · ${MOCK_DLI_NOTE}${checkText ? ` · ${checkText}` : ''}`}
            </AppText>
          ) : null}

          {selectedCell ? (
            <FadeInView key={`${selectedCell.x}-${selectedCell.y}-${view}`}>
              <View style={styles.cellInfo}>
                <View style={styles.cellIcon}>
                  <MapPin size={16} color={Colors.primary} strokeWidth={1.9} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{describePosition(room, selectedCell)}</AppText>
                  <AppText variant="caption" color={Colors.textSecondary}>
                    {showDli && cellDli
                      ? `DLI ${cellDli.total.toFixed(2)} mol/m²/day · 직사 ${cellDli.direct.toFixed(2)} · 산란 ${cellDli.diffuse.toFixed(2)}`
                      : `빛 ${LIGHT_LEVEL_LABEL[lightLevelOf(cellValue)]} · 예상 일조 ${expectedSunHours(cellValue)}시간 · 광량 지수 ${cellValue}`}
                  </AppText>
                </View>
                <Pressable hitSlop={10} onPress={() => setSelectedCell(null)} accessibilityLabel="선택 해제">
                  <X size={18} color={Colors.textTertiary} strokeWidth={1.8} />
                </Pressable>
              </View>
            </FadeInView>
          ) : (
            <View style={styles.hint}>
              <Hand size={14} color={Colors.textTertiary} strokeWidth={1.8} />
              <AppText variant="small" color={Colors.textTertiary}>
                마커·창문·바닥 칸을 눌러 확인해보세요
              </AppText>
            </View>
          )}
        </Card>

        <View style={styles.section}>
          <SectionHeader eyebrow="Outside view" title="창밖 환경" subtitle="창문을 선택해 바깥을 180° 스캔해보세요" />
          <Card padding={0} radius={Radius.xl}>
            {room.windows.map((w, i) => {
              const scan = state.windowScans[w.id];
              return (
                <Pressable
                  key={w.id}
                  onPress={() => openWindow(w.id)}
                  style={({ pressed }) => [
                    styles.plantRow,
                    i < room.windows.length - 1 && styles.rowDivider,
                    pressed && { backgroundColor: Colors.surfaceMuted },
                  ]}>
                  <View style={[styles.rowAvatar, styles.windowAvatar]}>
                    <PanelsTopLeft size={20} color={Colors.waterDeep} strokeWidth={1.7} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{windowName(w)}</AppText>
                    <AppText variant="caption" color={Colors.textSecondary}>
                      {windowFacingLabel(w)} · 폭 약 {windowWidthM(room, w)}m
                    </AppText>
                  </View>
                  <StatusChip
                    label={scan ? `${scan.scannedAngle.toFixed(0)}° · ${scan.captures.length}장` : '스캔 전'}
                    tone={scan ? 'green' : 'neutral'}
                    size="sm"
                  />
                  <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
                </Pressable>
              );
            })}
          </Card>
        </View>

        <View style={styles.section}>
          <LightSummaryCard summary={summary} timeLabel={TIME_OF_DAY_LABEL[time]} />
        </View>

        <View style={styles.section}>
          <SectionHeader eyebrow="Plants" title="이 공간의 식물" subtitle="적합도가 낮은 식물은 추천 위치를 확인해보세요" />
          <Card padding={0} radius={Radius.xl}>
            {plants.length === 0 ? (
              <View style={styles.emptyRow}>
                <AppText variant="caption" color={Colors.textSecondary}>
                  아직 배치된 식물이 없어요.
                </AppText>
              </View>
            ) : (
              plants.map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => openPlant(p.id)}
                  style={({ pressed }) => [
                    styles.plantRow,
                    i < plants.length - 1 && styles.rowDivider,
                    pressed && { backgroundColor: Colors.surfaceMuted },
                  ]}>
                  <View style={styles.rowAvatar}>
                    <PlantIllustration speciesId={p.speciesId} size={40} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{p.name}</AppText>
                    <AppText variant="caption" color={Colors.textSecondary}>
                      {p.location.label} · {LIGHT_LEVEL_LABEL[p.analysis.current.lightLevel]} light
                    </AppText>
                  </View>
                  <StatusChip
                    label={`${p.analysis.current.score}%`}
                    tone={p.analysis.recommended ? 'sun' : 'green'}
                    size="sm"
                  />
                  <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
                </Pressable>
              ))
            )}
          </Card>
        </View>

        <SecondaryButton
          title="공간 다시 스캔하기"
          icon={ScanLine}
          variant="outline"
          onPress={() => router.push('/room-scan')}
          style={styles.section}
        />
      </ScreenContainer>

      <BottomSheet visible={sheetOpen && !!selected} onClose={closeSheet}>
        {selected ? (
          <PlantInfoSheet
            plant={selected}
            today={today}
            onRecommendation={() =>
              goAfterClose(() => router.push({ pathname: '/recommendation/[id]', params: { id: selected.id } }))
            }
            onDetail={() => goAfterClose(() => router.push({ pathname: '/plant/[id]', params: { id: selected.id } }))}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet visible={windowSheetOpen && !!selectedWindow} onClose={() => setWindowSheetOpen(false)}>
        {selectedWindow ? (
          <WindowDetailSheet
            room={room}
            roomWindow={selectedWindow}
            scan={state.windowScans[selectedWindow.id]}
            onScan={() =>
              goAfterClose(() =>
                router.push({ pathname: '/window-scan/[windowId]', params: { windowId: selectedWindow.id } }),
              )
            }
            onViewResult={() =>
              goAfterClose(() =>
                router.push({ pathname: '/window-scan/[windowId]/result', params: { windowId: selectedWindow.id } }),
              )
            }
          />
        ) : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  roomChips: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  roomChipActive: {
    backgroundColor: Colors.deepGreen,
  },
  roomChipAdd: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.surface,
  },
  roomDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#BFD4B8',
  },
  planCard: {
    marginTop: Spacing.lg,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  segment: {
    marginTop: Spacing.lg,
  },
  planWrap: {
    marginTop: Spacing.md,
  },
  legend: {
    marginTop: Spacing.md,
    justifyContent: 'center',
  },
  dliNote: {
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  cellInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGreen,
  },
  cellIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: Spacing.xxl,
  },
  plantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  emptyRow: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  windowAvatar: {
    backgroundColor: Colors.waterSoft,
    justifyContent: 'center',
  },
});
