const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const LANG = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic', th: 'Thai', he: 'Hebrew', hi: 'Hindi', zh: 'Chinese' };
const PERSONA = {
  friendly: 'Warm, friendly, casual like a good friend. Use occasional emojis.',
  professional: 'Professional, precise and formal.',
  teacher: 'Patient teacher: explain step by step with simple examples.',
  funny: 'Witty and humorous while still being helpful.',
  concise: 'Extremely concise. Short direct answers.',
  creative: 'Imaginative, creative and expressive.'
};
const MODE = {
  chat: 'You are a smart general assistant. You can analyze images the user sends.',
  code: 'You are an expert coding assistant (HTML, CSS, JS, Python, etc). Give complete, working code in fenced code blocks with the language tag. Debug errors precisely. For web demos, give ONE complete self-contained ```html block.',
  project: 'You are a project builder. Plan the project briefly, then output complete files, each in its own fenced code block preceded by the file name. For web projects also give one self-contained ```html version that runs in a browser.',
  game: 'You are a 3D game developer. Always output ONE complete self-contained ```html block with a playable Three.js game (load https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js), keyboard + touch controls, full-window canvas, score, restart. No placeholders.'
};

function body(req) {
  return new Promise((res, rej) => {
    let d = [], n = 0;
    req.on('data', c => { n += c.length; if (n > 25e6) { rej(new Error('big')); req.destroy(); } else d.push(c); });
    req.on('end', () => res(Buffer.concat(d).toString()));
    req.on('error', rej);
  });
}

async function gemini(payload) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'API error ' + r.status);
  return j;
}

async function chat(b) {
  if (!KEY) throw new Error('GEMINI_API_KEY ayarlı değil (Render > Environment).');
  const { messages = [], lang = 'tr', persona = 'friendly', mode = 'chat', search = false, memory = [] } = b;
  const sys = [
    MODE[mode] || MODE.chat,
    'Personality: ' + (PERSONA[persona] || PERSONA.friendly),
    `ALWAYS reply in ${LANG[lang] || 'Turkish'} unless the user explicitly asks for another language. Code comments may follow the same language.`,
    'Your name is ÖMER AI.',
    memory.length ? 'Things to remember about the user:\n- ' + memory.join('\n- ') : ''
  ].filter(Boolean).join('\n\n');

  const contents = messages.slice(-24).map(m => {
    const parts = [];
    for (const im of m.images || []) {
      const mt = /^data:(.*?);base64,/.exec(im);
      if (mt) parts.push({ inlineData: { mimeType: mt[1], data: im.split(',')[1] } });
    }
    parts.push({ text: m.text || ' ' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });

  const payload = { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: mode === 'chat' ? 4096 : 16384 } };
  let j;
  if (search) {
    try { j = await gemini({ ...payload, tools: [{ google_search: {} }] }); }
    catch (e) { j = await gemini(payload); }
  } else j = await gemini(payload);

  const c = j.candidates?.[0];
  const text = (c?.content?.parts || []).map(p => p.text || '').join('') || (c?.finishReason ? `(${c.finishReason})` : 'Cevap alınamadı.');
  const seen = new Set();
  const sources = (c?.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(w => w && !seen.has(w.uri) && seen.add(w.uri)).map(w => ({ title: w.title, uri: w.uri }));
  return { text, sources };
}

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const name = path.basename(p).toLowerCase();
  const f = fs.readdirSync(__dirname).find(x => x.toLowerCase() === name);
  if (!f || f === 'server.js' || f.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const out = await chat(JSON.parse(await body(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  serve(req, res);
}).listen(PORT, () => console.log('ÖMER AI server on ' + PORT + ' model=' + MODEL));
