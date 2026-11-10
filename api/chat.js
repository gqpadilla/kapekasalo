// Vercel serverless function behind the "Ask Kasalo" chat: POST /api/chat { message } -> { reply }.
// Same logic as the Langflow flow: a guard prompt labels the message IN_SCOPE / OUT_OF_SCOPE; in-scope messages get the
// answer prompt, everything else the fixed invalid-request message. Prompts live in CHATBOT_PROMPTS.md.
// Model settings come from Vercel environment variables (never from code or the browser):
//   LLM_API_KEY   provider key (OpenRouter sk-or-..., NVIDIA nvapi-...); leave empty for a local Ollama
//   LLM_MODEL     model id, e.g. a Nemotron model from openrouter.ai/models
//   LLM_BASE_URL  OpenAI-compatible endpoint; default OpenRouter
const fs = require('fs');
const path = require('path');

const md = fs.readFileSync(path.join(__dirname, '..', 'CHATBOT_PROMPTS.md'), 'utf8');
const [GUARD, INVALID, ANSWER] = [...md.matchAll(/```\r?\n([\s\S]*?)```/g)].slice(0, 3).map(m => m[1].trim());

// shortcut: per-instance memory, so the limit resets on cold starts; move to Vercel KV / firewall rules if abused
const hits = new Map();
const limited = ip => {
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  hits.set(ip, [...recent, now]);
  return recent.length >= 20;   // 20 messages per minute per visitor
};

async function complete(prompt, temperature, max_tokens) {
  const base = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.LLM_API_KEY && { Authorization: `Bearer ${process.env.LLM_API_KEY}` }) },
    // reasoning off: thinking models otherwise spend the token budget thinking and return an empty answer.
    // max_tokens leaves room for a provider that ignores the switch and thinks anyway.
    body: JSON.stringify({ model: process.env.LLM_MODEL, messages: [{ role: 'user', content: prompt }], temperature, max_tokens,
                           reasoning: { effort: 'none' } }),
  });
  if (!r.ok) throw new Error(`model HTTP ${r.status}`);
  return ((await r.json()).choices?.[0]?.message?.content || '').trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0];
  if (limited(ip)) return res.status(429).json({ error: 'Too many messages, try again in a minute.' });   // counts bad requests too
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 500) return res.status(400).json({ error: 'message must be 1-500 characters' });
  if (!process.env.LLM_MODEL) return res.status(500).json({ error: 'LLM_MODEL is not set' });
  try {
    const label = await complete(GUARD.replace('{message}', message), 0, 300);
    const reply = label.startsWith('IN_SCOPE') ? await complete(ANSWER.replace('{message}', message), 0.2, 1500) : INVALID;
    res.status(200).json({ reply: reply || INVALID });
  } catch (e) {
    console.error('chat', e.message);
    res.status(502).json({ error: 'The assistant is unavailable right now.' });
  }
};
