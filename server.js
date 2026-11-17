
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
    throw new Error(
      result?.error?.message || `Gemini API hatası (${response.status})`
    );
  }

  return result;
}

function getAnswer(result) {
  return result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim() || "";
}


function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  return history.slice(-20).map(item => {
    const text =
      item.parts?.[0]?.text ??
      item.text ??
      item.content ??
      "";

    return {
      role:
        item.role === "assistant" ||
        item.role === "model"
          ? "model"
          : "user",
      parts: [{
        text: String(text).slice(0, 12000)
      }]
    };
  }).filter(item => item.parts[0].text.trim());
}


// NORMAL SOHBET
async function askChat(data) {
  const message = String(data.message || "").trim();

  if (!message) {
    throw new Error("Mesaj boş olamaz.");
  }

  const language = String(data.dil || "Türkçe");
  const personality = personalities[data.kisilik] || personalities.arkadas;
  const memory = String(data.hafiza || "").slice(0, 5000);

  const history = cleanHistory(data.gecmis);

  if (history.length && history[history.length - 1].role === "user") {
    history.pop();
  }

  history.push({
    role: "user",
    parts: [{ text: message.slice(0, 12000) }]
  });

  const system = `
Sen ÖMER AI adlı gelişmiş bir yapay zekâ asistanısın.

KONUŞMA TARZI:
${personality}

DİL:
Kullanıcı başka bir dil istemedikçe ${language} dilinde cevap ver.

DAVRANIŞ:
- Soruları doğru ve anlaşılır cevapla.
- Gerektiğinde adım adım anlat.
- Kodlama sorularında çalışabilir örnekler ver.
- Bilmediğin şeyleri biliyormuş gibi gösterme.
- Hatalı kodları analiz edip düzelt.
- Kullanıcının önceki mesajlarını dikkate al.
- Gereksiz tekrar yapma.
- Samimi, saygılı ve yardımcı ol.

KULLANICI HAFIZASI:
${memory || "Henüz kayıtlı hafıza notu yok."}
`;

  const result = await callGemini({
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
    }
  });

  const answer = getAnswer(result);

  if (!answer) {
    throw new Error("Yapay zekâ boş cevap verdi.");
  }

  return answer;
}

// PROJE DOSYALARINI KONTROL ET
function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Yapay zekâ proje dosyalarını oluşturamadı.");
  }

  if (files.length > 30) {
    throw new Error("Proje en fazla 30 dosya içerebilir.");
  }

  const allowedExtensions =
    /\.(html|css|js|mjs|cjs|json|md|txt|svg|xml|yml|yaml|py|java|ts|tsx|jsx|php|sql|sh|toml|gitignore)$/i;

  const seen = new Set();
  let totalSize = 0;

  return files.map(file => {
    let name = String(file.name || "").replace(/\\/g, "/").trim();
    const content = String(file.content || "");

    if (
      !name ||
      name.startsWith("/") ||
      name.includes("..") ||
      name.includes("\0") ||
      !allowedExtensions.test(name)
    ) {
      throw new Error("Geçersiz proje dosyası adı: " + name);
    }

    if (seen.has(name)) {
      throw new Error("Aynı isimde birden fazla dosya var: " + name);
    }

    seen.add(name);

    if (!content.trim()) {
      throw new Error(name + " dosyası boş oluşturuldu.");
    }

    totalSize += Buffer.byteLength(content, "utf8");

    if (totalSize > 3 * 1024 * 1024) {
      throw new Error("Proje dosyalarının toplam boyutu çok büyük.");
    }

    return { name, content };
  });
}

