const socket = io();
const connState = document.getElementById('conn-state');
const gearDot = document.getElementById('gear-dot');
const frameEl = document.getElementById('frame');
const labelInput = document.getElementById('label-input');
const renameBtn = document.getElementById('rename-btn');
const wInput = document.getElementById('w-input');
const hInput = document.getElementById('h-input');
const applyBtn = document.getElementById('apply-btn');
const fitBtn = document.getElementById('fit-btn');
const presetSelect = document.getElementById('preset-select');
const gearBtn = document.getElementById('gear-btn');
const closePanelBtn = document.getElementById('close-panel');
const controlPanel = document.getElementById('control-panel');
const shareBanner = document.getElementById('share-banner');
const shareMessage = document.getElementById('share-message');
const shareAllowBtn = document.getElementById('share-allow');
const shareDenyBtn = document.getElementById('share-deny');
const joinForm = document.getElementById('join-form');
const runCodeInput = document.getElementById('run-code-input');
const joinStatus = document.getElementById('join-status');
const scanStartBtn = document.getElementById('scan-start');
const scanStopBtn = document.getElementById('scan-stop');
const scanVideo = document.getElementById('scan-video');
const scanPlaceholder = document.getElementById('scan-placeholder');

function openPanel() {
  controlPanel.classList.add('open');
  controlPanel.setAttribute('aria-hidden', 'false');
  gearBtn.classList.add('hidden');
}

function closePanel() {
  controlPanel.classList.remove('open');
  controlPanel.setAttribute('aria-hidden', 'true');
  gearBtn.classList.remove('hidden');
}

gearBtn.addEventListener('click', openPanel);
closePanelBtn.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && controlPanel.classList.contains('open')) closePanel();
});

function guessLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Device';
}

let label = localStorage.getItem('device-label') || guessLabel();
labelInput.value = label;
let activeRunCode = '';
let scanState = null;

function normalizeRunCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function runCodeFromUrl(value = window.location.href) {
  try {
    const url = new URL(value);
    return normalizeRunCode(url.searchParams.get('run'));
  } catch {
    return normalizeRunCode(value);
  }
}

function setJoinStatus(message, isError) {
  joinStatus.textContent = message || '';
  joinStatus.classList.toggle('error', !!isError);
}

function emitDeviceLog(level, message, source = 'client', url = '') {
  if (!socket.connected) return;
  socket.emit('device-log', {
    level,
    message,
    source,
    url: url || frameEl.dataset.intendedUrl || '',
    kind: 'device',
  });
}

function updateClientUrl(runCode) {
  const url = new URL(window.location.href);
  url.pathname = '/client';
  url.searchParams.set('run', runCode);
  window.history.replaceState({}, '', url);
}

function showJoinedUi(runCode) {
  activeRunCode = runCode;
  document.body.classList.remove('needs-join');
  localStorage.setItem('pixelpeek-client-run', runCode);
  updateClientUrl(runCode);
}

function showJoinUi() {
  document.body.classList.add('needs-join');
}

function registerClient(runCode) {
  const code = normalizeRunCode(runCode);
  if (!code) {
    setJoinStatus('Enter a run code.', true);
    showJoinUi();
    return;
  }
  if (!socket.connected) {
    setJoinStatus('Connecting to server...', false);
    return;
  }
  const { width, height } = currentDims();
  setJoinStatus('Joining...', false);
  socket.emit(
    'register-client',
    {
      runCode: code,
      label,
      width,
      height,
      userAgent: navigator.userAgent,
    },
    (ack) => {
      if (!ack?.ok) {
        setJoinStatus(ack?.reason || 'Could not join this run.', true);
        showJoinUi();
        return;
      }
      showJoinedUi(ack.run.code);
      setJoinStatus('', false);
      pushViewport();
      emitDeviceLog('TIP', `Joined run ${ack.run.code}`, 'client');
    },
  );
}

