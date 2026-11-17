import { Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { TextField } from '@/components/common/FormField';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { searchSpecies } from '@/services/api/endpoints';
import { localSpeciesIdFor, type SpeciesLinks } from '@/services/api/plantSync';
import type { PlantSpeciesId } from '@/types';
import type { ApiSpecies } from '@/types/api';

import { PlantIllustration } from './PlantIllustration';

/**
 * 서버 식물 카탈로그(107종) 검색 — 로그인 상태에서만.
 * 서버가 한글·영문 이름, 별칭(예: 적상추, Red leaf lettuce), 옛 학명까지 찾는다.
 * 고른 종은 앱 6종과 연결돼 있으면 그 종으로, 아니면 카탈로그 종(srv-ID)으로 고른다.
 */
export function SpeciesSearch({
  links,
  value,
  onSelect,
}: {
  links: SpeciesLinks;
  value: PlantSpeciesId | null;
  onSelect: (id: PlantSpeciesId) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ q: string; items: ApiSpecies[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    // 입력이 멈추면 검색한다
    const timer = setTimeout(() => {
      searchSpecies(q, 8)
        .then((items) => {
          if (!cancelled) {
            setResult({ q, items });
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : '검색하지 못했어요');
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const items = q && result?.q === q ? result.items : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Search size={16} color={Colors.textTertiary} strokeWidth={1.9} />
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="다른 식물 검색 (예: 적상추, 바질, 고무나무)"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
      </View>
      {!q ? null : error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.note}>
          {error}
        </AppText>
      ) : items === null ? (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.note} />
      ) : items.length === 0 ? (
        <AppText variant="caption" color={Colors.textSecondary} style={styles.note}>
          카탈로그에서 찾지 못했어요. 다른 이름이나 학명으로 찾아보세요.
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((s, i) => {
            const id = localSpeciesIdFor(s.id, links);
            if (!id) return null;
            const active = id === value;
            return (
              <Pressable
                key={s.id}
                onPress={() => onSelect(id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.row,
                  i < items.length - 1 && styles.divider,
                  (pressed || active) && { backgroundColor: Colors.lightGreen },
                ]}>
                <View style={styles.art}>
                  <PlantIllustration speciesId={id} size={34} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="captionStrong">{s.name}</AppText>
                  <AppText variant="small" color={Colors.textSecondary} numberOfLines={1}>
                    {[s.scientificName, `DLI ${s.minDli}–${s.maxDli}`].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { marginTop: Spacing.md },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: { flex: 1 },
  note: { marginTop: Spacing.sm },
  list: {
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  art: {
    width: 40,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});