function parseProjectJSON(text) {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first === -1 || last <= first) {
    throw new Error("Proje verisi okunamadı. Daha kısa bir istek dene.");
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

// OYUN DOSYALARINI TEK HTML DOSYASINA BİRLEŞTİR
function makeSingleFileGame(files) {
  const htmlFile = files.find(
    file => file.name.toLowerCase() === "index.html"
  );

  if (!htmlFile) {
    throw new Error("Oyun için index.html oluşturulamadı.");
  }

  if (files.some(file =>
    !["index.html", "style.css", "game.js"].includes(file.name)
  )) {
    throw new Error(
      "Oyun yalnızca index.html, style.css ve game.js kullanabilir."
    );
  }

  let html = htmlFile.content;

  const cssFiles = files.filter(file => file.name === "style.css");
  const jsFiles = files.filter(file => file.name === "game.js");

  const usedCSS = new Set();
  const usedJS = new Set();

  function matchesFile(path, fileName) {
    const cleanPath = path.split("?")[0].split("#")[0];
    return cleanPath === fileName ||
      cleanPath.endsWith("/" + fileName);
  }

  html = html.replace(/<link\b[^>]*>/gi, tag => {
    const match = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);

    if (!match) return tag;

    const file = cssFiles.find(item =>
      matchesFile(match[1], item.name)
    );

    if (!file) return tag;

    usedCSS.add(file.name);

    return `<style>\n${file.content.replace(/<\/style/gi, "<\\/style")}\n</style>`;
  });

  html = html.replace(
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, path) => {
      const file = jsFiles.find(item =>
        matchesFile(path, item.name)
      );

      if (!file) return tag;

      usedJS.add(file.name);

      return `<script>\n${file.content.replace(/<\/script/gi, "<\\/script")}\n<\/script>`;
    }
  );

  const extraCSS = cssFiles
    .filter(file => !usedCSS.has(file.name))
    .map(file =>
      `<style>\n${file.content.replace(/<\/style/gi, "<\\/style")}\n</style>`
    )
    .join("\n");

  const extraJS = jsFiles
    .filter(file => !usedJS.has(file.name))
    .map(file =>
      `<script>\n${file.content.replace(/<\/script/gi, "<\\/script")}\n<\/script>`
    )
    .join("\n");

  if (extraCSS) {
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, extraCSS + "\n</head>");
    } else {
      html = extraCSS + "\n" + html;
    }
  }

  if (extraJS) {
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, extraJS + "\n</body>");
    } else {
      html += "\n" + extraJS;
    }
  }

  return [{
    name: "index.html",
    content: html
  }];
}

