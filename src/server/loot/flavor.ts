import type { AbilityCategory, AbilityFlavor, Rarity, Theme } from "../../shared/types";

export interface FlavorService {
  flavor(category: AbilityCategory, rarity: Rarity, theme: Theme): Promise<AbilityFlavor>;
}

// ---------------------------------------------------------------------------
// Static fallback table — the ALWAYS-available backbone (ROADMAP M5). Loot is
// fully playable from this with the LLM disabled or failing. Deterministic, so
// the same (category, rarity, theme) always reads the same.
// ---------------------------------------------------------------------------
const NAME_POOLS: Record<AbilityCategory, string[]> = {
  ranged: ["Longshot", "Piercer", "Volley", "Skybolt", "Hailfire"],
  melee: ["Cleaver", "Rendari", "Sunderer", "Gutting Edge", "Maelstrike"],
  aoe: ["Cataclysm", "Nova Burst", "Wildfire", "Detonation", "Shockwave"],
  support: ["Lifebloom", "Mending Light", "Renewal", "Sanctuary", "Wellspring"],
  utility: ["Snarewire", "Hex Lattice", "Time Drag", "Gravewell", "Tanglevine"],
  stealth: ["Whisperfang", "Nightkiss", "Veilstrike", "Shadowmark", "Silent End"],
};
const THEME_ADJ: Record<Theme, string> = {
  fantasy: "Runed",
  cyberpunk: "Chromed",
  forest: "Verdant",
  pirate: "Saltworn",
  clockwork: "Geared",
  nightmare: "Dreadbound",
  icedungeon: "Frostbound",
};
const RARITY_TWIST: Record<Rarity, string | undefined> = {
  common: undefined,
  uncommon: undefined,
  rare: "Hums faintly when foes draw near.",
  epic: "Its last wielder was never found.",
  legendary: "The floor itself remembers its name.",
};

// Stable, dependency-free hash so table lookups are deterministic per key.
function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tableFlavor(category: AbilityCategory, rarity: Rarity, theme: Theme): AbilityFlavor {
  const pool = NAME_POOLS[category];
  const name = `${THEME_ADJ[theme]} ${pool[hashKey(`${category}|${rarity}|${theme}`) % pool.length]}`;
  return {
    name,
    flavor: `A ${rarity} ${category} relic of the ${theme} depths.`,
    twist: RARITY_TWIST[rarity],
  };
}

// PHASE-0 STUB kept as the simplest possible FlavorService. AiFlavorService is
// the real implementation; both fall back to the table, never to a thrown error.
export class StubFlavorService implements FlavorService {
  async flavor(category: AbilityCategory, rarity: Rarity, theme: Theme): Promise<AbilityFlavor> {
    return tableFlavor(category, rarity, theme);
  }
}

