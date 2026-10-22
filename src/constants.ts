// Trystero room / tracker config.
// Only live relays — dead trackers spam reconnect errors (hard-won lesson).
export const APP_ID = 'bifrost';
export const TORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
];

// Transfer engine tuning. CHUNK_SIZE is negotiated per-transfer via TRANSFER_OFFER
// so both ends agree; bump after measuring real throughput (M3 exit).
export const CHUNK_SIZE = 256 * 1024; // 256 KB application-level chunks
export const WINDOW = 16; // max chunks in flight per transfer (16 * 256KB = 4MB)
export const ACK_EVERY = 8; // receiver sends cumulative CHUNK_ACK every N chunks
export const PROGRESS_STORE_INTERVAL_MS = 250; // throttle store writes per transfer

// Connection hardening (values proven in production).
// HELLO window: mobile peers (Android) can take tens of seconds to open the
// data channel (tracker signaling + ICE) — 30 × 2s gives them a real chance.
export const HELLO_RETRY_MS = 2_000;
export const HELLO_MAX_RETRIES = 30;
export const PING_MS = 10_000; // host heartbeat interval
export const WATCHDOG_MS = 45_000; // guest: silence from host ⇒ reconnect
export const DISCOVERY_TIMEOUT = 80_000; // tracker discovery can be slow; don't give up early
export const HANDSHAKE_WATCHDOG_MS = 30_000;
export const RECONNECT_INTERVAL_MS = 5_000;
export const RECONNECT_MAX_ATTEMPTS = 12; // 12 × 5s = 3 min budget
export const LEAVE_RACE_TIMEOUT_MS = 3_000; // leave() is async; don't wait forever

// Preview generation.
export const PREVIEW_MAX_SIDE = 512; // px — large enough for the detail drawer
export const PREVIEW_MAX_BYTES = 300 * 1024; // re-encode below this target
export const PREVIEW_JPEG_QUALITY = 0.7;
export const PSD_PREVIEW_MAX_FILE = 200 * 1024 * 1024; // don't read multi-GB PSDs
export const VIDEO_SEEK_TIMEOUT_MS = 5_000;

// Storage.
export const HOST_ROOM_KEY = 'bifrost-host-room-id'; // dedicated key — a same-browser
// guest tab must not be able to clobber the host's identity (sessionResume.ts gotcha).
export const PEER_NAME_KEY = 'bifrost-peer-name';

export const ROOM_ID_PREFIX = 'bifrost';