// KODLAMA / PROJE / OYUN STÜDYOSU
async function askStudio(data) {
  const mode = String(data.mode || "");
  const prompt = String(data.prompt || "").trim();

  if (!prompt) {
    throw new Error("Önce bir istek yaz.");
  }

  if (!["code", "project", "game"].includes(mode)) {
    throw new Error("Geçersiz stüdyo seçimi.");
  }

  const basePrompt = `
Sen ÖMER AI Gelişmiş Yazılım Motorusun.

Uzmanlık alanların:
- Profesyonel yazılım geliştirme
- HTML, CSS, JavaScript
- Node.js ve API geliştirme
- Oyun programlama
- Hata ayıklama
- Yazılım mimarisi
- Responsive tasarım
- Güvenli kodlama

GENEL KURALLAR:
1. Eksiksiz ve tutarlı dosyalar üret.
2. Dosyalar birbirleriyle uyumlu olsun.
3. Gerekli bütün dosyaları oluştur.
4. Dosya isimlerini açıkça belirle.
5. Kodları yarım bırakma.
6. Gerçekleştirmediğin özellikleri yapılmış gibi gösterme.
7. Kullanıcının istediği özellikleri atlama.
8. Mobil ve masaüstü uyumluluğuna dikkat et.
9. Gereksiz dosya oluşturma.
10. Dosya içeriklerinde Markdown kod çitleri kullanma.

ÇIKTI FORMATI:
Sadece geçerli JSON döndür.

Şu yapıyı kullan:
{
  "projectName": "Proje adı",
  "description": "Kısa proje açıklaması",
  "files": [
    {
      "name": "index.html",
      "content": "Dosyanın tam kodu"
    }
  ]
}

Dosya isimleri gerçek dosya isimleri olmalı.
Dosya içerikleri eksiksiz olmalı.
JSON biçimini bozma.
`;

  let task = "";

  if (mode === "code") {
    task = `
GÖREV: PROFESYONEL KODLAMA STÜDYOSU.

Kullanıcının istediği yazılımı geliştir.
Gerektiğinde HTML, CSS, JavaScript, JSON ve diğer gerekli dosyaları ayrı oluştur.
Her dosyanın tam içeriğini files listesine ekle.
Dosyalar arasında doğru bağlantıları kur.
README.md dosyasıyla kurulum ve çalıştırma bilgilerini açıkla.
`;
  }

  if (mode === "project") {
    task = `
GÖREV: PROFESYONEL PROJE FABRİKASI.

Kullanıcının fikrini gerçek bir yazılım projesine dönüştür.
Proje mimarisini ve gerekli kaynak dosyalarını oluştur.
Kullanıcı arayüzü, veri yönetimi, hata yönetimi ve güvenlik konularını düşün.
Gerekli başlangıç kodlarını dosyalar halinde üret.
README.md dosyası ekle.
`;
  }

  if (mode === "game") {
    task = `
GÖREV: PROFESYONEL OYUN FABRİKASI.

Kullanıcının istediği oyunu profesyonel kalitede ve tamamen oynanabilir şekilde oluştur.

TEK DOSYA ZORUNLULUĞU:
- Oyunun tamamı tek index.html dosyasında bulunmalı.
- CSS kodlarını HTML içindeki <style> etiketine yaz.
- JavaScript kodlarını HTML içindeki <script> etiketine yaz.
- Ayrı CSS, JS, JSON veya başka dosya oluşturma.
- Harici kütüphane, CDN, internet bağlantısı veya import kullanma.
- Görselleri Canvas, CSS veya HTML içine gömülü SVG ile oluştur.
- Oyun doğrudan index.html açılarak çalışmalı.
- Oyun iframe önizlemesinde çalışabilmeli.

OYUN KALİTESİ:
- Profesyonel arayüz ve animasyonlar oluştur.
- Mobil dokunmatik ve bilgisayar klavye kontrollerini destekle.
- Başlangıç menüsü, duraklatma, yeniden başlatma ve oyun sonu ekranı ekle.
- Skor ve oyun mekaniklerini gerçekten çalıştır.
- Boş ekran, çalışmayan buton ve eksik kod bırakma.
- Oyunu oluşturmadan önce mantığını kontrol et.

GELİŞMİŞ FUTBOLCU KONTROL MOTORU:

Oyun futbol oyunuysa aşağıdaki sistemi zorunlu uygula:

1. Her oyuncunun kendine ait benzersiz ID'si, konumu, hızı ve kontrol durumu olsun.
2. selectedPlayer değişkeni yalnızca kontrol edilen futbolcuyu belirlesin.
3. Klavye ve joystick girdileri sadece selectedPlayer üzerinde etkili olsun.
4. Takım oyuncularının tamamına aynı hareket komutunu uygulama.
5. Her oyuncunun hareketini ayrı ayrı hesapla.
6. Kontrol edilmeyen oyuncular bağımsız yapay zekâ tarafından yönetilsin.
7. Oyuncu değiştirme tuşu ekle. Seçim değiştiğinde eski oyuncunun kontrolü tamamen bırakılsın.
8. Topa sahip olma ve pas verme sistemleri oyuncu seçimiyle uyumlu çalışsın.
9. Aynı anda iki oyuncunun kullanıcı tarafından kontrol edilmesini engelle.
10. Mobil joystick de yalnızca seçili oyuncuyu hareket ettirsin.

TEKNİK ZORUNLULUKLAR:
- Global hareket komutlarını bütün oyunculara uygulama.
- Her oyuncunun kontrol ve yapay zekâ sistemini birbirinden ayır.
- Klavye olaylarını tek bir merkezi giriş sistemiyle yönet.
- Oyuncu değiştirildiğinde eski tuş durumlarını temizle.
- Hareket güncellemelerini requestAnimationFrame oyun döngüsünde yönet.
- Mevcut çarpışma sistemini koru.
- Kontrol sistemi gerçekten çalışır durumda olsun.
- Sadece görsel olarak çalışan sahte kontrol sistemi oluşturma.

ÇIKTI:
files listesinde SADECE bir dosya bulunmalı:
index.html

Bu dosyanın içinde oyunun bütün kaynak kodları bulunmalı.
`;
  }

  const result = await callGemini({
    systemInstruction: {
      parts: [{ text: basePrompt + "\n" + task }]
    },
    contents: [{
      role: "user",
      parts: [{ text: prompt.slice(0, 16000) }]
    }],
    generationConfig: {
      temperature: mode === "game" ? 0.35 : 0.45,
      maxOutputTokens: 16000,
      responseMimeType: "application/json"
    }
  });

  const answer = getAnswer(result);

  if (!answer) {
    throw new Error("Model boş yanıt verdi.");
  }

  let project;

  try {
    project = parseProjectJSON(answer);
  } catch (error) {
    throw new Error(
      "Proje JSON biçiminde tamamlanamadı. Daha kısa ve daha sade bir istek dene."
    );
  }

  let files = validateFiles(project.files);

  if (mode === "game") {
    files = makeSingleFileGame(files);
  }

  return {
    answer: String(
      project.description || project.projectName || "Projen hazır!"
    ),
    projectName: String(project.projectName || "omer-ai-proje"),
    files
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    return res.end();
  }

  if (
    req.method === "GET" &&
    (req.url === "/" || req.url === "/health")
  ) {
    return send(res, 200, {
      ok: true,
      service: "omer-ai-server",
      chatModel: CHAT_MODEL
    });
  }

  if (
    req.method !== "POST" ||
    !["/api/chat", "/api/studio"].includes(req.url)
  ) {
    return send(res, 404, { error: "Sayfa bulunamadı." });
  }

  try {
    const data = await readBody(req);

    if (req.url === "/api/chat") {
      const answer = await askChat(data);
      return send(res, 200, { answer });
    }

    if (req.url === "/api/studio") {
      const result = await askStudio(data);
      return send(res, 200, result);
    }
  } catch (error) {
    console.error("ÖMER AI error:", error);

    return send(res, 500, {
      error: error.message || "Beklenmeyen sunucu hatası."
    });
  }
});

server.listen(PORT, () => {
  console.log("ÖMER AI server çalışıyor: " + PORT);
  console.log("Sohbet modeli: " + CHAT_MODEL);
});
      
