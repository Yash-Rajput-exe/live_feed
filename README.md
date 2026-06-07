---
title: Live Camera Stream
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Live Camera Stream


A production-ready development build for live camera streaming with one broadcaster and multiple viewers. A broadcaster starts a live camera feed, receives a unique 6 character stream code, and viewers watch the live feed by entering that code.

This app is only for live video. It does not record, store, save, replay, authenticate, or persist streams.

## Architecture Explanation

The application has three browser pages and one Node.js server:

- Landing page: chooses broadcaster or viewer mode.
- Broadcaster page: opens the camera and microphone, creates a stream code, and sends live tracks to viewers.
- Viewer page: joins an active stream by code and receives the live WebRTC feed.
- Server: serves static files and coordinates Socket.IO signaling.

The server does not relay media. It stores only temporary in-memory stream rooms:

```js
activeStreams = {
  A7K9X2: {
    broadcasterId: 'socket-id',
    viewers: Set(['viewer-socket-id'])
  }
}
```

When a broadcaster stops streaming or disconnects, the room is destroyed, the code becomes invalid, and all viewers receive a `stream:ended` event.

## Folder Structure

```text
project/
  server/
    server.js
    roomManager.js
    socketHandler.js
  public/
    index.html
    broadcast.html
    viewer.html
    css/
      style.css
    js/
      broadcast.js
      viewer.js
      socket.js
      utils.js
  package.json
  README.md
  .env.example
```

## Backend Files

- `server/server.js`: Express app, HTTP server, Socket.IO server, health route, and static file hosting.
- `server/roomManager.js`: in-memory stream code generation, room creation, room cleanup, and viewer tracking.
- `server/socketHandler.js`: stream lifecycle events and WebRTC signaling events.

## Frontend Files

- `public/index.html`: dark themed landing page with Start Broadcasting and Watch Stream actions.
- `public/broadcast.html`: camera preview, stream code, copy button, viewer count, selectors, status, start and stop controls.
- `public/viewer.html`: code input, video player, connect, disconnect, fullscreen, loading state, and status messages.
- `public/css/style.css`: responsive mobile-first dark glassmorphism UI.
- `public/js/socket.js`: shared Socket.IO connection.
- `public/js/utils.js`: shared UI, code, device, clipboard, and network helpers.
- `public/js/broadcast.js`: broadcaster camera, stream, peer connection, offer, ICE, and cleanup logic.
- `public/js/viewer.js`: viewer join, answer, ICE, stream ended, fullscreen, and reconnect logic.

## WebRTC Implementation

The live video path is peer-to-peer:

1. Broadcaster clicks Start Stream.
2. Browser calls `navigator.mediaDevices.getUserMedia()` for camera and microphone access.
3. Server generates a unique 6 character code and stores it in memory.
4. Viewer enters the code and joins the Socket.IO room.
5. Server notifies the broadcaster with `viewer:joined`.
6. Broadcaster creates one `RTCPeerConnection` for that viewer.
7. Broadcaster adds local camera and microphone tracks with `addTrack()`.
8. Broadcaster creates an SDP offer using `createOffer()`.
9. Broadcaster calls `setLocalDescription()` and sends `webrtc:offer`.
10. Viewer calls `setRemoteDescription()`.
11. Viewer creates an SDP answer using `createAnswer()`.
12. Viewer calls `setLocalDescription()` and sends `webrtc:answer`.
13. Broadcaster calls `setRemoteDescription()` with the answer.
14. Both sides exchange ICE candidates with `addIceCandidate()`.
15. Once ICE succeeds, the viewer receives the broadcaster stream in `ontrack`.

The broadcaster maintains:

```js
Map<viewerId, RTCPeerConnection>
```

That allows one broadcaster to support many viewers. Each viewer gets a separate peer connection and receives the same local media tracks.

## STUN And NAT Traversal

The app uses:

```js
{ urls: 'stun:stun.l.google.com:19302' }
```

Most devices are behind NAT routers, so peers usually do not know the public network address other peers need to reach them. A STUN server helps each browser discover its public-facing IP and port. WebRTC then exchanges those ICE candidates through Socket.IO so the broadcaster and viewer can attempt a direct peer-to-peer connection.