let mode = localStorage.getItem('viewport-mode') || 'fit';
let customW = parseInt(localStorage.getItem('custom-w'), 10) || 390;
let customH = parseInt(localStorage.getItem('custom-h'), 10) || 844;
wInput.value = customW;
hInput.value = customH;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function fitDims() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function currentDims() {
  return mode === 'custom' ? { width: customW, height: customH } : fitDims();
}

function applyMode() {
  if (mode === 'fit') {
    frameEl.classList.remove('custom');
    frameEl.classList.add('fit');
    frameEl.style.removeProperty('width');
    frameEl.style.removeProperty('height');
    fitBtn.classList.add('active');
  } else {
    frameEl.classList.remove('fit');
    frameEl.classList.add('custom');
    frameEl.style.width = customW + 'px';
    frameEl.style.height = customH + 'px';
    fitBtn.classList.remove('active');
  }
  pushViewport();
}

function pushViewport() {
  const { width, height } = currentDims();
  if (socket.connected) socket.emit('viewport-changed', { width, height });
}

function setCustomDims(w, h) {
  customW = clamp(parseInt(w, 10) || customW, 50, 9999);
  customH = clamp(parseInt(h, 10) || customH, 50, 9999);
  wInput.value = customW;
  hInput.value = customH;
  localStorage.setItem('custom-w', customW);
  localStorage.setItem('custom-h', customH);
  mode = 'custom';
  localStorage.setItem('viewport-mode', mode);
  applyMode();
}

socket.on('connect', () => {
  connState.innerHTML = '<span class="badge-dot"></span>connected';
  connState.className = 'badge connected';
  gearDot.className = 'dot connected';
  const code = activeRunCode || runCodeFromUrl() || localStorage.getItem('pixelpeek-client-run') || '';
  if (code) registerClient(code);
  else showJoinUi();
});

socket.on('disconnect', () => {
  connState.innerHTML = '<span class="badge-dot"></span>disconnected';
  connState.className = 'badge disconnected';
  gearDot.className = 'dot disconnected';
});

socket.on('joined-run', (run) => {
  if (run?.code) {
    showJoinedUi(run.code);
    emitDeviceLog('TIP', `Joined run ${run.code}`, 'client');
  }
});

socket.on('join-failed', ({ reason } = {}) => {
  setJoinStatus(reason || 'Could not join this run.', true);
  showJoinUi();
});

const initialRunCode = runCodeFromUrl() || localStorage.getItem('pixelpeek-client-run') || '';
if (initialRunCode && runCodeInput) runCodeInput.value = initialRunCode;

runCodeInput?.addEventListener('input', () => {
  const normalized = normalizeRunCode(runCodeInput.value);
  runCodeInput.value = normalized;
});

joinForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  registerClient(runCodeInput.value);
});

