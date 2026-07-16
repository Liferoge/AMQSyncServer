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

const DEFAULT_ROOM = "global";
const rooms = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeRoomId(value) {
  const roomId = String(value ?? "").trim();
  return roomId || DEFAULT_ROOM;
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getRoom(roomId = DEFAULT_ROOM) {
  const id = normalizeRoomId(roomId);

  if (!rooms.has(id)) {
    rooms.set(id, {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      players: new Map(),
      state: {
        phase: "idle",
        roundKey: "",
        currentSong: "",
        currentArtist: "",
        teamMode: false,
        scores: {},
        drafts: { song: {}, artist: {} },
        submissions: { song: {}, artist: {} },
        hashes: { song: {}, artist: {} },
        reveals: { song: {}, artist: {} },
        hints: {}
      }
    });
  }

  return rooms.get(id);
}

function touchRoom(room) {
  room.updatedAt = nowIso();
}

function publicPlayer(player) {
  return {
    socketId: player.socketId,
    playerKey: player.playerKey,
    username: player.username,
    displayName: player.displayName,
    gamePlayerId: player.gamePlayerId,
    teamNumber: player.teamNumber,
    client: player.client,
    userscript: player.userscript,
    version: player.version,
    avatar: player.avatar,
    identified: player.identified,
    roomId: player.roomId,
    connectedAt: player.connectedAt,
    updatedAt: player.updatedAt
  };
}

function roomSnapshot(room) {
  return {
    roomId: room.id,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    phase: room.state.phase,
    roundKey: room.state.roundKey,
    currentSong: room.state.currentSong,
    currentArtist: room.state.currentArtist,
    teamMode: room.state.teamMode,
    scores: room.state.scores,
    drafts: room.state.drafts,
    submissions: room.state.submissions,
    hashes: room.state.hashes,
    reveals: room.state.reveals,
    hints: room.state.hints,
    players: [...room.players.values()].map(publicPlayer),
    playerCount: room.players.size
  };
}

function normalizeClientInfo(payload = {}) {
  const data = safeObject(payload);

  const username = normalizeText(data.username, "Anônimo");
  const displayName = normalizeText(data.displayName, username);
  const gamePlayerId = normalizeText(data.gamePlayerId ?? data.playerKey, "");
  const teamNumber = Number(data.teamNumber ?? 1) || 1;

  return {
    username,
    displayName,
    gamePlayerId,
    teamNumber,
    client: normalizeText(data.client, "browser"),
    userscript: normalizeText(data.userscript, "AMQSync"),
    version: normalizeText(data.version, "1.0.0"),
    avatar: normalizeText(data.avatar, ""),
    roomId: normalizeRoomId(data.roomId),
    identified: true,
    connectedAt: nowIso(),
    updatedAt: nowIso()
  };
}

function attachPlayer(socket, info) {
  const room = getRoom(info.roomId);
  const playerKey = info.gamePlayerId || socket.id;

  const player = {
    socketId: socket.id,
    playerKey,
    ...info,
    roomId: room.id
  };

  socket.data.roomId = room.id;
  socket.data.playerKey = playerKey;
  socket.data.clientInfo = player;

  room.players.set(playerKey, player);
  touchRoom(room);
  socket.join(room.id);

  return { room, player };
}

function removePlayer(socket) {
  const roomId = socket.data.roomId;
  const playerKey = socket.data.playerKey;

  if (!roomId || !playerKey) return;

  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.get(playerKey);
  if (!player) return;

  room.players.delete(playerKey);
  touchRoom(room);

  io.to(room.id).emit("player:left", {
    player: publicPlayer(player),
    reason: "disconnect"
  });

  io.to(room.id).emit("room:players", [...room.players.values()].map(publicPlayer));
  io.to(room.id).emit("room:snapshot", roomSnapshot(room));
}

function patchRoomState(room, event, payload, playerKey) {
  const data = safeObject(payload);

  if (event === "round:update") {
    if ("phase" in data) room.state.phase = normalizeText(data.phase, room.state.phase);
    if ("roundKey" in data) room.state.roundKey = normalizeText(data.roundKey, room.state.roundKey);
    if ("teamMode" in data) room.state.teamMode = Boolean(data.teamMode);
    if ("currentSong" in data) room.state.currentSong = normalizeText(data.currentSong, room.state.currentSong);
    if ("currentArtist" in data) room.state.currentArtist = normalizeText(data.currentArtist, room.state.currentArtist);
  }

  if (event === "score:update") {
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) room.state.scores[key] = { ...(safeObject(room.state.scores[key])), ...data };
  }

  if (event === "draft:update") {
    const kind = data.kind === "artist" ? "artist" : "song";
    const bucket = kind === "artist" ? room.state.drafts.artist : room.state.drafts.song;
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) {
      bucket[key] = {
        text: normalizeText(data.text, ""),
        at: data.at || nowIso(),
        typing: Boolean(data.typing),
        teamOnly: Boolean(data.teamOnly)
      };
    }
  }

  if (event === "answer:hash") {
    const kind = data.kind === "artist" ? "artist" : "song";
    const bucket = kind === "artist" ? room.state.hashes.artist : room.state.hashes.song;
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) {
      bucket[key] = {
        hash: normalizeText(data.hash, ""),
        timestamp: normalizeText(data.timestamp, ""),
        at: data.at || nowIso()
      };
    }
  }

  if (event === "answer:submit") {
    const kind = data.kind === "artist" ? "artist" : "song";
    const bucket = kind === "artist" ? room.state.submissions.artist : room.state.submissions.song;
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) {
      bucket[key] = {
        text: normalizeText(data.text, ""),
        at: data.at || nowIso(),
        roundKey: normalizeText(data.roundKey, room.state.roundKey)
      };
    }
  }

  if (event === "answer:reveal") {
    const kind = data.kind === "artist" ? "artist" : "song";
    const bucket = kind === "artist" ? room.state.reveals.artist : room.state.reveals.song;
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) {
      bucket[key] = {
        text: normalizeText(data.text, ""),
        correct: data.correct ?? null,
        at: data.at || nowIso(),
        roundKey: normalizeText(data.roundKey, room.state.roundKey)
      };
    }
  }

  if (event === "hint:use") {
    const key = normalizeText(data.playerKey ?? playerKey, "");
    if (key) {
      if (!Array.isArray(room.state.hints[key])) room.state.hints[key] = [];
      room.state.hints[key].push({
        roundKey: normalizeText(data.roundKey, room.state.roundKey),
        artistKey: normalizeText(data.artistKey ?? data.entityKey, ""),
        hintTs: normalizeText(data.hintTs, ""),
        entityKey: normalizeText(data.entityKey, ""),
        at: data.at || nowIso()
      });
    }
  }

  touchRoom(room);
}

