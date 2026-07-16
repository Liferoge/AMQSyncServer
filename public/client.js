const status = document.getElementById("status");
const logBox = document.getElementById("log");
const playersBox = document.getElementById("players");
const playersCount = document.getElementById("playersCount");
const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const APP_VERSION = "0.3.0";

let socket = null;
let username = "Anônimo";
let roomId = "global";
let identified = false;
let currentSnapshot = null;
let connectionLabel = "Conectando...";

const hasElement = (el) => Boolean(el && typeof el === "object");

const appendLog = (message) => {
  console.log(message);

  if (!hasElement(logBox)) return;

  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBox.prepend(line);
};

const setStatus = (message) => {
  connectionLabel = message;
  renderStatus();
};

const renderStatus = () => {
  if (!hasElement(status)) return;

  const snapshot = currentSnapshot || {};
  const roomLabel = snapshot.roomId || roomId || "global";
  const phase = snapshot.phase || "idle";
  const roundKey = snapshot.roundKey || "-";
  const song = snapshot.currentSong || "-";
  const artist = snapshot.currentArtist || "-";
  const playerCount = Number.isFinite(snapshot.playerCount)
    ? snapshot.playerCount
    : (Array.isArray(snapshot.players) ? snapshot.players.length : 0);

  status.textContent =
    `${connectionLabel}` +
    `\n\nID: ${socket?.id || "-"}` +
    `\nNome: ${username}` +
    `\nSala: ${roomLabel}` +
    `\nFase: ${phase}` +
    `\nRodada: ${roundKey}` +
    `\nMúsica: ${song}` +
    `\nArtista: ${artist}` +
    `\nJogadores: ${playerCount}`;
};

const setConnectedState = () => {
  if (hasElement(sendButton)) sendButton.disabled = false;
  if (hasElement(input)) input.disabled = false;
  if (hasElement(input)) input.focus();
};

const setWaitingState = () => {
  if (hasElement(sendButton)) sendButton.disabled = true;
  if (hasElement(input)) input.disabled = true;
};

const promptValue = (message, fallback) => {
  const value = prompt(message, fallback) ?? fallback;
  return String(value).trim() || fallback;
};

const resolveIdentity = () => {
  username = promptValue("Digite seu nome para entrar no AMQSync:", username);
  roomId = promptValue("Digite a sala para entrar no AMQSync:", roomId || "global");
};

const normalizePlayer = (player) => {
  if (!player || typeof player !== "object") return null;

  return {
    socketId: player.socketId || "",
    playerKey: player.playerKey || player.socketId || "",
    username: player.username || "",
    displayName: player.displayName || player.username || player.socketId || "",
    gamePlayerId: player.gamePlayerId || "",
    teamNumber: Number(player.teamNumber || 1) || 1,
    client: player.client || "browser",
    userscript: player.userscript || "AMQSync",
    version: player.version || APP_VERSION,
    avatar: player.avatar || "",
    identified: Boolean(player.identified),
    roomId: player.roomId || roomId,
    connectedAt: player.connectedAt || "",
    updatedAt: player.updatedAt || ""
  };
};

const renderPlayers = (players = []) => {
  if (hasElement(playersCount)) {
    playersCount.textContent = String(Array.isArray(players) ? players.length : 0);
  }

  if (!hasElement(playersBox)) return;

  playersBox.innerHTML = "";

  const list = Array.isArray(players) ? players.map(normalizePlayer).filter(Boolean) : [];

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhum usuário conectado.";
    playersBox.append(empty);
    return;
  }

  for (const player of list) {
    const card = document.createElement("div");
    card.className = "player";

    const title = document.createElement("strong");
    title.textContent = player.displayName || player.username || player.socketId;

    const meta = document.createElement("div");
    meta.textContent =
      `ID: ${player.socketId}\n` +
      `PlayerKey: ${player.playerKey || "-"}\n` +
      `Estado: ${player.identified ? "Identificado" : "Aguardando"}\n` +
      `Cliente: ${player.client}\n` +
      `Jogo: ${player.gamePlayerId ? `AMQ (${player.gamePlayerId})` : "AMQ"}\n` +
      `Equipe: ${player.teamNumber}\n` +
      `Versão: ${player.version}`;

    card.append(title, meta);
    playersBox.append(card);
  }
};

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return;

  currentSnapshot = snapshot;

  if (Array.isArray(snapshot.players)) {
    renderPlayers(snapshot.players);
  } else if (typeof snapshot.playerCount === "number" && hasElement(playersCount)) {
    playersCount.textContent = String(snapshot.playerCount);
  }

  renderStatus();
};

