function hasBatchim(word: string): { has: boolean; isRieul: boolean } {
  const last = word.trim().charCodeAt(word.trim().length - 1);
  if (last < 0xac00 || last > 0xd7a3) return { has: false, isRieul: false };
  const jong = (last - 0xac00) % 28;
  return { has: jong !== 0, isRieul: jong === 8 };
}

/** '창가' → '창가로', '책상 옆' → '책상 옆으로' */
export function withRo(word: string): string {
  const { has, isRieul } = hasBatchim(word);
  return `${word}${has && !isRieul ? '으로' : '로'}`;
}

/** '몬스테라' → '몬스테라가', '올리브나무' → '올리브나무가', '필레아' → '필레아가' */
export function withIga(word: string): string {
  return `${word}${hasBatchim(word).has ? '이' : '가'}`;
}

/** '몬스테라' → '몬스테라는', '책상 옆' → '책상 옆은' */
export function withEunNeun(word: string): string {
  return `${word}${hasBatchim(word).has ? '은' : '는'}`;
}

/** '몬스테라' → '몬스테라를' */
export function withEulReul(word: string): string {
  return `${word}${hasBatchim(word).has ? '을' : '를'}`;
}

/** '몬스테라' → '몬스테라에게' (받침 무관) */
export function withEge(word: string): string {
  return `${word}에게`;
}
