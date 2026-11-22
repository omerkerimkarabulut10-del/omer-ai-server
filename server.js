const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const PORT = process.env.PORT || 3000;
const LIMIT = +process.env.RATE_LIMIT || 30; // dakikada istek / IP
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
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

// ---- hız sınırı ----
const HITS = new Map();
const limited = ip => { const n = Date.now(), a = (HITS.get(ip) || []).filter(t => n - t < 6e4); a.push(n); HITS.set(ip, a); return a.length > LIMIT; };
setInterval(() => HITS.clear(), 6e5);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- anlaşılır hata mesajları ----
function nice(status, msg = '') {
  if (status === 429) return 'Kota doldu veya çok fazla istek var. Biraz bekleyip tekrar dene.';
  if (status === 404) return `Model bulunamadı (${MODEL}). Render'da GEMINI_MODEL değerini kontrol et.`;
  if (status === 503) return 'Gemini şu an yoğun. Tekrar dene.';
  if (status === 403 || /API key/i.test(msg)) return 'API anahtarı geçersiz veya yetkisiz (GEMINI_API_KEY).';
  if (/image|modalit/i.test(msg)) return 'Bu model sohbet için uygun değil. GEMINI_MODEL olarak metin modeli yaz.';
  return msg || 'Sunucu hatası ' + status;
}

function readBody(req) {
  return new Promise((res, rej) => {
    const d = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 25e6) { rej(new Error('İstek çok büyük')); req.destroy(); } else d.push(c); });
    req.on('end', () => res(Buffer.concat(d).toString()));
    req.on('error', rej);
  });
}

function payloadOf(b) {
  const { messages = [], lang = 'tr', persona = 'friendly', mode = 'chat', memory = [] } = b;
  const sys = [
    MODE[mode] || MODE.chat,
    'Personality: ' + (PERSONA[persona] || PERSONA.friendly),
    `ALWAYS reply in ${LANG[lang] || 'Turkish'} unless the user explicitly asks for another language.`,
    'Your name is ÖMER AI.',
    memory.length ? 'Things to remember about the user:\n- ' + memory.slice(0, 50).join('\n- ') : ''
  ].filter(Boolean).join('\n\n');
  const contents = messages.slice(-24).map(m => {
    const parts = [];
    for (const im of (m.images || []).slice(0, 6)) {
      const mt = /^data:(.*?);base64,/.exec(im);
      if (mt) parts.push({ inlineData: { mimeType: mt[1], data: im.split(',')[1] } });
    }
    parts.push({ text: m.text || ' ' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });
  return { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: mode === 'chat' ? 4096 : 16384 } };
}

// 429/503 için otomatik yeniden deneme
async function call(payload) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(API + ':streamGenerateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(payload)
    });
    if (r.ok) return r;
    if (![429, 503].includes(r.status) || i === 2) {
      const j = await r.json().catch(() => ({}));
      const e = new Error(nice(r.status, j.error?.message)); e.status = r.status; throw e;
    }
    await sleep(1200 * (i + 1));
  }
}

// ---- akıcı (stream) cevap: her satır bir JSON ----
async function stream(b, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  try {
    if (!KEY) throw new Error('GEMINI_API_KEY ayarlı değil (Render > Environment).');
    const p = payloadOf(b);
    let r;
    try { r = await call(b.search ? { ...p, tools: [{ google_search: {} }] } : p); }
    catch (e) { if (b.search && e.status === 400) r = await call(p); else throw e; }
    const dec = new TextDecoder(), seen = new Set(), src = [];
    let buf = '';
    for await (const ch of r.body) {
      buf += dec.decode(ch, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const c = JSON.parse(line.slice(5)).candidates?.[0];
          const t = (c?.content?.parts || []).map(p => p.text || '').join('');
          if (t) send({ t });
          for (const g of c?.groundingMetadata?.groundingChunks || [])
            if (g.web && !seen.has(g.web.uri)) { seen.add(g.web.uri); src.push({ title: g.web.title, uri: g.web.uri }); }
        } catch { }
      }
    }
    send({ done: 1, sources: src });
  } catch (e) { send({ error: e.message }); }
  res.end();
}

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const name = path.basename(p).toLowerCase();
  const f = fs.readdirSync(__dirname).find(x => x.toLowerCase() === name);
  if (!f || f === 'server.js' || f.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'POST' && req.url === '/api/stream') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    if (limited(ip)) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Çok hızlı gidiyorsun, bir dakika bekle.' })); }
    try { await stream(JSON.parse(await readBody(req)), res); }
    catch (e) { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } }
    return;
  }
  serve(req, res);
}).listen(PORT, () => console.log('ÖMER AI server on ' + PORT + ' model=' + MODEL));
