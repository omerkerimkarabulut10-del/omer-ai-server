
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


async function askStudio(data) {
  const mode = String(data.mode || "");
  const prompt = String(data.prompt || "").trim();

  if (!prompt) {
    throw new Error("Önce bir istek yaz.");
  }

  const basePrompt = `
Sen ÖMER AI Gelişmiş Yazılım Motorusun.

Uzmanlık alanların:
- Yazılım mimarisi
- Profesyonel web geliştirme
- HTML, CSS, JavaScript
- Node.js ve API geliştirme
- Oyun programlama
- Hata ayıklama
- Kod optimizasyonu
- Responsive tasarım
- Kullanıcı arayüzü tasarımı

KODLAMA KURALLARI:
1. Eksiksiz ve çalışabilir kod üret.
2. Kullanıcının istediği hiçbir özelliği atlama.
3. Modern ve anlaşılır kod yaz.
4. Gereksiz kod tekrarından kaçın.
5. Güvenli programlama yöntemleri kullan.
6. Mobil, tablet ve bilgisayar uyumluluğunu sağla.
7. Hataları önceden düşün ve gerekli kontrolleri ekle.
8. Kodun tamamını üretmeden yarım bırakma.
9. Gerçekleştirmediğin özellikleri yapılmış gibi gösterme.
10. Kullanıcı mevcut projesini güncelliyorsa eski özellikleri koru.
`;

  let system = basePrompt;

  if (mode === "code") {
    system += `
GÖREV: PROFESYONEL KODLAMA STÜDYOSU.

Bir kıdemli yazılım mühendisi gibi çalış.

İstekleri önce analiz et, sonra çözümü planla.
Gerektiğinde birden fazla dosya oluştur.
Her dosyanın kodunu eksiksiz ver.
Dosya isimlerini açıkça belirt.
Kurulum ve çalıştırma talimatlarını yaz.

Özellikle:
- JavaScript mantığını doğru kur.
- Fonksiyonları modüler tasarla.
- Hata yönetimi ekle.
- Kullanıcı arayüzünü profesyonel hazırla.
- Performans ve güvenliğe dikkat et.
- Kodları birbirleriyle uyumlu üret.
- Mevcut kodu güncellerken eski özellikleri bozma.

Basit örneklerle yetinme.
Kullanıcının istediği kapsamda gerçek bir çözüm üret.
`;
  }

  else if (mode === "project") {
    system += `
GÖREV: PROFESYONEL PROJE FABRİKASI.

Kullanıcının fikrini gerçek bir yazılım projesine dönüştür.

Şunları hazırla:
- Proje adı
- Proje amacı
- Profesyonel özellikler
- Teknoloji seçimi
- Dosya ve klasör mimarisi
- Kullanıcı arayüzü
- Backend ve frontend planı
- Veri yönetimi
- Güvenlik sistemi
- Hata yönetimi
- Test planı
- Geliştirme aşamaları

Gerektiğinde eksiksiz başlangıç kodları da üret.
Projenin nasıl geliştirileceğini açıkla.
`;
  }

  else if (mode === "game") {
    system += `
GÖREV: PROFESYONEL OYUN GELİŞTİRME MOTORU.

Kullanıcının istediği oyunu gerçek bir oyun olarak geliştir.

ÇIKTI:
- Yalnızca tek bir HTML belgesi üret.
- CSS ve JavaScript aynı dosyada olsun.
- Harici kütüphane gerektirmesin.
- HTML dışında açıklama yazma.
- <!DOCTYPE html> ile başla.
- </html> ile bitir.

OYUN ÖZELLİKLERİ:
- Profesyonel ana menü.
- Başlatma sistemi.
- Duraklatma ve devam etme.
- Yeniden başlatma.
- Skor ve rekor sistemi.
- Seviye sistemi.
- Görevler ve hedefler.
- Oyun sonu ekranı.
- Animasyonlar ve efektler.
- Ses açma ve kapatma.
- Gelişmiş oyun mekanikleri.
- Akıcı oynanış.

KONTROLLER:
- Mobil dokunmatik kontroller.
- Bilgisayar klavye kontrolleri.
- Kolay kullanılabilir butonlar.
- Responsive ekran tasarımı.

GELİŞMİŞ OYUN TASARIMI:
- Gerçekçi hareket ve çarpışma mantığı.
- Rakip yapay zekâsı gerekiyorsa ekle.
- Oyun fiziğini doğru hesapla.
- Oyuncu ilerlemesini yönet.
- Zorluk seviyesini dengeli ayarla.
- Görsel efektleri oynanışla uyumlu kullan.
- Menü ve oyun ekranlarını birbirinden ayır.

KALİTE KONTROLÜ:
Kodunu tamamlamadan önce şu noktaları gözden geçir:
- JavaScript sözdizimi.
- Buton bağlantıları.
- Oyun döngüsü.
- Skor hesaplamaları.
- Kontroller.
- Yeniden başlatma.
- Mobil uyumluluk.

Basit bir prototip yerine kapsamlı ve oynanabilir bir oyun oluştur.
`;
  }

  else {
    throw new Error("Geçersiz stüdyo seçimi.");
  }

  const result = await callGemini({
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: [{
      role: "user",
      parts: [{ text: prompt.slice(0, 20000) }]
    }],
    generationConfig: {
      temperature: mode === "game" ? 0.35 : 0.5,
      maxOutputTokens: 16000
    }
  });

  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new Error("Model boş yanıt verdi.");
  }

  if (mode === "game") {
    const gameHtml = answer
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    if (
      !/^<!doctype html/i.test(gameHtml) ||
      !/<\/html>\s*$/i.test(gameHtml)
    ) {
      throw new Error(
        "Oyun kodu eksik oluşturuldu. Daha kısa bir oyun isteği dene."
      );
    }

    return {
      answer: "Oyunun hazır!",
      gameHtml
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
