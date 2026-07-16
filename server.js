import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const defaultClientInfo = {
  username: null,
  avatar: "",
  game: "AMQ",
  version: "0.2.0",
  userscript: "AMQSync",
  client: "browser",
  identified: false
};

app.use(express.static(publicDir));

app.get("/health", (_, res) => {
  res.status(200).json({
    ok: true,
    service: "AMQSync",
    uptime: process.uptime()
  });
});

function now() {
  return new Date().toISOString();
}

function makeEvent(type, from, text, extra = {}) {
  return {
    type,
    from,
    text,
    at: now(),
    ...extra
  };
}

function makeSystemMessage(text) {
  return makeEvent("system", "server", text);
}

function makeChatMessage(from, text, extra = {}) {
  return makeEvent("chat", from, text, extra);
}

function normalizeClientInfo(payload) {
  if (typeof payload === "string") {
    payload = { username: payload };
  }

  const username = String(payload?.username ?? "").trim() || "Anônimo";

  return {
    username,
    avatar: String(payload?.avatar ?? "").trim(),
    game: String(payload?.game ?? "AMQ").trim() || "AMQ",
    version: String(payload?.version ?? "0.2.0").trim() || "0.2.0",
    userscript: String(payload?.userscript ?? "AMQSync").trim() || "AMQSync",
    client: String(payload?.client ?? "browser").trim() || "browser",
    identified: true
  };
}

function getClientInfo(socket) {
  return {
    ...defaultClientInfo,
    ...(socket.data.clientInfo ?? {})
  };
}

function serializePlayer(socket) {
  const info = getClientInfo(socket);
  const displayName = info.username?.trim()
    ? info.username
    : `Sem nome (${socket.id.slice(0, 6)})`;

  return {
    socketId: socket.id,
    username: info.username,
    displayName,
    avatar: info.avatar,
    game: info.game,
    version: info.version,
    userscript: info.userscript,
    client: info.client,
    identified: Boolean(info.identified)
  };
}

function getPlayers() {
  return [...io.sockets.sockets.values()].map(serializePlayer);
}

function broadcastPlayers() {
  io.emit("players", getPlayers());
}

io.on("connection", (socket) => {
  socket.data.clientInfo = {
    ...defaultClientInfo
  };

  console.log(`[socket] cliente conectado: ${socket.id}`);

  socket.emit(
    "system",
    makeSystemMessage("Conexão aberta. Identifique-se com seu nome.")
  );

  socket.emit("players", getPlayers());

  socket.on("identify", (payload) => {
    const clientInfo = normalizeClientInfo(payload);

    socket.data.clientInfo = {
      ...getClientInfo(socket),
      ...clientInfo,
      identified: true,
      socketId: socket.id
    };

    console.log(
      `[socket] identificado: ${socket.id} => ${socket.data.clientInfo.username}`
    );

    socket.emit("identified", {
      ok: true,
      clientInfo: {
        ...socket.data.clientInfo,
        socketId: socket.id
      }
    });

    socket.broadcast.emit(
      "system",
      makeSystemMessage(`${socket.data.clientInfo.username} entrou.`)
    );

    broadcastPlayers();
  });

  const handleChat = (payload) => {
    const text = typeof payload === "string"
      ? payload
      : payload?.text ?? "";

    const cleanText = String(text).trim();
    if (!cleanText) return;

    const from = getClientInfo(socket).username || socket.id;

    console.log(`[socket] chat de ${socket.id} (${from}): ${cleanText}`);

    io.emit(
      "chat",
      makeChatMessage(from, cleanText, {
        socketId: socket.id
      })
    );
  };

  socket.on("chat", handleChat);
  socket.on("message", handleChat); // compatibilidade com as etapas anteriores

  socket.on("request_players", () => {
    socket.emit("players", getPlayers());
  });

  socket.on("disconnect", (reason) => {
    const clientInfo = getClientInfo(socket);
    const username = clientInfo.username || socket.id;

    console.log(`[socket] cliente desconectado: ${socket.id} (${reason})`);

    socket.broadcast.emit(
      "system",
      makeSystemMessage(`${username} saiu (${reason})`)
    );

    setTimeout(() => {
      broadcastPlayers();
    }, 0);
  });
});

const PORT = Number(process.env.PORT) || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AMQSync iniciado na porta ${PORT}`);
});

function shutdown(signal) {
  console.log(`[server] recebendo ${signal}, encerrando...`);

  server.close(() => {
    console.log("[server] encerrado com sucesso");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[server] encerramento forçado após timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));