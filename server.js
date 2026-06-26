import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { Server } from 'socket.io';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import selfsigned from 'selfsigned';
import { captureDevice, shutdown as shutdownEngine } from './screenshotEngine.js';
import { auditScreenshot } from './auditor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 4443;
const SCREENSHOTS_DIR = join(__dirname, 'screenshots');
const CERT_DIR = join(__dirname, 'certs');
const CERT_PATH = join(CERT_DIR, 'cert.pem');
const KEY_PATH = join(CERT_DIR, 'key.pem');
await mkdir(SCREENSHOTS_DIR, { recursive: true });

function lanAddresses() {
  const out = [];
  for (const [name, ifaces] of Object.entries(networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push({ name, address: iface.address });
      }
    }
  }
  return out;
}

async function ensureCert() {
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) return;
  await mkdir(CERT_DIR, { recursive: true });
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const { address } of lanAddresses()) {
    altNames.push({ type: 7, ip: address });
  }
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      days: 825,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    },
  );
  await writeFile(CERT_PATH, pems.cert);
  await writeFile(KEY_PATH, pems.private);
  console.log(`Generated self-signed TLS cert: ${CERT_PATH}`);
  console.log('(delete the certs/ folder to regenerate if your LAN IP changes)');
}

await ensureCert();

const app = express();
const httpServer = createHttpServer(app);
const httpsServer = createHttpsServer(
  { cert: await readFile(CERT_PATH), key: await readFile(KEY_PATH) },
  app,
);
const io = new Server({ maxHttpBufferSize: 4 * 1024 * 1024 });
io.attach(httpServer);
io.attach(httpsServer);

app.use(express.static(join(__dirname, 'public')));
app.use('/screenshots', express.static(SCREENSHOTS_DIR));
app.get('/', (req, res) => res.redirect('/host'));
app.get('/host', (req, res) => res.sendFile(join(__dirname, 'public', 'host.html')));
app.get('/client', (req, res) => res.sendFile(join(__dirname, 'public', 'client.html')));
app.get('/health', (req, res) => {
  const key = process.env.GEMINI_API_KEY || '';
  res.json({
    status: 'ok',
    geminiKeyLoaded: key.length > 0,
    geminiKeyLength: key.length,
    geminiModel: process.env.GEMINI_MODEL || null,
    connectedDevices: devices.size,
  });
});

const devices = new Map();
const latestFrames = new Map(); // socketId -> { buffer, width, height, ts } — last live share frame
const FRAME_TTL_MS = 30000;      // frames older than this are considered stale
let lastBroadcastUrl = null;

function snapshot() {
  return Array.from(devices.values());
}

function broadcastDeviceList() {
  io.to('hosts').emit('device-list', snapshot());
}

