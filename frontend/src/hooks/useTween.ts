import { useEffect, useRef, useState } from 'react';

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * target 값이 바뀌면 이전 값에서 target까지 requestAnimationFrame으로 보간한다.
 * SVG 속성처럼 네이티브 애니메이션이 까다로운 값에 사용 (iOS / Android / Web 동일 동작).
 */
export function useTween(
  target: number,
  { duration = 700, from, easing = easeOutCubic }: { duration?: number; from?: number; easing?: (t: number) => number } = {},
): number {
  const [value, setValue] = useState(from ?? target);
  const valueRef = useRef(from ?? target);

  useEffect(() => {
    const start = valueRef.current;
    if (start === target) return;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const next = start + (target - start) * easing(t);
      valueRef.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, easing]);

  return value;
}
