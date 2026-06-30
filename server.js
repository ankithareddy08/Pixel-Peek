import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { Server } from 'socket.io';
import { networkInterfaces } from 'node:os';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import selfsigned from 'selfsigned';
import QRCode from 'qrcode';
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
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
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
    activeRuns: runs.size,
  });
});

app.get('/api/connect-options', (req, res) => {
  const runCode = normalizeRunCode(req.query.runCode);
  if (!runCode) {
    res.status(400).json({ error: 'runCode is required' });
    return;
  }

  const requestProtocol = req.secure ? 'https' : 'http';
  const requestHost = req.get('host');
  const options = [];
  if (requestHost) {
    options.push({
      id: 'current',
      label: requestHost,
      detail: requestProtocol.toUpperCase(),
      url: clientUrl(`${requestProtocol}://${requestHost}`, runCode),
      recommended: false,
    });
  }

  for (const { name, address } of lanAddresses()) {
    options.push({
      id: `https-${address}`,
      label: `${address}:${HTTPS_PORT}`,
      detail: `${name} HTTPS`,
      url: clientUrl(`https://${address}:${HTTPS_PORT}`, runCode),
      recommended: true,
    });
    options.push({
      id: `http-${address}`,
      label: `${address}:${PORT}`,
      detail: `${name} HTTP`,
      url: clientUrl(`http://${address}:${PORT}`, runCode),
      recommended: false,
    });
  }

  res.json({ runCode, options });
});

app.get('/api/qr', async (req, res) => {
  const data = String(req.query.data || '');
  if (!data || data.length > 2048) {
    res.status(400).send('invalid QR data');
    return;
  }

  try {
    const svg = await QRCode.toString(data, {
      type: 'svg',
      margin: 1,
      color: { dark: '#e8eaf0', light: '#00000000' },
    });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/frame-check', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rawUrl = String(req.query.url || '').trim();
  let target;
  try {
    target = new URL(rawUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    res.status(400).json({
      ok: false,
      embeddable: false,
      reason: 'Enter a valid http or https URL.',
    });
    return;
  }

  try {
    const headers = await fetchFramePolicyHeaders(target.toString());
    const policy = analyzeFramePolicy({
      targetUrl: headers.finalUrl || target.toString(),
      embeddingOrigin: requestOrigin(req),
      xFrameOptions: headers.xFrameOptions,
      contentSecurityPolicy: headers.contentSecurityPolicy,
    });

    res.json({
      ok: true,
      embeddable: policy.embeddable,
      reason: policy.reason,
      finalUrl: headers.finalUrl,
      status: headers.status,
      headers: {
        xFrameOptions: headers.xFrameOptions || null,
        contentSecurityPolicy: headers.contentSecurityPolicy || null,
      },
    });
  } catch (err) {
    res.json({
      ok: true,
      embeddable: true,
      uncertain: true,
      reason: `Could not check frame policy before loading (${err.name || 'Error'}).`,
    });
  }
});

const devices = new Map();
const runs = new Map();
const latestFrames = new Map(); // socketId -> { base64, width, height, ts }
const FRAME_TTL_MS = 30000;
const RUN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RUN_CODE_LENGTH = 6;
const FRAME_POLICY_CHECK_TIMEOUT_MS = 4500;

function requestOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.secure ? 'https' : 'http');
  return `${protocol}://${req.get('host')}`;
}

async function fetchFramePolicyHeaders(targetUrl) {
  let headError = null;
  try {
    const head = await fetchPolicyHeaders(targetUrl, 'HEAD');
    if (head.xFrameOptions || head.contentSecurityPolicy || ![405, 501].includes(head.status)) {
      return head;
    }
  } catch (err) {
    headError = err;
  }

  try {
    return await fetchPolicyHeaders(targetUrl, 'GET');
  } catch (err) {
    throw headError || err;
  }
}

async function fetchPolicyHeaders(targetUrl, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FRAME_POLICY_CHECK_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(targetUrl, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Pixelpeek frame policy check',
      },
    });

    return {
      status: response.status,
      finalUrl: response.url || targetUrl,
      xFrameOptions: response.headers.get('x-frame-options') || '',
      contentSecurityPolicy: response.headers.get('content-security-policy') || '',
    };
  } finally {
    clearTimeout(timer);
    if (response?.body && method !== 'HEAD') {
      try {
        await response.body.cancel();
      } catch {}
    }
  }
}

