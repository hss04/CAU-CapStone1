import { ImageOff } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { formatClock, formatDeg, formatSigned, type CaptureStat } from '@/services/windowScan/scanAnalysis';

export interface CaptureCardProps {
  stat: CaptureStat;
  step: number;
  onPress?: () => void;
}

/** 촬영 이미지 + 촬영 당시 방위각 (개발 확인용) */
export function CaptureCard({ stat, step, onPress }: CaptureCardProps) {
  const { capture, relative, diff, elapsedMs, index } = stat;
  const diffColor =
    diff === null ? Colors.textTertiary : diff > step * 1.6 || diff <= 0 ? '#D9534F' : diff < step * 0.4 ? Colors.sunlightDeep : Colors.primary;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.imageWrap}>
        {capture.imageUri ? (
          <Image source={{ uri: capture.imageUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <ImageOff size={20} color="rgba(255,255,255,0.6)" strokeWidth={1.6} />
            <AppText variant="small" color="rgba(255,255,255,0.6)">
              no image (mock)
            </AppText>
          </View>
        )}
        <View style={styles.indexBadge}>
          <AppText variant="small" color={Colors.white} style={styles.mono}>
            #{index + 1}
          </AppText>
        </View>
      </View>
      <View style={styles.info}>
        <Row k="Azimuth (T)" v={formatDeg(capture.azimuth)} strong />
        <Row k="Magnetic" v={formatDeg(capture.magneticAzimuth)} />
        <Row k="Relative" v={formatDeg(relative)} />
        <Row k="Δ prev" v={diff === null ? '—' : formatSigned(diff)} color={diffColor} />
        <Row k="Pitch" v={capture.pitch === undefined ? '—' : formatSigned(capture.pitch)} />
        <Row k="Time" v={formatClock(capture.timestamp)} />
        <Row k="Elapsed" v={`+${(elapsedMs / 1000).toFixed(2)}s`} />
      </View>
    </Pressable>
  );
}

function Row({ k, v, strong, color }: { k: string; v: string; strong?: boolean; color?: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="small" color={Colors.textTertiary} style={styles.mono}>
        {k}
      </AppText>
      <AppText
        variant="small"
        color={color ?? Colors.text}
        style={[styles.mono, strong && styles.strong]}
        numberOfLines={1}>
        {v}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: '#1C2620',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  indexBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  info: {
    padding: Spacing.sm,
    gap: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: 10.5,
  },
  strong: {
    fontWeight: '700',
    fontSize: 11.5,
  },
});
