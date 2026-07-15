import express from "express";

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send(`
        <h1>AMQSync Server</h1>
        <p>Servidor online.</p>
    `);
});

app.listen(PORT, () => {
    console.log(`AMQSync iniciado na porta ${PORT}`);
});
