// Identity seam (Stream A / M1). A durable, HMAC-signed token binds a client to
// its playerId so a reconnecting player rebinds to their own character and a dead
// player can't forge a fresh identity to dodge permadeath. crypto.subtle is a
// Workers global (no nodejs_compat needed).
//
// SECURITY: the signing key MUST come from a real secret (TOKEN_SIGNING_KEY). If
// it's missing/weak we FAIL CLOSED to a random per-instance key — never a
// source-committed constant, which would let anyone forge any identity. With an
// ephemeral key, tokens simply don't survive a restart (players rejoin as new).
const MIN_KEY_LEN = 16;

export interface Identity {
  mint(name: string): Promise<{ playerId: string; token: string }>;
  verify(token: string): Promise<{ playerId: string } | null>;
}

export class HmacIdentity implements Identity {
  readonly ephemeral: boolean;
  private rawKey: string;
  private keyPromise: Promise<CryptoKey> | null = null;
  private seq = 0;

  constructor(secret: string | undefined) {
    if (secret && secret.length >= MIN_KEY_LEN) {
      this.rawKey = secret;
      this.ephemeral = false;
    } else {
      this.rawKey = randomKey();
      this.ephemeral = true;
      console.warn(
        "TOKEN_SIGNING_KEY missing or <16 chars; using an ephemeral key — identities will NOT persist across restarts. Set the secret in production.",
      );
    }
  }

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.rawKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    }
    return this.keyPromise;
  }

  async mint(name: string): Promise<{ playerId: string; token: string }> {
    // playerId contains no '.' so the token splits cleanly on the last dot. The
    // timestamp is for uniqueness only — it is NOT a freshness/expiry check.
    const playerId = `${sanitize(name)}-${(++this.seq).toString(36)}-${Date.now().toString(36)}`;
    const sig = await this.sign(playerId);
    return { playerId, token: `${playerId}.${sig}` };
  }

  async verify(token: string): Promise<{ playerId: string } | null> {
    // Format parsing below is not timing-sensitive (it touches no secret); only
    // crypto.subtle.verify's MAC comparison is, and that is constant-time.
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const playerId = token.slice(0, dot);
    const sig = b64urlToBytes(token.slice(dot + 1));
    if (!sig) return null;
    try {
      const ok = await crypto.subtle.verify("HMAC", await this.key(), sig, new TextEncoder().encode(playerId));
      return ok ? { playerId } : null;
    } catch {
      return null;
    }
  }

  private async sign(data: string): Promise<string> {
    const mac = await crypto.subtle.sign("HMAC", await this.key(), new TextEncoder().encode(data));
    return bytesToB64url(new Uint8Array(mac));
  }
}

function sanitize(name: string): string {
  return (name || "hero").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "hero";
}

function randomKey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
    const bin = atob(norm + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
