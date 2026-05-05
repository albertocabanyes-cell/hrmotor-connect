const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const USERS = {
  alberto: { username: "alberto", password: "1234", name: "Alberto IT Cabanyes" },
  carlos: { username: "carlos", password: "1234", name: "Carlos IT Torres" },
  javier: { username: "javier", password: "1234", name: "Javier IT Arruabarrena" },
  thibaldo: { username: "thibaldo", password: "1234", name: "Thibaldo IT Hermoso" },
  juan: { username: "juan", password: "1234", name: "Juan IT Juiña" },
  
};

const MESSAGES_FILE = path.join(__dirname, "messages.json");

function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, "[]");
  }

  const data = fs.readFileSync(MESSAGES_FILE, "utf8");
  return JSON.parse(data || "[]");
}

function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function getConversationId(userA, userB) {
  return [userA, userB].sort().join("__");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});;


app.get("/users", (req, res) => {
  const list = Object.values(USERS).map(u => ({
    username: u.username,
    name: u.name
  }));

  res.json(list);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  res.json({
    username: user.username,
    name: user.name
  });
});

app.get("/messages/:userA/:userB", (req, res) => {
  const { userA, userB } = req.params;
  const conversationId = getConversationId(userA, userB);

  const messages = loadMessages().filter(
    msg => msg.conversationId === conversationId
  );

  res.json(messages);
});

io.on("connection", (socket) => {
  console.log("Usuario conectado");

  socket.on("register", (username) => {
    socket.join(username);
  });

  socket.on("private_message", (msg) => {
    const allMessages = loadMessages();

    const savedMessage = {
      id: Date.now(),
      conversationId: getConversationId(msg.from, msg.to),
      from: msg.from,
      fromName: msg.fromName,
      to: msg.to,
      text: msg.text,
      time: new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit"
      }),
      date: new Date().toISOString()
    };

    allMessages.push(savedMessage);
    saveMessages(allMessages);

    io.to(msg.to).emit("private_message", savedMessage);
    io.to(msg.from).emit("private_message", savedMessage);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado");
  });
});

server.listen(3000, () => {
  console.log("Servidor en http://127.0.0.1:3000");
});