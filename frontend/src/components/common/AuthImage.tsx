import { Image, type ImageContentFit } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, type StyleProp, StyleSheet, View, type ImageStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { absoluteApiUrl, authHeaders } from '@/services/api/client';

/**
 * 로그인해야 볼 수 있는 서버 이미지 (성장 사진 등).
 * 토큰을 URL에 넣지 않고 Authorization 헤더로 받는다.
 * 앱은 이미지 요청에 헤더를 붙이고, 웹은 <img>가 헤더를 못 붙여서 fetch → Blob URL로 보여준다.
 */
export function AuthImage({
  path,
  style,
  contentFit = 'cover',
}: {
  /** 서버 상대 경로 (/api/v1/growth-photos/5/thumbnail) */
  path: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}) {
  const uri = absoluteApiUrl(path);
  const web = Platform.OS === 'web';
  const [blobUrl, setBlobUrl] = useState<{ uri: string; url: string } | null>(null);

  useEffect(() => {
    if (!web) return;
    let cancelled = false;
    let created: string | null = null;
    fetch(uri, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl({ uri, url: created });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [uri, web]);

  if (!web) return <Image source={{ uri, headers: authHeaders() }} style={style} contentFit={contentFit} transition={150} />;
  if (blobUrl?.uri !== uri) return <View style={[styles.placeholder, style as StyleProp<object>]} />;
  return <Image source={{ uri: blobUrl.url }} style={style} contentFit={contentFit} transition={150} />;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: Colors.surfaceMuted },
});
