const modules = import.meta.glob('../../assets/survivors/*.png', { eager: true, import: 'default' }) as Record<string, string>;

const PORTRAITS: string[] = Object.keys(modules).sort().map((key) => modules[key]);

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Portrait art is generic (no name/identity baked in), so the same survivor
 * template deterministically gets the same portrait every game via a hash of
 * its template id — no per-survivor art assignment to maintain by hand.
 */
export function getSurvivorPortrait(templateId: string): string | null {
  if (PORTRAITS.length === 0) return null;
  return PORTRAITS[hashString(templateId) % PORTRAITS.length];
}