STUN is enough for many local, home, and mobile networks. Some strict corporate or carrier networks require TURN relay servers. This project intentionally does not use TURN or external streaming services because the request asked for no external streaming services.

## Socket.IO Implementation

Stream lifecycle events:

- `stream:create`: broadcaster creates an in-memory stream and receives a unique code.
- `stream:join`: viewer joins a stream by code.
- `stream:leave`: viewer disconnects from a stream.
- `stream:stop`: broadcaster ends the stream and destroys the room.
- `stream:viewer-count`: server updates all room members with the current viewer count.
- `stream:ended`: server tells viewers the broadcaster ended the stream.

WebRTC signaling events:

- `webrtc:offer`: broadcaster sends SDP offer to a specific viewer.
- `webrtc:answer`: viewer sends SDP answer to the broadcaster.
- `webrtc:ice-candidate`: both sides exchange ICE candidates.
- `connection:state`: peers report connection state changes.

## Error Handling

The app handles and displays friendly messages for:

- Invalid stream code
- Stream not found
- Camera permission denied
- Microphone permission denied
- Camera or microphone already in use
- Broadcaster left
- Viewer disconnected
- Socket.IO network failure
- WebRTC connection failure
- ICE failure and reconnection attempts

## Setup Instructions

Install dependencies:

```bash
cd project
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Testing Instructions

### Vercel Static Route Fix

This repository includes `vercel.json` so Vercel can map clean URLs to the static HTML pages:

```text
/broadcast -> /broadcast.html
/viewer -> /viewer.html
```

This fixes Vercel `404: NOT_FOUND` errors when opening `/broadcast` or `/viewer`.

Important: Vercel can host these static pages, but the full live streaming app also needs a long-running Socket.IO server for WebRTC signaling. Vercel Serverless Functions are not a good fit for that persistent WebSocket server. For the complete live streaming flow, run the Node server on a host that supports persistent connections, such as Render, Railway, Fly.io, a VPS, or a local/cloud VM. Another option is to keep the frontend on Vercel and host the Socket.IO server separately, then point the frontend Socket.IO client to that backend URL.

### 1. Localhost

Use two browser tabs on the same machine:

```bash
cd project
npm start
```

Open:

```text
http://localhost:3000/broadcast
http://localhost:3000/viewer
```

Start the broadcast, copy the code, enter it in the viewer tab, and connect.

### 2. Same WiFi

Find the broadcaster machine IP address.

On Windows:

```bash
ipconfig
```

Look for the IPv4 address, for example:

```text
192.168.1.50
```

Start the app:

```bash
cd project
npm start
```

On another device on the same WiFi, open:

```text
http://192.168.1.50:3000
```

Note: browsers require a secure context for camera access in many cases. `localhost` is considered secure. For another device over plain HTTP, camera permissions may be blocked by the browser. Use Cloudflare Tunnel or ngrok for HTTPS testing.

### 3. Cloudflare Tunnel

Install Cloudflare Tunnel, then run:

```bash
cd project
npm start
```

In another terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Open the generated HTTPS URL on the broadcaster and viewer devices.

### 4. ngrok

Install ngrok, then run:

```bash
cd project
npm start
```

In another terminal:

```bash
ngrok http 3000
```

Open the generated HTTPS URL on the broadcaster and viewer devices.

## Troubleshooting

- Camera does not open: allow camera and microphone permissions, close other apps using the camera, and reload.
- Viewer says stream not found: confirm the broadcaster is still live and the 6 character code was entered correctly.
- Viewer stays connecting: try localhost first, then same WiFi, then HTTPS through Cloudflare Tunnel or ngrok.
- Video works on localhost but not across networks: the network may require TURN. This app uses STUN only by design.
- Mobile browser blocks camera: use HTTPS through Cloudflare Tunnel or ngrok.
- Viewer disconnects when broadcaster closes tab: expected behavior. The room is destroyed immediately.

## Future Improvements

- Add optional TURN support for difficult networks.
- Add bitrate controls and camera resolution selectors.
- Add screen sharing as a separate live mode.
- Add broadcaster-side per-viewer connection diagnostics.
- Add automated browser tests for signaling events.
#   l i v e _ f e e d  
 
