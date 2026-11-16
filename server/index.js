// エントリーポイント。静的ファイルの配信と WebSocket の受け口だけを担当し、
// ルームやゲームの中身は rooms.js に任せる。

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RoomManager, RoomError } from './rooms.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HEARTBEAT_MS = 25_000;
const MAX_MESSAGES_PER_WINDOW = 40;
const RATE_WINDOW_MS = 5_000;

const manager = new RoomManager();
const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ...manager.stats() });
});

// ビルド工程を持たないので、更新がすぐ反映されるよう毎回サーバーに確認させる。
const staticOptions = { etag: true, lastModified: true, maxAge: 0 };
app.use(express.static(path.join(root, 'public'), staticOptions));
app.use('/shared', express.static(path.join(root, 'shared'), staticOptions));
app.get('/vendor/htm-preact.js', (_req, res) => {
  res.sendFile(path.join(root, 'node_modules/htm/preact/standalone.module.js'));
});
// ルームの URL (/r/ABCD) を直接開いても同じ画面を返す。
app.get('/r/:code', (_req, res) => {
  res.sendFile(path.join(root, 'public/index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // このソケットがどのルームのどの席に結びついているか。
  const session = { room: null, player: null };
  const conn = {
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    rebind(player) {
      session.player = player;
    },
  };

  let windowStart = Date.now();
  let count = 0;

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - windowStart > RATE_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    if (++count > MAX_MESSAGES_PER_WINDOW) return;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'ping') {
      conn.send({ t: 'pong' });
      return;
    }

    if (msg.t === 'create' || msg.t === 'join') {
      if (session.room) return;
      try {
        const room = msg.t === 'create' ? manager.createRoom() : manager.getRoom(msg.code);
        if (!room) {
          conn.send({ t: 'joinFailed', reason: 'notFound', message: 'そのルームは見つかりませんでした' });
          return;
        }
        session.room = room;
        session.player = room.join(conn, msg);
      } catch (err) {
        session.room = null;
        session.player = null;
        const message = err instanceof RoomError ? err.message : '参加できませんでした';
        if (!(err instanceof RoomError)) console.error(err);
        conn.send({ t: 'joinFailed', reason: 'error', message });
      }
      return;
    }

    if (!session.room || !session.player) return;
    if (msg.t === 'leave') {
      const { room, player } = session;
      session.room = null;
      session.player = null;
      room.leave(player);
      return;
    }
    session.room.handle(session.player, msg);
  });

  ws.on('close', () => {
    if (session.room && session.player) session.room.disconnect(session.player, conn);
    session.room = null;
    session.player = null;
  });
  ws.on('error', () => {});
});

// 途中のプロキシに切られないよう定期的に ping を送り、応答のない接続は閉じる。
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

const sweeper = setInterval(() => manager.sweep(), 30_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ボドゲひろば: http://localhost:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(sweeper);
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
