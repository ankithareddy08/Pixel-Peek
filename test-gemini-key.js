const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!apiKey) {
  console.error('GEMINI_API_KEY not set in environment.');
  process.exit(1);
}

const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const body = {
  contents: [{ parts: [{ text: 'Reply with exactly the word OK and nothing else.' }] }],
  generationConfig: { temperature: 0, maxOutputTokens: 8 },
};

console.log(`Calling ${model} via generativelanguage.googleapis.com...`);

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  if (!res.ok) {
    console.error('Response body:', text.slice(0, 500));
    process.exit(2);
  }
  const data = JSON.parse(text);
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  console.log(`Reply: ${JSON.stringify(reply)}`);
  console.log('Gemini API key works.');
} catch (err) {
  console.error('Request failed:', err.message);
  process.exit(3);
}
