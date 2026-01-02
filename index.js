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
let isStarting = false;   // 🔒 prevents reconnect loop

/* =========================
   START WHATSAPP (SAFE)
========================= */
async function startWhatsApp() {
  if (isStarting) {
    console.log("⏸️ WhatsApp already starting, skipping...");
    return;
  }

  isStarting = true;
  console.log("🚀 Starting WhatsApp socket...");

  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),

    // ---- LOW RAM / RAILWAY SAFE ----
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ---- QR HANDLING ----
    if (qr) {
      latestQR = qr;
      console.log("🔑 QR generated (open /qr-image)");
    }

    // ---- CONNECTED ----
    if (connection === "open") {
      isConnected = true;
      latestQR = null;
      isStarting = false;
      console.log("✅ WhatsApp Connected");
    }

    // ---- DISCONNECTED ----
    if (connection === "close") {
      isConnected = false;
      latestQR = null;
      isStarting = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnected. Reason:", statusCode);

      // 🚫 DO NOT RECONNECT ON 405
      if (statusCode === 405) {
        console.log("🚫 405 BLOCKED");
        console.log("👉 Action: call /reset → restart → scan new QR");
        return;
      }

      // 🚫 LOGGED OUT
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("🚫 Logged out. Session invalid.");
        console.log("👉 Delete session & scan again.");
        return;
      }

      // ✅ SAFE RECONNECT WITH DELAY
      console.log("⏳ Reconnecting after 10 seconds...");
      setTimeout(() => {
        startWhatsApp();
      }, 10000);
    }
  });
}

// 🔥 INITIAL START
startWhatsApp();

/* =========================
   STATUS CHECK
========================= */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    whatsapp: isConnected ? "connected" : "disconnected"
  });
});

/* =========================
   QR IMAGE (BEST METHOD)
========================= */
app.get("/qr-image", async (req, res) => {
  if (isConnected) {
    return res.send("WhatsApp already connected");
  }

  if (!latestQR) {
    return res.send("QR not ready. Refresh after 5–10 seconds.");
  }

  try {
    const dataUrl = await QRCode.toDataURL(latestQR);
    const img = Buffer.from(dataUrl.split(",")[1], "base64");

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": img.length
    });
    res.end(img);
  } catch (err) {
    res.status(500).send("QR generation failed");
  }
});

/* =========================
   SEND MESSAGE API
========================= */
app.post("/send", async (req, res) => {
  try {
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

    const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
    await sock.sendMessage(jid, { text: message });

    res.json({
      success: true,
      message: "Message sent"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =========================
   FORCE RESET (SAFE)
========================= */
app.get("/reset", async (req, res) => {
  try {
    console.log("♻️ Resetting WhatsApp session...");

    if (sock) {
      await sock.logout();
      sock = null;
    }

    isConnected = false;
    latestQR = null;
    isStarting = false;

    if (fs.existsSync("./sessions")) {
      fs.rmSync("./sessions", { recursive: true, force: true });
    }

    res.json({
      success: true,
      message: "Session reset. Restart service & scan new QR."
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =========================
   START HTTP SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🌐 API running on port", PORT);
});