io.on("connection", (socket) => {
  socket.on("identify", (payload = {}) => {
    const info = normalizeClientInfo(payload);
    const { room, player } = attachPlayer(socket, info);

    socket.emit("identified", {
      ok: true,
      clientInfo: player,
      room: roomSnapshot(room)
    });

    io.to(room.id).emit("room:players", [...room.players.values()].map(publicPlayer));
    io.to(room.id).emit("room:snapshot", roomSnapshot(room));
    socket.to(room.id).emit("player:joined", { player: publicPlayer(player) });
  });

  socket.on("state:request", () => {
    const room = getRoom(socket.data.roomId || DEFAULT_ROOM);

    socket.emit("identified", {
      ok: true,
      clientInfo: socket.data.clientInfo || null,
      room: roomSnapshot(room)
    });

    socket.emit("room:snapshot", roomSnapshot(room));
    socket.emit("room:state", roomSnapshot(room));
    socket.emit("room:players", [...room.players.values()].map(publicPlayer));
  });

  socket.on("request_players", () => {
    const room = getRoom(socket.data.roomId || DEFAULT_ROOM);
    socket.emit("room:players", [...room.players.values()].map(publicPlayer));
  });

  socket.onAny((event, payload) => {
    if (event === "identify" || event === "state:request" || event === "request_players") {
      return;
    }

    const roomId = socket.data.roomId || normalizeRoomId(payload?.roomId);
    const room = getRoom(roomId);
    const playerKey = socket.data.playerKey || socket.id;

    const publicPayload = {
      ...(safeObject(payload)),
      roomId: room.id,
      playerKey,
      player: socket.data.clientInfo?.displayName || socket.id,
      displayName: socket.data.clientInfo?.displayName || socket.id,
      teamNumber: socket.data.clientInfo?.teamNumber || 1
    };

    patchRoomState(room, event, publicPayload, playerKey);
    io.to(room.id).emit(event, publicPayload);

    if (
      event === "draft:update" ||
      event === "answer:hash" ||
      event === "answer:submit" ||
      event === "answer:reveal" ||
      event === "hint:use" ||
      event === "score:update" ||
      event === "round:update"
    ) {
      io.to(room.id).emit("room:state", roomSnapshot(room));
    }
  });

  socket.on("disconnect", () => {
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  console.log(`AMQSyncServer listening on http://localhost:${PORT}`);
});