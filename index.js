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
   START WHATSAPP
========================= */
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),

    // ---- LOW RAM SAFE ----
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      console.log("🔑 QR generated");
    }

    if (connection === "open") {
      isConnected = true;
      latestQR = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      isConnected = false;
      latestQR = null;

      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnected:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔁 Auto reconnecting...");
        startWhatsApp();
      } else {
        console.log("🚫 Logged out. Delete sessions to re-login.");
      }
    }
  });
}

startWhatsApp();

/* =========================
   BASIC STATUS
========================= */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    whatsapp: isConnected ? "connected" : "disconnected"
  });
});

/* =========================
   QR STRING API
========================= */
app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.json({
      success: false,
      message: "Already connected"
    });
  }

  if (!latestQR) {
    return res.json({
      success: false,
      message: "QR not generated yet. Refresh after 5 sec."
    });
  }

  res.json({
    success: true,
    qr: latestQR
  });
});

/* =========================
   QR IMAGE API (BEST)
========================= */
app.get("/qr-image", async (req, res) => {
  if (isConnected) {
    return res.send("Already connected");
  }

  if (!latestQR) {
    return res.send("QR not ready. Refresh after few seconds.");
  }

  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    const img = Buffer.from(qrImage.split(",")[1], "base64");

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": img.length
    });
    res.end(img);

  } catch (err) {
    res.status(500).send("QR generation error");
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
   FORCE RESET (NEW QR)
========================= */
app.get("/reset", async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }

    latestQR = null;
    isConnected = false;

    // delete session folder
    if (fs.existsSync("./sessions")) {
      fs.rmSync("./sessions", { recursive: true, force: true });
    }

    res.json({
      success: true,
      message: "Session reset. Restart app to get new QR."
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
