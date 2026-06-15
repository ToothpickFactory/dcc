import { MyDurableObject } from "./server/world-do";

// The DO class must be exported from the Worker entry (wrangler `main`).
export { MyDurableObject };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Realtime: everyone joins the same global world DO.
    if (url.pathname === "/ws") {
      const stub = env.MY_DURABLE_OBJECT.getByName("world");
      return stub.fetch(request);
    }

    // Everything else (index.html, /client.js) is served by the static-assets
    // binding ahead of this handler. A request reaching here is unknown.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
