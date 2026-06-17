class_name DccConst
## Shared constants, mirrored verbatim from src/shared/constants.ts + the client.
## Keep these in lockstep with the TS — they drive prediction + fog parity.

const TICK_MS := 50            # server simulation step (20 Hz)
const PLAYER_SPEED := 230.0    # px/s (fallback; prefer SelfDTO.derived.moveSpeed)
const PLAYER_RADIUS := 17.0
const LOOT_REACH := 90.0       # px a player must be within to loot a bag
const VISION_RADIUS := 1000.0  # lit/sight radius (px). Bumped with the 2x floor rescale so the circle reveals enemies/loot, not just a tiny patch.
const WORLD := Vector2(2400, 2400)
const INPUT_MS := 33           # client -> server input cadence (~30Hz: server tracks input closely = smoother)
const HOTBAR_SIZE := 6         # first N abilities are the castable hotbar; the rest are benched
# Dodge/dash (mirror src/shared/constants.ts) — client predicts the burst + gates the CD.
const DASH_SPEED := 760.0      # px/s during the dash burst
const DASH_MS := 180.0         # dash duration
const DASH_CD := 1400.0        # cooldown between dashes
const SLOW_FACTOR := 0.5        # movement multiplier while slowed (frost) — mirror src/shared/constants.ts
const PROTOCOL_VERSION := 15  # v15: ally hp/class on wire, loot owner-priority, buy vendor; v14 was attr points + respec
const DEFAULT_WS_URL := "wss://young-frost-2be4.austin-bb5.workers.dev/ws"
