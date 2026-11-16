
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const personalities = {
  arkadas: "Sıcak, arkadaş canlısı ve destekleyici konuş.",
  resmi: "Kibar ve profesyonel bir dil kullan.",
  ogretmen: "Sabırlı bir öğretmen gibi açıkla ve örnekler ver.",
  kisa: "Kısa, net ve doğrudan cevap ver.",
  eglenceli: "Neşeli, yaratıcı ve saygılı bir dil kullan."
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

async function askGemini(data) {
  const language = String(data.dil || "Türkçe").slice(0, 40);
  const personality =
    personalities[data.kisilik] || personalities.arkadas;
  const memory = String(data.hafiza || "").slice(0, 5000);

  const systemInstruction = [
    "Sen ÖMER AI adlı yardımcı sohbet asistanısın.",
    personality,
    `Yanıtlarını ${language} dilinde ver.`,
    "Doğru, güvenli ve anlaşılır cevaplar ver. Bilmediğin bilgileri uydurma.",
    memory
      ? `Kullanıcının kaydettiği hafıza notları: ${memory}`
      : ""
  ].filter(Boolean).join("\n\n");

  const contents = cleanHistory(data.gecmis);

  if (!contents.length && data.message) {
    contents.push({
      role: "user",
      parts: [{ text: String(data.message).slice(0, 12000) }]
    });
  }

  const last = contents[contents.length - 1];

  if (data.image && last && last.role === "user") {
    const mime = ["image/png", "image/jpeg", "image/webp"]
      .includes(data.imageMime)
      ? data.imageMime
      : "image/jpeg";

    last.parts.push({
      inline_data: {
        mime_type: mime,
        data: String(data.image).slice(0, 10500000)
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
          parts: [{ text: systemInstruction }]
        },
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048
        }
      })
    });

    if (response.ok) break;

    if (
      ![429, 500, 502, 503, 504].includes(response.status) ||
      attempt === 2
    ) break;

    await new Promise(resolve =>
      setTimeout(resolve, 900 * (attempt + 1))
    );
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result?.error?.message || `Gemini API hatası (${response.status})`
    );
  }

  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new Error("Model boş yanıt verdi. Biraz sonra tekrar dene.");
  }

  return answer;
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
      model: MODEL
    });
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    return send(res, 404, { error: "Sayfa bulunamadı." });
  }

  if (!API_KEY) {
    return send(res, 500, {
      error: "GEMINI_API_KEY Render ortam değişkeninde tanımlı değil."
    });
  }

  try {
    const data = await readBody(req);

    if (!data.message && !data.image) {
      return send(res, 400, { error: "Mesaj boş olamaz." });
    }

    const answer = await askGemini(data);
    return send(res, 200, { answer });

  } catch (error) {
    console.error("Chat error:", error.message);
    return send(res, 500, {
      error: error.message || "Beklenmeyen sunucu hatası."
    });
  }
});

server.listen(PORT, () => {
  console.log(`ÖMER AI server ${PORT} portunda çalışıyor.`);
});
  