io.on('connection', (socket) => {
  socket.on('register-host', () => {
    socket.join('hosts');
    socket.emit('device-list', snapshot());
  });

  socket.on('register-client', (info = {}) => {
    socket.join('clients');
    devices.set(socket.id, {
      id: socket.id,
      label: info.label || 'unnamed device',
      width: info.width ?? 0,
      height: info.height ?? 0,
      userAgent: info.userAgent || '',
      currentUrl: null,
      connectedAt: Date.now(),
    });
    broadcastDeviceList();

    if (lastBroadcastUrl) {
      const device = devices.get(socket.id);
      if (device) device.currentUrl = lastBroadcastUrl;
      socket.emit('load-url', { url: lastBroadcastUrl });
      broadcastDeviceList();
    }
  });

  socket.on('viewport-changed', ({ width, height }) => {
    const device = devices.get(socket.id);
    if (!device) return;
    device.width = width;
    device.height = height;
    broadcastDeviceList();
  });

  socket.on('load-url', ({ url, targetId }, ack) => {
    if (typeof url !== 'string' || !url) {
      if (typeof ack === 'function') ack({ ok: false, delivered: 0, reason: 'invalid url' });
      return;
    }
    const recipients = targetId ? [targetId] : Array.from(devices.keys());
    let delivered = 0;
    for (const id of recipients) {
      const device = devices.get(id);
      if (!device) continue;
      device.currentUrl = url;
      io.to(id).emit('load-url', { url });
      delivered++;
    }
    if (!targetId) lastBroadcastUrl = url;
    broadcastDeviceList();
    if (typeof ack === 'function') ack({ ok: true, delivered, targetId: targetId || null });
  });

  socket.on('capture-screenshots', async ({ url: override } = {}, ack) => {
    if (!socket.rooms.has('hosts')) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'only host can capture' });
      return;
    }
    const targets = Array.from(devices.values()).filter(
      (d) => (override || d.currentUrl) && d.width > 0 && d.height > 0,
    );
    if (targets.length === 0) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'no devices with a URL to capture' });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = join(SCREENSHOTS_DIR, stamp);
    io.to('hosts').emit('capture-started', { targetCount: targets.length, stamp });

    let okCount = 0;
    let errCount = 0;
    console.log(`[capture] ${targets.length} target(s). Buffered frames for: [${Array.from(latestFrames.keys()).join(', ')}]`);
    await Promise.all(
      targets.map(async (d) => {
        const targetUrl = override || d.currentUrl;
        try {
          const live = latestFrames.get(d.id);
          const liveAge = live ? Date.now() - live.ts : null;
          console.log(`[capture] device ${d.id} (${d.label}): live frame ${live ? `present, age=${liveAge}ms` : 'MISSING'}`);
          let filename;
          let source;
          if (live && Date.now() - live.ts < FRAME_TTL_MS) {
            // Use the device's actual on-screen state from the active share stream.
            // Preserves scroll position, opened menus, consent dialogs that the user
            // already dismissed, etc.
            filename = `${String(d.label || 'device').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}-${d.width}x${d.height}.jpg`;
            await mkdir(sessionDir, { recursive: true });
            await writeFile(join(sessionDir, filename), live.buffer);
            source = 'live';
          } else {
            // No active share — fall back to a fresh Playwright render at the
            // device's reported viewport.
            const result = await captureDevice({
              url: targetUrl,
              width: d.width,
              height: d.height,
              label: d.label,
              outputDir: sessionDir,
            });
            filename = result.filename;
            source = 'fresh';
          }
          okCount++;
          io.to('hosts').emit('screenshot-captured', {
            id: d.id,
            label: d.label,
            width: d.width,
            height: d.height,
            url: targetUrl,
            path: `/screenshots/${stamp}/${filename}`,
            source,
            capturedAt: Date.now(),
          });
        } catch (err) {
          errCount++;
          io.to('hosts').emit('screenshot-captured', {
            id: d.id,
            label: d.label,
            width: d.width,
            height: d.height,
            url: targetUrl,
            error: err.message,
            capturedAt: Date.now(),
          });
        }
      }),
    );

    if (typeof ack === 'function') {
      ack({ ok: true, captured: okCount, errors: errCount });
    }
  });

  socket.on('audit-screenshot', async ({ path: shotPath, url, width, height, label } = {}, ack) => {
    if (!socket.rooms.has('hosts')) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'only host can audit' });
      return;
    }
    if (typeof shotPath !== 'string' || !shotPath.startsWith('/screenshots/')) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid screenshot path' });
      return;
    }
    const relative = shotPath.slice('/screenshots/'.length);
    if (relative.includes('..') || relative.includes('\0')) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid screenshot path' });
      return;
    }
    const filepath = join(SCREENSHOTS_DIR, relative);
    try {
      const audit = await auditScreenshot({
        imagePath: filepath,
        url,
        width,
        height,
        label,
      });
      if (typeof ack === 'function') ack({ ok: true, audit });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, reason: err.message });
    }
  });

  // WebRTC screen-share signaling — server is a dumb relay between specific sockets.
  // host -> client events are gated to the 'hosts' room; client -> host events aren't.
  function relayShare(event, requireHost) {
    socket.on(event, ({ targetId, ...rest } = {}) => {
      if (requireHost && !socket.rooms.has('hosts')) return;
      if (!targetId || !io.sockets.sockets.get(targetId)) return;
      io.to(targetId).emit(event, { fromId: socket.id, ...rest });
    });
  }
  relayShare('share-request', true);
  relayShare('share-stop', true);
  relayShare('share-control', true);   // host -> device: scroll/click commands
  relayShare('share-failed', false);
  relayShare('share-ended', false);

  // share-frame is relayed AND buffered server-side so "Capture now" can use
  // the device's current on-screen state instead of re-fetching the URL fresh.
  let framesSeen = 0;
  socket.on('share-frame', ({ targetId, frame, width, height } = {}) => {
    if (frame) {
      try {
        latestFrames.set(socket.id, {
          buffer: Buffer.from(frame, 'base64'),
          width: Number(width) || 0,
          height: Number(height) || 0,
          ts: Date.now(),
        });
        framesSeen++;
        if (framesSeen === 1 || framesSeen % 50 === 0) {
          console.log(`[share-frame] buffered for ${socket.id} (${framesSeen} frames, ${latestFrames.get(socket.id).buffer.length} bytes)`);
        }
      } catch (err) {
        console.error('[share-frame] buffer failed:', err.message);
      }
    }
    if (!targetId || !io.sockets.sockets.get(targetId)) return;
    io.to(targetId).emit('share-frame', { fromId: socket.id, frame, width, height });
  });

  // Forward each device's web console output to all hosts. Hosts use this to debug
  // what's happening inside the page running on the device.
  socket.on('console-log', (payload = {}) => {
    const device = devices.get(socket.id);
    if (!device) return;
    io.to('hosts').emit('console-log', {
      deviceId: socket.id,
      deviceLabel: device.label,
      level: typeof payload.level === 'string' ? payload.level : 'LOG',
      message: typeof payload.message === 'string' ? payload.message : String(payload.message ?? ''),
      source: typeof payload.source === 'string' ? payload.source : '',
      line: Number.isFinite(payload.line) ? payload.line : 0,
      ts: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    latestFrames.delete(socket.id);
    if (devices.delete(socket.id)) broadcastDeviceList();
  });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await shutdownEngine();
    process.exit(0);
  });
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Set a different port with PORT=4100 npm start\n`);
  } else {
    console.error('\nHTTP server error:', err);
  }
  process.exit(1);
});
httpsServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nHTTPS port ${HTTPS_PORT} is already in use. Set HTTPS_PORT=<n>\n`);
  } else {
    console.error('\nHTTPS server error:', err);
  }
  process.exit(1);
});

let listeningCount = 0;
function maybePrintBanner() {
  listeningCount++;
  if (listeningCount < 2) return;
  console.log('\nResponsive testing tool running.');
  console.log(`  Host dashboard:  http://localhost:${PORT}/host`);
  console.log(`  Client device:   http://localhost:${PORT}/client`);
  console.log(`  (HTTPS)          https://localhost:${HTTPS_PORT}/host`);
  const lan = lanAddresses();
  if (lan.length) {
    console.log('\nReachable from other devices on your network:');
    for (const { name, address } of lan) {
      console.log(`  http://${address}:${PORT}/client   (${name})`);
      console.log(`  https://${address}:${HTTPS_PORT}/client   (${name}, required for screen share)`);
    }
    console.log('\nNote: phones must use the https:// URL for screen share to work.');
    console.log('On first visit, accept the self-signed cert warning ("Advanced → Proceed").');
  }
  console.log('');
}

httpServer.listen(PORT, '0.0.0.0', maybePrintBanner);
httpsServer.listen(HTTPS_PORT, '0.0.0.0', maybePrintBanner);
