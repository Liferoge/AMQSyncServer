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

const users = new Map();

app.use(express.static(publicDir));

app.get("/health", (_, res) => {
  res.status(200).json({
    ok: true,
    service: "AMQSync",
    uptime: process.uptime()
  });
});

function makeMessage(from, text) {
  return {
    from,
    text,
    at: new Date().toISOString()
  };
}

function getUsername(socket) {
  return users.get(socket.id) || socket.data.username || socket.id;
}

io.on("connection", (socket) => {
  console.log(`[socket] cliente conectado: ${socket.id}`);

  socket.emit("message", makeMessage(
    "server",
    "Conexão aberta. Envie seu nome para identificar o usuário."
  ));

  socket.on("identify", (payload) => {
    const usernameRaw = typeof payload === "string"
      ? payload
      : payload?.username;

    const username = String(usernameRaw || "").trim() || "Anônimo";

    users.set(socket.id, username);
    socket.data.username = username;

    console.log(`[socket] identificado: ${socket.id} => ${username}`);

    socket.emit("identified", {
      ok: true,
      username,
      socketId: socket.id
    });

    socket.broadcast.emit(
      "message",
      makeMessage("server", `${username} entrou na sala`)
    );
  });

  socket.on("message", (payload) => {
    const text = typeof payload === "string"
      ? payload
      : payload?.text ?? JSON.stringify(payload);

    const from = getUsername(socket);

    console.log(`[socket] mensagem recebida de ${socket.id} (${from}): ${text}`);

    io.emit("message", makeMessage(from, text));
  });

  socket.on("disconnect", (reason) => {
    const username = users.get(socket.id) || socket.data.username || socket.id;

    users.delete(socket.id);

    console.log(`[socket] cliente desconectado: ${socket.id} (${reason})`);

    socket.broadcast.emit(
      "message",
      makeMessage("server", `${username} saiu (${reason})`)
    );
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