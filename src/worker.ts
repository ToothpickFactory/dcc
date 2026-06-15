import { MyDurableObject } from "./server/world-do";

// The DO class must be exported from the Worker entry (wrangler `main`).
export { MyDurableObject };

// Constant-time token compare via SHA-256 digests (equal length, no early-out,
// no length leak). Avoids crypto.subtle.timingSafeEqual, which is not GA.
async function tokenMatches(provided: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false; // missing secret => deny
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Realtime: everyone joins the same global world DO.
    if (url.pathname === "/ws") {
      return env.MY_DURABLE_OBJECT.getByName("world").fetch(request);
    }

    // Admin: wipe + start a fresh run (decision #7 — manual during dev).
    if (url.pathname === "/admin/new-run") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!(await tokenMatches(provided, env.ADMIN_TOKEN))) {
        return new Response("forbidden", { status: 403 });
      }
      const result = await env.MY_DURABLE_OBJECT.getByName("world").newRun();
      return Response.json({ ok: true, ...result });
    }

    // Everything else (index.html, /client.js) is served by the static-assets
    // binding ahead of this handler. A request reaching here is unknown.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
