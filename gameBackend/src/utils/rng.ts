/**
 * Seeded pseudo-random number generator (mulberry32).
 * Pass the same seed to get identical game outcomes — critical for balance testing.
 */
export function createRng(seed: number) {
  let s = seed >>> 0;

  function next(): number {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** [0, 1) */
    random: next,
    /** [0, max) integer */
    int: (max: number) => Math.floor(next() * max),
    /** [min, max] integer */
    intRange: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** Roll a d6 */
    d6: () => 1 + Math.floor(next() * 6),
    /** Shuffle array in-place, returns same array */
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
