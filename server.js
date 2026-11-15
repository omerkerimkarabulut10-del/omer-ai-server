const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const kisilikler = {
  arkadas: "Friendly and warm. Talk like a helpful, supportive friend. Be natural and approachable.",
  komik: "Funny and playful. Use light humor when appropriate, but always answer accurately.",
  ogretmen: "Patient and educational. Explain things clearly, step by step, using simple examples.",
  ciddi: "Serious, professional, direct and precise. Avoid unnecessary jokes."
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("ÖMER AI server çalışıyor!");
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Sayfa bulunamadı." }));
  }

  if (!API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "GEMINI_API_KEY ayarlanmamış." }));
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
    if (body.length > 20 * 1024 * 1024) {
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const data = JSON.parse(body || "{}");

      const mesaj = String(data.mesaj || "");
      const dil = String(data.dil || "tr-TR");
      const dilAdi = String(data.dilAdi || "Turkish");
      const kisilik = kisilikler[data.kisilik] || kisilikler.arkadas;

      const parts = [];

      if (mesaj.trim()) {
        parts.push({ text: mesaj });
      }

      if (data.imageBase64 && data.imageMimeType) {
        const izinliTurler = ["image/jpeg", "image/png", "image/webp"];

        if (!izinliTurler.includes(data.imageMimeType)) {
          throw new Error("Desteklenmeyen görsel türü.");
        }

        parts.push({
          inlineData: {
            mimeType: data.imageMimeType,
            data: data.imageBase64
          }
        });
      }

      if (!parts.length) {
        throw new Error("Bir mesaj veya görsel gönder.");
      }

      const systemText = `
You are ÖMER AI, a helpful AI assistant.

IMPORTANT LANGUAGE RULE:
Always answer in ${dilAdi}. The selected language code is ${dil}.
Do not switch languages unless the user explicitly asks you to.

PERSONALITY:
${kisilik}

Be helpful, accurate and respectful.
`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemText }]
            },
            contents: [{
              role: "user",
              parts
            }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 2048
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("Gemini error:", result);
        throw new Error(
          result.error?.message || "Gemini cevap veremedi."
        );
      }

      const cevap = result.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!cevap) {
        throw new Error("Gemini boş cevap gönderdi.");
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });

      res.end(JSON.stringify({ cevap }));

    } catch (error) {
      console.error(error);

      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8"
      });

      res.end(JSON.stringify({
        error: error.message || "Bir hata oluştu."
      }));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("ÖMER AI server çalışıyor. Port:", PORT);
});
      
