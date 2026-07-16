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

app.use(express.static(publicDir));

app.get("/health", (_, res) => {
  res.status(200).json({
    ok: true,
    service: "AMQSync",
    uptime: process.uptime()
  });
});

io.on("connection", (socket) => {
  console.log(`[socket] cliente conectado: ${socket.id}`);

  socket.emit("message", {
    from: "server",
    text: "Servidor conectado e aguardando mensagens.",
    at: new Date().toISOString()
  });

  socket.on("message", (payload) => {
    const text = typeof payload === "string"
      ? payload
      : payload?.text ?? JSON.stringify(payload);

    console.log(`[socket] mensagem recebida de ${socket.id}: ${text}`);

    socket.emit("message", {
      from: "server",
      text: `Recebi: ${text}`,
      at: new Date().toISOString()
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] cliente desconectado: ${socket.id} (${reason})`);
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