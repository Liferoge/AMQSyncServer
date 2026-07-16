import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

io.on("connection", (socket) => {
  socket.data.roomId = "global";

  socket.on("join", (payload = {}) => {
    const roomId = asText(payload.roomId ?? payload, "global");
    socket.leave(socket.data.roomId);
    socket.data.roomId = roomId;
    socket.join(roomId);

    socket.emit("joined", { roomId, socketId: socket.id });
    socket.to(roomId).emit("system", {
      type: "join",
      socketId: socket.id,
      roomId,
      at: new Date().toISOString()
    });
  });

  socket.on("message", (payload = {}) => {
    const roomId = asText(payload.roomId ?? socket.data.roomId, "global");
    const message = asText(payload.message, "");
    const player = asText(payload.player, socket.id);

    if (!message) return;

    socket.join(roomId);
    socket.to(roomId).emit("message", {
      player,
      message,
      roomId,
      socketId: socket.id,
      at: new Date().toISOString()
    });

    socket.emit("message:ack", {
      ok: true,
      roomId,
      at: new Date().toISOString()
    });
  });

  socket.on("disconnect", (reason) => {
    const roomId = socket.data.roomId || "global";
    socket.to(roomId).emit("system", {
      type: "disconnect",
      socketId: socket.id,
      roomId,
      reason,
      at: new Date().toISOString()
    });
  });
});

server.listen(PORT, () => {
  console.log(`AMQSyncServer listening on http://localhost:${PORT}`);
});