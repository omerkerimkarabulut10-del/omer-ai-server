
const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const kisilikler = {
  arkadas: "Samimi, sıcak ve yardımsever bir arkadaş gibi konuş. Doğal ve anlaşılır ol.",
  komik: "Neşeli, eğlenceli ve yerinde espriler yapan bir asistansın.",
  ogretmen: "Sabırlı bir öğretmen gibi davran. Konuları adım adım ve örneklerle açıkla.",
  ciddi: "Profesyonel, ciddi, net ve doğrudan cevaplar ver."
};

const sunucu = http.createServer(async (req, res) => {
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
    res.writeHead(404);
    return res.end("Sayfa bulunamadı");
  }

  if (!API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ hata: "GEMINI_API_KEY ayarlanmamış." }));
  }

  let body = "";

  req.on("data", parca => {
    body += parca;
    if (body.length > 15 * 1024 * 1024) {
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const data = JSON.parse(body);

      const mesaj = String(data.mesaj || "").trim();
      const dil = String(data.dilAdi || data.dil || "Türkçe");
      const kisilik = kisilikler[data.kisilik] || kisilikler.arkadas;

      if (!mesaj) {
        return cevapla(res, 400, { hata: "Mesaj boş olamaz." });
      }

      const systemInstruction = `
Senin adın ÖMER AI.
Kullanıcıyla ${dil} dilinde konuş.
${kisilik}

Önceki konuşmaları dikkate al.
Kullanıcının sorusuna doğrudan ve anlaşılır cevap ver.
Kullanıcı başka bir dil istemedikçe ${dil} kullan.
`;

      const contents = [];

      const gecmis = Array.isArray(data.gecmis) ? data.gecmis.slice(-20) : [];

      for (const item of gecmis) {
        if (!item || !["user", "bot"].includes(item.rol)) continue;

        const text = String(item.metin || "").slice(0, 12000);
        if (!text.trim()) continue;

        contents.push({
          role: item.rol === "bot" ? "model" : "user",
          parts: [{ text }]
        });
      }

      const parts = [{ text: mesaj }];

      if (data.imageBase64 && data.imageMimeType) {
        const izinliTurler = ["image/jpeg", "image/png", "image/webp"];

        if (!izinliTurler.includes(data.imageMimeType)) {
          return cevapla(res, 400, { hata: "Bu görsel formatı desteklenmiyor." });
        }

        parts.push({
          inline_data: {
            mime_type: data.imageMimeType,
            data: data.imageBase64
          }
        });
      }

      contents.push({
        role: "user",
        parts
      });

      const sonuc = await geminiIstek({
  systemInstruction: {
    parts: [{ text: systemInstruction }]
  },
  contents
});

      const cevap =
        sonuc.candidates?.[0]?.content?.parts
          ?.map(p => p.text || "")
          .join("")
          .trim();

      if (!cevap) {
        return cevapla(res, 502, { hata: "Yapay zekâ boş cevap verdi. Tekrar deneyebilirsin." });
      }

      cevapla(res, 200, { cevap });

    } catch (error) {
      console.error("ÖMER AI Hatası:", error);
      cevapla(res, 500, {
        hata: error.message || "Bir hata oluştu."
      });
    }
  });
});

async function geminiIstek(payload) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const tekrarDenemeleri = 3;
  let sonHata;

  for (let deneme = 0; deneme < tekrarDenemeleri; deneme++) {
    let response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      sonHata = error;

      if (deneme === tekrarDenemeleri - 1) break;

      await bekle(1000 * (deneme + 1));
      continue;
    }

    if (response.ok) {
      return await response.json();
    }

    const hataMetni = await response.text();
    sonHata = new Error(hataMetni || `Gemini HTTP ${response.status}`);
    sonHata.status = response.status;

    const tekrarEdilebilir = [429, 500, 502, 503, 504].includes(response.status);

    if (!tekrarEdilebilir || deneme === tekrarDenemeleri - 1) {
      throw sonHata;
    }

    await bekle(1000 * (deneme + 1));
  }

  throw sonHata || new Error("Gemini sunucusuna ulaşılamadı.");
}

function bekle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cevapla(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

sunucu.listen(PORT, () => {
  console.log(`ÖMER AI sunucusu ${PORT} portunda çalışıyor.`);
});
