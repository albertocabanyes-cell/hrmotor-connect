const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch(err => console.error("MongoDB error:", err));

/* ── Schemas ── */
const MsgSchema = new mongoose.Schema({
  id: Number, conversationId: String, groupId: String,
  from: String, fromName: String, to: String, text: String,
  fileUrl: String, fileName: String, fileType: String, fileSize: Number,
  time: String, date: String,
  edited: { type: Boolean, default: false },
  editHistory: [{ text: String, editedAt: String }]
}, { versionKey: false });

const GroupSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String, members: [String], admins: [String],
  createdBy: String, color: String, createdAt: String
}, { versionKey: false });

const ProfileSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  nombre: String, apellidos: String, email: String,
  telefono: String, dpto: String, delegacion: String, avatarUrl: String,
  lastSeen: String, role: String
}, { versionKey: false });

const AdminSchema = new mongoose.Schema({
  key: { type: String, default: "admins" },
  list: [String]
}, { versionKey: false });

const ExtraUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String, name: String
}, { versionKey: false });

const Msg       = mongoose.model("Message",   MsgSchema);
const Group     = mongoose.model("Group",     GroupSchema);
const Profile   = mongoose.model("Profile",   ProfileSchema);
const AdminDoc  = mongoose.model("Admin",     AdminSchema);
const ExtraUser = mongoose.model("ExtraUser", ExtraUserSchema);

/* ── Usuarios base ── */
const USERS = {
  alberto:  { username: "alberto",  password: "1234", name: "Alberto IT Cabanyes" },
  carlos:   { username: "carlos",   password: "1234", name: "Carlos IT Torres" },
  javier:   { username: "javier",   password: "1234", name: "Javier IT Arruabarrena" },
  thibaldo: { username: "thibaldo", password: "1234", name: "Thibaldo IT Hermoso" },
  juan:     { username: "juan",     password: "1234", name: "Juan IT Juiña" },
};

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function convId(a, b) { return [a, b].sort().join("__"); }

/* ── Routes ── */
app.get("/healthz", (req, res) => res.status(200).send("OK"));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

app.get("/profiles", async (req, res) => {
  const docs = await Profile.find().lean();
  const result = {};
  docs.forEach(p => { const { _id, ...rest } = p; result[p.username] = rest; });
  res.json(result);
});

app.put("/profile/:username", async (req, res) => {
  const profile = await Profile.findOneAndUpdate(
    { username: req.params.username },
    { $set: { ...req.body, username: req.params.username } },
    { upsert: true, new: true, lean: true }
  );
  io.emit("profile_updated", { username: req.params.username, profile });
  res.json(profile);
});

app.get("/admins", async (req, res) => {
  let doc = await AdminDoc.findOne({ key: "admins" });
  if (!doc) doc = await AdminDoc.create({ key: "admins", list: ["alberto"] });
  res.json(doc.list);
});

app.put("/admins", async (req, res) => {
  const { admins } = req.body;
  if (!Array.isArray(admins)) return res.status(400).json({ error: "Invalid" });
  if (!admins.includes("alberto")) admins.unshift("alberto");
  await AdminDoc.findOneAndUpdate({ key: "admins" }, { list: admins }, { upsert: true });
  io.emit("admins_updated", admins);
  res.json(admins);
});

app.get("/users", async (req, res) => {
  const extra = await ExtraUser.find().lean();
  const base = Object.values(USERS).map(u => ({ username: u.username, name: u.name }));
  const extraMapped = extra.filter(u => !USERS[u.username]).map(u => ({ username: u.username, name: u.name }));
  res.json([...base, ...extraMapped]);
});

app.post("/users", async (req, res) => {
  const { username, password, name, email, telefono, dpto, delegacion } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña obligatorios" });
  if (USERS[username]) return res.status(409).json({ error: "Usuario ya existe" });
  if (await ExtraUser.findOne({ username })) return res.status(409).json({ error: "Usuario ya existe" });
  const hashedPassword = await bcrypt.hash(password, 12);
  const newUser = await ExtraUser.create({ username, password: hashedPassword, name: name || username });
  if (email || telefono || dpto || delegacion) {
    const parts = (name || "").split(" ");
    await Profile.findOneAndUpdate({ username }, {
      $set: { username, nombre: parts[0]||"", apellidos: parts.slice(1).join(" ")||"",
              email: email||"", telefono: telefono||"", dpto: dpto||"", delegacion: delegacion||"" }
    }, { upsert: true });
  }
  io.emit("user_created", { username, name: newUser.name });
  res.json({ username, name: newUser.name });
});

