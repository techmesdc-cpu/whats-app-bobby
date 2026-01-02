const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const QRCode = require("qrcode");
const fs = require("fs");

const app = express();
app.use(express.json());

let client;
let latestQR = null;
let ready = false;

/* =========================
   INIT WHATSAPP (MINIMAL)
========================= */
function startWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./session" }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process"
      ],
      executablePath: process.env.CHROME_PATH || undefined
    }
  });

  client.on("qr", (qr) => {
    latestQR = qr;
    console.log("🔑 QR generated");
  });

  client.on("ready", () => {
    ready = true;
    latestQR = null;
    console.log("✅ WhatsApp Ready");
  });

  client.on("disconnected", (reason) => {
    ready = false;
    console.log("❌ Disconnected:", reason);
  });

  client.initialize();
}

startWhatsApp();

/* =========================
   STATUS
========================= */
app.get("/", (req, res) => {
  res.json({
    whatsapp: ready ? "connected" : "disconnected"
  });
});

/* =========================
   QR IMAGE API
========================= */
app.get("/qr", async (req, res) => {
  if (ready) return res.send("Already connected");
  if (!latestQR) return res.send("QR not ready, refresh");

  const img = await QRCode.toBuffer(latestQR);
  res.type("png").send(img);
});

/* =========================
   SEND MESSAGE
========================= */
app.post("/send", async (req, res) => {
  if (!ready) {
    return res.status(503).json({ success: false });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ success: false });
  }

  try {
    await client.sendMessage(number + "@c.us", message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* =========================
   LOGOUT + DELETE SESSION
========================= */
app.get("/logout", async (req, res) => {
  try {
    await client.logout();
    ready = false;

    if (fs.existsSync("./session")) {
      fs.rmSync("./session", { recursive: true, force: true });
    }

    res.json({ success: true, message: "Logged out" });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
