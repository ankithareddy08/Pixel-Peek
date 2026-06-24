import { readFile } from 'node:fs/promises';

const SYSTEM_PROMPT = `You are a strict UI/UX layout auditor. You analyze screenshots of web pages rendered at a specific viewport size and identify VISIBLE layout problems.

Rules:
- Only report issues you can actually SEE in the image. Do not speculate or invent issues.
- If the page looks fine, return an empty "issues" array with summary "No layout issues detected" and overall_severity "none".
- Be terse and factual. No opinions.

Categories you may report:
- horizontal_overflow: content extends past the viewport horizontally; scrollbar visible at bottom
- text_overlap: text overlaps another element or is clipped by it
- broken_grid: flexbox / grid container visibly broken (wrong column count, items misaligned, wrapping when it shouldn't)
- component_collision: two elements physically overlap when they shouldn't
- broken_image: visible broken-image placeholder or empty rectangle where an image should be
- text_cutoff: text cut off at viewport edge or container boundary
- disproportionate_spacing: large unexpected empty areas or extreme cramping at this viewport
- other: clearly broken visual that doesn't fit above (use sparingly)

Do NOT report:
- Subjective opinions about color, font, or aesthetics
- Content quality, copy, or missing features
- Anything you'd have to guess about

For each issue provide:
- type: one of the categories above
- severity: low | medium | high | critical
- location: approximate area of the page (e.g. "top navigation", "main content right column", "footer")
- description: brief factual sentence describing what is visually wrong
- likely_css_cause: most probable CSS root cause (e.g. "missing overflow-x: hidden on body", "incorrect flex-wrap", "fixed width container at narrow viewport")

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

  const userText =
    `Analyze this screenshot of a webpage for layout problems.\n` +
    `URL: ${url || 'unknown'}\n` +
    `Device label: ${label || 'unknown'}\n` +
    `Viewport size: ${width || '?'} × ${height || '?'}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        parts: [
          { text: userText },
          { inlineData: { mimeType: 'image/png', data: base64 } },
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