async function startScanner() {
  if (!('BarcodeDetector' in window)) {
    setJoinStatus('QR scanning is not available in this browser. Enter the code instead.', true);
    return;
  }
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    setJoinStatus('QR scanning is not available in this browser. Enter the code instead.', true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    scanVideo.srcObject = stream;
    scanVideo.classList.add('active');
    scanPlaceholder.classList.add('hidden');
    scanStartBtn.hidden = true;
    scanStopBtn.hidden = false;
    await scanVideo.play();

    scanState = { stream, detector, stopped: false };
    const tick = async () => {
      if (!scanState || scanState.stopped) return;
      try {
        const codes = await detector.detect(scanVideo);
        const raw = codes[0]?.rawValue || '';
        const code = runCodeFromUrl(raw);
        if (code) {
          runCodeInput.value = code;
          stopScanner();
          registerClient(code);
          return;
        }
      } catch {
        // Camera frames can fail transiently while starting.
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch {
    setJoinStatus('Camera access failed. Enter the code instead.', true);
    stopScanner();
  }
}

function stopScanner() {
  if (scanState) {
    scanState.stopped = true;
    for (const track of scanState.stream.getTracks()) {
      try { track.stop(); } catch {}
    }
  }
  scanState = null;
  if (scanVideo) {
    try { scanVideo.pause(); } catch {}
    try { scanVideo.srcObject = null; } catch {}
    scanVideo.classList.remove('active');
  }
  scanPlaceholder?.classList.remove('hidden');
  if (scanStartBtn) scanStartBtn.hidden = false;
  if (scanStopBtn) scanStopBtn.hidden = true;
}

scanStartBtn?.addEventListener('click', startScanner);
scanStopBtn?.addEventListener('click', stopScanner);

const frameErrorEl = document.getElementById('frame-error');
const frameErrorOpenEl = document.getElementById('frame-error-open');
const frameErrorTitleEl = document.getElementById('frame-error-title');
const frameErrorReasonEl = document.getElementById('frame-error-reason');

let frameLoadCheckTimer = null;
let pushedUrlToken = 0;
const defaultFrameBlockReason = 'The target page uses browser security headers that prevent it from loading inside the Pixelpeek web client.';

function clearFrameLoadCheck() {
  if (frameLoadCheckTimer) clearTimeout(frameLoadCheckTimer);
  frameLoadCheckTimer = null;
}

function showFrameLoading() {
  if (frameErrorEl) frameErrorEl.hidden = true;
  frameEl.style.visibility = 'hidden';
}

function showFrameError(url, reason = defaultFrameBlockReason) {
  if (!frameErrorEl) return;
  const displayReason = reason || defaultFrameBlockReason;
  if (frameErrorTitleEl) frameErrorTitleEl.textContent = 'This site blocks web embedding.';
  if (frameErrorReasonEl) frameErrorReasonEl.textContent = displayReason;
  if (frameErrorOpenEl) {
    frameErrorOpenEl.href = url;
    frameErrorOpenEl.textContent = `Open ${url} in a new tab`;
  }
  frameErrorEl.hidden = false;
  frameEl.style.visibility = 'hidden';
  emitDeviceLog('WARNING', `Web iframe blocked: ${displayReason}`, 'iframe', url);
}

function hideFrameError() {
  if (!frameErrorEl) return;
  frameErrorEl.hidden = true;
  frameEl.style.visibility = '';
}

async function checkFrameAllowed(url) {
  const response = await fetch(`/api/frame-check?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
  if (!response.ok) {
    return {
      embeddable: true,
      uncertain: true,
      reason: `Frame policy check returned HTTP ${response.status}; attempting iframe load.`,
    };
  }
  return response.json();
}

function loadFrameUrl(url) {
  frameEl.dataset.intendedUrl = url;
  frameEl.src = url;
  clearFrameLoadCheck();
  frameLoadCheckTimer = setTimeout(() => {
    try {
      const href = frameEl.contentWindow?.location?.href;
      if (!href || href === 'about:blank') {
        showFrameError(url, 'The browser kept the frame empty after the URL was pushed.');
      }
    } catch {
      hideFrameError();
      emitDeviceLog('LOG', 'Iframe owns a cross-origin page after timeout check.', 'iframe', url);
    }
  }, 6000);
}

frameEl.addEventListener('load', () => {
  const intendedUrl = frameEl.dataset.intendedUrl || '';
  if (!intendedUrl) return;
  clearFrameLoadCheck();
  try {
    const href = frameEl.contentWindow?.location?.href;
    if (!href || href === 'about:blank') {
      if (intendedUrl !== 'about:blank') {
        showFrameError(intendedUrl, 'The browser kept the frame empty after the URL was pushed.');
      }
    } else {
      hideFrameError();
      emitDeviceLog('LOG', 'Iframe finished loading.', 'iframe', intendedUrl || href);
    }
  } catch {
    hideFrameError();
    emitDeviceLog('LOG', 'Iframe finished loading cross-origin page.', 'iframe', intendedUrl);
  }
});

socket.on('load-url', async ({ url }) => {
  emitDeviceLog('TIP', `Received pushed URL: ${url}`, 'client', url);
  const targetUrl = typeof url === 'string' ? url.trim() : '';
  if (!targetUrl) return;

  const token = ++pushedUrlToken;
  clearFrameLoadCheck();
  frameEl.dataset.intendedUrl = '';
  showFrameLoading();

  let frameCheck;
  try {
    frameCheck = await checkFrameAllowed(targetUrl);
  } catch (err) {
    frameCheck = {
      embeddable: true,
      uncertain: true,
      reason: `Could not check frame policy before loading (${err.name || 'Error'}).`,
    };
  }

  if (token !== pushedUrlToken) return;

  if (frameCheck?.embeddable === false) {
    frameEl.dataset.intendedUrl = targetUrl;
    showFrameError(targetUrl, frameCheck.reason);
    return;
  }

  if (frameCheck?.uncertain) {
    emitDeviceLog(
      'WARNING',
      frameCheck.reason || 'Frame policy check was inconclusive; attempting iframe load.',
      'iframe',
      targetUrl,
    );
  }

  loadFrameUrl(targetUrl);
});

renameBtn.addEventListener('click', () => {
  const next = labelInput.value.trim() || guessLabel();
  label = next;
  localStorage.setItem('device-label', label);
  socket.disconnect();
  socket.connect();
});

applyBtn.addEventListener('click', () => setCustomDims(wInput.value, hInput.value));
wInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setCustomDims(wInput.value, hInput.value);
});
hInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setCustomDims(wInput.value, hInput.value);
});

fitBtn.addEventListener('click', () => {
  mode = 'fit';
  localStorage.setItem('viewport-mode', mode);
  applyMode();
});

presetSelect.addEventListener('change', () => {
  if (!presetSelect.value) return;
  const [w, h] = presetSelect.value.split(',').map(Number);
  setCustomDims(w, h);
  presetSelect.value = '';
});

window.addEventListener('resize', () => {
  if (mode === 'fit') pushViewport();
});
window.addEventListener('orientationchange', () => {
  if (mode === 'fit') pushViewport();
});

applyMode();

let shareState = null;
let pendingShareFrom = null;
let pendingShareProfile = null;
const SHARE_PROFILES = {
  preview: { mode: 'preview', fps: 3, maxFrameDim: 720, jpegQuality: 0.55 },
  detail: { mode: 'detail', fps: 20, maxFrameDim: 1440, jpegQuality: 0.74 },
};

function normalizeShareProfile(profile = {}) {
  const fallback = profile?.mode === 'detail' ? SHARE_PROFILES.detail : SHARE_PROFILES.preview;
  return {
    mode: profile.mode === 'detail' ? 'detail' : 'preview',
    fps: clamp(Number(profile.fps) || fallback.fps, 1, 24),
    maxFrameDim: clamp(Number(profile.maxFrameDim) || fallback.maxFrameDim, 360, 1600),
    jpegQuality: clamp(Number(profile.jpegQuality) || fallback.jpegQuality, 0.35, 0.85),
  };
}

function frameIntervalForProfile(profile) {
  return Math.max(42, Math.round(1000 / (profile.fps || SHARE_PROFILES.preview.fps)));
}

function startFrameTimer(session) {
  if (session.timer) clearInterval(session.timer);
  session.timer = setInterval(() => emitFrame(session), frameIntervalForProfile(session.profile));
}

function applyShareProfile(session, profile) {
  if (!session) return;
  session.profile = normalizeShareProfile(profile);
  startFrameTimer(session);
}

function shareSupportError() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return 'unsupported';
  return null;
}

function showShareBanner(message, isError) {
  shareMessage.textContent = message;
  shareBanner.classList.toggle('error', !!isError);
  shareBanner.hidden = false;
  shareAllowBtn.hidden = !!isError;
  shareDenyBtn.textContent = isError ? 'Dismiss' : 'Deny';
}

function hideShareBanner() {
  shareBanner.hidden = true;
  shareBanner.classList.remove('error');
  shareAllowBtn.hidden = false;
  shareDenyBtn.textContent = 'Deny';
}

socket.on('share-request', ({ fromId, profile }) => {
  const err = shareSupportError();
  if (err) {
    socket.emit('share-failed', { targetId: fromId, reason: err });
    const text = err === 'insecure'
      ? 'Screen share unavailable - this page must be served over HTTPS or localhost.'
      : 'This browser does not support screen sharing.';
    showShareBanner(text, true);
    return;
  }
  if (shareState) stopShare();
  pendingShareFrom = fromId;
  pendingShareProfile = normalizeShareProfile(profile);
  showShareBanner('Host wants to view your screen', false);
});

shareAllowBtn.addEventListener('click', async () => {
  const fromId = pendingShareFrom;
  const profile = pendingShareProfile || SHARE_PROFILES.preview;
  pendingShareFrom = null;
  pendingShareProfile = null;
  hideShareBanner();
  if (!fromId) return;
  await startSharing(fromId, profile);
});

shareDenyBtn.addEventListener('click', () => {
  if (pendingShareFrom) socket.emit('share-failed', { targetId: pendingShareFrom, reason: 'denied' });
  pendingShareFrom = null;
  pendingShareProfile = null;
  hideShareBanner();
});

async function startSharing(hostId, initialProfile = SHARE_PROFILES.preview) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 24, max: 30 } },
      audio: false,
    });
  } catch (err) {
    const reason = err && err.name === 'NotAllowedError' ? 'denied' : (err && err.name) || 'unknown';
    socket.emit('share-failed', { targetId: hostId, reason });
    return;
  }

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
  } catch {
    socket.emit('share-failed', { targetId: hostId, reason: 'autoplay-blocked' });
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  if (video.readyState < 2) {
    await new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('loadeddata', done);
        resolve();
      };
      video.addEventListener('loadeddata', done);
    });
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (!shareState || shareState.hostId !== hostId) return;
      socket.emit('share-ended', { targetId: hostId });
      stopShare();
    });
  });

  const session = {
    hostId,
    stream,
    video,
    canvas,
    ctx,
    timer: null,
    profile: normalizeShareProfile(initialProfile),
  };
  shareState = session;
  startFrameTimer(session);
}

function emitFrame(session) {
  if (!shareState || shareState !== session) return;
  const { video, canvas, ctx, hostId } = session;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const profile = session.profile || SHARE_PROFILES.preview;
  const scale = Math.min(1, profile.maxFrameDim / Math.max(vw, vh));
  const w = Math.max(2, Math.round(vw * scale));
  const h = Math.max(2, Math.round(vh * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch {
    return;
  }
  const dataUrl = canvas.toDataURL('image/jpeg', profile.jpegQuality);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  socket.emit('share-frame', { targetId: hostId, frame: base64, width: w, height: h });
}

socket.on('share-profile', ({ fromId, profile }) => {
  if (!shareState && pendingShareFrom === fromId) {
    pendingShareProfile = normalizeShareProfile(profile);
    return;
  }
  if (!shareState || shareState.hostId !== fromId) return;
  applyShareProfile(shareState, profile);
});

socket.on('share-stop', () => {
  if (shareState) socket.emit('share-ended', { targetId: shareState.hostId });
  stopShare();
});

socket.on('share-control', ({ type, deltaX, deltaY, x, y }) => {
  const win = frameEl?.contentWindow;
  if (!win) return;
  try {
    if (type === 'scroll') win.scrollBy(deltaX || 0, deltaY || 0);
    else if (type === 'scroll-to') win.scrollTo(x || 0, y || 0);
  } catch {
    // Cross-origin frame cannot be scripted.
  }
});

function stopShare() {
  if (!shareState) return;
  const s = shareState;
  shareState = null;
  if (s.timer) clearInterval(s.timer);
  if (s.stream) {
    for (const t of s.stream.getTracks()) {
      try { t.stop(); } catch {}
    }
  }
  if (s.video) {
    try { s.video.srcObject = null; } catch {}
  }
}
