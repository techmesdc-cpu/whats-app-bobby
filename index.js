const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs-extra');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ===============================
   STORAGE
================================ */
const clients = {};
const qrStore = {};

/* ===============================
   INIT CLIENT
================================ */
function initClient(sessionId) {
    if (clients[sessionId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        }
    });

    client.on('qr', async (qr) => {
        qrStore[sessionId] = await QRCode.toDataURL(qr);
        console.log(`QR Generated: ${sessionId}`);
    });

    client.on('ready', () => {
        qrStore[sessionId] = null;
        console.log(`Client Ready: ${sessionId}`);
    });

    client.on('authenticated', () => {
        console.log(`Authenticated: ${sessionId}`);
    });

    client.on('disconnected', (reason) => {
        console.log(`Disconnected ${sessionId}: ${reason}`);
        client.destroy();
        delete clients[sessionId];
        setTimeout(() => initClient(sessionId), 5000);
    });

    client.initialize();
    clients[sessionId] = client;
}

/* ===============================
   CREATE SESSION
================================ */
app.post('/session/create', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.json({ status: false, message: 'sessionId required' });
    }
    initClient(sessionId);
    res.json({ status: true, message: 'Session started' });
});

/* ===============================
   GET QR
================================ */
app.get('/session/qr/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    if (!qrStore[sessionId]) {
        return res.json({
            status: false,
            message: 'QR not available / already scanned'
        });
    }

    res.json({
        status: true,
        qr: qrStore[sessionId]
    });
});

/* ===============================
   SEND MESSAGE
================================ */
app.post('/send-message', async (req, res) => {
    const { sessionId, number, message } = req.body;

    if (!clients[sessionId]) {
        return res.json({ status: false, message: 'Invalid session' });
    }

    try {
        const chatId = number.includes('@c.us')
            ? number
            : `${number}@c.us`;

        await clients[sessionId].sendMessage(chatId, message);

        res.json({ status: true, message: 'Message sent' });
    } catch (err) {
        res.json({ status: false, error: err.message });
    }
});

/* ===============================
   LOGOUT SESSION
================================ */
app.post('/session/logout', async (req, res) => {
    const { sessionId } = req.body;

    if (!clients[sessionId]) {
        return res.json({ status: false, message: 'Session not found' });
    }

    await clients[sessionId].logout();
    clients[sessionId].destroy();
    delete clients[sessionId];

    fs.removeSync(`.wwebjs_auth/session-${sessionId}`);

    res.json({ status: true, message: 'Logged out & device removed' });
});

/* ===============================
   LIST SESSIONS
================================ */
app.get('/sessions', (req, res) => {
    res.json({ active_sessions: Object.keys(clients) });
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
    console.log(`WhatsApp API running on port ${PORT}`);
});
