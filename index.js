import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import express from "express";
import P from "pino";

const app = express();
app.use(express.json());

let sock;
let isConnected = false;
let latestQR = null;

/* =========================
   INIT WHATSAPP
========================= */
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),

    // ---- RAILWAY / LOW RAM SAFE ----
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ---- QR HANDLING (API BASED) ----
    if (qr) {
      latestQR = qr;
      console.log("🔑 New QR generated (fetch via /qr)");
    }

    if (connection === "open") {
      isConnected = true;
      latestQR = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      isConnected = false;
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ Disconnected. Reason:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔁 Reconnecting...");
        startWhatsApp();
      } else {
        console.log("🚫 Logged out. Delete sessions folder to re-scan.");
      }
    }
  });
}

startWhatsApp();

/* =========================
   QR API (NO TERMINAL)
========================= */
app.get("/qr", (req, res) => {
  if (!latestQR) {
    return res.json({
      success: false,
      message: "QR not available or already scanned"
    });
  }

  res.json({
    success: true,
    qr: latestQR
  });
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
    console.error("SEND ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =========================
   STATUS / HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    whatsapp: isConnected ? "connected" : "disconnected"
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