// ---------------------------------------------------------------------------
// Validation + sanitization (pure, exported for tests). JSON mode is best-effort
// so we never trust the model: strict shape, length caps, and a profanity / URL
// / prompt-injection filter. The blast radius is only 3 cosmetic strings, but
// they reach players, so they go through here.
// ---------------------------------------------------------------------------
const MAX = { name: 40, flavor: 160, twist: 100 };
const BANNED = [/https?:\/\//i, /www\./i, /\b(ignore|disregard)\b.{0,20}\b(previous|prior|above|instructions)\b/i, /system\s*:/i, /<\/?[a-z]/i];
// Tiny profanity guard — defensive, not exhaustive (the model is instructed to
// stay family-friendly; this is the backstop).
const PROFANITY = /\b(fuck|shit|bitch|cunt|nigg|faggot)/i;

export function sanitizeText(s: unknown, maxLen: number): string | null {
  if (typeof s !== "string") return null;
  const cleaned = s
    .replace(/[\u0000-\u001f\u007f]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (PROFANITY.test(cleaned)) return null;
  for (const re of BANNED) if (re.test(cleaned)) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
}

// Turn an arbitrary model response into a valid AbilityFlavor, or null. `name`
// and `flavor` are required; `twist` is optional and dropped if dirty.
export function validateFlavor(raw: unknown): AbilityFlavor | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const name = sanitizeText(o.name, MAX.name);
  const flavor = sanitizeText(o.flavor, MAX.flavor);
  if (!name || !flavor) return null;
  const twist = o.twist != null ? (sanitizeText(o.twist, MAX.twist) ?? undefined) : undefined;
  return { name, flavor, twist };
}

// Prompt builder is PURE and only ever sees (category, rarity, theme). There is
// no parameter through which a player name could reach the model — the test
// suite asserts this against a sentinel.
export function buildPrompt(category: AbilityCategory, rarity: Rarity, theme: Theme): string {
  return [
    `Name a ${rarity} ${category} weapon/relic for a roguelite set in a "${theme}" world.`,
    `Respond with ONLY minified JSON: {"name": string, "flavor": string, "twist": string}.`,
    `Constraints: name <= ${MAX.name} chars; flavor <= ${MAX.flavor} chars (one evocative sentence);`,
    `twist <= ${MAX.twist} chars (a short ominous aside). Family-friendly. No URLs, no markup, no real names.`,
  ].join(" ");
}

// Minimal shape of the Workers AI binding we use (avoids depending on generated
// types). `run` returns model-specific JSON; we parse defensively.
export interface WorkersAiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}
export interface FlavorConfig {
  enabled: boolean;
  ai?: WorkersAiBinding; // Workers AI binding (commons)
  gateway?: { accountId: string; gatewayId: string; anthropicKey: string }; // AI Gateway -> Claude (rares)
  budgetPerFloor?: number; // max model calls per floor; over budget => table
  fallback?: FlavorService;
}

const LLAMA = "@cf/meta/llama-3.1-8b-instruct";
const HAIKU = "claude-haiku-4-5";

// Real service: cache -> budget -> model (Llama for common/uncommon, Claude
// Haiku for rare+), validated, one retry, then the static table. Always resolves
// to a usable AbilityFlavor; never throws. Designed to be called OFF the tick.
export class AiFlavorService implements FlavorService {
  private cache = new Map<string, AbilityFlavor>();
  private spent = 0;
  private cfg: FlavorConfig;
  private fallback: FlavorService;

  constructor(cfg: FlavorConfig) {
    this.cfg = cfg;
    this.fallback = cfg.fallback ?? new StubFlavorService();
  }

  // Per-floor spend budget that fails open to the table (ROADMAP M5).
  resetFloorBudget(): void {
    this.spent = 0;
  }

  async flavor(category: AbilityCategory, rarity: Rarity, theme: Theme): Promise<AbilityFlavor> {
    const key = `${category}|${rarity}|${theme}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const table = await this.fallback.flavor(category, rarity, theme);
    if (!this.cfg.enabled) return table;
    if (this.cfg.budgetPerFloor != null && this.spent >= this.cfg.budgetPerFloor) return table;

    this.spent++;
    const prompt = buildPrompt(category, rarity, theme);
    // Rare and above earn the stronger (Claude) model; commons use Workers AI.
    const useClaude = rarity === "rare" || rarity === "epic" || rarity === "legendary";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = useClaude ? await this.callClaude(prompt) : await this.callWorkersAi(prompt);
        const valid = validateFlavor(raw);
        if (valid) {
          this.cache.set(key, valid);
          return valid;
        }
      } catch {
        /* fall through to retry / table */
      }
    }
    return table; // model unavailable or unusable -> the always-playable table
  }

  private async callWorkersAi(prompt: string): Promise<unknown> {
    if (!this.cfg.ai) throw new Error("no AI binding");
    const out = (await this.cfg.ai.run(LLAMA, {
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
    })) as { response?: unknown };
    return out?.response ?? out;
  }

  private async callClaude(prompt: string): Promise<unknown> {
    const g = this.cfg.gateway;
    if (!g) throw new Error("no gateway config");
    const url = `https://gateway.ai.cloudflare.com/v1/${g.accountId}/${g.gatewayId}/anthropic/v1/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": g.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: HAIKU, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const data = (await res.json()) as { content?: { text?: string }[] };
    return data?.content?.[0]?.text ?? null;
  }
}
