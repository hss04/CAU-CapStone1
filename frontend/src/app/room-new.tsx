import { router } from 'expo-router';
import { Check, LogIn, Plus, Ruler, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line, Polygon, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { useToast } from '@/components/common/Toast';
import { TopBar } from '@/components/common/TopBar';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import {
  roomPolygon,
  validateManualRoom,
  validateRoomShape,
  wallsOf,
  windowCorners,
  type ManualRoomInput,
  type NotchCorner,
  type RoomShape,
  type Wall,
} from '@/services/space/manualRoom';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';

/** 입력 중인 창문 (숫자는 문자열로 들고 있다가 저장할 때 바꾼다) */
interface WindowDraft {
  key: string;
  wallIndex: number;
  offset: string;
  width: string;
  sill: string;
  height: string;
}

const SHAPE_OPTIONS: { value: RoomShape; label: string }[] = [
  { value: 'rect', label: '직사각형' },
  { value: 'L', label: 'ㄱ자' },
];

const NOTCH_OPTIONS: { value: NotchCorner; label: string }[] = [
  { value: 'topLeft', label: '왼쪽 위' },
  { value: 'topRight', label: '오른쪽 위' },
  { value: 'bottomRight', label: '오른쪽 아래' },
  { value: 'bottomLeft', label: '왼쪽 아래' },
];

/** "1,5"처럼 쉼표로 써도 숫자로 읽는다. 비어 있으면 NaN */
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));

let draftSeq = 1;
const newWindow = (wallIndex = 0): WindowDraft => ({
  key: `w${draftSeq++}`,
  wallIndex,
  offset: '1.0',
  width: '1.5',
  sill: '0.9',
  height: '1.2',
});

/**
 * 방 직접 입력 — ARCore를 쓸 수 없을 때 줄자로 잰 값으로 방을 만든다.
 * 서버 POST /rooms(바닥 모서리) + POST /rooms/{id}/windows(창문 꼭짓점). 방 방향은 창밖 스캔 후 서버가 계산한다.
 */
