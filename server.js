import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";

let aiModel = null;
if (GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        aiModel = genAI.getGenerativeModel({ model: "gemini-pro" });
        console.log("✅ AI Model initialized");
    } catch (err) { console.error("AI Error:", err.message); }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, transports: ["websocket", "polling"] });
const onlineUsers = {};

app.use(express.static("public"));
app.use(express.json());

// Cloudinary
if(process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
}
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus_uploads', resource_type: 'auto', allowed_formats: ['jpg', 'png', 'mp3', 'wav', 'mp4'] },
});
const upload = multer({ storage });

const transporter = nodemailer.createTransport({
  service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const otpStore = new Map();

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); });
};

// API ROUTES
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await transporter.sendMail({ from: 'Nexus', to: email, subject: "OTP", html: `<h3>OTP: <b>${otp}</b></h3>` });
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Lỗi mail" }); }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp) return res.status(400).json({ message: "Sai OTP" });
  res.json({ message: "OK" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)", [username, hash, email, nickname, avatar]);
    otpStore.delete(email);
    res.status(201).json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Lỗi DB" }); }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].passwordHash))) return res.status(400).json({ message: "Sai thông tin" });
    const token = jwt.sign({ userId: rows[0].id, username: rows[0].username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "OK", token });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  const [r] = await db.query("SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?", [req.user.userId]);
  res.json(r[0]);
});

