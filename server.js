// ÖMER AI Ultimate sunucusu — bağımlılık yok, Node 18+ yeterli.
// Render ortam değişkenleri: GEMINI_API_KEY (zorunlu), GEMINI_MODEL (isteğe bağlı)
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const BASE = `Sen ÖMER AI Ultimate'sin: Ömer'in geliştirdiği Türkçe yapay zekâ asistanısın. Şu an: {D} (Türkiye saati).
Kullanıcının yazdığı dilde yanıt ver (varsayılan Türkçe).
DOĞRULUK KURALLARI:
- Güncel veya değişebilen her bilgide (haber, fiyat, skor, tarih, kişi/görev, sürüm, hava) mutlaka Google aramasını kullan; arama sonucuna dayan.
- Bilmediğini veya emin olmadığını uydurma; "emin değilim" de ve neyin belirsiz olduğunu söyle.
- Sayı, tarih, isim ve alıntıları dikkatle ver; kaynaklar çelişirse bunu belirt.
- Görsel varsa önce gördüğünü nesnel tanımla; yazı varsa aynen aktar; net seçemediğin yeri açıkça belirt, tahmin ettiğini söyle.
- Cevaplar net, düzenli ve gereksiz uzatmasız olsun.`;

const EXTRA = {
  chat: 'Mod: Sohbet & analiz. Soruyu doğru anla, kanıta dayalı, adım adım ve anlaşılır cevap ver.',
  code: 'Mod: Kodlama Stüdyosu. Eksiksiz, çalışan kod yaz; kodu ```dil bloklarında ver. Hata ayıklarken sebebi kısaca açıkla, sonra düzeltilmiş kodun tamamını ver. Tek dosya web istenirse tam <!DOCTYPE html> belgesi yaz. Kütüphane sürümlerini uydurma.',
  project: 'Mod: Proje Oluşturucu. İsteğe göre tam çalışan, modern, mobil uyumlu, tek dosyalık (HTML+CSS+JS) bir proje üret. Kodun TAMAMINI tek bir ```html bloğunda ver; "..." veya yer tutucu bırakma; harici kaynak olarak yalnızca cdnjs.cloudflare.com kullan; localStorage kullanma. Önce 1-2 cümle plan, sonra kod, sonra kısa kullanım notu. Kullanıcı değişiklik isterse önceki kodun tamamını güncelleyip yeniden ver.',
  game: 'Mod: 3D Oyun Stüdyosu. Three.js (https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js) ile tek dosyalık, oynanabilir 3D oyun üret; tam <!DOCTYPE html> ve TEK ```html bloğu. Tam ekran canvas, pencere yeniden boyutlandırma, klavye + dokunmatik kontrol, skor, game over ve yeniden başlat, requestAnimationFrame döngüsü olsun. THREE.CapsuleGeometry ve OrbitControls kullanma. Kod hatasız çalışmalı; kontrol talimatını oyunun içinde göster. Değişiklikte kodun tamamını yeniden ver.'
};

const sys = (mode, tone, mem) =>
  BASE.replace('{D}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'short' })) +
  `\nTon: ${tone || 'Arkadaş canlısı'}.\n` + (EXTRA[mode] || EXTRA.chat) +
  (mem.length ? `\nKullanıcı hakkında hatırlanan notlar:\n- ${mem.slice(-30).join('\n- ')}` : '');

const wait = ms => new Promise(r => setTimeout(r, ms));
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  const b = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > 20e6) { no(new Error('İstek çok büyük')); req.destroy(); } else b.push(c); });
  req.on('end', () => ok(Buffer.concat(b).toString()));
  req.on('error', no);
});

async function gemini(body) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(100000)
    });
    if (r.status === 429 || r.status >= 500) { await wait(1500 * (i + 1)); continue; }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Gemini hatası');
    return d;
  }
  throw new Error('Gemini şu an yoğun, biraz sonra tekrar dene.');
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/api/health') return send(res, 200, { ok: true, model: MODEL, key: !!KEY });

  if (u.pathname === '/api/chat' && req.method === 'POST') {
    try {
      if (!KEY) throw new Error('GEMINI_API_KEY Render ortam değişkenlerinde tanımlı değil.');
      const { mode = 'chat', tone, search, memory = [], messages = [], image } = JSON.parse(await readBody(req));
      const m = messages.filter(x => x && x.text).slice(-20);
      while (m.length && m[0].role !== 'user') m.shift();
      if (!m.length) throw new Error('Mesaj boş.');
      const contents = m.map(x => ({ role: x.role === 'user' ? 'user' : 'model', parts: [{ text: String(x.text).slice(0, 30000) }] }));
      if (image && image.data) contents[contents.length - 1].parts.push({ inlineData: { mimeType: image.mime || 'image/jpeg', data: image.data } });
      const payload = {
        systemInstruction: { parts: [{ text: sys(mode, tone, memory) }] },
        contents,
        generationConfig: { temperature: mode === 'chat' ? 0.3 : 0.5, maxOutputTokens: 16000 }
      };
      if ((mode === 'chat' || mode === 'code') && search !== false) payload.tools = [{ google_search: {} }];
      else if (search === false) payload.systemInstruction.parts[0].text += '\nKullanıcı web aramasını kapattı: güncel bilgi gerektiren sorularda bunu belirt, emin olmadığın şeyi uydurma.';
      const d = await gemini(payload);
      const c = d.candidates && d.candidates[0];
      const text = ((c && c.content && c.content.parts) || []).map(p => p.text || '').join('').trim();
      const seen = new Set(), sources = [];
      for (const g of (c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []) {
        const w = g.web;
        if (w && /^https?:/.test(w.uri || '') && !seen.has(w.uri) && sources.length < 5) { seen.add(w.uri); sources.push({ u: w.uri, t: w.title }); }
      }
      send(res, 200, { text: text || 'Yanıt üretilemedi (boş yanıt veya filtre). Soruyu farklı yazar mısın?', sources });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // Statik dosyalar (büyük/küçük harf fark etmez: Manifest.json / manifest.json)
  const n = path.basename(decodeURIComponent(u.pathname)) || 'index.html';
  const f = fs.readdirSync(__dirname).find(x => x.toLowerCase() === n.toLowerCase());
  if (!f || f === 'server.js' || !MIME[path.extname(f).toLowerCase()]) { res.writeHead(404); return res.end('Bulunamadı'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('ÖMER AI hazır, port:', PORT, 'model:', MODEL));
