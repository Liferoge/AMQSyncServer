const status = document.getElementById("status");

const socket = io();

socket.on("connect", () => {

    console.log("Conectado");

    status.textContent =
        "Conectado\n\nID: " + socket.id;

});

socket.on("disconnect", () => {

    console.log("Desconectado");

    status.textContent =
        "Desconectado";

});