app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 0 LIMIT 20", [`%${query}%`, `%${query}%`, req.user.userId]);
    res.json(users);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/profile/update", authenticateToken, async (req, res) => {
  const { nickname, avatar, bio, location, work, education } = req.body;
  try {
    await db.query(`UPDATE users SET nickname=?, avatar=?, bio=?, location=?, work=?, education=? WHERE id=?`, [nickname, avatar, bio, location, work, education, req.user.userId]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try {
    const [u] = await db.query(`SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 0 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`, [req.user.userId, req.user.userId, req.user.userId]);
    res.json(u);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, username, nickname, avatar, bio, location, work, education FROM users WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: "Not found" });
    const [posts] = await db.query(`SELECT * FROM posts WHERE userId = ? ORDER BY createdAt DESC`, [req.params.id]);
    res.json({ user: rows[0], posts: posts });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/friends", authenticateToken, async (req, res) => {
  try {
    const [f] = await db.query(`SELECT u.id, u.username, u.nickname, u.avatar FROM users u JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ?`, [req.user.userId, req.user.userId, req.user.userId]);
    res.json(f);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/friends/pending", authenticateToken, async (req, res) => {
  try {
    const [reqs] = await db.query(`SELECT fr.id as requestId, u.id as userId, u.username, u.nickname, u.avatar FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`, [req.user.userId]);
    res.json(reqs);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try {
    await db.query("INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)", [req.user.userId, req.body.receiverId]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Duplicate" }); }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    await db.query("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [req.body.requestId]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/posts", authenticateToken, async (req, res) => {
  try {
    const [posts] = await db.query(`SELECT p.*, u.username, u.nickname, u.avatar FROM posts p JOIN users u ON p.userId = u.id ORDER BY p.createdAt DESC LIMIT 50`);
    res.json(posts);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/posts", authenticateToken, async (req, res) => {
  try {
    await db.query("INSERT INTO posts (userId, content, image) VALUES (?, ?, ?)", [req.user.userId, req.body.content, req.body.image]);
    res.json({ message: "Posted" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/stories", authenticateToken, async (req, res) => {
  try {
    const [s] = await db.query("SELECT s.*, u.username, u.nickname, u.avatar FROM stories s JOIN users u ON s.userId = u.id WHERE s.createdAt >= NOW() - INTERVAL 1 DAY ORDER BY s.createdAt DESC");
    res.json(s);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/stories", authenticateToken, async (req, res) => {
  try {
    await db.query("INSERT INTO stories (userId, image, expiresAt) VALUES (?, ?, ?)", [req.user.userId, req.body.image, new Date(Date.now() + 86400000)]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files) return res.status(400).json({ message: "No file" });
  const files = req.files.map(f => ({ type: f.mimetype.includes("image") ? "image" : "audio", name: f.originalname, url: f.path }));
  res.json(files);
});

app.get("/api/notifications", authenticateToken, async (req, res) => {
    try {
        const uid = req.user.userId;
        const [reqs] = await db.query(`SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' as type FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`, [uid]);
        res.json(reqs);
    } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!members.includes(creatorId)) members.push(creatorId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query("INSERT INTO groups (name, creatorId) VALUES (?, ?)", [name, creatorId]);
    const values = members.map(uid => [g.insertId, uid]);
    if(values.length > 0) await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [values]);
    await conn.commit();
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [g.insertId]);
    members.forEach(uid => {
        if (onlineUsers[uid]) {
            io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
            const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
            if(s) s.join(`group_${g.insertId}`);
        }
    });
    res.json({ message: "OK" });
  } catch (e) { await conn.rollback(); res.status(500).json({ message: "Error" }); } finally { conn.release(); }
});

// SOCKET
async function handleAIChat(msg, uid, socket) {
    if(!aiModel) return socket.emit("newMessage", {senderId:0, content:"AI chưa sẵn sàng.", createdAt:new Date()});
    try {
        const result = await aiModel.generateContent(msg);
        const reply = result.response.text();
        const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (0, ?, ?)", [uid, reply]);
        socket.emit("newMessage", { id: r.insertId, senderId: 0, content: reply, createdAt: new Date() });
    } catch(e) { socket.emit("newMessage", { senderId:0, content:"AI bận.", createdAt:new Date() }); }
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return next(new Error("Auth Error")); socket.user = user; next(); });
});

io.on("connection", async (socket) => {
  const { userId } = socket.user;
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };

  const sendUserList = async () => {
      const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
      const list = users.map(u => ({...u, online: !!onlineUsers[u.id] || u.id===0 }));
      io.emit("userList", list);
  };
  await sendUserList();

  // --- CHAT & SECRET ---
  socket.on("privateMessage", async (data) => {
    const content = data.content;
    const recipientId = data.recipientId;
    const ttl = data.ttl; // Time to live (ms)

    if (recipientId === undefined || recipientId === null || !content) return;

    if (recipientId === 0) {
        await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, 0, ?)", [userId, content]);
        socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
        await handleAIChat(content, userId, socket);
        return;
    }
    
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content: content, createdAt: new Date(), ttl: ttl };
    
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);

    // TỰ ĐỘNG XÓA DB NẾU CÓ TTL (SECRET MODE)
    if (ttl && ttl > 0) {
        setTimeout(async () => {
            await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]);
        }, ttl);
    }
  });

  // --- DELETE CONVERSATION (XÓA CẢ 2 BÊN) ---
  socket.on("deleteConversation", async ({ recipientId }) => {
      await db.query("DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)", [userId, recipientId, recipientId, userId]);
      
      // Báo cho mình xóa UI
      socket.emit("conversationDeleted", { partnerId: recipientId });
      
      // Báo cho đối phương xóa UI
      if (onlineUsers[recipientId]) {
          io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", { partnerId: userId });
      }
  });
  
  // --- DELETE SINGLE MESSAGE ---
  socket.on("deleteMessage", async ({ messageId, recipientId }) => {
      await db.query("DELETE FROM messages WHERE id = ? AND senderId = ?", [messageId, userId]);
      socket.emit("messageDeleted", { messageId });
      if (onlineUsers[recipientId]) {
          io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", { messageId });
      }
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  // --- HEART & CALL ---
  socket.on("sendHeart", ({ recipientId }) => {
      if (onlineUsers[recipientId]) {
          io.to(onlineUsers[recipientId].socketId).emit("heartAnimation");
      }
  });

  socket.on("callOffer", async (d) => {
    if(!d.recipientId && d.recipientId !== 0) return;
    const rec = onlineUsers[d.recipientId];
    if (rec) {
        const [u] = await db.query("SELECT username, nickname, avatar FROM users WHERE id=?", [userId]);
        let avt = u[0].avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u[0].nickname)}`;
        io.to(rec.socketId).emit("callOffer", { ...d, senderId: userId, senderName: u[0].nickname||u[0].username, senderAvatar: avt });
    } else {
        const c = JSON.stringify({ type: "system", text: "📞 Cuộc gọi nhỡ" });
        await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, d.recipientId, c]);
        socket.emit("userOffline", { userId: d.recipientId });
    }
  });

  socket.on("callAnswer", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", { ...d, senderId: userId }));
  socket.on("sendICE", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", { ...d, senderId: userId }));
  socket.on("callEnd", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callEnd"));
  socket.on("callReject", (d) => onlineUsers[d.callerId] && io.to(onlineUsers[d.callerId].socketId).emit("callReject", { senderId: userId, reason: d.reason }));

  socket.on("disconnect", () => { delete onlineUsers[userId]; sendUserList(); });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running`));
