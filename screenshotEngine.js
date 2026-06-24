import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

let browser = null;
let launchPromise = null;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  if (launchPromise) return launchPromise;
  launchPromise = chromium
    .launch({ headless: true })
    .then((b) => {
      browser = b;
      b.on('disconnected', () => {
        if (browser === b) browser = null;
      });
      return b;
    })
    .finally(() => {
      launchPromise = null;
    });
  return launchPromise;
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function safeFilename(label) {
  return String(label || 'device').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

export async function captureDevice({ url, width, height, label, outputDir, timeoutMs = 15000 }) {
  const b = await getBrowser();
  const isMobile = width < 768;

  const context = await b.newContext({
    viewport: { width, height },
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile,
    hasTouch: isMobile,
    userAgent: isMobile ? MOBILE_UA : undefined,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(2000);
    const filename = `${safeFilename(label)}-${width}x${height}.png`;
    await mkdir(outputDir, { recursive: true });
    const filepath = join(outputDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    return { filename, filepath };
  } finally {
    await context.close();
  }
}

export async function shutdown() {
  if (browser) {
    const b = browser;
    browser = null;
    await b.close().catch(() => {});
  }
}
