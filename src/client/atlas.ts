export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  duration?: number;
}

interface RawAtlas {
  frames: Record<string, AtlasFrame>;
  meta?: {
    size?: { w: number; h: number };
    duration_s?: number;
  };
}

export interface AtlasClip {
  imageUrl: string;
  sheetWidth: number;
  sheetHeight: number;
  frames: AtlasFrame[];
  durationS: number;
}

// Loads a single animation clip from `<basePath>/atlas.json` and
// `<basePath>/spritesheet.png`.
export async function loadAtlasClip(basePath: string): Promise<AtlasClip | null> {
  try {
    const res = await fetch(`${basePath}/atlas.json`);
    if (!res.ok) return null;
    const raw = (await res.json()) as RawAtlas;
    const keys = Object.keys(raw.frames);
    if (!keys.length) return null;

    const sorted = keys
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
      .map((n) => raw.frames[String(n)])
      .filter((f): f is AtlasFrame => !!f);
    if (!sorted.length) return null;

    const inferredW = raw.meta?.size?.w ?? Math.max(...sorted.map((f) => f.x + f.w));
    const inferredH = raw.meta?.size?.h ?? Math.max(...sorted.map((f) => f.y + f.h));

    return {
      imageUrl: `${basePath}/spritesheet.png`,
      sheetWidth: inferredW,
      sheetHeight: inferredH,
      frames: sorted,
      durationS: raw.meta?.duration_s ?? Math.max(0.6, sorted.length * 0.08),
    };
  } catch {
    return null;
  }
}
