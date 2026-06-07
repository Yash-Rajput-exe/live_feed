require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = Number(process.env.PORT) || 3000;
const publicPath = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.static(publicPath));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'live-camera-stream' });
});

app.get('/broadcast', (req, res) => {
  res.sendFile(path.join(publicPath, 'broadcast.html'));
});

app.get('/viewer', (req, res) => {
  res.sendFile(path.join(publicPath, 'viewer.html'));
});

registerSocketHandlers(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Live Camera Stream running at http://localhost:${PORT}`);
});
