const socket = io();
const statusEl = document.getElementById('connection-status');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const targetSelect = document.getElementById('target-select');
const deviceListEl = document.getElementById('device-list');
const deviceCountEl = document.getElementById('device-count');
const logEl = document.getElementById('log');
const captureBtn = document.getElementById('capture-btn');
const shareAllBtn = document.getElementById('share-all-btn');
const captureStatus = document.getElementById('capture-status');
const galleryEl = document.getElementById('gallery');
const screenshotCountEl = document.getElementById('screenshot-count');
const clearGalleryBtn = document.getElementById('clear-gallery-btn');
const statDevicesEl = document.getElementById('stat-devices');
const statShotsEl = document.getElementById('stat-shots');
const statLastEl = document.getElementById('stat-last');
const runCodeEl = document.getElementById('run-code');
const runCodeModalEl = document.getElementById('run-code-modal');
const connectQrInline = document.getElementById('connect-qr-inline');
const connectQrModal = document.getElementById('connect-qr-modal');
const connectLinkSelect = document.getElementById('connect-link-select');
const connectLinkInput = document.getElementById('connect-link-input');
const copyCodeBtn = document.getElementById('copy-code-btn');
const copyCodeModalBtn = document.getElementById('copy-code-modal-btn');
const copyLinkBtn = document.getElementById('copy-link-btn');
const copyLinkModalBtn = document.getElementById('copy-link-modal-btn');
const showConnectBtn = document.getElementById('show-connect-btn');
const newRunBtn = document.getElementById('new-run-btn');
const connectModal = document.getElementById('connect-modal');
const connectCloseBtn = document.getElementById('connect-close');

const shareModal = document.getElementById('share-modal');
const shareImage = document.getElementById('share-image');
const shareTitle = document.getElementById('share-title');
const shareMetaEl = document.getElementById('share-meta');
const shareStatusEl = document.getElementById('share-status');
const sharePlaceholder = document.getElementById('share-placeholder');
const shareCloseBtn = document.getElementById('share-close');
const shareStartBtn = document.getElementById('share-start-btn');
const shareStopBtn = document.getElementById('share-stop-btn');
const shareBanner = document.getElementById('share-banner');
const shareBannerLabel = document.getElementById('share-banner-label');
const shareBannerStop = document.getElementById('share-banner-stop');
const shareBannerView = document.getElementById('share-banner-view');
const logsListEl = document.getElementById('logs-list');
const logsClearBtn = document.getElementById('logs-clear');

const screenshots = [];
let currentDevices = [];
let activeRun = null;
let connectOptions = [];
let selectedConnectUrl = '';
let didShowInitialConnect = false;

const liveFrames = new Map();
const cardFramePaintedAt = new Map();
const deviceLogs = new Map();
const cardImageEls = new Map();
const MAX_LOGS_PER_DEVICE = 200;
const CARD_PREVIEW_PAINT_INTERVAL_MS = 1200;

function getRunCodeFromUrl() {
  return new URLSearchParams(window.location.search).get('run') || '';
}

function updateHostUrl(runCode) {
  const url = new URL(window.location.href);
  url.pathname = '/host';
  url.searchParams.set('run', runCode);
  if (!url.hash) url.hash = '#connect';
  window.history.replaceState({}, '', url);
}

function qrSrcFor(url) {
  return `/api/qr?data=${encodeURIComponent(url)}`;
}

function setRunCode(code) {
  const value = code || '------';
  if (runCodeEl) runCodeEl.textContent = value;
  if (runCodeModalEl) runCodeModalEl.textContent = value;
}

function selectedConnectOption() {
  return connectOptions.find((option) => option.url === selectedConnectUrl) || connectOptions[0] || null;
}

function refreshQr() {
  const option = selectedConnectOption();
  selectedConnectUrl = option?.url || '';
  if (connectLinkInput) connectLinkInput.value = selectedConnectUrl;
  const src = selectedConnectUrl ? qrSrcFor(selectedConnectUrl) : '';
  if (connectQrInline) {
    connectQrInline.src = src;
    connectQrInline.hidden = !src;
  }
  if (connectQrModal) {
    connectQrModal.src = src;
    connectQrModal.hidden = !src;
  }
}

