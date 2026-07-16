import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const DEFAULT_ROOM = "global";
const rooms = new Map();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(publicDir));

app.get("/health", (_, res) => {
  res.status(200).json({
    ok: true,
    service: "AMQSync",
    uptime: process.uptime()
  });
});

app.get("/api/rooms", (_, res) => {
  res.json({
    ok: true,
    rooms: [...rooms.values()].map(serializeRoomSnapshot)
  });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms.get(normalizeRoomId(req.params.roomId));
  if (!room) {
    res.status(404).json({ ok: false, error: "Room not found" });
    return;
  }
  res.json({ ok: true, room: serializeRoomSnapshot(room) });
});

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

function createRoom(roomId) {
  return {
    id: roomId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    players: new Map(),
    state: {
      phase: "idle",
      roundKey: "",
      currentSong: "",
      currentArtist: "",
      teamMode: false,
      metadata: {},
      scores: {},
      drafts: { song: {}, artist: {} },
      submissions: { song: {}, artist: {} },
      hashes: { song: {}, artist: {} },
      reveals: { song: {}, artist: {} },
      hints: {}
    }
  };
}

function getRoom(roomId = DEFAULT_ROOM) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!rooms.has(normalizedRoomId)) {
    rooms.set(normalizedRoomId, createRoom(normalizedRoomId));
  }
  return rooms.get(normalizedRoomId);
}

function touchRoom(room) {
  room.updatedAt = nowIso();
  return room;
}

