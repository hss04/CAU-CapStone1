import { Bug, Camera, CircleCheck, CloudUpload, Compass, PanelsTopLeft, ScanLine, TriangleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AnalysisSteps, type AnalysisStep } from '@/components/common/AnalysisSteps';
import { AppText } from '@/components/common/AppText';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { StatusChip } from '@/components/common/StatusChip';
import { DEV_TOOLS_ENABLED } from '@/constants/app';
import { ANALYSIS_STEP_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { windowFacingAzimuth, windowFacingLabel, windowName, windowWallLabel, windowWidthM } from '@/services/space/windows';
import { checkScanForUpload } from '@/services/windowScan/uploadPayload';
import type { ScanUploadState } from '@/services/windowScan/uploadService';
import type { Room, RoomWindow, WindowScan } from '@/types';

export interface WindowDetailSheetProps {
  room: Room;
  roomWindow: RoomWindow;
  scan?: WindowScan;
  upload?: ScanUploadState;
  /** 업로드할 수 없는 이유 (로그인 전, 데모 방 등). null이면 업로드 가능 */
  uploadBlocked: string | null;
  /** 방 방향 계산이 실패한 이유 (분석은 끝났는데 방향을 못 구한 경우) */
  directionNote?: string | null;
  onScan: () => void;
  onUpload: () => void;
  onViewResult: () => void;
}

const BUSY = ['preparing', 'uploading', 'analyzing'] as const;

/** 업로드 단계 → 화면 단계 (실제 처리 순서, 퍼센트 없음) */
function uploadSteps(phase: ScanUploadState['phase']): AnalysisStep[] {
  const order = ['preparing', 'uploading', 'analyzing'] as const;
  const labels = { preparing: '사진 준비 중', uploading: '서버로 보내는 중', analyzing: ANALYSIS_STEP_LABEL.sky };
  const current = order.indexOf(phase as (typeof order)[number]);
  return order.map((p, i) => ({ key: p, label: labels[p], status: i < current ? 'done' : i === current ? 'active' : 'pending' }));
}

/** 업로드 상태가 지금 방 구조와 맞지 않으면(위치 저장 등으로 방 버전이 바뀜) 서버가 이 스캔을 쓰지 않는다 */
export function isUploadStale(room: Room, upload: ScanUploadState | undefined): boolean {
  return !!upload && !!room.server && upload.geometryVersion !== room.server.geometryVersion;
}

/** 평면도에서 창문을 선택했을 때의 간단한 상세 */
export function WindowDetailSheet({
  room,
  roomWindow: w,
  scan,
  upload,
  uploadBlocked,
  directionNote,
  onScan,
  onUpload,
  onViewResult,
}: WindowDetailSheetProps) {
  const problem = scan ? checkScanForUpload(scan) : null;
  const stale = isUploadStale(room, upload);
  const busy = !!upload && !stale && (BUSY as readonly string[]).includes(upload.phase);
  const done = !!upload && !stale && upload.phase === 'done';
  const canUpload = !!scan && !uploadBlocked && !problem && !busy && !done;
  /** 사진은 이 기기에 없지만 서버에 분석된 스캔이 있는 경우 (앱을 다시 설치했거나 다른 기기에서 스캔) */
  const serverOnly = !scan && (done || busy);

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.icon}>
          <PanelsTopLeft size={24} color={Colors.waterDeep} strokeWidth={1.7} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">{windowName(w)}</AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {room.name} · {windowWallLabel(w)} · 폭 약 {windowWidthM(room, w)}m
          </AppText>
        </View>
        <StatusChip
          label={w.facingUnknown ? windowFacingLabel(w) : `${w.facing} · ${windowFacingAzimuth(w)}°`}
          tone={w.facingUnknown ? 'neutral' : 'sun'}
          icon={Compass}
          size="sm"
        />
      </View>

      <AppText variant="label" color={Colors.textSecondary} style={styles.sectionLabel}>
        Outside environment
      </AppText>

      {scan ? (
        <View style={[styles.status, styles.statusDone]}>
          <CircleCheck size={20} color={Colors.primary} strokeWidth={2} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color={Colors.deepGreen}>
              외부 환경 스캔 완료
            </AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              {scan.scannedAngle.toFixed(0)}° 스캔 · 사진 {scan.captures.length}장 · {scan.startAzimuth.toFixed(0)}° →{' '}
              {scan.endAzimuth.toFixed(0)}°
            </AppText>
          </View>
        </View>
      ) : serverOnly ? null : (
        <View style={styles.status}>
          <Camera size={20} color={Colors.textTertiary} strokeWidth={1.8} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">아직 외부 환경을 스캔하지 않았어요</AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              창문 앞에서 바깥을 180° 스캔하면, 하늘이 보이는 방향과 건물·나무에 가려지는 방향을 분석할 수 있어요.
            </AppText>
          </View>
        </View>
      )}

      {/* 서버 업로드 · SKY 분석 */}
      {scan || serverOnly ? (
        <View style={styles.upload}>
          {busy && upload ? (
            <AnalysisSteps title="창밖 사진을 분석하고 있어요" caption="분석은 서버에서 진행돼요. 다른 화면으로 가도 계속돼요." steps={uploadSteps(upload.phase)} />
          ) : done ? (
            <View style={[styles.status, styles.statusDone]}>
              <CloudUpload size={20} color={Colors.primary} strokeWidth={1.9} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" color={Colors.deepGreen}>
                  창밖 환경 분석 완료
                </AppText>
                <AppText variant="caption" color={Colors.textSecondary}>
                  이 창문의 하늘·가림 정보가 서버 광환경 계산에 쓰여요.
                </AppText>
                {room.orientationUnknown && directionNote ? (
                  <AppText variant="small" color={Colors.clayDeep} style={styles.directionNote}>
                    {`방 방향은 아직 못 구했어요 · ${directionNote}`}
                  </AppText>
                ) : null}
              </View>
            </View>
          ) : (
            <Note
              warn={!!problem || upload?.phase === 'failed' || stale}
              text={
                problem ??
                uploadBlocked ??
                (stale
                  ? '방 정보(위치 등)가 바뀌어 서버가 이전 스캔을 쓰지 않아요. 다시 보내 주세요.'
                  : upload?.phase === 'failed'
                    ? `보내지 못했어요 · ${upload.error ?? '알 수 없는 오류'}`
                    : '서버로 보내면 하늘이 보이는 방향을 분석해 광환경 계산에 써요. 사진 13장과 촬영 방향이 전송돼요.')
              }
            />
          )}
        </View>
      ) : null}

      <View style={styles.actions}>
        {canUpload ? (
          <>
            <PrimaryButton title={upload ? '서버로 다시 보내기' : '서버로 보내기'} icon={CloudUpload} onPress={onUpload} />
            <SecondaryButton title="창밖 다시 스캔하기" icon={ScanLine} variant="ghost" size="md" onPress={onScan} />
          </>
        ) : (
          <PrimaryButton title={scan ? '창밖 다시 스캔하기' : '창밖 스캔하기'} icon={ScanLine} onPress={onScan} disabled={busy} />
        )}
        {scan && DEV_TOOLS_ENABLED ? (
          <SecondaryButton title="스캔 결과 보기 (Dev)" icon={Bug} variant="ghost" size="md" onPress={onViewResult} />
        ) : null}
      </View>
    </View>
  );
}

function Note({ text, warn }: { text: string; warn: boolean }) {
  return (
    <View style={styles.note}>
      {warn ? <TriangleAlert size={16} color={Colors.clayDeep} strokeWidth={2} /> : <CloudUpload size={16} color={Colors.textTertiary} strokeWidth={1.9} />}
      <AppText variant="caption" color={warn ? Colors.clayDeep : Colors.textSecondary} style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.waterSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  statusDone: {
    backgroundColor: Colors.lightGreen,
    borderColor: Colors.lightGreen,
  },
  upload: {
    marginTop: Spacing.md,
  },
  directionNote: {
    marginTop: Spacing.xs,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  actions: {
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
});