async function loadConnectOptions(runCode) {
  if (!runCode) return;
  const res = await fetch(`/api/connect-options?runCode=${encodeURIComponent(runCode)}`);
  if (!res.ok) throw new Error('failed to load connection links');
  const data = await res.json();
  connectOptions = data.options || [];
  const recommended = connectOptions.find((option) => option.recommended) || connectOptions[0] || null;
  selectedConnectUrl = recommended?.url || '';
  if (connectLinkSelect) {
    connectLinkSelect.innerHTML = '';
    for (const option of connectOptions) {
      const opt = document.createElement('option');
      opt.value = option.url;
      opt.textContent = `${option.label} - ${option.detail}`;
      connectLinkSelect.appendChild(opt);
    }
    connectLinkSelect.value = selectedConnectUrl;
  }
  refreshQr();
}

async function copyText(value, label) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    log(`${label} copied.`);
  } catch {
    log(`Copy failed. ${label}: ${value}`);
  }
}

function showConnectModal() {
  if (connectModal) connectModal.hidden = false;
}

function hideConnectModal() {
  if (connectModal) connectModal.hidden = true;
}

function registerHost(runCode) {
  socket.emit('register-host', { runCode }, async (ack) => {
    if (!ack?.ok || !ack.run?.code) {
      log('Host run setup failed.');
      return;
    }
    activeRun = ack.run;
    localStorage.setItem('pixelpeek-host-run', activeRun.code);
    updateHostUrl(activeRun.code);
    setRunCode(activeRun.code);
    try {
      await loadConnectOptions(activeRun.code);
      if (!didShowInitialConnect || window.location.hash === '#connect') {
        didShowInitialConnect = true;
        showConnectModal();
      }
    } catch (err) {
      log(`Connection panel failed: ${err.message}`);
    }
    log(`Host run ready: ${activeRun.code}`);
  });
}

function aspectRatioLabel(w, h) {
  if (!w || !h) return '';
  const r = w / h;
  const candidates = [
    [16, 9], [9, 16], [16, 10], [10, 16],
    [4, 3], [3, 4], [21, 9], [9, 21],
    [3, 2], [2, 3], [19.5, 9], [9, 19.5],
    [20, 9], [9, 20], [18, 9], [9, 18],
    [1, 1],
  ];
  for (const [a, b] of candidates) {
    if (Math.abs(r - a / b) < 0.015) return `${a}:${b}`;
  }
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function getLatestShotForDevice(id) {
  for (const s of screenshots) {
    if (s.id === id && s.path && !s.error) return s;
  }
  return null;
}

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(li);
  while (logEl.children.length > 50) logEl.lastChild.remove();
}

function setStatus(state) {
  statusEl.className = `status ${state}`;
  statusEl.innerHTML = `<span class="status-dot"></span><span class="status-text">${state}</span>`;
}

socket.on('connect', () => {
  setStatus('connected');
  const runCode = getRunCodeFromUrl() || localStorage.getItem('pixelpeek-host-run') || '';
  registerHost(runCode);
  log('Connected to server.');
});

socket.on('disconnect', () => {
  setStatus('disconnected');
  log('Disconnected from server.');
});

socket.on('device-list', (devices) => {
  currentDevices = devices;
  renderDevices();
});

