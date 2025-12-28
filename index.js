const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const app = express();
app.use(express.json({ limit: "25mb" }));

/* ======================
   FIXED API KEY
====================== */
const API_KEY = "Techazux@123";

/* ======================
   API KEY VALIDATION
====================== */
app.use((req, res, next) => {
  const key = req.headers["x-api-key"] || req.body.api_key || req.query.api_key;

  if (key !== API_KEY) {
    return res.status(401).json({
      status: false,
      msg: "Invalid API Key",
    });
  }
  next();
});

/* ======================
   GLOBAL VARIABLES
====================== */
const clients = {};
const qrStore = {};
const SESSION_PATH = "./sessions";

/* ======================
   START CLIENT
====================== */
function startClient(sender_id) {
  if (clients[sender_id]) return clients[sender_id];

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sender_id,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", (qr) => {
    qrStore[sender_id] = qr;
    console.log("QR Generated:", sender_id);
  });

  client.on("ready", () => {
    console.log("READY:", sender_id);
    delete qrStore[sender_id];
  });

  client.on("disconnected", (reason) => {
    console.log("DISCONNECTED:", sender_id, reason);
    delete clients[sender_id];

    // AUTO RECONNECT
    setTimeout(() => {
      startClient(sender_id);
    }, 5000);
  });

  client.initialize();
  clients[sender_id] = client;
}

/* ======================
   DEVICE INIT
====================== */
app.post("/device/init", (req, res) => {
  const { sender_id } = req.body;
  if (!sender_id) return res.json({ status: false });

  startClient(sender_id);
  res.json({ status: true });
});

/* ======================
   GET QR
====================== */
app.get("/device/qr/:sender_id", async (req, res) => {
  const qr = qrStore[req.params.sender_id];
  if (!qr) {
    return res.json({ status: false, msg: "QR not available" });
  }

  const qrImg = await QRCode.toDataURL(qr);
  res.json({ status: true, qr: qrImg });
});

/* ======================
   DEVICE STATUS
====================== */
app.get("/device/status/:sender_id", (req, res) => {
  const client = clients[req.params.sender_id];
  if (!client) return res.json({ status: "offline" });

  if (client.info) {
    return res.json({ status: "connected" });
  } else {
    return res.json({ status: "connecting" });
  }
});

/* ======================
   LOGOUT DEVICE
====================== */
app.post("/device/logout", async (req, res) => {
  const { sender_id } = req.body;
  const client = clients[sender_id];
  if (!client) return res.json({ status: false });

  await client.logout();
  delete clients[sender_id];

  res.json({ status: true });
});

/* ======================
   DELETE DEVICE (SESSION REMOVE)
====================== */
app.post("/device/delete", async (req, res) => {
  const { sender_id } = req.body;

  if (clients[sender_id]) {
    await clients[sender_id].destroy();
    delete clients[sender_id];
  }

  const sessionDir = path.join(SESSION_PATH, `session-${sender_id}`);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  res.json({ status: true });
});

/* ======================
   SEND TEXT MESSAGE
====================== */
app.post("/send/text", async (req, res) => {
  const { sender_id, phone, message } = req.body;
  const client = clients[sender_id];

  if (!client) {
    return res.json({ status: false, msg: "Device not connected" });
  }

  await client.sendMessage(`${phone}@c.us`, message);
  res.json({ status: true });
});

/* ======================
   SEND MEDIA
====================== */
app.post("/send/media", async (req, res) => {
  const { sender_id, phone, base64, mimetype, filename, caption } = req.body;
  const client = clients[sender_id];

  if (!client) {
    return res.json({ status: false, msg: "Device not connected" });
  }

  const media = new MessageMedia(mimetype, base64, filename);
  await client.sendMessage(`${phone}@c.us`, media, { caption });

  res.json({ status: true });
});

/* ======================
   AUTO START SAVED SESSIONS
====================== */
if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH);
}

fs.readdirSync(SESSION_PATH, { withFileTypes: true })
  .filter((dir) => dir.isDirectory())
  .forEach((dir) => {
    const sender_id = dir.name.replace("session-", "");
    console.log("Auto starting:", sender_id);
    startClient(sender_id);
  });

/* ======================
   SERVER START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("WhatsApp Engine Running on port", PORT);
});
