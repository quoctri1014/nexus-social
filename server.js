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

// THƯ VIỆN AI & CLOUD
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";

// AI INIT
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

// CLOUDINARY
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

// EMAIL
const transporter = nodemailer.createTransport({
  service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const otpStore = new Map();

// MIDDLEWARE
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); });
};

// API (Giữ nguyên các API Auth/Upload/Group cũ)
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

app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files) return res.status(400).json({ message: "No file" });
  const files = req.files.map(f => ({ type: f.mimetype.includes("image") ? "image" : "audio", name: f.originalname, url: f.path }));
  res.json(files);
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

// --- SOCKET.IO (PHẦN QUAN TRỌNG) ---

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
  
  // 1. Lưu User Online
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };
  console.log(`User ${socket.user.username} connected`);

  // 2. Gửi danh sách User ngay lập tức (Broadcast)
  const broadcastUserList = async () => {
      const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
      const list = users.map(u => ({
          userId: u.id,
          username: u.username,
          nickname: u.nickname,
          avatar: u.avatar,
          online: !!onlineUsers[u.id] || u.id === 0 // AI luôn online
      }));
      io.emit("userList", list); // Gửi cho tất cả mọi người
  };
  await broadcastUserList(); // Gọi ngay khi có người vào

  socket.on("privateMessage", async (data) => {
    const content = data.content;
    const recipientId = data.recipientId;

    if (recipientId === undefined || recipientId === null || !content) return;

    if (recipientId === 0) {
        await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, 0, ?)", [userId, content]);
        socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
        await handleAIChat(content, userId, socket);
        return;
    }
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content: content, createdAt: new Date() };
    
    if (onlineUsers[recipientId]) {
      io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    }
    socket.emit("newMessage", msg);
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  // WebRTC
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

  socket.on("disconnect", async () => {
      delete onlineUsers[userId];
      await broadcastUserList(); // Cập nhật lại list khi có người thoát
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running`));
