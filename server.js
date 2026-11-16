
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const personalities = {
  arkadas: "Sıcak, arkadaş canlısı ve destekleyici konuş.",
  resmi: "Kibar ve profesyonel konuş.",
  ogretmen: "Sabırlı bir öğretmen gibi açıkla ve örnekler ver.",
  kisa: "Kısa, net ve doğrudan cevap ver.",
  eglenceli: "Neşeli, yaratıcı ve saygılı konuş."
};

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("İstek çok büyük."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Geçersiz JSON."));
      }
    });
    req.on("error", reject);
  });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-20).map(item => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: String(item.text || "").slice(0, 12000) }]
  })).filter(item => item.parts[0].text.trim());
}

async function askGemini({ prompt, system, history = [], image, imageMime }) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY Render ayarlarında bulunamadı.");

  const contents = cleanHistory(history);

  if (prompt) {
    contents.push({
      role: "user",
      parts: [{ text: String(prompt).slice(0, 30000) }]
    });
  }

  if (!contents.length) throw new Error("Mesaj boş olamaz.");

  if (image) {
    const mime = ["image/png", "image/jpeg", "image/webp"].includes(imageMime)
      ? imageMime : "image/jpeg";

    contents[contents.length - 1].parts.push({
      inline_data: {
        mime_type: mime,
        data: String(image).slice(0, 10500000)
      }
    });
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

  let response;

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system || "Sen ÖMER AI adlı yardımcı asistansın. Doğru, güvenli ve anlaşılır cevap ver." }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      })
    });

    if (response.ok) break;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.error?.message || `Gemini API hatası (${response.status})`);
  }

  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "").join("").trim();

  if (!answer) throw new Error("Model boş yanıt verdi. Tekrar dene.");
  return answer;
}

function chatSystem(data) {
  const language = String(data.dil || "Türkçe").slice(0, 40);
  const personality = personalities[data.kisilik] || personalities.arkadas;
  const memory = String(data.hafiza || "").slice(0, 5000);

  return [
    "Sen ÖMER AI adlı yardımcı sohbet asistanısın.",
    personality,
    `Yanıtlarını ${language} dilinde ver.`,
    "Doğru, güvenli ve anlaşılır cevaplar ver. Bilmediğin bilgileri uydurma.",
    memory ? `Kullanıcının hafıza notları: ${memory}` : ""
  ].filter(Boolean).join("\n\n");
}

const studioPrompts = {
  code: `Sen ÖMER AI Kodlama Stüdyosu'sun.
Kullanıcının istediği kodu anlaşılır ve çalışabilir şekilde üret.
Hangi dosyanın gerektiğini belirt. Kodları eksiksiz ver.
Güvenlik açıkları, zararlı yazılım veya veri çalma özellikleri üretme.
Koddan önce kısa açıklama, sonra kod ve en sonda çalıştırma adımları ver.`,

  project: `Sen ÖMER AI Proje Fabrikası'sın.
Kullanıcının fikrini uygulanabilir bir projeye dönüştür.
Şu başlıkları kullan:
1. Proje adı
2. Amaç
3. Özellikler
4. Kullanılacak teknolojiler
5. Dosya yapısı
6. Yapım aşamaları
7. İlk çalışan sürüm
Gerçekçi ol; yapılmamış özellikleri tamamlanmış gibi gösterme.`,

  game: `Sen ÖMER AI Oyun Tasarımcısı'sın.
Kullanıcının fikrine göre tarayıcıda çalışabilen bir oyun üret.
Varsayılan çıktı tek bir HTML dosyası olsun; CSS ve JavaScript dosyanın içinde bulunsun.
Gerçek oynanış, çalışan kontroller, çarpışmalar, skor, hedefler ve yeniden başlatma ekle.
Mobil, tablet ve bilgisayara uyumlu tasarla.
Menü, talimatlar ve görsel açıdan özenli bir arayüz oluştur.
Kod eksiksiz ve tek parça olsun. Harici kütüphane gerekiyorsa açıkça belirt.
Oyunu çalıştırmadan test edildiğini iddia etme.`,

  image: `Sen ÖMER AI Görsel Stüdyosu'sun.
Kullanıcının yüklediği görseli inceleyebilir, açıklayabilir ve düzenleme için ayrıntılı bir görsel üretim komutu hazırlayabilirsin.
Gerçek görsel üretimi yapamadığında bunu açıkça söyle.
Görsel oluşturduğunu veya düzenlediğini asla iddia etme.`
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return send(res, 200, { ok: true, service: "omer-ai-server", model: MODEL });
  }

  if (req.method !== "POST" || !["/api/chat", "/api/studio"].includes(req.url)) {
    return send(res, 404, { error: "Sayfa bulunamadı." });
  }

  try {
    const data = await readBody(req);

    if (req.url === "/api/chat") {
      const answer = await askGemini({
        prompt: data.message,
        system: chatSystem(data),
        history: data.gecmis,
        image: data.image,
        imageMime: data.imageMime
      });
      return send(res, 200, { answer });
    }

    const mode = String(data.mode || "");
    if (!studioPrompts[mode]) {
      return send(res, 400, { error: "Geçersiz stüdyo seçimi." });
    }

    if (!String(data.prompt || "").trim()) {
      return send(res, 400, { error: "Önce bir fikir veya istek yaz." });
    }

    const answer = await askGemini({
      prompt: String(data.prompt),
      system: studioPrompts[mode],
      image: data.image,
      imageMime: data.imageMime
    });

    return send(res, 200, { answer });

  } catch (error) {
    console.error("Server error:", error.message);
    return send(res, 500, { error: error.message || "Sunucu hatası." });
  }
});

server.listen(PORT, () => {
  console.log(`ÖMER AI server ${PORT} portunda çalışıyor.`);
});
          
