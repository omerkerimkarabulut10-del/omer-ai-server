
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const kisilikler = {
  arkadas: "Friendly and warm. Talk like a helpful, supportive friend.",
  komik: "Funny and playful. Use light humor when appropriate, but always answer accurately.",
  ogretmen: "Patient and educational. Explain clearly, step by step, with simple examples.",
  ciddi: "Serious, professional, direct and precise."
};

const bekle = ms => new Promise(resolve => setTimeout(resolve, ms));

async function geminiIstek(body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  for (let deneme = 0; deneme < 3; deneme++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (response.ok) return result;

      const tekrarDenenecek = [429, 500, 502, 503, 504].includes(response.status);

      if (!tekrarDenenecek || deneme === 2) {
        const hata = new Error(
          result.error?.message || "Gemini cevap veremedi."
        );
        hata.status = response.status;
        throw hata;
      }

      console.log(`Gemini geçici hata: ${response.status}. Tekrar deneniyor...`);
      await bekle(1000 * Math.pow(2, deneme));

    } catch (error) {
      if (error.status || deneme === 2) throw error;

      console.log("Bağlantı hatası. Tekrar deneniyor...");
      await bekle(1000 * Math.pow(2, deneme));
    }
  }
}

const server = http.createServer((req, res) => {
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
  let fazlaBuyuk = false;

  req.on("data", chunk => {
    body += chunk;

    if (body.length > 20 * 1024 * 1024) {
      fazlaBuyuk = true;
      req.destroy();
    }
  });

  req.on("end", async () => {
    if (fazlaBuyuk) return;

    try {
      const data = JSON.parse(body || "{}");

      const dil = String(data.dil || "tr-TR");
      const dilAdi = String(data.dilAdi || "Turkish");
      const kisilik = kisilikler[data.kisilik] || kisilikler.arkadas;

      const systemText = `
You are ÖMER AI, a helpful AI assistant.

Always answer in ${dilAdi}. Language code: ${dil}.
Do not switch languages unless the user asks.

PERSONALITY:
${kisilik}

IMPORTANT:
- Use the previous messages in this conversation to understand context.
- Remember what was said earlier in this same conversation.
- Answer follow-up questions using the conversation history.
- Do not claim to remember information that is not in the conversation.
- Be helpful, accurate and respectful.
`;

      let gecmis = Array.isArray(data.gecmis) ? data.gecmis : [];

      gecmis = gecmis
        .filter(m =>
          m &&
          ["user", "bot"].includes(m.role) &&
          typeof m.text === "string" &&
          m.text.trim()
        )
        .slice(-20);

      const contents = gecmis.map((m, index) => {
        const parts = [{ text: m.text.slice(0, 12000) }];

        // Görseli yalnızca son kullanıcı mesajına ekle.
        if (
          index === gecmis.length - 1 &&
          m.role === "user" &&
          data.imageBase64 &&
          data.imageMimeType
        ) {
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

        return {
          role: m.role === "bot" ? "model" : "user",
          parts
        };
      });

      if (!contents.length) {
        throw new Error("Bir mesaj veya görsel gönder.");
      }

      const result = await geminiIstek({
        systemInstruction: {
          parts: [{ text: systemText }]
        },
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048
        }
      });

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
      console.error("ÖMER AI hata:", error);

      res.writeHead(error.status || 500, {
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
              
