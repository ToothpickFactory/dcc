// Identity seam (Stream A / M1).
//
// PHASE-0 STUB: a non-cryptographic dev token, just enough that reconnect +
// permadeath plumbing exists end-to-end. M1 replaces mint/verify with real HMAC
// signing using a Worker secret, and `verify` becomes the gate that prevents a
// dead player from rejoining as anything but a spectator.
export interface Identity {
  mint(name: string): { playerId: string; token: string };
  verify(token: string): { playerId: string } | null;
}

export class DevIdentity implements Identity {
  private seq = 0;
  mint(name: string): { playerId: string; token: string } {
    const playerId = `${(name || "hero").slice(0, 12)}-${(++this.seq).toString(36)}`;
    return { playerId, token: `dev.${playerId}` };
  }
  verify(token: string): { playerId: string } | null {
    if (!token.startsWith("dev.")) return null;
    const playerId = token.slice(4);
    return playerId ? { playerId } : null;
  }
}
