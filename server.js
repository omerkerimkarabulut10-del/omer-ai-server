
const http = require("http");

const CHAT_MODEL = "gemini-3.5-flash-lite";

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
      durum: "15 dilde sohbet ve görsel yorumlama hazır!"
    }));
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const {
          mesaj,
          dil,
          dilAdi,
          imageBase64,
          imageMimeType
        } = JSON.parse(body);

        if ((!mesaj || typeof mesaj !== "string") && !imageBase64) {
          throw new Error("Mesaj veya görsel gerekli.");
        }

        const desteklenenDiller = {
          "tr-TR": "Türkçe",
          "de-DE": "Almanca",
          "en-US": "İngilizce",
          "th-TH": "Tayca",
          "he-IL": "İbranice",
          "hi-IN": "Hintçe",
          "ja-JP": "Japonca",
          "zh-CN": "Çince",
          "ko-KR": "Korece",
          "pt-PT": "Portekizce",
          "es-ES": "İspanyolca",
          "ru-RU": "Rusça",
          "fr-FR": "Fransızca",
          "it-IT": "İtalyanca",
          "ar-SA": "Arapça"
        };

        const secilenDil = desteklenenDiller[dil]
          ? desteklenenDiller[dil]
          : "Türkçe";

        if (
          imageBase64 &&
          !["image/jpeg", "image/png", "image/webp"].includes(imageMimeType)
        ) {
          throw new Error("Desteklenmeyen görsel formatı.");
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error("API anahtarı bulunamadı.");
        }

        const parts = [];

        if (imageBase64) {
          parts.push({
            inlineData: {
              mimeType: imageMimeType,
              data: imageBase64
            }
          });
        }

        parts.push({
          text: mesaj || "Bu görselde neler var?"
        });

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text:
                    `Sen ÖMER AI adlı nazik, yardımsever ve güvenli bir yapay zekâ asistanısın. ` +
                    `Kullanıcıya daima ${secilenDil} dilinde cevap ver. ` +
                    `Başka bir dilde cevap verme. ` +
                    `Soruları anlaşılır ve doğal şekilde yanıtla. ` +
                    `Gönderilen görselleri dikkatlice incele.`
                }]
              },
              contents: [{
                parts
              }]
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error?.message || "Gemini bağlantı hatası."
          );
        }

        const cevap = data.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("") || "Cevap oluşturulamadı.";

        res.end(JSON.stringify({ cevap }));

      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({
          hata: error.message
        }));
      }
    });

    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({
    hata: "Sayfa bulunamadı."
  }));
});

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("ÖMER AI hazır!");
});
          
