// Headless synthetic client (Stream G) — the cross-stream smoke + load test.
// Drives N fake players over the WebSocket so any stream can exercise the server
// without a browser. Requires global WebSocket (Node 22+) and is run with Node's
// native TS support.
//
//   npm run bot -- [count] [url]
//   node --experimental-strip-types test/bot.ts 50 ws://127.0.0.1:8787/ws
export {}; // make this a module so top-level consts don't pollute global scope

const COUNT = Number(process.argv[2] ?? 10);
const WS_URL = process.argv[3] ?? "ws://127.0.0.1:8787/ws";
const DURATION_MS = Number(process.argv[4] ?? 0); // 0 = run forever (load); >0 = bounded smoke

let connected = 0;
let states = 0;

function bot(i: number) {
  const ws = new WebSocket(WS_URL);
  let seq = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  ws.addEventListener("open", () => {
    connected++;
    ws.send(JSON.stringify({ t: "join", name: `bot${i}` }));
    // ~10 Hz input (matches the client input policy / scale gate).
    timer = setInterval(() => {
      const a = Math.random() * Math.PI * 2;
      ws.send(JSON.stringify({ t: "input", seq: ++seq, mv: [Math.cos(a), Math.sin(a)], aim: a }));
      if (Math.random() < 0.1) ws.send(JSON.stringify({ t: "cast", seq: ++seq, ability: 0, aim: a }));
    }, 100);
  });
  ws.addEventListener("message", () => {
    states++;
  });
  ws.addEventListener("close", () => {
    if (timer) clearInterval(timer);
  });
  ws.addEventListener("error", (e: unknown) => {
    console.error(`bot${i} error`, (e as { message?: string })?.message ?? e);
  });
}

console.log(`spawning ${COUNT} bots -> ${WS_URL}`);
for (let i = 0; i < COUNT; i++) bot(i);

setInterval(() => {
  console.log(`connected=${connected}/${COUNT}  state msgs received=${states}`);
}, 2000);

if (DURATION_MS > 0) {
  setTimeout(() => {
    console.log(`done: connected=${connected}/${COUNT} state=${states}`);
    process.exit(connected === COUNT && states > 0 ? 0 : 1);
  }, DURATION_MS);
}
