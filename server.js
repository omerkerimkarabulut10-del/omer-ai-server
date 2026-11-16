
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

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

      if (body.length > 5 * 1024 * 1024) {
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

async function callGemini(payload) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY Render ayarlarında bulunamadı.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CHAT_MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

  let response;

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.ok) break;

    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.error?.message || `Gemini API hatası (${response.status})`);
  }

  return result;
}

function getAnswer(result) {
  return result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim() || "";
}

async function askChat(data) {
  const language = String(data.dil || "Türkçe").slice(0, 40);
  const personality = personalities[data.kisilik] || personalities.arkadas;
  const memory = String(data.hafiza || "").slice(0, 5000);

  const system = [
    "Sen ÖMER AI adlı yardımcı sohbet asistanısın.",
    personality,
    `Yanıtlarını ${language} dilinde ver.`,
    "Doğru, güvenli ve anlaşılır cevaplar ver. Bilmediğin bilgileri uydurma.",
    memory ? `Kullanıcının hafıza notları: ${memory}` : ""
  ].filter(Boolean).join("\n\n");

  const contents = cleanHistory(data.gecmis);

  if (!contents.length && data.message) {
    contents.push({
      role: "user",
      parts: [{ text: String(data.message).slice(0, 12000) }]
    });
  }

  if (!contents.length) throw new Error("Mesaj boş olamaz.");

  const result = await callGemini({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096
    }
  });

  const answer = getAnswer(result);
  if (!answer) throw new Error("Model boş yanıt verdi.");

  return answer;
}

async function askStudio(data) {
  const mode = String(data.mode || "");
  const prompt = String(data.prompt || "").trim();

  if (!prompt) throw new Error("Önce bir istek yaz.");

  let system = "";

  if (mode === "code") {
    system = `Sen ÖMER AI Kodlama Stüdyosu'sun.
Eksiksiz, çalışabilir ve anlaşılır kodlar üret.
Gerekli dosyaları ve kurulum adımlarını belirt.
Zararlı yazılım, veri çalma veya güvenlik aşma özellikleri üretme.`;
  } else if (mode === "project") {
    system = `Sen ÖMER AI Proje Fabrikası'sın.
Kullanıcının fikrini uygulanabilir projeye dönüştür.
Proje adı, amaç, özellikler, teknolojiler, dosya yapısı ve yapım aşamalarını açıkla.
Yapılmamış özellikleri tamamlanmış gibi gösterme.`;
  } else if (mode === "game") {
    system = `Sen ÖMER AI Oyun Fabrikası'sın.

Kullanıcının istediği oyunu TEK DOSYALIK, TAMAMEN ÇALIŞAN bir HTML oyunu olarak üret.

ÇOK ÖNEMLİ KURALLAR:
- Cevabın yalnızca HTML kodu olsun.
- Kod <!DOCTYPE html> ile başlasın ve </html> ile bitsin.
- CSS ve JavaScript aynı HTML dosyasının içinde bulunsun.
- Harici kütüphane, CDN veya internet bağlantısı gerektirme.
- Gerçek oynanış mekanikleri, skor, hedefler ve yeniden başlatma ekle.
- Mobil dokunmatik kontrolleri ve bilgisayar klavye kontrolleri ekle.
- Ekrana sığan, responsive bir oyun tasarla.
- Boş buton, çalışmayan kontrol veya sahte özellik bırakma.
- Güvenli ve yaşa uygun içerik üret.
- Açıklama veya Markdown kod çiti ekleme.`;
  } else {
    throw new Error("Geçersiz stüdyo seçimi.");
  }

  const result = await callGemini({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: "user",
      parts: [{ text: prompt.slice(0, 20000) }]
    }],
    generationConfig: {
      temperature: mode === "game" ? 0.5 : 0.7,
      maxOutputTokens: 12000
    }
  });

  let answer = getAnswer(result);

  if (!answer) throw new Error("Model boş yanıt verdi.");

  if (mode === "game") {
    answer = answer
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    if (!/^<!doctype html/i.test(answer) || !/<\/html>\s*$/i.test(answer)) {
      throw new Error("Model geçerli bir HTML oyun dosyası oluşturamadı. Tekrar dene.");
    }

    return {
      answer: "Oyunun hazır! HTML dosyasını indirip tarayıcıda açabilirsin.",
      gameHtml: answer
    };
  }

  return { answer };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return send(res, 200, {
      ok: true,
      service: "omer-ai-server",
      chatModel: CHAT_MODEL
    });
  }

  if (req.method !== "POST" ||
      !["/api/chat", "/api/studio"].includes(req.url)) {
    return send(res, 404, { error: "Sayfa bulunamadı." });
  }

  try {
    const data = await readBody(req);

    if (req.url === "/api/chat") {
      return send(res, 200, { answer: await askChat(data) });
    }

    if (req.url === "/api/studio") {
      const result = await askStudio(data);
      return send(res, 200, result);
    }
  } catch (error) {
    console.error("ÖMER AI error:", error.message);
    return send(res, 500, {
      error: error.message || "Beklenmeyen sunucu hatası."
    });
  }
});

server.listen(PORT, () => {
  console.log("ÖMER AI server çalışıyor: " + PORT);
  console.log("Sohbet modeli: " + CHAT_MODEL);
});
