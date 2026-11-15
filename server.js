const http = require("http");

const CHAT_MODEL = "gemini-3.5-flash-lite";
const IMAGE_MODEL = "gemini-3.1-flash-image";

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
      durum: "Sohbet ve görsel üretme hazır!"
    }));
    return;
  }

  if (
    (req.url === "/api/chat" || req.url === "/api/image") &&
    req.method === "POST"
  ) {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const input = JSON.parse(body);
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error("API anahtarı bulunamadı.");
        }

        // SOHBET VE GÖRSEL YORUMLAMA
        if (req.url === "/api/chat") {
          const { mesaj, imageBase64, imageMimeType } = input;

          if ((!mesaj || typeof mesaj !== "string") && !imageBase64) {
            throw new Error("Mesaj veya görsel gerekli.");
          }

          if (
            imageBase64 &&
            !["image/jpeg", "image/png", "image/webp"].includes(imageMimeType)
          ) {
            throw new Error("Desteklenmeyen görsel formatı.");
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
                    text: "Sen ÖMER AI adlı nazik ve güvenli bir yapay zekâ asistanısın. Türkçe cevap ver."
                  }]
                },
                contents: [{ parts }]
              })
            }
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error?.message || "Sohbet hatası.");
          }

          const cevap = data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("") || "Cevap oluşturulamadı.";

          res.end(JSON.stringify({ cevap }));
          return;
        }

        // GÖRSEL OLUŞTURMA
        if (req.url === "/api/image") {
          const prompt = input.prompt;

          if (!prompt || typeof prompt !== "string") {
            throw new Error("Görsel açıklaması gerekli.");
          }

          if (prompt.length > 2000) {
            throw new Error("Görsel açıklaması çok uzun.");
          }

          const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              body: JSON.stringify({
                model: IMAGE_MODEL,
                input: "Create an image based on this description: " + prompt,
                response_format: {
                  type: "image",
                  aspect_ratio: "1:1",
                  image_size: "1K"
                }
              })
            }
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error?.message || "Görsel üretilemedi.");
          }

          let generatedImage = data.output_image;

          if (!generatedImage && data.steps) {
            for (const step of data.steps) {
              if (step.type === "model_output" && step.content) {
                generatedImage = step.content.find(
                  item => item.type === "image"
                );
                if (generatedImage) break;
              }
            }
          }

          if (!generatedImage?.data) {
            throw new Error("Gemini görsel döndürmedi.");
          }

          const mime = generatedImage.mime_type || "image/png";

          res.end(JSON.stringify({
            imageUrl: `data:${mime};base64,${generatedImage.data}`
          }));
          return;
        }

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

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("ÖMER AI hazır!");
});
              