export default function RoomNewScreen() {
  const { actions } = useGarden();
  const auth = useAuth();
  const toast = useToast();

  const [name, setName] = useState('내 방');
  const [shape, setShape] = useState<RoomShape>('rect');
  const [width, setWidth] = useState('4.0');
  const [depth, setDepth] = useState('3.5');
  const [notch, setNotch] = useState<NotchCorner>('topRight');
  const [notchW, setNotchW] = useState('1.5');
  const [notchD, setNotchD] = useState('1.5');
  const [windows, setWindows] = useState<WindowDraft[]>(() => [newWindow(0)]);
  const [saving, setSaving] = useState(false);

  if (auth.status !== 'signedIn') {
    return (
      <ScreenContainer header={<TopBar title="방 직접 입력" />}>
        <EmptyState
          style={styles.section}
          title="로그인하면 방을 저장할 수 있어요"
          description="직접 입력한 방은 서버에 저장되고, 창밖 스캔·광환경 계산에 쓰여요."
          actionLabel="로그인하기"
          actionIcon={LogIn}
          onAction={() => router.push('/login')}
        />
      </ScreenContainer>
    );
  }

  const input: ManualRoomInput = {
    name,
    shape,
    widthM: num(width),
    depthM: num(depth),
    notch,
    notchWidthM: num(notchW),
    notchDepthM: num(notchD),
    windows: windows.map((w) => ({
      key: w.key,
      wallIndex: w.wallIndex,
      offsetM: num(w.offset),
      widthM: num(w.width),
      sillM: num(w.sill),
      heightM: num(w.height),
    })),
  };
  const error = validateManualRoom(input);
  // 방 모양만 맞으면 미리보기는 그린다 (창문 입력 중이어도)
  const walls = validateRoomShape(input) ? [] : wallsOf(roomPolygon(input));

  const changeShape = (next: RoomShape) => {
    setShape(next);
    // 벽 개수가 바뀌므로 없는 벽을 고른 창문은 첫 벽으로
    const count = next === 'rect' ? 4 : 6;
    setWindows((list) => list.map((w) => (w.wallIndex < count ? w : { ...w, wallIndex: 0 })));
  };

  const updateWindow = (key: string, patch: Partial<WindowDraft>) =>
    setWindows((list) => list.map((w) => (w.key === key ? { ...w, ...patch } : w)));

  const save = async () => {
    if (error) return;
    setSaving(true);
    try {
      await actions.createManualRoom(input);
      toast.show('방을 저장했어요. 이제 방 위치를 알려주세요', 'leaf');
      router.replace('/room-location');
    } catch (e) {
      toast.show(`저장하지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
      setSaving(false);
    }
  };

  return (
    <ScreenContainer
      header={<TopBar title="방 직접 입력" />}
      footer={
        <PrimaryButton
          title={saving ? '저장하는 중…' : '저장하고 이 방 쓰기'}
          icon={Check}
          disabled={!!error || saving}
          onPress={save}
        />
      }>
      <AppText variant="title" style={styles.title}>
        줄자로 잰 값으로 방을 만들어요
      </AppText>
      <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        ARCore를 쓸 수 없을 때 써요. 방 방향은 나중에 창밖 스캔을 하면 자동으로 정해져요.
      </AppText>

      <FormField label="방 이름" required>
        <TextField value={name} onChangeText={setName} placeholder="예: 내 방" maxLength={100} />
      </FormField>

      <FormField label="방 모양" hint="ㄱ자는 직사각형에서 한쪽 모서리가 빠진 모양이에요">
        <SegmentedControl options={SHAPE_OPTIONS} value={shape} onChange={changeShape} />
      </FormField>

      <FormField label="크기 (m)" hint="벽 안쪽에서 잰 전체 가로·세로">
        <View style={styles.row}>
          <NumberField label="가로" value={width} onChange={setWidth} />
          <NumberField label="세로" value={depth} onChange={setDepth} />
        </View>
        {shape === 'L' ? (
          <>
            <AppText variant="captionStrong" style={styles.subLabel}>
              빠진 모서리
            </AppText>
            <ChipRow options={NOTCH_OPTIONS} value={notch} onChange={setNotch} />
            <View style={[styles.row, styles.subRow]}>
              <NumberField label="빠진 부분 가로" value={notchW} onChange={setNotchW} />
              <NumberField label="빠진 부분 세로" value={notchD} onChange={setNotchD} />
            </View>
          </>
        ) : null}
      </FormField>

      {/* 미리보기 — 화면 위쪽이 평면도 위쪽 (방향은 스캔 후 정해짐) */}
      <Card padding={Spacing.lg} radius={Radius.xl} style={styles.section}>
        <AppText variant="captionStrong" color={Colors.textSecondary}>
          미리보기 · 숫자는 벽 번호
        </AppText>
        {walls.length > 0 ? (
          <RoomPreview walls={walls} input={input} />
        ) : (
          <AppText variant="caption" color={Colors.textTertiary} style={styles.previewEmpty}>
            크기를 입력하면 모양이 보여요
          </AppText>
        )}
      </Card>

      <View style={styles.section}>
        <AppText variant="bodyStrong">창문</AppText>
        <AppText variant="caption" color={Colors.textSecondary}>
          거리는 방 안에서 그 벽을 바라볼 때 왼쪽 끝에서 재요.
        </AppText>
        {windows.map((w, i) => (
          <Card key={w.key} padding={Spacing.lg} radius={Radius.lg} style={styles.windowCard}>
            <View style={styles.windowHeader}>
              <AppText variant="h3" style={styles.flex}>{`창문 ${i + 1}`}</AppText>
              {windows.length > 1 ? (
                <Pressable
                  hitSlop={10}
                  accessibilityLabel={`창문 ${i + 1} 삭제`}
                  onPress={() => setWindows((list) => list.filter((x) => x.key !== w.key))}>
                  <X size={18} color={Colors.textTertiary} strokeWidth={1.8} />
                </Pressable>
              ) : null}
            </View>
            {walls.length > 0 ? (
              <ChipRow
                options={walls.map((wall) => ({ value: wall.index, label: `벽 ${wall.index + 1} · ${wall.side} ${wall.lengthM}m` }))}
                value={w.wallIndex}
                onChange={(wallIndex) => updateWindow(w.key, { wallIndex })}
              />
            ) : null}
            <View style={[styles.row, styles.subRow]}>
              <NumberField label="왼쪽 끝에서" value={w.offset} onChange={(offset) => updateWindow(w.key, { offset })} />
              <NumberField label="창 폭" value={w.width} onChange={(v) => updateWindow(w.key, { width: v })} />
            </View>
            <View style={[styles.row, styles.subRow]}>
              <NumberField label="바닥에서 창 아래" value={w.sill} onChange={(sill) => updateWindow(w.key, { sill })} />
              <NumberField label="창 높이" value={w.height} onChange={(v) => updateWindow(w.key, { height: v })} />
            </View>
          </Card>
        ))}
        <SecondaryButton
          title="창문 추가"
          icon={Plus}
          variant="outline"
          size="md"
          onPress={() => setWindows((list) => [...list, newWindow(0)])}
          style={styles.addWindow}
        />
      </View>

      <View style={[styles.section, styles.notice]}>
        <Ruler size={15} color={error ? Colors.clayDeep : Colors.textTertiary} strokeWidth={1.9} />
        <AppText variant="caption" color={error ? Colors.clayDeep : Colors.textSecondary} style={styles.flex}>
          {error ?? '저장하면 이 방이 앱의 방으로 바뀌어요. 그다음 방 위치 → 창문마다 창밖 스캔 순서로 진행해요.'}
        </AppText>
      </View>
    </ScreenContainer>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.flex}>
      <AppText variant="small" color={Colors.textSecondary} style={styles.fieldLabel}>
        {`${label} (m)`}
      </AppText>
      <TextField value={value} onChangeText={onChange} keyboardType="decimal-pad" inputMode="decimal" placeholder="0.0" />
    </View>
  );
}

function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}>
            <AppText variant="captionStrong" color={active ? Colors.white : Colors.textSecondary}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 평면도 미리보기 (m 단위 viewBox) */
function RoomPreview({ walls, input }: { walls: Wall[]; input: ManualRoomInput }) {
  const xs = walls.map((w) => w.from.x);
  const zs = walls.map((w) => w.from.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...zs) - minZ;
  const pad = 0.7;
  const unit = Math.max(w, h) / 14; // 글자·선 굵기를 방 크기에 맞춘다

  return (
    <View style={[styles.preview, { aspectRatio: (w + 2 * pad) / (h + 2 * pad) }]}>
      <Svg width="100%" height="100%" viewBox={`${minX - pad} ${minZ - pad} ${w + 2 * pad} ${h + 2 * pad}`}>
        <Polygon
          points={walls.map((wall) => `${wall.from.x},${wall.from.z}`).join(' ')}
          fill={Colors.lightGreen}
          stroke={Colors.deepGreen}
          strokeWidth={unit * 0.35}
          strokeLinejoin="round"
        />
        {walls.map((wall) => {
          // 화면 시계 방향으로 돌므로 (−dz, dx)가 방 안쪽
          const nx = -(wall.to.z - wall.from.z) / wall.lengthM;
          const nz = (wall.to.x - wall.from.x) / wall.lengthM;
          const mx = (wall.from.x + wall.to.x) / 2 + nx * unit * 1.6;
          const mz = (wall.from.z + wall.to.z) / 2 + nz * unit * 1.6;
          return (
            <SvgText
              key={`wall-${wall.index}`}
              x={mx}
              y={mz + unit * 0.4}
              fontSize={unit * 1.1}
              fontWeight="700"
              fill={Colors.textSecondary}
              textAnchor="middle"
              fontFamily={FontFamily.sans}>
              {`${wall.index + 1}`}
            </SvgText>
          );
        })}
        {input.windows.map((win) => {
          const wall = walls[win.wallIndex];
          if (!wall || ![win.offsetM, win.widthM].every(Number.isFinite) || win.offsetM < 0 || win.offsetM + win.widthM > wall.lengthM) {
            return null;
          }
          const [v0, v1] = windowCorners(wall, { ...win, sillM: 0, heightM: 1 });
          return (
            <Line
              key={win.key}
              x1={v0.x}
              y1={v0.z}
              x2={v1.x}
              y2={v1.z}
              stroke={Colors.water}
              strokeWidth={unit * 0.9}
              strokeLinecap="round"
            />
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  subRow: {
    marginTop: Spacing.md,
  },
  subLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  fieldLabel: {
    marginBottom: 4,
  },
  chips: {
    gap: 6,
    paddingTop: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: '#F0F1EA',
  },
  chipActive: {
    backgroundColor: Colors.deepGreen,
  },
  preview: {
    width: '100%',
    maxHeight: 320,
    marginTop: Spacing.md,
  },
  previewEmpty: {
    marginTop: Spacing.md,
  },
  windowCard: {
    marginTop: Spacing.md,
  },
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addWindow: {
    marginTop: Spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
});
