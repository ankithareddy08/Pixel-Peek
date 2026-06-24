import { io as ioClient } from 'socket.io-client';

const SERVER = process.env.SERVER || 'http://localhost:4000';
const TEST_URL = 'https://example.com/milestone-1-test';
const REAL_URL = 'https://example.com/';

const results = [];
const log = (ok, msg) => {
  results.push({ ok, msg });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

function wait(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function waitMatching(socket, event, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for matching "${event}"`));
    }, timeoutMs);
    function handler(payload) {
      if (predicate(payload)) {
        clearTimeout(t);
        socket.off(event, handler);
        resolve(payload);
      }
    }
    socket.on(event, handler);
  });
}

async function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function main() {
  console.log(`\nTesting orchestrator at ${SERVER}\n`);

  const host = ioClient(SERVER, { transports: ['websocket'] });
  await wait(host, 'connect');
  log(true, 'host socket connected');

  host.emit('register-host');
  const initialList = await wait(host, 'device-list');
  log(Array.isArray(initialList), `host received initial device-list (length=${initialList.length})`);

  // Client #1
  const client = ioClient(SERVER, { transports: ['websocket'] });
  await wait(client, 'connect');
  log(true, 'client socket connected');

  client.emit('register-client', {
    label: 'TestPhone',
    width: 390,
    height: 844,
    userAgent: 'milestone-1-test',
  });

  const listAfterRegister = await waitMatching(
    host,
    'device-list',
    (list) => list.some((d) => d.id === client.id),
  );
  const registered = listAfterRegister.find((d) => d.id === client.id);
  log(
    registered?.label === 'TestPhone' && registered.width === 390 && registered.height === 844,
    `host saw client registered (${registered?.label} ${registered?.width}x${registered?.height})`,
  );

  // URL push to broadcast. Server may have a stale lastBroadcastUrl from earlier runs that gets
  // replayed to our client on register — use waitMatching to find OUR url specifically.
  const receivedTestUrl = waitMatching(client, 'load-url', (p) => p.url === TEST_URL);
  host.emit('load-url', { url: TEST_URL });
  const received = await receivedTestUrl;
  log(received?.url === TEST_URL, `client received load-url with url=${received?.url}`);

  // Confirm host's device-list shows the new currentUrl for our client
  const listWithUrl = await waitMatching(
    host,
    'device-list',
    (list) => list.find((d) => d.id === client.id)?.currentUrl === TEST_URL,
  );
  log(true, `host's device-list reflects currentUrl=${listWithUrl.find((d) => d.id === client.id).currentUrl}`);

  // Viewport change
  client.emit('viewport-changed', { width: 1024, height: 768 });
  await waitMatching(host, 'device-list', (list) => {
    const d = list.find((x) => x.id === client.id);
    return d?.width === 1024 && d.height === 768;
  });
  log(true, `viewport change propagated to host (1024x768)`);

  // Targeted push (specific socket id)
  const targetedUrl = 'https://example.com/targeted';
  const targetedPromise = waitMatching(client, 'load-url', (p) => p.url === targetedUrl);
  host.emit('load-url', { url: targetedUrl, targetId: client.id });
  const targeted = await targetedPromise;
  log(targeted?.url === targetedUrl, `targeted load-url delivered (url=${targeted?.url})`);

  // Disconnect — host's list should no longer contain our client
  client.disconnect();
  await waitMatching(host, 'device-list', (list) => !list.some((d) => d.id === client.id));
  log(true, `client removed from device-list after disconnect`);

  // Push to a non-existent targetId → ack.delivered === 0 (hermetic — doesn't depend on no other clients existing)
  const ack0 = await emitAck(host, 'load-url', {
    url: 'https://example.com/no-such-target',
    targetId: 'this-socket-id-does-not-exist',
  });
  log(ack0?.ok && ack0.delivered === 0, `push to nonexistent target returns ack.delivered=${ack0?.delivered}`);

  // Replay: a new client connecting after a broadcast push should auto-receive the lastBroadcastUrl
  const replayProbeUrl = 'https://example.com/replay-probe';
  await emitAck(host, 'load-url', { url: replayProbeUrl });
  const lateClient = ioClient(SERVER, { transports: ['websocket'] });
  await wait(lateClient, 'connect');
  const replayPromise = waitMatching(lateClient, 'load-url', (p) => p.url === replayProbeUrl, 5000);
  lateClient.emit('register-client', {
    label: 'LateClient',
    width: 800,
    height: 600,
    userAgent: 'milestone-1-test-late',
  });
  const replayed = await replayPromise;
  log(replayed?.url === replayProbeUrl, `late client received replayed URL (${replayed?.url})`);
  lateClient.disconnect();

  // Screenshot capture: register a client at a real URL, trigger capture, verify a PNG for that client.
  // Let prior disconnects settle so we don't race their device-list updates.
  await new Promise((r) => setTimeout(r, 300));
  const captureClient = ioClient(SERVER, { transports: ['websocket'] });
  await wait(captureClient, 'connect');
  captureClient.emit('register-client', {
    label: 'CaptureTarget',
    width: 800,
    height: 600,
    userAgent: 'milestone-1-test-capture',
  });
  // Brief settle for server to process register-client (no ack on this event).
  await new Promise((r) => setTimeout(r, 200));

  // Targeted push of a real reachable URL so the capture target has currentUrl=REAL_URL.
  const pushedAck = await emitAck(host, 'load-url', { url: REAL_URL, targetId: captureClient.id });
  log(pushedAck?.delivered === 1, `pushed REAL_URL to capture target (delivered=${pushedAck?.delivered})`);

  // Trigger the capture; wait for the screenshot event that matches our id
  const ourScreenshotPromise = waitMatching(
    host,
    'screenshot-captured',
    (s) => s.id === captureClient.id,
    45000,
  );
  const captureAck = await emitAck(host, 'capture-screenshots', {});
  log(captureAck?.ok, `capture-screenshots ack ok=${captureAck?.ok} captured=${captureAck?.captured} errors=${captureAck?.errors}`);

  const shot = await ourScreenshotPromise;
  log(
    shot?.label === 'CaptureTarget' && shot.path?.startsWith('/screenshots/') && !shot.error,
    `screenshot event for CaptureTarget: label=${shot?.label} path=${shot?.path} error=${shot?.error || 'none'}`,
  );

  if (shot?.path) {
    const res = await fetch(`${SERVER}${shot.path}`);
    const ct = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-length') || 0);
    log(
      res.ok && ct.includes('image/png') && len > 0,
      `screenshot file served via HTTP (status=${res.status}, type=${ct}, bytes=${len})`,
    );
  }

  // Step 4: vision auditor — only runs if a key is configured on the server
  const health = await fetch(`${SERVER}/health`).then((r) => r.json());
  if (!health.geminiKeyLoaded) {
    log(true, 'SKIP audit checks — GEMINI_API_KEY not loaded on server');
  } else if (!shot?.path) {
    log(false, 'SKIP audit checks — no screenshot path to audit');
  } else {
    const auditAck = await new Promise((resolve) =>
      host.emit(
        'audit-screenshot',
        {
          path: shot.path,
          url: shot.url,
          width: shot.width,
          height: shot.height,
          label: shot.label,
        },
        resolve,
      ),
    );
    log(
      auditAck?.ok === true,
      `audit-screenshot ack ok=${auditAck?.ok} reason=${auditAck?.reason || 'none'}`,
    );
    if (auditAck?.ok) {
      const a = auditAck.audit;
      const validStructure =
        typeof a?.summary === 'string' &&
        Array.isArray(a.issues) &&
        ['none', 'low', 'medium', 'high', 'critical'].includes(a.overall_severity);
      log(
        validStructure,
        `audit returned valid schema: severity=${a?.overall_severity}, issues=${a?.issues?.length}, summary="${(a?.summary || '').slice(0, 60)}"`,
      );

      // Path traversal must be rejected
      const traversalAck = await new Promise((resolve) =>
        host.emit(
          'audit-screenshot',
          { path: '/screenshots/../../../etc/hosts', url: '', width: 0, height: 0, label: '' },
          resolve,
        ),
      );
      log(
        traversalAck?.ok === false,
        `path traversal rejected (ok=${traversalAck?.ok} reason=${traversalAck?.reason})`,
      );
    }
  }

  captureClient.disconnect();

  // ---- WebRTC signaling relay (Part B / screen share) ----
  const shareClient = ioClient(SERVER, { transports: ['websocket'] });
  await wait(shareClient, 'connect');
  shareClient.emit('register-client', {
    label: 'ShareTarget',
    width: 1280,
    height: 800,
    userAgent: 'milestone-1-test-share',
  });
  await new Promise((r) => setTimeout(r, 150));

  // host → client: share-request relayed with fromId = host.id
  const requestPromise = waitMatching(shareClient, 'share-request', (p) => p.fromId === host.id, 3000);
  host.emit('share-request', { targetId: shareClient.id });
  const req = await requestPromise;
  log(req?.fromId === host.id, `client received share-request with fromId=${req?.fromId}`);

  // client → host: share-offer relayed with fromId = client.id, sdp preserved
  const offerPromise = waitMatching(host, 'share-offer', (p) => p.fromId === shareClient.id, 3000);
  shareClient.emit('share-offer', { targetId: host.id, sdp: { type: 'offer', sdp: 'mock' } });
  const offer = await offerPromise;
  log(
    offer?.fromId === shareClient.id && offer?.sdp?.type === 'offer',
    `host received share-offer (fromId=${offer?.fromId}, sdp.type=${offer?.sdp?.type})`,
  );

  // ICE relay both directions
  const iceToClient = waitMatching(shareClient, 'share-ice', (p) => p.candidate?.candidate === 'host-cand', 3000);
  host.emit('share-ice', { targetId: shareClient.id, candidate: { candidate: 'host-cand' } });
  const ice1 = await iceToClient;
  log(ice1?.fromId === host.id, `host→client ICE relayed (fromId=${ice1?.fromId})`);

  const iceToHost = waitMatching(host, 'share-ice', (p) => p.candidate?.candidate === 'client-cand', 3000);
  shareClient.emit('share-ice', { targetId: host.id, candidate: { candidate: 'client-cand' } });
  const ice2 = await iceToHost;
  log(ice2?.fromId === shareClient.id, `client→host ICE relayed (fromId=${ice2?.fromId})`);

  // Role gate: a non-host client cannot emit share-request
  const otherClient = ioClient(SERVER, { transports: ['websocket'] });
  await wait(otherClient, 'connect');
  otherClient.emit('register-client', { label: 'Outsider', width: 100, height: 100, userAgent: 'x' });
  await new Promise((r) => setTimeout(r, 100));
  const leakPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('no-event'), 600);
    shareClient.once('share-request', () => {
      clearTimeout(timer);
      resolve('leaked');
    });
  });
  otherClient.emit('share-request', { targetId: shareClient.id });
  const leak = await leakPromise;
  log(leak === 'no-event', `non-host share-request blocked (result=${leak})`);
  otherClient.disconnect();

  // Targeting a nonexistent socket is silently dropped (no crash, no event)
  const ghostPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('no-event'), 400);
    host.once('share-offer', () => {
      clearTimeout(timer);
      resolve('leaked');
    });
  });
  shareClient.emit('share-offer', { targetId: 'no-such-socket', sdp: { type: 'offer', sdp: 'x' } });
  const ghost = await ghostPromise;
  log(ghost === 'no-event', `share-offer to nonexistent target dropped (result=${ghost})`);

  shareClient.disconnect();

  host.disconnect();

  // Allow disconnects to flush server-side before exit
  await new Promise((r) => setTimeout(r, 300));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTEST ERROR:', err.message);
  process.exit(1);
});