function mergeBucket(target, patch) {
  const next = { ...target };
  for (const [key, value] of Object.entries(safeObject(patch))) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = { ...(safeObject(target[key])), ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

function applyStatePatch(room, patch = {}) {
  const state = room.state;
  const data = safeObject(patch);

  if ("phase" in data) state.phase = normalizeText(data.phase, "idle");
  if ("roundKey" in data) state.roundKey = normalizeText(data.roundKey, "");
  if ("currentSong" in data) state.currentSong = normalizeText(data.currentSong, "");
  if ("currentArtist" in data) state.currentArtist = normalizeText(data.currentArtist, "");
  if ("teamMode" in data) state.teamMode = Boolean(data.teamMode);

  if ("metadata" in data) {
    state.metadata = { ...safeObject(state.metadata), ...safeObject(data.metadata) };
  }

  if ("scores" in data) state.scores = mergeBucket(state.scores, data.scores);
  if ("drafts" in data) {
    const drafts = safeObject(data.drafts);
    state.drafts = {
      song: mergeBucket(state.drafts.song, drafts.song),
      artist: mergeBucket(state.drafts.artist, drafts.artist)
    };
  }

  if ("submissions" in data) {
    const submissions = safeObject(data.submissions);
    state.submissions = {
      song: mergeBucket(state.submissions.song, submissions.song),
      artist: mergeBucket(state.submissions.artist, submissions.artist)
    };
  }

  if ("hashes" in data) {
    const hashes = safeObject(data.hashes);
    state.hashes = {
      song: mergeBucket(state.hashes.song, hashes.song),
      artist: mergeBucket(state.hashes.artist, hashes.artist)
    };
  }

  if ("reveals" in data) {
    const reveals = safeObject(data.reveals);
    state.reveals = {
      song: mergeBucket(state.reveals.song, reveals.song),
      artist: mergeBucket(state.reveals.artist, reveals.artist)
    };
  }

  if ("hints" in data) {
    state.hints = mergeBucket(state.hints, data.hints);
  }

  touchRoom(room);
}

function buildDefaultClientInfo(socket) {
  return {
    username: socket.data?.clientInfo?.username || socket.id,
    displayName: socket.data?.clientInfo?.displayName || socket.data?.clientInfo?.username || socket.id,
    gamePlayerId: socket.data?.clientInfo?.gamePlayerId || "",
    teamNumber: Number(socket.data?.clientInfo?.teamNumber ?? 1) || 1,
    client: socket.data?.clientInfo?.client || "browser",
    userscript: socket.data?.clientInfo?.userscript || "AMQSync",
    version: socket.data?.clientInfo?.version || "0.2.0",
    avatar: socket.data?.clientInfo?.avatar || "",
    identified: Boolean(socket.data?.clientInfo?.identified),
    connectedAt: socket.data?.clientInfo?.connectedAt || nowIso()
  };
}

function normalizeClientInfo(payload = {}) {
  const data = safeObject(payload);

  const username = normalizeText(data.username, "Anônimo");
  const displayName = normalizeText(data.displayName, username);
  const gamePlayerId = normalizeText(data.gamePlayerId ?? data.playerKey, "");
  const client = normalizeText(data.client, "browser");
  const userscript = normalizeText(data.userscript, "AMQSync");
  const version = normalizeText(data.version, "0.2.0");
  const avatar = normalizeText(data.avatar, "");
  const roomId = normalizeRoomId(data.roomId);
  const teamNumber = Number(data.teamNumber ?? 1) || 1;

  return {
    username,
    displayName,
    gamePlayerId,
    client,
    userscript,
    version,
    avatar,
    teamNumber,
    roomId,
    identified: true,
    connectedAt: nowIso(),
    updatedAt: nowIso()
  };
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

function publicPlayers(room) {
  return [...room.players.values()].map(publicPlayer);
}

function serializeRoomSnapshot(room) {
  return {
    roomId: room.id,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    phase: room.state.phase,
    roundKey: room.state.roundKey,
    currentSong: room.state.currentSong,
    currentArtist: room.state.currentArtist,
    teamMode: room.state.teamMode,
    metadata: room.state.metadata,
    scores: room.state.scores,
    drafts: room.state.drafts,
    submissions: room.state.submissions,
    hashes: room.state.hashes,
    reveals: room.state.reveals,
    hints: room.state.hints,
    players: publicPlayers(room),
    playerCount: room.players.size
  };
}

function broadcastRoomState(room) {
  const snapshot = serializeRoomSnapshot(room);
  io.to(room.id).emit("room:snapshot", snapshot);
  io.to(room.id).emit("room:state", snapshot);
  io.to(room.id).emit("room:players", snapshot.players);
}

function setPlayerScores(room, playerKey, patch = {}) {
  const current = safeObject(room.state.scores[playerKey]);
  room.state.scores[playerKey] = { ...current, ...safeObject(patch) };
}

function setDraft(room, kind, playerKey, payload = {}) {
  const bucket = kind === "artist" ? room.state.drafts.artist : room.state.drafts.song;
  bucket[playerKey] = {
    ...(safeObject(bucket[playerKey])),
    text: normalizeText(payload.text, ""),
    at: normalizeText(payload.at, nowIso()),
    teamOnly: Boolean(payload.teamOnly),
    typing: Boolean(payload.typing)
  };
}

function setSubmission(room, kind, playerKey, payload = {}) {
  const bucket = kind === "artist" ? room.state.submissions.artist : room.state.submissions.song;
  bucket[playerKey] = {
    ...(safeObject(bucket[playerKey])),
    text: normalizeText(payload.text, ""),
    hash: normalizeText(payload.hash, ""),
    timestamp: normalizeText(payload.timestamp, ""),
    roundKey: normalizeText(payload.roundKey, room.state.roundKey),
    at: normalizeText(payload.at, nowIso())
  };
}

function setHash(room, kind, playerKey, payload = {}) {
  const bucket = kind === "artist" ? room.state.hashes.artist : room.state.hashes.song;
  bucket[playerKey] = {
    ...(safeObject(bucket[playerKey])),
    hash: normalizeText(payload.hash, ""),
    timestamp: normalizeText(payload.timestamp, ""),
    roundKey: normalizeText(payload.roundKey, room.state.roundKey),
    at: normalizeText(payload.at, nowIso())
  };
}

function setReveal(room, kind, playerKey, payload = {}) {
  const bucket = kind === "artist" ? room.state.reveals.artist : room.state.reveals.song;
  bucket[playerKey] = {
    ...(safeObject(bucket[playerKey])),
    text: normalizeText(payload.text, ""),
    correct: payload.correct ?? null,
    roundKey: normalizeText(payload.roundKey, room.state.roundKey),
    at: normalizeText(payload.at, nowIso())
  };
}

function addHint(room, playerKey, payload = {}) {
  if (!room.state.hints[playerKey]) {
    room.state.hints[playerKey] = [];
  }

  room.state.hints[playerKey].push({
    roundKey: normalizeText(payload.roundKey, room.state.roundKey),
    artistKey: normalizeText(payload.artistKey, ""),
    hintTs: normalizeText(payload.hintTs, nowIso()),
    entityKey: normalizeText(payload.entityKey, ""),
    at: normalizeText(payload.at, nowIso())
  });
}

function logSocket(message) {
  console.log(`[socket] ${message}`);
}

function removeFromRoom(socket, roomId, reason = "disconnect") {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.get(socket.data.playerKey);
  if (!player) return;

  room.players.delete(socket.data.playerKey);
  touchRoom(room);

  io.to(room.id).emit("player:left", {
    roomId: room.id,
    player: publicPlayer(player),
    reason
  });

  broadcastRoomState(room);

  if (room.players.size === 0 && room.id !== DEFAULT_ROOM) {
    rooms.delete(room.id);
  }
}

function addToRoom(socket, roomId) {
  const room = getRoom(roomId);
  const clientInfo = socket.data.clientInfo || buildDefaultClientInfo(socket);
  const playerKey = socket.data.playerKey || clientInfo.gamePlayerId || socket.id;

  socket.data.playerKey = playerKey;

  const existing = room.players.get(playerKey);

  room.players.set(playerKey, {
    socketId: socket.id,
    playerKey,
    username: clientInfo.username || socket.id,
    displayName: clientInfo.displayName || clientInfo.username || socket.id,
    gamePlayerId: clientInfo.gamePlayerId || "",
    teamNumber: Number(clientInfo.teamNumber ?? 1) || 1,
    client: clientInfo.client || "browser",
    userscript: clientInfo.userscript || "AMQSync",
    version: clientInfo.version || "0.2.0",
    avatar: clientInfo.avatar || "",
    identified: Boolean(clientInfo.identified),
    roomId: room.id,
    connectedAt: existing?.connectedAt || clientInfo.connectedAt || nowIso(),
    updatedAt: nowIso()
  });

  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.clientInfo = {
    ...clientInfo,
    ...room.players.get(playerKey)
  };

  touchRoom(room);
  return room;
}

io.on("connection", (socket) => {
  socket.data.clientInfo = buildDefaultClientInfo(socket);
  socket.data.roomId = DEFAULT_ROOM;
  socket.data.playerKey = socket.id;

  logSocket(`cliente conectado: ${socket.id}`);

  const defaultRoom = addToRoom(socket, DEFAULT_ROOM);

  socket.emit("system", {
    type: "system",
    text: "Conexão aberta. Identifique-se para começar.",
    at: nowIso()
  });

  socket.emit("room:snapshot", serializeRoomSnapshot(defaultRoom));
  socket.emit("room:state", serializeRoomSnapshot(defaultRoom));
  socket.emit("room:players", publicPlayers(defaultRoom));

  socket.on("identify", (payload = {}) => {
    const clientInfo = normalizeClientInfo(payload);
    socket.data.clientInfo = {
      ...socket.data.clientInfo,
      ...clientInfo,
      identified: true
    };

    socket.data.playerKey = clientInfo.gamePlayerId || socket.data.playerKey || socket.id;

    const targetRoomId = clientInfo.roomId;
    if (socket.data.roomId !== targetRoomId) {
      removeFromRoom(socket, socket.data.roomId, "room switch");
    }
    const room = addToRoom(socket, targetRoomId);

    logSocket(`identificado: ${socket.id} => ${clientInfo.displayName} (room: ${room.id})`);

    const player = room.players.get(socket.data.playerKey);

    socket.emit("identified", {
      ok: true,
      clientInfo: player,
      room: serializeRoomSnapshot(room)
    });

    io.to(room.id).emit("player:joined", {
      roomId: room.id,
      player: publicPlayer(player)
    });

    broadcastRoomState(room);
  });

  const joinRoomHandler = (payload = {}) => {
    const roomId = normalizeRoomId(payload.roomId ?? payload);
    if (roomId === socket.data.roomId) {
      return;
    }

    removeFromRoom(socket, socket.data.roomId, "room switch");
    const room = addToRoom(socket, roomId);

    io.to(room.id).emit("player:joined", {
      roomId: room.id,
      player: publicPlayer(room.players.get(socket.data.playerKey))
    });

    broadcastRoomState(room);
  };

  socket.on("join_room", joinRoomHandler);
  socket.on("room:join", joinRoomHandler);

  const leaveRoomHandler = () => {
    removeFromRoom(socket, socket.data.roomId, "leave");
    const room = addToRoom(socket, DEFAULT_ROOM);
    broadcastRoomState(room);
  };

  socket.on("leave_room", leaveRoomHandler);
  socket.on("room:leave", leaveRoomHandler);

  socket.on("request_players", () => {
    const room = getRoom(socket.data.roomId);
    socket.emit("room:players", publicPlayers(room));
  });

  socket.on("players:request", () => {
    const room = getRoom(socket.data.roomId);
    socket.emit("room:players", publicPlayers(room));
  });

  const syncStateHandler = (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    applyStatePatch(room, payload);
    broadcastRoomState(room);
  };

  socket.on("sync_state", syncStateHandler);
  socket.on("room:state", syncStateHandler);
  socket.on("state:update", syncStateHandler);

  socket.on("chat", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const text = typeof payload === "string" ? payload : normalizeText(payload.text, "");
    if (!text) return;

    const from = normalizeText(payload.from, socket.data.clientInfo.displayName || socket.id);

    io.to(room.id).emit("chat", {
      type: "chat",
      roomId: room.id,
      from,
      text,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("message", (payload = {}) => {
    socket.emit("chat", payload);
  });

  socket.on("draft:update", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const kind = payload.kind === "artist" ? "artist" : "song";
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    setDraft(room, kind, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("draft:update", {
      roomId: room.id,
      kind,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("answer:hash", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const kind = payload.kind === "artist" ? "artist" : "song";
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    setHash(room, kind, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("answer:hash", {
      roomId: room.id,
      kind,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("answer:submit", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const kind = payload.kind === "artist" ? "artist" : "song";
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    setSubmission(room, kind, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("answer:submit", {
      roomId: room.id,
      kind,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("answer:reveal", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const kind = payload.kind === "artist" ? "artist" : "song";
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    setReveal(room, kind, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("answer:reveal", {
      roomId: room.id,
      kind,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("hint:use", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    addHint(room, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("hint:use", {
      roomId: room.id,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("score:update", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    const playerKey = normalizeText(payload.playerKey, socket.data.playerKey || socket.id);

    setPlayerScores(room, playerKey, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("score:update", {
      roomId: room.id,
      playerKey,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("round:update", (payload = {}) => {
    const room = getRoom(socket.data.roomId);
    applyStatePatch(room, payload);
    broadcastRoomState(room);
    io.to(room.id).emit("round:update", {
      roomId: room.id,
      ...payload,
      at: normalizeText(payload.at, nowIso())
    });
  });

  socket.on("state:request", () => {
    const room = getRoom(socket.data.roomId);
    const snapshot = serializeRoomSnapshot(room);
    socket.emit("room:snapshot", snapshot);
    socket.emit("room:state", snapshot);
    socket.emit("room:players", publicPlayers(room));
  });

  socket.on("disconnecting", () => {
    removeFromRoom(socket, socket.data.roomId, "disconnect");
  });

  socket.on("disconnect", (reason) => {
    logSocket(`cliente desconectado: ${socket.id} (${reason})`);
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