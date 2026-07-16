const status = document.getElementById("status");
const logBox = document.getElementById("log");
const playersBox = document.getElementById("players");
const playersCount = document.getElementById("playersCount");
const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const STORAGE_KEY = "amqsync.username";
const APP_VERSION = "0.2.0";

let socket = null;
let username = "";
let identified = false;

const appendLog = (message) => {
  console.log(message);

  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBox.prepend(line);
};

const setStatus = (message) => {
  status.textContent = message;
};

const setConnectedState = () => {
  sendButton.disabled = false;
  input.disabled = false;
  input.focus();
};

const setWaitingState = () => {
  sendButton.disabled = true;
  input.disabled = true;
};

const getStoredUsername = () => {
  return (localStorage.getItem(STORAGE_KEY) || "").trim();
};

const resolveUsername = () => {
  const stored = getStoredUsername();
  if (stored) return stored;

  const typed = prompt("Digite seu nome para entrar no AMQSync:")?.trim() || "Anônimo";
  localStorage.setItem(STORAGE_KEY, typed);
  return typed;
};

const saveUsername = (value) => {
  const clean = String(value || "").trim() || "Anônimo";
  localStorage.setItem(STORAGE_KEY, clean);
  return clean;
};

const renderPlayers = (players = []) => {
  playersCount.textContent = String(players.length);
  playersBox.innerHTML = "";

  if (!players.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhum usuário conectado.";
    playersBox.append(empty);
    return;
  }

  for (const player of players) {
    const card = document.createElement("div");
    card.className = "player";

    const title = document.createElement("strong");
    title.textContent = player.displayName || player.username || player.socketId;

    const meta = document.createElement("div");
    meta.textContent =
      `ID: ${player.socketId}\n` +
      `Estado: ${player.identified ? "Identificado" : "Aguardando identificação"}\n` +
      `Cliente: ${player.client || "browser"}\n` +
      `Jogo: ${player.game || "AMQ"}\n` +
      `Versão: ${player.version || "-"}`;

    card.append(title, meta);
    playersBox.append(card);
  }
};

const bindSocket = () => {
  socket = io();
  identified = false;
  setWaitingState();

  socket.on("connect", () => {
    username = saveUsername(resolveUsername());

    setStatus(`Conectado\n\nID: ${socket.id}\nNome: ${username}`);
    appendLog(`Conectado com ID ${socket.id}`);

    socket.emit("identify", {
      username,
      client: "browser",
      userscript: "AMQSync",
      game: "AMQ",
      version: APP_VERSION
    });
  });

  socket.on("identified", (payload) => {
    identified = true;

    const info = payload?.clientInfo || {};
    username = saveUsername(info.username || username);

    setStatus(`Conectado\n\nID: ${socket.id}\nNome: ${username}`);
    appendLog(`Identificado como ${username}`);

    setConnectedState();
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

  socket.on("players", renderPlayers);
};

const sendMessage = () => {
  const text = input.value.trim();
  if (!text) return;

  if (!identified || !socket?.connected) {
    appendLog("Você ainda não está pronto para enviar mensagens.");
    return;
  }

  socket.emit("chat", {
    from: username,
    text,
    at: new Date().toISOString(),
    client: "browser"
  });

  appendLog(`eu: ${text}`);
  input.value = "";
  input.focus();
};

sendButton.addEventListener("click", sendMessage);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

bindSocket();