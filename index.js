const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();

/* ======================
   CORS (Browser Safe)
====================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-api-key"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "25mb" }));

/* ======================
   API KEY
====================== */
const API_KEY = "Techazux@123";

app.use((req, res, next) => {
  const key =
    req.headers["x-api-key"] ||
    req.body?.api_key ||
    req.query?.api_key;

  if (key !== API_KEY) {
    return res
      .status(401)
      .json({ status: false, msg: "Invalid API Key" });
  }
  next();
});

/* ======================
   GLOBAL STORES
====================== */
const sockets = {};
const qrStore = {};
const SESSION_PATH = "./sessions";

/* ======================
   START DEVICE
====================== */
async function startDevice(sender_id) {
  if (sockets[sender_id]) return;

  const authPath = path.join(SESSION_PATH, sender_id);
  const { state, saveCreds } =
    await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" })
  });

  sockets[sender_id] = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrStore[sender_id] = qr;
      console.log("QR Generated:", sender_id);
    }

    if (connection === "open") {
      console.log("CONNECTED:", sender_id);
      delete qrStore[sender_id];
    }

    if (connection === "close") {
      const reason =
        lastDisconnect?.error?.output?.statusCode;

      console.log("DISCONNECTED:", sender_id, reason);

      delete sockets[sender_id];

      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(() => startDevice(sender_id), 3000);
      }
    }
  });
}

/* ======================
   DEVICE INIT
====================== */
app.post("/device/init", async (req, res) => {
  const { sender_id } = req.body;
  if (!sender_id)
    return res.json({ status: false, msg: "sender_id required" });

  await startDevice(sender_id);
  res.json({ status: true });
});

/* ======================
   GET QR
====================== */
app.get("/device/qr/:sender_id", async (req, res) => {
  const qr = qrStore[req.params.sender_id];
  if (!qr)
    return res.json({ status: false, msg: "QR not available" });

  const img = await QRCode.toDataURL(qr);
  res.json({ status: true, qr: img });
});

/* ======================
   DEVICE STATUS
====================== */
app.get("/device/status/:sender_id", (req, res) => {
  const sock = sockets[req.params.sender_id];
  if (!sock) return res.json({ status: "offline" });
  return res.json({ status: "connected" });
});

/* ======================
   LOGOUT DEVICE
====================== */
app.post("/device/logout", async (req, res) => {
  const { sender_id } = req.body;
  const sock = sockets[sender_id];
  if (!sock) return res.json({ status: false });

  await sock.logout();
  delete sockets[sender_id];

  res.json({ status: true });
});

/* ======================
   SEND TEXT
====================== */
app.post("/send/text", async (req, res) => {
  try {
    const { sender_id, phone, message } = req.body;
    const sock = sockets[sender_id];

    if (!sock)
      return res.json({
        status: false,
        msg: "Device not connected"
      });

    await sock.sendMessage(
      `${phone}@s.whatsapp.net`,
      { text: message }
    );

    res.json({ status: true });
  } catch (e) {
    res.json({ status: false, error: e.message });
  }
});

/* ======================
   SEND MEDIA (BASE64)
====================== */
app.post("/send/media", async (req, res) => {
  try {
    const {
      sender_id,
      phone,
      base64,
      mimetype,
      caption
    } = req.body;

    const sock = sockets[sender_id];
    if (!sock)
      return res.json({
        status: false,
        msg: "Device not connected"
      });

    const buffer = Buffer.from(base64, "base64");

    await sock.sendMessage(
      `${phone}@s.whatsapp.net`,
      {
        image: buffer,
        mimetype,
        caption
      }
    );

    res.json({ status: true });
  } catch (e) {
    res.json({ status: false, error: e.message });
  }
});

/* ======================
   AUTO START SESSIONS
====================== */
if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH);
}

fs.readdirSync(SESSION_PATH).forEach((id) => {
  console.log("Auto starting:", id);
  startDevice(id);
});

/* ======================
   SERVER START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Baileys WhatsApp Engine running on", PORT);
});
