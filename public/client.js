const socket = io();
const connState = document.getElementById('conn-state');
const gearDot = document.getElementById('gear-dot');
const frameEl = document.getElementById('frame');
const frameWrap = document.getElementById('frame-wrap');
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

let mode = localStorage.getItem('viewport-mode') || 'fit';
let customW = parseInt(localStorage.getItem('custom-w'), 10) || 390;
let customH = parseInt(localStorage.getItem('custom-h'), 10) || 844;
wInput.value = customW;
hInput.value = customH;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function fitDims() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
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
  const { width, height } = currentDims();
  socket.emit('register-client', {
    label,
    width,
    height,
    userAgent: navigator.userAgent,
  });
});

socket.on('disconnect', () => {
  connState.innerHTML = '<span class="badge-dot"></span>disconnected';
  connState.className = 'badge disconnected';
  gearDot.className = 'dot disconnected';
});

const frameErrorEl = document.getElementById('frame-error');
const frameErrorOpenEl = document.getElementById('frame-error-open');

let frameLoadCheckTimer = null;

function showFrameError(url) {
  if (!frameErrorEl) return;
  if (frameErrorOpenEl) {
    frameErrorOpenEl.href = url;
    frameErrorOpenEl.textContent = `Open ${url} in a new tab`;
  }
  frameErrorEl.hidden = false;
  frameEl.style.visibility = 'hidden';
}
function hideFrameError() {
  if (!frameErrorEl) return;
  frameErrorEl.hidden = true;
  frameEl.style.visibility = '';
}

frameEl.addEventListener('load', () => {
  if (frameLoadCheckTimer) clearTimeout(frameLoadCheckTimer);
  // After load, try to read the iframe location. Cross-origin = SecurityError = the page loaded fine.
  // Same-origin but the iframe is showing about:blank likely means the target blocked us
  // via X-Frame-Options / CSP frame-ancestors.
  try {
    const href = frameEl.contentWindow?.location?.href;
    if (!href || href === 'about:blank') {
      // Iframe finished load on about:blank — probably blocked by X-Frame-Options
      if (frameEl.dataset.intendedUrl && frameEl.dataset.intendedUrl !== 'about:blank') {
        showFrameError(frameEl.dataset.intendedUrl);
      }
    } else {
      hideFrameError();
    }
  } catch {
    // Cross-origin — iframe is actually loaded with a different-origin page → OK
    hideFrameError();
  }
});

socket.on('load-url', ({ url }) => {
  hideFrameError();
  frameEl.dataset.intendedUrl = url;
  frameEl.src = url;
  // If we never get a load event within 6s, the embed almost certainly failed.
  if (frameLoadCheckTimer) clearTimeout(frameLoadCheckTimer);
  frameLoadCheckTimer = setTimeout(() => {
    try {
      const href = frameEl.contentWindow?.location?.href;
      if (!href || href === 'about:blank') showFrameError(url);
    } catch {
      // cross-origin = succeeded
    }
  }, 6000);
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

// ---- screen share (Socket.IO JPEG streaming) ----

let shareState = null;            // { hostId, stream, video, canvas, ctx, timer }
let pendingShareFrom = null;
const FRAME_INTERVAL_MS = 100;    // ~10 FPS
const MAX_FRAME_DIM = 720;        // downscale capture to keep frame size in check
const JPEG_QUALITY = 0.55;

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

socket.on('share-request', ({ fromId }) => {
  const err = shareSupportError();
  if (err) {
    socket.emit('share-failed', { targetId: fromId, reason: err });
    const text = err === 'insecure'
      ? 'Screen share unavailable — this page must be served over HTTPS or localhost.'
      : 'This browser does not support screen sharing.';
    showShareBanner(text, true);
    return;
  }
  if (shareState) stopShare();
  pendingShareFrom = fromId;
  showShareBanner('Host wants to view your screen', false);
});

shareAllowBtn.addEventListener('click', async () => {
  const fromId = pendingShareFrom;
  pendingShareFrom = null;
  hideShareBanner();
  if (!fromId) return;
  await startSharing(fromId);
});

shareDenyBtn.addEventListener('click', () => {
  if (pendingShareFrom) {
    socket.emit('share-failed', { targetId: pendingShareFrom, reason: 'denied' });
  }
  pendingShareFrom = null;
  hideShareBanner();
});

async function startSharing(hostId) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 15 } },
      audio: false,
    });
  } catch (err) {
    const reason = err && err.name === 'NotAllowedError' ? 'denied' : (err && err.name) || 'unknown';
    socket.emit('share-failed', { targetId: hostId, reason });
    return;
  }

  // Attach the captured stream to an off-DOM video element we can read pixels from.
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
  } catch {
    // Some browsers refuse autoplay even when muted; fail gracefully.
    socket.emit('share-failed', { targetId: hostId, reason: 'autoplay-blocked' });
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  // Wait until the first frame is decodable so we know the natural dimensions.
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

  // User stopping the share via the browser's "Stop sharing" bar ends the track.
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (!shareState || shareState.hostId !== hostId) return;
      socket.emit('share-ended', { targetId: hostId });
      stopShare();
    });
  });

  const session = { hostId, stream, video, canvas, ctx, timer: null };
  shareState = session;

  session.timer = setInterval(() => emitFrame(session), FRAME_INTERVAL_MS);
}

function emitFrame(session) {
  if (!shareState || shareState !== session) return;
  const { video, canvas, ctx, hostId } = session;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  // Downscale so the JPEG payload stays small.
  const scale = Math.min(1, MAX_FRAME_DIM / Math.max(vw, vh));
  const w = Math.max(2, Math.round(vw * scale));
  const h = Math.max(2, Math.round(vh * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch {
    return;
  }
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  socket.emit('share-frame', { targetId: hostId, frame: base64, width: w, height: h });
}

socket.on('share-stop', () => {
  if (shareState) {
    socket.emit('share-ended', { targetId: shareState.hostId });
  }
  stopShare();
});

// Host can scroll the page the client is showing. Same-origin pages get
// programmatic scroll; cross-origin pages are inaccessible via JS so we
// silently no-op (the host operator should load same-origin content for control).
socket.on('share-control', ({ type, deltaX, deltaY, x, y }) => {
  const win = frameEl?.contentWindow;
  if (!win) return;
  try {
    if (type === 'scroll') {
      win.scrollBy(deltaX || 0, deltaY || 0);
    } else if (type === 'scroll-to') {
      win.scrollTo(x || 0, y || 0);
    }
  } catch {
    // cross-origin frame — cannot script
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
