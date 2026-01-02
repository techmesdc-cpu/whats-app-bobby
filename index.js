import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import express from "express";
import P from "pino";
import QRCode from "qrcode";
import fs from "fs";

const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;
let latestQR = null;

/* =========================
   START WHATSAPP (NO LOOP)
========================= */
async function startWhatsApp() {
  console.log("🚀 Starting WhatsApp (Baileys, safe mode)");

  const { state, saveCreds } = await useMultiFileAuthState("./session");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),

    // 🔒 STRICT SAFE OPTIONS
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      console.log("🔑 QR generated (open /qr)");
    }

    if (connection === "open") {
      isConnected = true;
      latestQR = null;
      console.log("✅ WhatsApp connected");
    }

    if (connection === "close") {
      isConnected = false;
      latestQR = null;

      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnected. Reason:", code);

      console.log("🛑 Auto reconnect DISABLED");
      console.log("👉 Fix: /reset → restart → scan QR again");
    }
  });
}

startWhatsApp();

/* =========================
   STATUS
========================= */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    whatsapp: isConnected ? "connected" : "disconnected"
  });
});

/* =========================
   QR IMAGE (MANUAL)
========================= */
app.get("/qr", async (req, res) => {
  if (isConnected) {
    return res.send("WhatsApp already connected");
  }

  if (!latestQR) {
    return res.send("QR not ready. Wait 5–10 seconds.");
  }

  try {
    const img = await QRCode.toBuffer(latestQR);
    res.type("png").send(img);
  } catch {
    res.status(500).send("QR error");
  }
});

/* =========================
   SEND TEXT MESSAGE
========================= */
app.post("/send", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({
      success: false,
      message: "WhatsApp not connected"
    });
  }

  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({
      success: false,
      message: "number & message required"
    });
  }

  try {
    const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
    await sock.sendMessage(jid, { text: message });

    res.json({
      success: true,
      message: "Message sent"
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

/* =========================
   LOGOUT + DELETE SESSION
========================= */
app.get("/reset", async (req, res) => {
  try {
    console.log("♻️ Resetting session");

    if (sock) {
      await sock.logout();
      sock = null;
    }

    isConnected = false;
    latestQR = null;

    if (fs.existsSync("./session")) {
      fs.rmSync("./session", { recursive: true, force: true });
    }

    res.json({
      success: true,
      message: "Session cleared. Restart app & scan new QR."
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🌐 API running on port", PORT);
});
