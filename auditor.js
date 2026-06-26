import { readFile } from 'node:fs/promises';

const SYSTEM_PROMPT = `You are a strict UI/UX layout auditor. You analyze screenshots of web pages rendered at a specific viewport size and identify VISIBLE layout problems.

The user expects HIGH PRECISION. False positives are worse than missing minor issues.

Strict rules:
- Only report issues that are UNAMBIGUOUSLY visible. If unsure, do not report.
- Do NOT report transient/animation states (carousel mid-transition, overlapping rotating slides, fade-ins) as issues.
- Do NOT report standard cookie banners, consent overlays, modal dialogs, sticky headers, or hamburger menus as cutoffs — they are intentional and routine.
- The screenshot may be captured at 2x device pixel ratio. Judge layout by relative proportions, NOT by raw image pixel counts.
- If the page looks reasonable at this viewport, return an empty "issues" array, summary "No layout issues detected", overall_severity "none". This is the EXPECTED result for most well-built pages.

Categories you may report (only when CLEARLY visible):
- horizontal_overflow: content visibly extends past the right edge of the viewport, with content cut off mid-element (not an icon at the edge, not a hamburger in a corner)
- text_overlap: two distinct text elements visibly overlap each other and become unreadable
- broken_grid: a grid/flex layout is visibly broken (e.g., one column where there should be several, items spilling outside their container)
- component_collision: two unrelated elements physically overlap when they shouldn't
- broken_image: a visible broken-image placeholder or completely empty rectangle where an image should clearly render
- text_cutoff: a text string is sliced off mid-word at a container boundary AND that string is clearly important content (not navigation icons, not decorative)
- disproportionate_spacing: extreme cramming or huge empty regions at this viewport that clearly look wrong
- other: clearly broken visual not covered above (use very sparingly)

Do NOT report:
- Subjective opinions about color, font, or aesthetics
- Content quality, copy, or missing features
- Cookie/consent banners overlaying content (they are designed to do this)
- Hamburger menus, search icons, or other corner-icons that sit at the viewport edge
- Carousels showing partial next/previous slides (this is normal)
- Anything you'd have to guess about

For each issue provide:
- type: one of the categories above
- severity: low | medium | high | critical
- location: approximate area of the page (e.g. "top navigation", "main content right column", "footer")
- description: brief factual sentence describing what is visually wrong
- likely_css_cause: most probable CSS root cause

Return ONLY the JSON. No markdown fences. No prose outside the JSON.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    overall_severity: {
      type: 'string',
      enum: ['none', 'low', 'medium', 'high', 'critical'],
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          location: { type: 'string' },
          description: { type: 'string' },
          likely_css_cause: { type: 'string' },
        },
        required: ['type', 'severity', 'description'],
      },
    },
  },
  required: ['summary', 'overall_severity', 'issues'],
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt) {
  // 800ms, 1600ms, 3200ms (+jitter), capped
  return Math.min(8000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
}

function isRetryableStatus(status) {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

async function callGemini({ endpoint, body, timeoutMs, maxAttempts = 4 }) {
  let lastError = new Error('Gemini call failed');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === 'AbortError' ? new Error('Gemini request timed out') : err;
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    if (res.ok) return res;

    const text = await res.text();
    const snippet = text.slice(0, 300);
    if (isRetryableStatus(res.status) && attempt < maxAttempts) {
      lastError = new Error(`Gemini API ${res.status}: ${snippet}`);
      await sleep(backoffMs(attempt));
      continue;
    }
    // Non-retryable, or out of attempts: surface a friendlier message for the common cases.
    if (res.status === 503) {
      throw new Error(`Gemini model overloaded (503) — try again in a minute. After ${attempt} attempts.`);
    }
    if (res.status === 429) {
      throw new Error(`Gemini rate limit hit (429) — slow down or upgrade quota. After ${attempt} attempts.`);
    }
    throw new Error(`Gemini API ${res.status}: ${snippet}`);
  }
  throw lastError;
}

export async function auditScreenshot({ imagePath, url, width, height, label, timeoutMs = 60000 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in the environment');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const bytes = await readFile(imagePath);
  const base64 = bytes.toString('base64');
  const lower = imagePath.toLowerCase();
  const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

  const userText =
    `Analyze this screenshot of a webpage for layout problems.\n` +
    `URL: ${url || 'unknown'}\n` +
    `Device label: ${label || 'unknown'}\n` +
    `Viewport size (CSS pixels): ${width || '?'} × ${height || '?'}\n` +
    `Note: the screenshot may be rendered at 2x device pixel ratio (so the image file is ` +
    `${(width || 0) * 2}×${(height || 0) * 2} but represents a ${width || '?'}×${height || '?'} ` +
    `CSS-pixel viewport). Judge layout by proportions, not raw pixel counts.`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        parts: [
          { text: userText },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await callGemini({ endpoint, body, timeoutMs });

  const responseText = await res.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini returned non-JSON envelope: ${responseText.slice(0, 200)}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned no content${finishReason ? ` (finishReason=${finishReason})` : ''}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse JSON from Gemini content: ${text.slice(0, 200)}`);
  }
}
