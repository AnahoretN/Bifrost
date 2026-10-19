# Bifrost

P2P file bridge over the BitTorrent network: two or more devices (PCs, phones) join a
room and share one **file pool**. Files added by anyone can be sent to the host
(Send / Send All); anything the host holds can be downloaded by everyone — with
**sender-generated previews** for PSD and video files, and streaming transfer that
handles **10 GB+** with pause / resume (even across a page reload).

## How it works

1. The host opens the app and clicks **Connect** — a room with a unique ID and a
   shareable link is created (`?roomId=…`).
2. Guests open the link, pick a display name, and join over Trystero's BitTorrent
   strategy (WebTorrent tracker signaling, WebRTC data channels for data).
3. Everyone shares the file pool. `Add files` publishes metadata + a preview
   thumbnail; **Send**/**Send All** transfers bytes to the host; **Download** pulls a
   file the host holds. Files already on your disk (same folder, name + size match)
   are marked *on device*.

## Transfers

- 256 KB application chunks, CRC32-verified, sliding window of 16 in flight (~4 MB),
  cumulative ACK every 8 chunks.
- Received bytes stream straight to disk via the File System Access API
  (`write({position})`) — nothing large is ever held in memory.
- Pause/resume drain the window cleanly; the resume point is persisted to IndexedDB
  after every ACK, so a **page reload mid-transfer resumes** instead of restarting.
- OPFS fallback (e.g. iOS Safari) keeps files app-private with an Export button.

## Running

```bash
npm install
npm run dev        # http://localhost:5599 — no certificate warnings
```

**Testing between devices on your LAN** — File System Access and the clipboard need a
**secure context**. `localhost` is one automatically, but a phone hitting your IP is
not, so LAN testing uses a self-signed HTTPS server:

```bash
npm run dev:lan    # https://<your-ip>:5599 — accept the self-signed cert warning on each device
```

If Chrome's "Proceed anyway" link is finicky, click into the warning page and just
type `thisisunsafe` (a built-in Chrome bypass, no input box).

**Public use** — deploy `dist/` to any static host (Cloudflare Pages, Netlify, GitHub
Pages). The page is identical for everyone; the `?roomId=` parameter is what binds a
guest to a room.

## Browser support

| Browser | Save to folder | Notes |
| --- | --- | --- |
| Chrome / Edge desktop | ✅ pick a real folder | primary path |
| Firefox | ⚠️ OPFS | files land in app-private storage, export per file |
| iOS Safari | ⚠️ OPFS | same as Firefox; share/export after download |

## Architecture (src/)

- `p2p/trysteroTransport.ts` — room join/leave with the hard-won hardening (zombie-room
  poll after async `leave()`, 80 s peer-discovery window, module-scoped peer set that
  survives StrictMode/HMR).
- `p2p/protocol.ts` — the `{type, payload}` wire dispatcher; host is the pool authority
  (only the host processes HELLO / FILE_ADDED, only guests apply POOL_MANIFEST).
- `p2p/transferEngine.ts` — OFFER → ACCEPT → CHUNK → ACK → COMPLETE state machine,
  per-peer FIFO queues, pause/resume/cancel, disk streaming.
- `storage/` — folder handle persistence (IndexedDB), directory presence index
  (name+size), resume index.
- `preview/` — PSD (ag-psd), video (frame capture), image thumbnails; generated on the
  sender, transmitted as a separate binary channel, generic-icon fallback on failure.

## Tests

```bash
npm test       # vitest — frame codec + CRC32, protocol host/guest routing
npm run typecheck
```

Transfer scenarios need two real browsers (WebRTC) — open `https://<ip>:5177` in two
windows, create a room, join from the other via the link.