function renderDevices() {
  const devices = currentDevices;
  deviceCountEl.textContent = String(devices.length);
  if (statDevicesEl) statDevicesEl.textContent = String(devices.length);
  if (shareAllBtn) shareAllBtn.disabled = devices.length === 0;

  const previous = targetSelect.value;
  targetSelect.innerHTML = '<option value="">All connected devices</option>';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.label} - ${d.width}x${d.height}`;
    targetSelect.appendChild(opt);
  }
  targetSelect.value = previous;

  if (devices.length === 0) {
    deviceListEl.innerHTML =
      '<div class="empty-state"><div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"></rect><line x1="12" y1="18" x2="12" y2="18"></line></svg></div><p class="empty-title">No devices connected yet</p><p class="empty-body">Open <code>/client</code> on a device on the same network to get started.</p></div>';
    return;
  }
  deviceListEl.innerHTML = '';
  cardImageEls.clear();
  for (const d of devices) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'device-card';
    card.dataset.id = d.id;
    if (liveFrames.has(d.id)) card.classList.add('is-sharing');

    const preview = document.createElement('div');
    preview.className = 'device-preview';
    if (d.width && d.height) preview.style.aspectRatio = `${d.width} / ${d.height}`;

    const live = liveFrames.get(d.id);
    const latest = getLatestShotForDevice(d.id);
    if (live || latest) {
      const img = document.createElement('img');
      img.src = live ? `data:image/jpeg;base64,${live}` : latest.path;
      img.alt = `${d.label} preview`;
      img.loading = 'lazy';
      preview.appendChild(img);
      cardImageEls.set(d.id, img);
    } else {
      const empty = document.createElement('span');
      empty.className = 'empty-preview';
      empty.textContent = 'no preview yet';
      preview.appendChild(empty);
    }
    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay';
    const ratio = aspectRatioLabel(d.width, d.height);
    if (ratio) {
      const rb = document.createElement('span');
      rb.className = 'ratio-badge';
      rb.textContent = ratio;
      overlay.appendChild(rb);
    }
    preview.appendChild(overlay);
    const hint = document.createElement('span');
    hint.className = 'share-hint';
    hint.textContent = 'click for details';
    preview.appendChild(hint);

    const info = document.createElement('div');
    info.className = 'device-info';
    const top = document.createElement('div');
    top.className = 'device-info-top';
    const lbl = document.createElement('strong');
    lbl.className = 'label';
    lbl.textContent = d.label;
    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = `${d.width}x${d.height}`;
    top.appendChild(lbl);
    top.appendChild(dims);
    const ua = document.createElement('p');
    ua.className = 'ua';
    ua.textContent = d.userAgent || '';
    const url = document.createElement('p');
    url.className = 'url';
    url.textContent = d.currentUrl ? `-> ${d.currentUrl}` : 'idle';

    info.appendChild(top);
    info.appendChild(ua);
    info.appendChild(url);

    card.appendChild(preview);
    card.appendChild(info);
    card.addEventListener('click', () => openDeviceDetail(d));
    deviceListEl.appendChild(card);
  }
}

function renderAudit(container, audit) {
  container.innerHTML = '';
  const summary = document.createElement('div');
  const sev = audit.overall_severity || 'none';
  summary.className = `audit-summary sev-${sev}`;
  const sevBadge = document.createElement('span');
  sevBadge.className = `sev-badge sev-${sev}`;
  sevBadge.textContent = sev;
  const sumText = document.createElement('span');
  sumText.textContent = audit.summary || '';
  summary.appendChild(sevBadge);
  summary.appendChild(sumText);
  container.appendChild(summary);

  if (audit.issues?.length) {
    const ul = document.createElement('ul');
    ul.className = 'issue-list';
    for (const issue of audit.issues) {
      const li = document.createElement('li');
      li.className = `issue sev-${issue.severity || 'low'}`;
      const head = document.createElement('div');
      head.className = 'issue-head';
      const sevSpan = document.createElement('span');
      sevSpan.className = `sev-badge sev-${issue.severity || 'low'}`;
      sevSpan.textContent = issue.severity || 'low';
      const typeSpan = document.createElement('code');
      typeSpan.className = 'issue-type';
      typeSpan.textContent = issue.type || 'other';
      head.appendChild(sevSpan);
      head.appendChild(typeSpan);
      if (issue.location) {
        const locSpan = document.createElement('span');
        locSpan.className = 'issue-loc';
        locSpan.textContent = issue.location;
        head.appendChild(locSpan);
      }
      const desc = document.createElement('div');
      desc.className = 'issue-desc';
      desc.textContent = issue.description || '';
      li.appendChild(head);
      li.appendChild(desc);
      if (issue.likely_css_cause) {
        const cssEl = document.createElement('div');
        cssEl.className = 'issue-css';
        cssEl.textContent = `likely cause: ${issue.likely_css_cause}`;
        li.appendChild(cssEl);
      }
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
}

function runAudit(shot, btn, container) {
  btn.disabled = true;
  btn.textContent = 'Auditing...';
  container.classList.add('loading');
  socket.emit(
    'audit-screenshot',
    {
      path: shot.path,
      url: shot.url,
      width: shot.width,
      height: shot.height,
      label: shot.label,
    },
    (ack) => {
      btn.disabled = false;
      btn.textContent = 'Re-audit';
      container.classList.remove('loading');
      if (!ack?.ok) {
        container.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'audit-error';
        err.textContent = `Audit failed: ${ack?.reason || 'unknown'}`;
        container.appendChild(err);
        log(`Audit failed for ${shot.label}: ${ack?.reason}`);
        return;
      }
      renderAudit(container, ack.audit);
      const n = ack.audit.issues?.length || 0;
      log(`Audit complete for ${shot.label}: ${n} issue${n === 1 ? '' : 's'} (${ack.audit.overall_severity})`);
    },
  );
}

function renderGallery() {
  screenshotCountEl.textContent = String(screenshots.length);
  if (statShotsEl) statShotsEl.textContent = String(screenshots.length);
  if (statLastEl && screenshots.length > 0) {
    statLastEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (screenshots.length === 0) {
    galleryEl.innerHTML =
      '<div class="empty-state"><div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div><p class="empty-title">No screenshots yet</p><p class="empty-body">Push a URL, then hit <strong>Capture now</strong> to fill the gallery.</p></div>';
    return;
  }
  galleryEl.innerHTML = '';
  for (const s of screenshots) {
    const card = document.createElement('div');
    card.className = 'shot-card';
    if (s.error) {
      card.classList.add('error');
      const meta = document.createElement('div');
      meta.className = 'shot-meta';
      const lbl = document.createElement('strong');
      lbl.textContent = s.label;
      const dim = document.createElement('span');
      dim.textContent = `${s.width}x${s.height}`;
      meta.appendChild(lbl);
      meta.appendChild(dim);
      const errDiv = document.createElement('div');
      errDiv.className = 'shot-error';
      errDiv.textContent = `Error: ${s.error}`;
      const urlDiv = document.createElement('div');
      urlDiv.className = 'shot-url';
      urlDiv.textContent = s.url;
      card.appendChild(meta);
      card.appendChild(errDiv);
      card.appendChild(urlDiv);
    } else {
      const link = document.createElement('a');
      link.href = s.path;
      link.target = '_blank';
      const img = document.createElement('img');
      img.src = s.path;
      img.loading = 'lazy';
      img.alt = `${s.label} ${s.width}x${s.height}`;
      link.appendChild(img);
      const meta = document.createElement('div');
      meta.className = 'shot-meta';
      const lbl = document.createElement('strong');
      lbl.textContent = s.label;
      const dim = document.createElement('span');
      dim.textContent = `${s.width}x${s.height}`;
      meta.appendChild(lbl);
      meta.appendChild(dim);
      const urlDiv = document.createElement('div');
      urlDiv.className = 'shot-url';
      urlDiv.title = s.url;
      urlDiv.textContent = s.url;
      const auditPanel = document.createElement('div');
      auditPanel.className = 'audit-panel';
      const auditBtn = document.createElement('button');
      auditBtn.className = 'audit-btn';
      auditBtn.type = 'button';
      auditBtn.textContent = 'Audit layout';
      auditBtn.addEventListener('click', () => runAudit(s, auditBtn, auditPanel));
      card.appendChild(link);
      card.appendChild(meta);
      card.appendChild(urlDiv);
      card.appendChild(auditBtn);
      card.appendChild(auditPanel);
    }
    galleryEl.appendChild(card);
  }
}

captureBtn.addEventListener('click', () => {
  captureBtn.disabled = true;
  captureStatus.textContent = 'capturing...';
  socket.emit('capture-screenshots', {}, (ack) => {
    captureBtn.disabled = false;
    if (!ack?.ok) {
      captureStatus.textContent = ack?.reason || 'capture failed';
      log(`Capture failed: ${ack?.reason || 'unknown error'}`);
      return;
    }
    const parts = [`captured ${ack.captured}`];
    if (ack.errors) parts.push(`${ack.errors} errors`);
    captureStatus.textContent = parts.join(', ');
    log(`Captured ${ack.captured} screenshot${ack.captured === 1 ? '' : 's'}${ack.errors ? ` (with ${ack.errors} errors)` : ''}`);
  });
});

shareAllBtn?.addEventListener('click', () => {
  const targets = currentDevices.filter((device) => !activeShareIds.has(device.id));
  if (targets.length === 0) {
    captureStatus.textContent = currentDevices.length ? 'all devices already sharing' : 'no devices connected';
    return;
  }
  for (const device of targets) startSharingForDevice(device.id);
  captureStatus.textContent = `share requested on ${targets.length} device${targets.length === 1 ? '' : 's'}`;
});

clearGalleryBtn.addEventListener('click', () => {
  screenshots.length = 0;
  renderGallery();
});

connectLinkSelect?.addEventListener('change', () => {
  selectedConnectUrl = connectLinkSelect.value;
  refreshQr();
});
copyCodeBtn?.addEventListener('click', () => copyText(activeRun?.code, 'Run code'));
copyCodeModalBtn?.addEventListener('click', () => copyText(activeRun?.code, 'Run code'));
copyLinkBtn?.addEventListener('click', () => copyText(selectedConnectUrl, 'Client link'));
copyLinkModalBtn?.addEventListener('click', () => copyText(selectedConnectUrl, 'Client link'));
showConnectBtn?.addEventListener('click', showConnectModal);
connectCloseBtn?.addEventListener('click', hideConnectModal);

newRunBtn?.addEventListener('click', () => {
  socket.emit('create-run', {}, async (ack) => {
    if (!ack?.ok || !ack.run?.code) {
      log('Could not create a new run.');
      return;
    }
    activeRun = ack.run;
    localStorage.setItem('pixelpeek-host-run', activeRun.code);
    updateHostUrl(activeRun.code);
    setRunCode(activeRun.code);
    screenshots.length = 0;
    liveFrames.clear();
    deviceLogs.clear();
    renderGallery();
    try {
      await loadConnectOptions(activeRun.code);
      showConnectModal();
    } catch (err) {
      log(`Connection panel failed: ${err.message}`);
    }
    log(`New host run ready: ${activeRun.code}`);
  });
});

socket.on('capture-started', ({ targetCount }) => {
  log(`Capture started - ${targetCount} device${targetCount === 1 ? '' : 's'}`);
});

socket.on('screenshot-captured', (shot) => {
  screenshots.unshift(shot);
  renderGallery();
  renderDevices();
});

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  const targetId = targetSelect.value || null;
  const targetLabel = targetId ? targetSelect.options[targetSelect.selectedIndex].text : 'all devices';
  socket.emit('load-url', { url, targetId }, (ack) => {
    if (!ack?.ok) {
      log(`Failed to send ${url}: ${ack?.reason || 'unknown error'}`);
      return;
    }
    const count = ack.delivered;
    if (count === 0) {
      log(`Sent ${url} -> ${targetLabel} - but 0 devices connected`);
    } else {
      log(`Sent ${url} -> ${targetLabel} (delivered to ${count} device${count === 1 ? '' : 's'})`);
    }
  });
});

let openDeviceId = null;
const activeShareIds = new Set();
const sharingDevices = new Map();
const SHARE_PROFILES = {
  preview: { mode: 'preview', fps: 3, maxFrameDim: 720, jpegQuality: 0.55 },
  detail: { mode: 'detail', fps: 20, maxFrameDim: 1440, jpegQuality: 0.74 },
};

function setShareStatus(text, isError) {
  shareStatusEl.textContent = text || '';
  shareStatusEl.classList.toggle('error', !!isError);
}

function shareProfileForDevice(deviceId) {
  const isVisibleDetail = openDeviceId === deviceId && shareModal && !shareModal.hidden;
  return isVisibleDetail ? SHARE_PROFILES.detail : SHARE_PROFILES.preview;
}

function sendShareProfile(deviceId) {
  if (!activeShareIds.has(deviceId)) return;
  socket.emit('share-profile', { targetId: deviceId, profile: shareProfileForDevice(deviceId) });
}

function syncShareProfiles() {
  for (const id of activeShareIds) sendShareProfile(id);
}

function updateShareBanner() {
  const count = activeShareIds.size;
  if (count === 0) {
    shareBanner.hidden = true;
    return;
  }
  if (count === 1) {
    const id = activeShareIds.values().next().value;
    shareBannerLabel.textContent = sharingDevices.get(id)?.label || 'device';
    shareBannerStop.textContent = 'Stop sharing';
  } else {
    shareBannerLabel.textContent = `${count} devices`;
    shareBannerStop.textContent = 'Stop all';
  }
  shareBanner.hidden = false;
}

function refreshShareButtons() {
  const isSharingThisDevice = openDeviceId && activeShareIds.has(openDeviceId);
  shareStartBtn.hidden = isSharingThisDevice;
  shareStopBtn.hidden = !isSharingThisDevice;
}

function paintModalPreview() {
  if (!openDeviceId) return;
  const live = liveFrames.get(openDeviceId);
  if (live) {
    shareImage.src = `data:image/jpeg;base64,${live}`;
    shareImage.classList.add('active');
    sharePlaceholder.classList.add('hidden');
    return;
  }
  const latest = getLatestShotForDevice(openDeviceId);
  if (latest) {
    shareImage.src = latest.path;
    shareImage.classList.add('active');
    sharePlaceholder.classList.add('hidden');
    return;
  }
  shareImage.removeAttribute('src');
  shareImage.classList.remove('active');
  sharePlaceholder.classList.remove('hidden');
  sharePlaceholder.innerHTML = 'No preview yet - click <strong>Share screen</strong> to start streaming.';
}

function renderLogsForOpenDevice() {
  if (!openDeviceId) return;
  const logs = deviceLogs.get(openDeviceId) || [];
  if (logs.length === 0) {
    logsListEl.innerHTML = '<div class="logs-empty">No device logs for the current URL yet.</div>';
    return;
  }
  logsListEl.innerHTML = '';
  for (const entry of logs) {
    const row = document.createElement('div');
    row.className = `log-entry lvl-${(entry.level || 'log').toLowerCase()}`;
    const ts = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = new Date(entry.ts).toLocaleTimeString([], { hour12: false });
    const body = document.createElement('div');
    const msg = document.createElement('div');
    msg.className = 'log-msg';
    msg.textContent = entry.message;
    body.appendChild(msg);
    if (entry.source) {
      const src = document.createElement('div');
      src.className = 'log-src';
      const parts = [entry.source];
      if (entry.line) parts.push(String(entry.line));
      if (entry.url) parts.push(entry.url);
      src.textContent = parts.join('  ');
      body.appendChild(src);
    }
    row.appendChild(ts);
    row.appendChild(body);
    logsListEl.appendChild(row);
  }
  logsListEl.scrollTop = logsListEl.scrollHeight;
}

function appendDeviceLog(entry) {
  if (!entry || !entry.deviceId) return;
  const resetSession = entry.kind === 'url-session-start';
  const arr = resetSession ? [] : (deviceLogs.get(entry.deviceId) || []);
  arr.push({
    ts: entry.ts || Date.now(),
    level: entry.level || 'LOG',
    message: entry.message || '',
    source: entry.source || '',
    line: Number.isFinite(entry.line) ? entry.line : 0,
    url: entry.url || '',
    kind: entry.kind || 'device',
  });
  if (arr.length > MAX_LOGS_PER_DEVICE) arr.splice(0, arr.length - MAX_LOGS_PER_DEVICE);
  deviceLogs.set(entry.deviceId, arr);
  if (openDeviceId === entry.deviceId) renderLogsForOpenDevice();
}

function openDeviceDetail(device) {
  openDeviceId = device.id;
  shareTitle.textContent = device.label;
  shareMetaEl.textContent = `${device.width}x${device.height}`;
  setShareStatus('');
  shareModal.hidden = false;
  syncShareProfiles();
  updateShareBanner();
  paintModalPreview();
  renderLogsForOpenDevice();
  refreshShareButtons();
}

function closeDeviceDetail() {
  shareModal.hidden = true;
  openDeviceId = null;
  syncShareProfiles();
  updateShareBanner();
}

function startSharingForDevice(deviceId) {
  const device = currentDevices.find((d) => d.id === deviceId);
  if (!device) return;
  if (activeShareIds.has(deviceId)) return;
  activeShareIds.add(deviceId);
  sharingDevices.set(deviceId, device);
  if (openDeviceId === deviceId) setShareStatus('Asking device to share - tap Allow on the device.');
  socket.emit('share-request', { targetId: deviceId, profile: shareProfileForDevice(deviceId) }, () => {});
  log(`Requesting screen share from ${device.label}`);
  updateShareBanner();
  refreshShareButtons();
}

function stopSharingForDevice(deviceId) {
  if (!activeShareIds.has(deviceId)) return;
  socket.emit('share-stop', { targetId: deviceId });
  const label = sharingDevices.get(deviceId)?.label || deviceId;
  log(`Stopped sharing - ${label}`);
  handleShareStopLocally(deviceId);
}

function handleShareStopLocally(deviceId) {
  liveFrames.delete(deviceId);
  cardFramePaintedAt.delete(deviceId);
  activeShareIds.delete(deviceId);
  sharingDevices.delete(deviceId);

  const card = deviceListEl.querySelector(`.device-card[data-id="${deviceId}"]`);
  if (card) {
    card.classList.remove('is-sharing');
    const img = cardImageEls.get(deviceId);
    if (img) {
      const latest = getLatestShotForDevice(deviceId);
      if (latest) img.src = latest.path;
      else {
        img.removeAttribute('src');
        renderDevices();
      }
    }
  }
  if (openDeviceId === deviceId) {
    paintModalPreview();
    refreshShareButtons();
  }
  updateShareBanner();
}

shareCloseBtn.addEventListener('click', closeDeviceDetail);
shareStartBtn.addEventListener('click', () => {
  if (openDeviceId) startSharingForDevice(openDeviceId);
});
shareStopBtn.addEventListener('click', () => {
  if (openDeviceId) stopSharingForDevice(openDeviceId);
});
shareBannerStop.addEventListener('click', () => {
  for (const id of Array.from(activeShareIds)) stopSharingForDevice(id);
});
shareBannerView.addEventListener('click', () => {
  const firstId = activeShareIds.values().next().value;
  if (!firstId) return;
  const device = sharingDevices.get(firstId) || currentDevices.find((d) => d.id === firstId);
  if (device) openDeviceDetail(device);
});
logsClearBtn.addEventListener('click', () => {
  if (!openDeviceId) return;
  deviceLogs.set(openDeviceId, []);
  renderLogsForOpenDevice();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !shareModal.hidden) closeDeviceDetail();
  if (e.key === 'Escape' && connectModal && !connectModal.hidden) hideConnectModal();
});

socket.on('share-frame', ({ fromId, frame, width, height }) => {
  if (!frame) return;
  liveFrames.set(fromId, frame);

  if (!activeShareIds.has(fromId)) {
    activeShareIds.add(fromId);
    const dev = currentDevices.find((d) => d.id === fromId);
    if (dev) sharingDevices.set(fromId, dev);
    updateShareBanner();
    sendShareProfile(fromId);
  }

  const card = deviceListEl.querySelector(`.device-card[data-id="${fromId}"]`);
  if (card) {
    card.classList.add('is-sharing');
    let img = cardImageEls.get(fromId);
    if (!img) {
      renderDevices();
      img = cardImageEls.get(fromId);
    }
    const now = performance.now();
    const lastPaint = cardFramePaintedAt.get(fromId) || 0;
    if (img && (!cardFramePaintedAt.has(fromId) || now - lastPaint >= CARD_PREVIEW_PAINT_INTERVAL_MS)) {
      img.src = `data:image/jpeg;base64,${frame}`;
      cardFramePaintedAt.set(fromId, now);
    }
  }

  if (openDeviceId === fromId) {
    shareImage.src = `data:image/jpeg;base64,${frame}`;
    shareImage.classList.add('active');
    sharePlaceholder.classList.add('hidden');
    if (width && height) shareMetaEl.textContent = `${width}x${height}`;
    setShareStatus('');
    refreshShareButtons();
  }
});

socket.on('share-failed', ({ fromId, reason }) => {
  const text = reasonText(reason);
  log(`Share failed (${fromId}): ${text}`);
  if (openDeviceId === fromId) setShareStatus(text, true);
  handleShareStopLocally(fromId);
});

socket.on('share-ended', ({ fromId }) => {
  log(`${fromId} ended sharing.`);
  if (openDeviceId === fromId) setShareStatus('Sharing ended by device.');
  handleShareStopLocally(fromId);
});

function sendScroll(deltaX, deltaY) {
  if (!openDeviceId || !activeShareIds.has(openDeviceId)) return;
  if (deltaX === 0 && deltaY === 0) return;
  socket.emit('share-control', {
    targetId: openDeviceId,
    type: 'scroll',
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY),
  });
}

function sendClick(xPct, yPct) {
  if (!openDeviceId || !activeShareIds.has(openDeviceId)) return;
  if (xPct < 0 || xPct > 1 || yPct < 0 || yPct > 1) return;
  socket.emit('share-control', {
    targetId: openDeviceId,
    type: 'click',
    xPct,
    yPct,
  });
}

shareImage.addEventListener('wheel', (e) => {
  if (!openDeviceId || !activeShareIds.has(openDeviceId)) return;
  e.preventDefault();
  sendScroll(e.deltaX, e.deltaY);
}, { passive: false });

const DRAG_THRESHOLD_PX = 5;
let dragState = null;

shareImage.addEventListener('mousedown', (e) => {
  if (!openDeviceId || !activeShareIds.has(openDeviceId)) return;
  dragState = {
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
  shareImage.style.cursor = 'grabbing';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const totalDx = Math.abs(e.clientX - dragState.startX);
  const totalDy = Math.abs(e.clientY - dragState.startY);
  if (totalDx > DRAG_THRESHOLD_PX || totalDy > DRAG_THRESHOLD_PX) dragState.moved = true;
  if (dragState.moved) {
    const dx = dragState.x - e.clientX;
    const dy = dragState.y - e.clientY;
    if (Math.abs(dx) >= 2 || Math.abs(dy) >= 2) {
      sendScroll(dx, dy);
      dragState.x = e.clientX;
      dragState.y = e.clientY;
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (!dragState) return;
  const wasTap = !dragState.moved;
  dragState = null;
  shareImage.style.cursor = '';
  if (wasTap) {
    const rect = shareImage.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    sendClick(xPct, yPct);
  }
});

shareImage.style.cursor = 'grab';

socket.on('console-log', (entry) => appendDeviceLog({ ...entry, kind: entry?.kind || 'console' }));
socket.on('device-log', appendDeviceLog);

function reasonText(reason) {
  if (reason === 'denied') return 'User denied screen sharing on the device.';
  return `Failed: ${reason || 'unknown'}`;
}
