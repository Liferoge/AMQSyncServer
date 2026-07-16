const status = document.getElementById("status");
const logBox = document.getElementById("log");
const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const appendLog = (message) => {
  console.log(message);
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBox.prepend(line);
};

const setStatus = (message) => {
  status.textContent = message;
};

const socket = io();

let username = "Anônimo";
let identified = false;

const setConnectedState = () => {
  sendButton.disabled = false;
  input.disabled = false;
  input.focus();
};

const setWaitingState = () => {
  sendButton.disabled = true;
  input.disabled = true;
};

setWaitingState();

socket.on("connect", () => {
  username = prompt("Digite seu nome para entrar no AMQSync:")?.trim() || "Anônimo";

  setStatus(`Conectado\n\nID: ${socket.id}\nNome: ${username}`);
  appendLog(`Conectado com ID ${socket.id}`);

  socket.emit("identify", {
    username
  });
});

socket.on("identified", (payload) => {
  identified = true;
  username = payload?.username || username;

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

socket.on("message", (payload) => {
  const from = payload?.from ?? "desconhecido";
  const text = payload?.text ?? JSON.stringify(payload);
  appendLog(`${from}: ${text}`);
});

const sendMessage = () => {
  const text = input.value.trim();
  if (!text) return;
  if (!identified) {
    appendLog("Você ainda não foi identificado.");
    return;
  }

  socket.emit("message", {
    from: username,
    text,
    at: new Date().toISOString()
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