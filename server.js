const http = require("http");

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.end();
    return;
  }

  if (req.url === "/") {
    res.end(JSON.stringify({
      bot: "ÖMER AI",
      durum: "Gemini bağlantısı hazır!"
    }));
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";

    req.on("data", chunk => body += chunk);

    req.on("end", async () => {
      try {
        const { mesaj } = JSON.parse(body);

        if (!mesaj || typeof mesaj !== "string") {
          throw new Error("Mesaj boş.");
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error("API anahtarı bulunamadı.");
        }

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text: "Sen ÖMER AI adlı yardımcı, nazik ve güvenli bir yapay zekâ sohbet asistanısın. Türkçe cevap ver."
                }]
              },
              contents: [{
                parts: [{ text: mesaj }]
              }]
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || "Gemini bağlantı hatası.");
        }

        const cevap = data.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("") || "Cevap oluşturulamadı.";

        res.end(JSON.stringify({ cevap }));

      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ hata: error.message }));
      }
    });

    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ hata: "Sayfa bulunamadı." }));
});

server.listen(process.env.PORT || 3000, () => {
  console.log("ÖMER AI Gemini ile hazır!");
});
            
