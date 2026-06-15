// Sprite-atlas manifest format (Stream F). PHASE 0: no real atlases yet — the
// renderer falls back to solid-color billboards. This defines the contract Art
// produces and the client loads.
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AtlasManifest {
  image: string; // URL of the packed PNG
  frameW: number;
  frameH: number;
  clips: Record<string, number[]>; // logical name -> animation frame indices
  frames: AtlasFrame[];
}

export async function loadAtlas(url: string): Promise<AtlasManifest | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as AtlasManifest;
  } catch {
    return null;
  }
}
