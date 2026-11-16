
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

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

      if (body.length > 15 * 1024 * 1024) {
        reject(new Error("İstek çok büyük. Daha küçük bir görsel dene."));
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

async function callGemini(model, payload) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY Render ayarlarında bulunamadı.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

  let response;

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.ok) break;

    if (
      ![429, 500, 502, 503, 504].includes(response.status) ||
      attempt === 2
    ) break;

    await new Promise(resolve =>
      setTimeout(resolve, 1000 * (attempt + 1))
    );
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result?.error?.message || `Gemini API hatası (${response.status})`
    );
  }

  return result;
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

  if (!contents.length) {
    throw new Error("Mesaj boş olamaz.");
  }

  if (data.image) {
    const mime = ["image/png", "image/jpeg", "image/webp"]
      .includes(data.imageMime) ? data.imageMime : "image/jpeg";

    contents[contents.length - 1].parts.push({
      inline_data: {
        mime_type: mime,
        data: String(data.image)
      }
    });
  }

  const result = await callGemini(CHAT_MODEL, {
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents,
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096
    }
  });

  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new Error("Model boş yanıt verdi. Biraz sonra tekrar dene.");
  }

  return answer;
}

const studioPrompts = {
  code: `Sen ÖMER AI Kodlama Stüdyosu'sun.
Çalışabilir ve eksiksiz kodlar üret.
Gerekli dosyaları ve çalıştırma adımlarını belirt.
Zararlı yazılım veya veri çalma özellikleri üretme.`,

  project: `Sen ÖMER AI Proje Fabrikası'sın.
Kullanıcının fikrini uygulanabilir projeye dönüştür.
Proje adı, amaç, özellikler, teknolojiler, dosya yapısı ve yapım aşamalarını açıkla.
Yapılmamış özellikleri tamamlanmış gibi gösterme.`,

  game: `Sen ÖMER AI Oyun Tasarımcısı'sın.
Tarayıcıda çalışabilen, gerçek oynanış mekanikleri olan oyunlar üret.
Kontroller, çarpışmalar, skor, hedefler ve yeniden başlatma ekle.
Mobil, tablet ve bilgisayara uyumlu tasarla.
Oyunu test etmediysen test edildiğini iddia etme.`,

  image: `Sen ÖMER AI Görsel Asistanısın.
Görsel üretme ve düzenleme konusunda yardımcı ol.`
};

async function askStudio(data) {
  const mode = String(data.mode || "");
  const system = studioPrompts[mode];

  if (!system) {
    throw new Error("Geçersiz stüdyo seçimi.");
  }

  const prompt = String(data.prompt || "").trim();

  if (!prompt) {
    throw new Error("Önce bir istek yaz.");
  }

  const result = await callGemini(CHAT_MODEL, {
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: [{
      role: "user",
      parts: [{ text: prompt.slice(0, 30000) }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
    }
  });

  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new Error("Model boş yanıt verdi.");
  }

  return answer;
}

async function generateImage(data) {
  const prompt = String(data.prompt || "").trim();

  if (!prompt) {
    throw new Error("Önce görselini tarif et.");
  }

  const parts = [{
    text:
      "Create a polished, high-quality image based on this request. " +
      "Pay attention to composition, lighting, details and visual consistency. " +
      "User request: " + prompt.slice(0, 10000)
  }];

  if (data.image) {
    const mime = ["image/png", "image/jpeg", "image/webp"]
      .includes(data.imageMime) ? data.imageMime : "image/jpeg";

    parts.push({
      inline_data: {
        mime_type: mime,
        data: String(data.image)
      }
    });
  }

  const result = await callGemini(IMAGE_MODEL, {
    contents: [{
      role: "user",
      parts
    }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });

  const responseParts =
    result?.candidates?.[0]?.content?.parts || [];

  let answer = "";
  let image = null;
  let mimeType = "image/png";

  for (const part of responseParts) {
    if (part.text) {
      answer += part.text + "\n";
    }

    const imageData = part.inlineData || part.inline_data;

    if (imageData?.data) {
      image = imageData.data;
      mimeType = imageData.mimeType || imageData.mime_type || "image/png";
    }
  }

  if (!image) {
    throw new Error(
      answer.trim() ||
      "Görsel oluşturulamadı. Model erişimini ve API kotanı kontrol et."
    );
  }

  return {
    answer: answer.trim() || "Görselin hazır!",
    image,
    mimeType
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (req.method === "GET" &&
      (req.url === "/" || req.url === "/health")) {
    return send(res, 200, {
      ok: true,
      service: "omer-ai-server",
      chatModel: CHAT_MODEL,
      imageModel: IMAGE_MODEL
    });
  }

  if (req.method !== "POST" ||
      !["/api/chat", "/api/studio", "/api/image"].includes(req.url)) {
    return send(res, 404, { error: "Sayfa bulunamadı." });
  }

  try {
    const data = await readBody(req);

    if (req.url === "/api/chat") {
      const answer = await askChat(data);
      return send(res, 200, { answer });
    }

    if (req.url === "/api/studio") {
      const answer = await askStudio(data);
      return send(res, 200, { answer });
    }

    if (req.url === "/api/image") {
      const result = await generateImage(data);
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
  console.log("Görsel modeli: " + IMAGE_MODEL);
});
