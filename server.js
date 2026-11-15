
const http = require("http");

const server = http.createServer((req, res) => {
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
      durum: "Sunucu çalışıyor!"
    }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({
    hata: "Sayfa bulunamadı."
  }));
});

server.listen(process.env.PORT || 3000, () => {
  console.log("ÖMER AI sunucusu hazır!");
});