function analyzeFramePolicy({ targetUrl, embeddingOrigin, xFrameOptions, contentSecurityPolicy }) {
  const targetOrigin = safeOrigin(targetUrl);
  const embedOrigin = safeOrigin(embeddingOrigin);
  const xfo = String(xFrameOptions || '').toUpperCase();

  if (/\bDENY\b/.test(xfo)) {
    return {
      embeddable: false,
      reason: 'The target sends X-Frame-Options: DENY, so browsers refuse to show it inside another page.',
    };
  }

  if (/\bSAMEORIGIN\b/.test(xfo) && targetOrigin && embedOrigin && targetOrigin !== embedOrigin) {
    return {
      embeddable: false,
      reason: 'The target sends X-Frame-Options: SAMEORIGIN, so it can only be framed by pages from the same site.',
    };
  }

  const ancestorSources = frameAncestorSources(contentSecurityPolicy);
  if (ancestorSources) {
    const allows = frameAncestorsAllow(ancestorSources, targetOrigin, embedOrigin);
    if (!allows) {
      return {
        embeddable: false,
        reason: 'The target Content-Security-Policy frame-ancestors rule does not allow this Pixelpeek web client.',
      };
    }
  }

  return { embeddable: true, reason: '' };
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function frameAncestorSources(contentSecurityPolicy) {
  const csp = String(contentSecurityPolicy || '');
  if (!csp) return null;
  const directives = csp
    .replace(/,/g, ' ; ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const directive of directives) {
    const parts = directive.split(/\s+/);
    if (parts[0]?.toLowerCase() === 'frame-ancestors') return parts.slice(1);
  }
  return null;
}

function frameAncestorsAllow(sources, targetOrigin, embeddingOrigin) {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  if (sources.some((source) => cleanSource(source).toLowerCase() === "'none'")) return false;
  return sources.some((source) => sourceAllowsOrigin(source, targetOrigin, embeddingOrigin));
}

function sourceAllowsOrigin(source, targetOrigin, embeddingOrigin) {
  const cleaned = cleanSource(source);
  const lower = cleaned.toLowerCase();
  if (!cleaned) return false;
  if (cleaned === '*') return true;
  if (lower === "'self'") return targetOrigin && targetOrigin === embeddingOrigin;

  let embedUrl;
  try {
    embedUrl = new URL(embeddingOrigin);
  } catch {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:$/i.test(cleaned)) {
    return cleaned.toLowerCase() === embedUrl.protocol;
  }

  let pattern = cleaned;
  let protocol = '';
  const protocolMatch = pattern.match(/^([a-z][a-z0-9+.-]*:)\/\//i);
  if (protocolMatch) {
    protocol = protocolMatch[1].toLowerCase();
    pattern = pattern.slice(protocolMatch[0].length);
  }
  if (protocol && protocol !== embedUrl.protocol) return false;

  pattern = pattern.split('/')[0];
  let host = pattern;
  let port = '';
  if (pattern.startsWith('[')) {
    const end = pattern.indexOf(']');
    host = end >= 0 ? pattern.slice(1, end) : pattern;
    port = pattern.slice(end + 1).replace(/^:/, '');
  } else {
    const colon = pattern.lastIndexOf(':');
    if (colon > -1 && pattern.indexOf(':') === colon) {
      host = pattern.slice(0, colon);
      port = pattern.slice(colon + 1);
    }
  }

  const embedHost = embedUrl.hostname.toLowerCase();
  const sourceHost = host.toLowerCase();
  if (port && port !== '*' && port !== (embedUrl.port || defaultPort(embedUrl.protocol))) return false;
  if (sourceHost === '*') return true;
  if (sourceHost.startsWith('*.')) return embedHost.endsWith(`.${sourceHost.slice(2)}`);
  return sourceHost === embedHost;
}

function cleanSource(source) {
  return String(source || '').trim().replace(/^,|,$/g, '');
}

function defaultPort(protocol) {
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return '';
}

function normalizeRunCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function makeRunCode() {
  let code = '';
  for (let i = 0; i < RUN_CODE_LENGTH; i++) {
    code += RUN_CODE_ALPHABET[randomInt(RUN_CODE_ALPHABET.length)];
  }
  return code;
}

function createRun(preferredCode) {
  let code = normalizeRunCode(preferredCode);
  if (!code) {
    do {
      code = makeRunCode();
    } while (runs.has(code));
  }
  if (!runs.has(code)) {
    runs.set(code, {
      code,
      hostIds: new Set(),
      createdAt: Date.now(),
      lastBroadcastUrl: null,
    });
  }
  return runs.get(code);
}

function resolveClientRun(runCode) {
  const normalized = normalizeRunCode(runCode);
  if (normalized && runs.has(normalized)) return runs.get(normalized);
  if (!normalized && runs.size === 1) return runs.values().next().value;
  return null;
}

function hostRoom(runCode) {
  return `hosts:${runCode}`;
}

function clientUrl(origin, runCode) {
  const url = new URL('/client', origin);
  url.searchParams.set('run', runCode);
  return url.toString();
}

function snapshot(runCode) {
  return Array.from(devices.values()).filter((device) => device.runCode === runCode);
}

function broadcastDeviceList(runCode) {
  if (!runCode) return;
  io.to(hostRoom(runCode)).emit('device-list', snapshot(runCode));
}

function joinHostRun(socket, run) {
  const previousCode = socket.data.runCode;
  if (previousCode && previousCode !== run.code) {
    const previous = runs.get(previousCode);
    if (previous) previous.hostIds.delete(socket.id);
    socket.leave(hostRoom(previousCode));
  }
  socket.data.role = 'host';
  socket.data.runCode = run.code;
  run.hostIds.add(socket.id);
  socket.join('hosts');
  socket.join(hostRoom(run.code));
}

function runPayload(run) {
  return {
    code: run.code,
    createdAt: run.createdAt,
    hostCount: run.hostIds.size,
  };
}

function hostRunForSocket(socket) {
  const runCode = socket.data.runCode;
  if (!runCode || !socket.rooms.has(hostRoom(runCode))) return null;
  return runs.get(runCode) || null;
}

function emitDeviceLog(device, payload = {}) {
  if (!device?.runCode) return;
  io.to(hostRoom(device.runCode)).emit('device-log', {
    deviceId: device.id,
    deviceLabel: device.label,
    level: typeof payload.level === 'string' ? payload.level : 'LOG',
    message: typeof payload.message === 'string' ? payload.message : String(payload.message ?? ''),
    source: typeof payload.source === 'string' ? payload.source : 'pixelpeek',
    line: Number.isFinite(payload.line) ? payload.line : 0,
    url: typeof payload.url === 'string' ? payload.url : device.currentUrl || '',
    kind: typeof payload.kind === 'string' ? payload.kind : 'device',
    ts: Date.now(),
  });
}

io.on('connection', (socket) => {
  socket.on('register-host', ({ runCode } = {}, ack) => {
    const run = createRun(runCode);
    joinHostRun(socket, run);
    const payload = runPayload(run);
    socket.emit('run-info', payload);
    socket.emit('device-list', snapshot(run.code));
    if (typeof ack === 'function') ack({ ok: true, run: payload });
  });

  socket.on('create-run', (_payload = {}, ack) => {
    const run = createRun();
    joinHostRun(socket, run);
    const payload = runPayload(run);
    socket.emit('run-info', payload);
    socket.emit('device-list', snapshot(run.code));
    if (typeof ack === 'function') ack({ ok: true, run: payload });
  });

  socket.on('register-client', (info = {}, ack) => {
    const previousDevice = devices.get(socket.id);
    if (previousDevice) {
      devices.delete(socket.id);
      broadcastDeviceList(previousDevice.runCode);
    }

    const run = resolveClientRun(info.runCode);
    if (!run) {
      const reason = normalizeRunCode(info.runCode) ? 'run code not found' : 'run code required';
      socket.emit('join-failed', { reason });
      if (typeof ack === 'function') ack({ ok: false, reason });
      return;
    }

    socket.join('clients');
    socket.data.role = 'client';
    socket.data.runCode = run.code;
    devices.set(socket.id, {
      id: socket.id,
      runCode: run.code,
      label: info.label || 'unnamed device',
      width: info.width ?? 0,
      height: info.height ?? 0,
      userAgent: info.userAgent || '',
      currentUrl: null,
      connectedAt: Date.now(),
    });
    socket.emit('joined-run', runPayload(run));
    if (typeof ack === 'function') ack({ ok: true, run: runPayload(run) });
    broadcastDeviceList(run.code);

    if (run.lastBroadcastUrl) {
      const device = devices.get(socket.id);
      if (device) device.currentUrl = run.lastBroadcastUrl;
      socket.emit('load-url', { url: run.lastBroadcastUrl });
      broadcastDeviceList(run.code);
    }
  });

  socket.on('viewport-changed', ({ width, height }) => {
    const device = devices.get(socket.id);
    if (!device) return;
    device.width = width;
    device.height = height;
    broadcastDeviceList(device.runCode);
  });

  socket.on('load-url', ({ url, targetId }, ack) => {
    const run = hostRunForSocket(socket);
    if (!run) {
      if (typeof ack === 'function') ack({ ok: false, delivered: 0, reason: 'host run not registered' });
      return;
    }
    if (typeof url !== 'string' || !url) {
      if (typeof ack === 'function') ack({ ok: false, delivered: 0, reason: 'invalid url' });
      return;
    }
    const recipients = targetId ? [targetId] : snapshot(run.code).map((device) => device.id);
    let delivered = 0;
    for (const id of recipients) {
      const device = devices.get(id);
      if (!device || device.runCode !== run.code) continue;
      device.currentUrl = url;
      io.to(id).emit('load-url', { url });
      emitDeviceLog(device, {
        level: 'TIP',
        message: `URL pushed: ${url}`,
        source: 'host',
        url,
        kind: 'url-session-start',
      });
      delivered++;
    }
    if (!targetId) run.lastBroadcastUrl = url;
    broadcastDeviceList(run.code);
    if (typeof ack === 'function') ack({ ok: true, delivered, targetId: targetId || null });
  });

  socket.on('capture-screenshots', async ({ url: override } = {}, ack) => {
    const run = hostRunForSocket(socket);
    if (!run) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'only host can capture' });
      return;
    }
    const targets = snapshot(run.code).filter(
      (d) => (override || d.currentUrl) && d.width > 0 && d.height > 0,
    );
    if (targets.length === 0) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'no devices with a URL to capture' });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = join(SCREENSHOTS_DIR, stamp);
    io.to(hostRoom(run.code)).emit('capture-started', { targetCount: targets.length, stamp });

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
            filename = `${String(d.label || 'device').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}-${d.width}x${d.height}.jpg`;
            await mkdir(sessionDir, { recursive: true });
            await writeFile(join(sessionDir, filename), Buffer.from(live.base64, 'base64'));
            source = 'live';
          } else {
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
          io.to(hostRoom(run.code)).emit('screenshot-captured', {
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
          io.to(hostRoom(run.code)).emit('screenshot-captured', {
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

    if (typeof ack === 'function') ack({ ok: true, captured: okCount, errors: errCount });
  });

  socket.on('audit-screenshot', async ({ path: shotPath, url, width, height, label } = {}, ack) => {
    if (!hostRunForSocket(socket)) {
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
      const audit = await auditScreenshot({ imagePath: filepath, url, width, height, label });
      if (typeof ack === 'function') ack({ ok: true, audit });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, reason: err.message });
    }
  });

  function relayShare(event, requireHost) {
    socket.on(event, ({ targetId, ...rest } = {}) => {
      if (!targetId || !io.sockets.sockets.get(targetId)) return;
      if (requireHost) {
        const run = hostRunForSocket(socket);
        const device = devices.get(targetId);
        if (!run || !device || device.runCode !== run.code) return;
      } else {
        const device = devices.get(socket.id);
        const target = io.sockets.sockets.get(targetId);
        if (!device || !target || target.data.runCode !== device.runCode) return;
      }
      io.to(targetId).emit(event, { fromId: socket.id, ...rest });
    });
  }
  relayShare('share-request', true);
  relayShare('share-profile', true);
  relayShare('share-stop', true);
  relayShare('share-control', true);
  relayShare('share-failed', false);
  relayShare('share-ended', false);

  let framesSeen = 0;
  socket.on('share-frame', ({ targetId, frame, width, height } = {}) => {
    const device = devices.get(socket.id);
    if (!device) return;
    if (frame) {
      try {
        latestFrames.set(socket.id, {
          base64: frame,
          width: Number(width) || 0,
          height: Number(height) || 0,
          ts: Date.now(),
        });
        framesSeen++;
        if (framesSeen === 1 || framesSeen % 50 === 0) {
          console.log(`[share-frame] buffered for ${socket.id} (${framesSeen} frames, ${frame.length} base64 chars)`);
        }
      } catch (err) {
        console.error('[share-frame] buffer failed:', err.message);
      }
    }
    const target = targetId ? io.sockets.sockets.get(targetId) : null;
    if (!target || target.data.runCode !== device.runCode) return;
    io.to(targetId).emit('share-frame', { fromId: socket.id, frame, width, height });
  });

  socket.on('console-log', (payload = {}) => {
    const device = devices.get(socket.id);
    if (!device) return;
    emitDeviceLog(device, { ...payload, kind: payload.kind || 'console' });
  });

  socket.on('device-log', (payload = {}) => {
    const device = devices.get(socket.id);
    if (!device) return;
    emitDeviceLog(device, payload);
  });

  socket.on('disconnect', () => {
    latestFrames.delete(socket.id);
    const device = devices.get(socket.id);
    if (device) {
      devices.delete(socket.id);
      broadcastDeviceList(device.runCode);
    }
    const runCode = socket.data.runCode;
    const run = runCode ? runs.get(runCode) : null;
    if (run && socket.data.role === 'host') run.hostIds.delete(socket.id);
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
  console.log(`  Launcher:        http://localhost:${PORT}/`);
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
    console.log('On first visit, accept the self-signed cert warning ("Advanced -> Proceed").');
  }
  console.log('');
}

httpServer.listen(PORT, '0.0.0.0', maybePrintBanner);
httpsServer.listen(HTTPS_PORT, '0.0.0.0', maybePrintBanner);
