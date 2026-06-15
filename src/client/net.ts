import type {
  ClientMsg,
  EntityDTO,
  FloorClientInfo,
  FloorState,
  GameEvent,
  RunState,
  SelfDTO,
  ServerMsg,
} from "../protocol";

export interface Snapshot {
  tick: number;
  ents: EntityDTO[];
  recv: number;
}

// Thin transport: encodes intent, decodes ServerMsg, keeps the last two
// snapshots for interpolation. PHASE 0 wire format is JSON; Stream G / M6 swaps
// in binary deltas HERE without touching any other module.
export class Net {
  ws: WebSocket | null = null;
  you = "";
  token = "";
  world = { w: 2400, h: 2400 };
  self: SelfDTO | null = null;
  floor: { info: FloorClientInfo; state: FloorState } | null = null;
  run: RunState | null = null;
  prev: Snapshot | null = null;
  cur: Snapshot | null = null;
  onEvents: (e: GameEvent[]) => void = () => {};
  onWelcome: () => void = () => {};
  onClose: () => void = () => {};

  connect(name: string, token?: string) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => this.send({ t: "join", name, token });
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string) as ServerMsg);
    this.ws.onclose = () => this.onClose();
    // A failed connection fires `error` then `close`; surface both so the UI can
    // tell the user the server is unreachable instead of silently doing nothing.
    this.ws.onerror = () => this.onClose();
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.you = m.you;
        this.token = m.token;
        this.world = m.world;
        this.onWelcome();
        break;
      case "state":
        this.prev = this.cur;
        this.cur = { tick: m.tick, ents: m.ents, recv: performance.now() };
        this.self = m.self;
        if (m.events.length) this.onEvents(m.events);
        break;
      case "floor":
        this.floor = { info: m.info, state: m.state };
        break;
      case "run":
        this.run = m.state;
        break;
    }
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
