const status = document.getElementById("status");
const log = (message) => {
  console.log(message);
  status.textContent = message;
};

const socket = io();

socket.on("connect", () => {
  log(`Conectado\n\nID: ${socket.id}`);
});

socket.on("disconnect", (reason) => {
  log(`Desconectado\n\nMotivo: ${reason}`);
});

socket.on("connect_error", (error) => {
  log(`Erro de conexão\n\n${error.message}`);
});

socket.io.on("reconnect_attempt", (attempt) => {
  log(`Reconectando...\n\nTentativa: ${attempt}`);
});

socket.io.on("reconnect", (attempt) => {
  log(`Reconectado\n\nTentativa: ${attempt}`);
});