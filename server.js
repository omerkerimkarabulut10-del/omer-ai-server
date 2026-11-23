
// ÖMER AI Ultimate — Groq API
// Render ortam değişkeni: GROQ_API_KEY
const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = process.env.GROQ_API_KEY;
const MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.8-27b';
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const BASE = `Sen ÖMER AI Ultimate'sin: Ömer'in geliştirdiği Türkçe yapay zekâ asistanısın.
Şu an: {D} (Türkiye saati).
Kullanıcının yazdığı dilde yanıt ver (varsayılan Türkçe).

DOĞRULUK KURALLARI:
- Güncel bilgilerde web araması açıksa arama yap.
- Bilmediğini uydurma; emin olmadığını açıkça söyle.
- Sayı, tarih ve isimleri dikkatle ver.
- Görselleri nesnel şekilde analiz et.
- Cevaplar net, düzenli ve gereksiz uzatmasız olsun.`;

const EXTRA = {
  chat: 'Mod: Sohbet & analiz. Soruyu doğru anla ve anlaşılır cevap ver.',
  code: 'Mod: Kodlama Stüdyosu. Eksiksiz çalışan kod yaz. Hata ayıklarken sebebi açıkla ve düzeltilmiş kodu ver.',
  project: 'Mod: Proje Oluşturucu. Modern, mobil uyumlu, çalışan projeler üret. Tek dosya HTML istenirse tam HTML belgesi ver. Kodda yer tutucu bırakma.',
  game: 'Mod: 3D Oyun Stüdyosu. Three.js ile oynanabilir 3D oyun üret. Tam HTML belgesi, dokunmatik ve klavye kontrolleri, skor ve yeniden başlatma ekle.'
};

const LANGS = {
  tr: 'Türkçe', en: 'English', de: 'Deutsch',
  es: 'Español', fr: 'Français', ar: 'العربية', ru: 'Русский'
};

const sys = (mode, tone, mem, lang) =>
  BASE.replace(
    '{D}',
    new Date().toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      dateStyle: 'full',
      timeStyle: 'short'
    })
  ) +
  `\nTon: ${tone || 'Arkadaş canlısı'}.\n` +
  (EXTRA[mode] || EXTRA.chat) +
  (LANGS[lang]
    ? `\nYanıt dili: ${LANGS[lang]}.`
    : '') +
  (mem.length
    ? `\nKullanıcı hakkında hatırlanan notlar:\n- ${mem.slice(-30).join('\n- ')}`
    : '');

const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(obj));
};

const readBody = req => new Promise((ok, no) => {
  const b = [];
  let n = 0;

  req.on('data', c => {
    n += c.length;
    if (n > 20e6) {
      no(new Error('İstek çok büyük.'));
      req.destroy();
    } else {
      b.push(c);
    }
  });

  req.on('end', () => ok(Buffer.concat(b).toString()));
  req.on('error', no);
});

async function groq(body) {
  const r = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    }
  );

  const d = await r.json();

  if (!r.ok) {
    if (r.status === 429) {
      throw new Error('Groq kullanım kotası doldu veya istek sınırına ulaşıldı. Biraz sonra tekrar dene.');
    }
    if (r.status === 401) {
      throw new Error('Groq API anahtarı geçersiz. Render ayarlarını kontrol et.');
    }
    throw new Error(d.error?.message || `Groq API hatası: ${r.status}`);
  }

  return d;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      model: MODEL,
      visionModel: VISION_MODEL,
      key: !!KEY
    });
  }

  if (u.pathname === '/api/chat' && req.method === 'POST') {
    try {
      if (!KEY) {
        throw new Error('GROQ_API_KEY Render ortam değişkenlerinde tanımlı değil.');
      }

      const {
        mode = 'chat',
        tone,
        search,
        lang,
        memory = [],
        messages = [],
        image
      } = JSON.parse(await readBody(req));

      const m = messages
        .filter(x => x && x.text)
        .slice(-20);

      while (m.length && m[0].role !== 'user') {
        m.shift();
      }

      if (!m.length) {
        throw new Error('Mesaj boş.');
      }

      const hasImage = !!(image && image.data);
      const activeModel = hasImage ? VISION_MODEL : MODEL;

      const groqMessages = [
        {
          role: 'system',
          content: sys(mode, tone, memory, lang)
        },
        ...m.map((x, i) => {
          const isLast = i === m.length - 1;

          if (hasImage && isLast && x.role === 'user') {
            return {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: String(x.text).slice(0, 30000)
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mime || 'image/jpeg'};base64,${image.data}`
                  }
                }
              ]
            };
          }

          return {
            role: x.role === 'user' ? 'user' : 'assistant',
            content: String(x.text).slice(0, 30000)
          };
        })
      ];

      const payload = {
        model: activeModel,
        messages: groqMessages,
        temperature: 1,
        max_completion_tokens: 8000,
        stream: false
      };

      // Görsel analizinde Qwen kullanılır.
      // Normal sohbet ve kodlamada GPT-OSS kullanılır.
      // Web araması GPT-OSS ile etkinleştirilir.
      if (!hasImage && search !== false) {
        payload.tools = [
          { type: 'browser_search' }
        ];
        payload.tool_choice = 'auto';
      } else if (search === false) {
        payload.messages[0].content +=
          '\nWeb araması kapalı. Güncel bilgilerde bunu belirt ve tahmin yürütme.';
      }

      if (hasImage) {
        payload.messages[0].content +=
          '\nBu istekte görsel analiz modeli kullanılıyor.';
      }

      const d = await groq(payload);
      const answer = d.choices?.[0]?.message?.content || '';

      send(res, 200, {
        text: answer.trim() || 'Yanıt üretilemedi. Soruyu farklı yazar mısın?',
        sources: []
      });

    } catch (e) {
      console.error('ÖMER AI Hatası:', e);
      send(res, 500, {
        error: e.message || 'Bilinmeyen sunucu hatası.'
      });
    }

    return;
  }

  // Statik dosyalar
  try {
    const n = path.basename(decodeURIComponent(u.pathname)) || 'index.html';
    const f = fs.readdirSync(__dirname)
      .find(x => x.toLowerCase() === n.toLowerCase());

    if (!f || f === 'server.js' || !MIME[path.extname(f).toLowerCase()]) {
      res.writeHead(404);
      return res.end('Bulunamadı');
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f).toLowerCase()]
    });

    fs.createReadStream(path.join(__dirname, f)).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end('Sunucu hatası');
  }

}).listen(PORT, () => {
  console.log('ÖMER AI hazır!');
  console.log('Model:', MODEL);
  console.log('Görsel modeli:', VISION_MODEL);
  console.log('API anahtarı:', !!KEY);
});
            
