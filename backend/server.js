const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
app.use("/uploads", express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.get("/healthz", (req, res) => res.status(200).send("OK"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const USERS = {
  alberto:  { username: "alberto",  password: "1234", name: "Alberto IT Cabanyes" },
  carlos:   { username: "carlos",   password: "1234", name: "Carlos IT Torres" },
  javier:   { username: "javier",   password: "1234", name: "Javier IT Arruabarrena" },
  thibaldo: { username: "thibaldo", password: "1234", name: "Thibaldo IT Hermoso" },
  juan:     { username: "juan",     password: "1234", name: "Juan IT Juiña" },
};

const MESSAGES_FILE = path.join(__dirname, "messages.json");
const GROUPS_FILE   = path.join(__dirname, "groups.json");

function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, "[]");
  return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8") || "[]");
}
function saveMessages(msgs) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2)); }
function getConversationId(a, b) { return [a, b].sort().join("__"); }

function loadGroups() {
  if (!fs.existsSync(GROUPS_FILE)) fs.writeFileSync(GROUPS_FILE, "[]");
  return JSON.parse(fs.readFileSync(GROUPS_FILE, "utf8") || "[]");
}
function saveGroups(groups) { fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2)); }

/* ── Routes ── */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

app.get("/users", (req, res) => {
  res.json(Object.values(USERS).map(u => ({ username: u.username, name: u.name })));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];
  if (!user || user.password !== password)
    return res.status(401).json({ error: "Credenciales incorrectas" });
  res.json({ username: user.username, name: user.name });
});

app.get("/messages/:userA/:userB", (req, res) => {
  const id = getConversationId(req.params.userA, req.params.userB);
  res.json(loadMessages().filter(m => m.conversationId === id));
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: "/uploads/" + req.file.filename, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
});

app.get("/groups", (req, res) => {
  const { user } = req.query;
  const groups = loadGroups();
  res.json(user ? groups.filter(g => g.members.includes(user)) : groups);
});

app.post("/groups", (req, res) => {
  const { name, members, createdBy, color } = req.body;
  if (!name || !members || !createdBy) return res.status(400).json({ error: "Faltan campos" });
  const groups = loadGroups();
  const group = { id: `grp_${Date.now()}`, name, members, createdBy, color: color || "#e30613", createdAt: new Date().toISOString() };
  groups.push(group); saveGroups(groups);
  members.forEach(m => io.to(m).emit("group_created", group));
  res.json(group);
});

app.get("/group-messages/:groupId", (req, res) => {
  res.json(loadMessages().filter(m => m.groupId === req.params.groupId));
});

app.delete("/groups/:id", (req, res) => {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Grupo no encontrado" });
  const [removed] = groups.splice(idx, 1);
  saveGroups(groups);
  removed.members.forEach(m => io.to(m).emit("group_deleted", { id: removed.id }));
  res.json({ ok: true });
});

app.put("/groups/:id/members", (req, res) => {
  const { members } = req.body;
  if (!members || !Array.isArray(members)) return res.status(400).json({ error: "Faltan miembros" });
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Grupo no encontrado" });
  const oldMembers = groups[idx].members;
  groups[idx].members = members;
  saveGroups(groups);
  [...new Set([...oldMembers, ...members])].forEach(m => io.to(m).emit("group_updated", groups[idx]));
  res.json(groups[idx]);
});

/* ── Socket.IO ── */
const onlineUsers = {};

io.on("connection", (socket) => {
  socket.on("register", (username) => {
    socket.join(username);
    socket.username = username;
    onlineUsers[username] = "available";
    socket.broadcast.emit("user_status", { username, status: "available" });
    socket.emit("online_users", Object.entries(onlineUsers).map(([u, s]) => ({ username: u, status: s })));
  });

  socket.on("set_status", ({ username, status }) => {
    onlineUsers[username] = status;
    socket.broadcast.emit("user_status", { username, status });
  });

  socket.on("typing", ({ from, to, typing }) => {
    if (to) io.to(to).emit("typing", { from, typing });
  });

  socket.on("private_message", (msg) => {
    const all = loadMessages();
    const saved = {
      id: Date.now(), conversationId: getConversationId(msg.from, msg.to),
      from: msg.from, fromName: msg.fromName, to: msg.to, text: msg.text || "",
      fileUrl: msg.fileUrl || null, fileName: msg.fileName || null, fileType: msg.fileType || null,
      time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toISOString()
    };
    all.push(saved); saveMessages(all);
    io.to(msg.to).emit("private_message", saved);
    io.to(msg.from).emit("private_message", saved);
  });

  socket.on("group_message", (msg) => {
    const all = loadMessages();
    const saved = {
      id: Date.now(), groupId: msg.groupId,
      from: msg.from, fromName: msg.fromName, text: msg.text || "",
      fileUrl: msg.fileUrl || null, fileName: msg.fileName || null, fileType: msg.fileType || null,
      time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toISOString()
    };
    all.push(saved); saveMessages(all);
    const group = loadGroups().find(g => g.id === msg.groupId);
    if (group) group.members.forEach(m => io.to(m).emit("group_message", saved));
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      socket.broadcast.emit("user_status", { username: socket.username, status: "offline" });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Servidor activo en puerto ${PORT}`));
