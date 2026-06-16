class_name DccConst
## Shared constants, mirrored verbatim from src/shared/constants.ts + the client.
## Keep these in lockstep with the TS — they drive prediction + fog parity.

const TICK_MS := 50            # server simulation step (20 Hz)
const PLAYER_SPEED := 230.0    # px/s (fallback; prefer SelfDTO.derived.moveSpeed)
const PLAYER_RADIUS := 17.0
const LOOT_REACH := 90.0       # px a player must be within to loot a bag
const VISION_RADIUS := 520.0
const WORLD := Vector2(2400, 2400)
const INPUT_MS := 100          # client -> server input cadence
const PROTOCOL_VERSION := 6
const DEFAULT_WS_URL := "wss://young-frost-2be4.austin-bb5.workers.dev/ws"