const bindSocket = () => {
  socket = io();

  identified = false;
  setWaitingState();
  setStatus("Conectando...");

  socket.on("connect", () => {
    resolveIdentity();

    setStatus("Conectado");
    appendLog(`Conectado com ID ${socket.id}`);

    socket.emit("identify", {
      username,
      displayName: username,
      gamePlayerId: "",
      teamNumber: 1,
      roomId,
      client: "browser",
      userscript: "AMQSync",
      version: APP_VERSION,
      avatar: "",
      identified: true
    });
  });

  socket.on("identified", (payload) => {
    identified = true;

    const info = payload?.clientInfo || {};
    username = info.displayName || info.username || username;
    roomId = info.roomId || roomId || "global";

    appendLog(`Identificado como ${username}`);

    if (payload?.room) {
      applySnapshot(payload.room);
    } else {
      renderStatus();
    }

    setConnectedState();
  });

  socket.on("room:snapshot", (snapshot) => {
    applySnapshot(snapshot);
    appendLog(
      `Snapshot da sala ${snapshot?.roomId || roomId} recebido (${snapshot?.playerCount ?? 0} jogadores)`
    );
  });

  socket.on("room:state", (snapshot) => {
    applySnapshot(snapshot);
  });

  socket.on("room:players", (players) => {
    renderPlayers(players);
    renderStatus();
  });

  socket.on("player:joined", (payload) => {
    const name = payload?.player?.displayName || payload?.player?.username || "Desconhecido";
    appendLog(`${name} entrou na sala`);
  });

  socket.on("player:left", (payload) => {
    const name = payload?.player?.displayName || payload?.player?.username || "Desconhecido";
    const reason = payload?.reason ? ` (${payload.reason})` : "";
    appendLog(`${name} saiu da sala${reason}`);
  });

  socket.on("system", (payload) => {
    const text = payload?.text ?? JSON.stringify(payload);
    appendLog(`sistema: ${text}`);
  });

  socket.on("chat", (payload) => {
    const from = payload?.from ?? "desconhecido";
    const text = payload?.text ?? JSON.stringify(payload);
    appendLog(`${from}: ${text}`);
  });

  socket.on("message", (payload) => {
    const from = payload?.from ?? "desconhecido";
    const text = payload?.text ?? JSON.stringify(payload);
    appendLog(`${from}: ${text}`);
  });

  socket.on("draft:update", (payload) => {
    appendLog(
      `draft:${payload?.kind || "song"} ${payload?.playerKey || ""} -> ${payload?.text || ""}`
    );
    if (payload?.roomId && currentSnapshot?.roomId === payload.roomId) {
      socket.emit("state:request");
    }
  });

  socket.on("answer:hash", (payload) => {
    appendLog(
      `hash:${payload?.kind || "song"} ${payload?.playerKey || ""} -> ${payload?.hash || ""}`
    );
  });

  socket.on("answer:submit", (payload) => {
    appendLog(
      `submit:${payload?.kind || "song"} ${payload?.playerKey || ""} -> ${payload?.text || ""}`
    );
  });

  socket.on("answer:reveal", (payload) => {
    appendLog(
      `reveal:${payload?.kind || "song"} ${payload?.playerKey || ""} -> ${payload?.text || ""}`
    );
  });

  socket.on("hint:use", (payload) => {
    appendLog(
      `hint:${payload?.playerKey || ""} -> ${payload?.entityKey || ""}`
    );
  });

  socket.on("score:update", (payload) => {
    appendLog(
      `score:${payload?.playerKey || ""} -> ${JSON.stringify(payload || {})}`
    );
  });

  socket.on("round:update", (payload) => {
    appendLog(
      `round:update -> phase=${payload?.phase || "-"} round=${payload?.roundKey || "-"}`
    );
    if (payload && typeof payload === "object") {
      currentSnapshot = {
        ...(currentSnapshot || {}),
        ...payload
      };
      renderStatus();
    }
  });

  socket.on("disconnect", (reason) => {
    identified = false;
    setWaitingState();
    setStatus(`Desconectado\n\nMotivo: ${reason}`);
    appendLog(`Desconectado: ${reason}`);
  });

  socket.on("connect_error", (error) => {
    identified = false;
    setWaitingState();
    setStatus(`Erro de conexão\n\n${error.message}`);
    appendLog(`Erro de conexão: ${error.message}`);
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    setWaitingState();
    setStatus(`Reconectando...\n\nTentativa: ${attempt}`);
    appendLog(`Tentando reconectar (${attempt})`);
  });

  socket.io.on("reconnect", (attempt) => {
    setStatus(`Reconectado\n\nTentativa: ${attempt}`);
    appendLog(`Reconectado após ${attempt} tentativa(s)`);
    socket.emit("state:request");
    socket.emit("request_players");
  });

  socket.on("room:snapshot", (snapshot) => {
    applySnapshot(snapshot);
  });

  socket.emit("state:request");
  socket.emit("request_players");
};

const sendMessage = () => {
  const text = hasElement(input) ? input.value.trim() : "";
  if (!text) return;

  if (!identified || !socket?.connected) {
    appendLog("Você ainda não está pronto para enviar mensagens.");
    return;
  }

  socket.emit("chat", {
    from: username,
    text,
    at: new Date().toISOString(),
    client: "browser",
    roomId
  });

  appendLog(`eu: ${text}`);

  if (hasElement(input)) {
    input.value = "";
    input.focus();
  }
};

if (hasElement(sendButton)) {
  sendButton.addEventListener("click", sendMessage);
}

if (hasElement(input)) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });
}

bindSocket();