app.delete("/users/:username", async (req, res) => {
  const { username } = req.params;
  if (USERS[username]) return res.status(403).json({ error: "No se puede eliminar un usuario base" });
  const deleted = await ExtraUser.findOneAndDelete({ username });
  if (!deleted) return res.status(404).json({ error: "Usuario no encontrado" });
  await Profile.deleteOne({ username });
  io.emit("user_deleted", { username });
  res.json({ ok: true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  // Usuarios base (hardcoded)
  const baseUser = USERS[username];
  if (baseUser) {
    if (baseUser.password !== password)
      return res.status(401).json({ error: "Credenciales incorrectas" });
    return res.json({ username: baseUser.username, name: baseUser.name });
  }
  // Usuarios extra (MongoDB)
  const user = await ExtraUser.findOne({ username }).lean();
  if (!user) return res.status(401).json({ error: "Credenciales incorrectas" });
  // Soporta contraseñas antiguas en texto plano y nuevas hasheadas
  const isHash = user.password.startsWith("$2");
  const valid = isHash
    ? await bcrypt.compare(password, user.password)
    : user.password === password;
  if (!valid) return res.status(401).json({ error: "Credenciales incorrectas" });
  // Migración automática: si era texto plano, actualizar a hash
  if (!isHash) {
    const hashed = await bcrypt.hash(password, 12);
    await ExtraUser.updateOne({ username }, { password: hashed });
  }
  res.json({ username: user.username, name: user.name });
});

app.get("/messages/:userA/:userB", async (req, res) => {
  const msgs = await Msg.find({ conversationId: convId(req.params.userA, req.params.userB) }).sort({ date: 1 }).lean();
  res.json(msgs);
});

app.put("/messages/:id", async (req, res) => {
  const { text, username } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "El texto no puede estar vacío" });
  const msg = await Msg.findOne({ id: Number(req.params.id) });
  if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });
  if (msg.from !== username) return res.status(403).json({ error: "No puedes editar este mensaje" });
  const ageSeconds = (Date.now() - new Date(msg.date).getTime()) / 1000;
  if (ageSeconds > 60) return res.status(403).json({ error: "El tiempo para editar este mensaje ha expirado (1 minuto)" });
  // Guardar versión anterior en historial
  msg.editHistory.push({ text: msg.text, editedAt: new Date().toISOString() });
  msg.text = text.trim();
  msg.edited = true;
  await msg.save();
  const out = msg.toObject();
  // Notificar a los participantes en tiempo real
  if (msg.conversationId) {
    const [userA, userB] = msg.conversationId.split("__");
    io.to(userA).emit("message_edited", out);
    io.to(userB).emit("message_edited", out);
  } else if (msg.groupId) {
    const group = await Group.findOne({ id: msg.groupId }).lean();
    if (group) group.members.forEach(m => io.to(m).emit("message_edited", out));
  }
  res.json(out);
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: "/uploads/" + req.file.filename, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
});

app.get("/groups", async (req, res) => {
  const { user } = req.query;
  const groups = await Group.find(user ? { members: user } : {}).lean();
  res.json(groups);
});

app.post("/groups", async (req, res) => {
  const { name, members, createdBy, color } = req.body;
  if (!name || !members || !createdBy) return res.status(400).json({ error: "Faltan campos" });
  const group = await Group.create({ id: `grp_${Date.now()}`, name, members, admins: [createdBy], createdBy, color: color || "#e30613", createdAt: new Date().toISOString() });
  members.forEach(m => io.to(m).emit("group_created", group));
  res.json(group);
});

app.get("/group-messages/:groupId", async (req, res) => {
  const msgs = await Msg.find({ groupId: req.params.groupId }).sort({ date: 1 }).lean();
  res.json(msgs);
});

app.delete("/groups/:id", async (req, res) => {
  const group = await Group.findOneAndDelete({ id: req.params.id }).lean();
  if (!group) return res.status(404).json({ error: "Grupo no encontrado" });
  group.members.forEach(m => io.to(m).emit("group_deleted", { id: group.id }));
  res.json({ ok: true });
});

app.put("/groups/:id/members", async (req, res) => {
  const { members, admins, name } = req.body;
  if (!members || !Array.isArray(members)) return res.status(400).json({ error: "Faltan miembros" });
  const group = await Group.findOne({ id: req.params.id });
  if (!group) return res.status(404).json({ error: "Grupo no encontrado" });
  const oldMembers = [...group.members];
  group.members = members;
  if (admins !== undefined) group.admins = admins;
  if (name && name.trim()) group.name = name.trim();
  await group.save();
  const updated = group.toObject();
  [...new Set([...oldMembers, ...members])].forEach(m => io.to(m).emit("group_updated", updated));
  res.json(updated);
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

  socket.on("private_message", async (msg) => {
    const saved = await Msg.create({
      id: Date.now(), conversationId: convId(msg.from, msg.to),
      from: msg.from, fromName: msg.fromName, to: msg.to, text: msg.text || "",
      fileUrl: msg.fileUrl || null, fileName: msg.fileName || null,
      fileType: msg.fileType || null, fileSize: msg.fileSize || null,
      time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toISOString()
    });
    const out = saved.toObject();
    io.to(msg.to).emit("private_message", out);
    io.to(msg.from).emit("private_message", out);
  });

  socket.on("group_message", async (msg) => {
    const saved = await Msg.create({
      id: Date.now(), groupId: msg.groupId,
      from: msg.from, fromName: msg.fromName, text: msg.text || "",
      fileUrl: msg.fileUrl || null, fileName: msg.fileName || null,
      fileType: msg.fileType || null, fileSize: msg.fileSize || null,
      time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toISOString()
    });
    const out = saved.toObject();
    const group = await Group.findOne({ id: msg.groupId }).lean();
    if (group) group.members.forEach(m => io.to(m).emit("group_message", out));
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      const lastSeen = new Date().toISOString();
      delete onlineUsers[socket.username];
      socket.broadcast.emit("user_status", { username: socket.username, status: "offline", lastSeen });
      Profile.findOneAndUpdate(
        { username: socket.username },
        { $set: { lastSeen } },
        { upsert: true }
      ).catch(() => {});
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Servidor activo en puerto ${PORT}`));
