import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import nodemailer from "nodemailer";

// --- THƯ VIỆN AI (BẢN ỔN ĐỊNH) ---
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- CLOUDINARY (LƯU TRỮ TRÊN MÂY) ---
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// ==========================================
// 1. CẤU HÌNH HỆ THỐNG (CONFIG)
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lấy Key từ biến môi trường
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";

// Khởi tạo AI (GoogleGenerativeAI)
let aiModel = null;
if (GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        aiModel = genAI.getGenerativeModel({ model: "gemini-pro" });
        console.log("✅ AI Model initialized");
    } catch (err) {
        console.error("AI Init Error:", err.message);
    }
} else {
    console.warn("⚠️ Thiếu GEMINI_API_KEY - Chatbot sẽ không hoạt động.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

// Lưu user online: { userId: { socketId, username } }
const onlineUsers = {};

app.use(express.static("public"));
app.use(express.json());

// ==========================================
// 2. CẤU HÌNH UPLOAD (CLOUDINARY)
// ==========================================

// Kiểm tra cấu hình Cloudinary trước khi khởi tạo
if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.warn("⚠️ Thiếu cấu hình Cloudinary. Tính năng Upload sẽ lỗi.");
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus_uploads',
    resource_type: 'auto', // Tự động nhận diện ảnh/video/âm thanh
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webm', 'mp3', 'wav', 'mp4'],
  },
});

const upload = multer({ storage: storage });

// Cấu hình Email
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const otpStore = new Map();

// ==========================================
// 3. MIDDLEWARE XÁC THỰC
// ==========================================
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ==========================================
// 4. API AUTH & USER
// ==========================================
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Email hoặc User đã tồn tại!" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });

    await transporter.sendMail({
      from: '"Nexus App" <no-reply@nexus.com>',
      to: email,
      subject: "Mã xác thực Nexus",
      html: `<h3>Mã OTP: <b style="color:#1877f2;">${otp}</b></h3>`,
    });
    res.json({ message: "Đã gửi OTP!" });
  } catch (e) {
    console.error("Mail Error:", e);
    res.status(500).json({ message: "Lỗi gửi mail." });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp)
    return res.status(400).json({ message: "OTP sai/hết hạn." });
  res.json({ message: "OTP đúng!" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  if (!otpStore.has(email)) return res.status(400).json({ message: "Hết hạn." });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)", [username, hash, email, nickname, avatar]);
    otpStore.delete(email);
    res.status(201).json({ message: "Thành công!" });
  } catch (e) {
    res.status(500).json({ message: "Lỗi DB." });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(400).json({ message: "Sai thông tin." });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "OK", token });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, username, nickname, email, avatar FROM users WHERE id = ?", [req.user.userId]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 0 LIMIT 20", [`%${query}%`, `%${query}%`, req.user.userId]);
    res.json(users);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

// ==========================================
// 5. API UPLOAD (CLOUDINARY)
// ==========================================
app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No file" });
  
  const files = req.files.map((f) => ({
    // Cloudinary trả về path là URL tuyệt đối
    type: f.mimetype ? (f.mimetype.startsWith("image") ? "image" : "audio") : "file",
    name: f.originalname,
    url: f.path, 
  }));
  res.json(files);
});

// ==========================================
// 6. API GROUP
// ==========================================
app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!members.includes(creatorId)) members.push(creatorId);
  
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query("INSERT INTO groups (name, creatorId) VALUES (?, ?)", [name, creatorId]);
    
    // Chuẩn bị mảng 2 chiều cho Bulk Insert
    const values = members.map(uid => [g.insertId, uid]);
    await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [values]);
    
    await conn.commit();
    
    // Thông báo Realtime
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [g.insertId]);
    members.forEach(uid => {
        if (onlineUsers[uid]) {
            io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
            const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
            if(s) s.join(`group_${g.insertId}`);
        }
    });
    res.json({ message: "OK" });
  } catch (e) {
    await conn.rollback();
    console.error("Group Error:", e);
    res.status(500).json({ message: "Error" });
  } finally { conn.release(); }
});

// ==========================================
// 7. SOCKET.IO (CHAT & CALL & AI)
// ==========================================

async function handleAIChat(msg, uid, socket) {
  if (!aiModel) {
      socket.emit("newMessage", { senderId: 0, content: "AI chưa được cấu hình.", createdAt: new Date() });
      return;
  }
  try {
    const [hist] = await db.query("SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=0) OR (senderId=0 AND recipientId=?) ORDER BY createdAt DESC LIMIT 6", [uid, uid]);
    let history = hist.reverse().map((m) => ({
      role: m.senderId === uid ? "user" : "model",
      parts: [{ text: m.content }],
    }));
    history.push({ role: "user", parts: [{ text: msg }] });

    const result = await aiModel.generateContent({ contents: history });
    const reply = result.response.text();

    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (0, ?, ?)", [uid, reply]);
    socket.emit("newMessage", { id: r.insertId, senderId: 0, content: reply, createdAt: new Date() });
  } catch (e) {
    console.error("AI Error:", e);
    socket.emit("newMessage", { senderId: 0, content: "AI đang bận, thử lại sau.", createdAt: new Date() });
  }
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Auth Error"));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error("Auth Error"));
    socket.user = user;
    next();
  });
});

io.on("connection", async (socket) => {
  const { userId, username } = socket.user;
  onlineUsers[userId] = { socketId: socket.id, username };
  console.log(`User ${username} connected`);

  // Gửi danh sách user + trạng thái online
  const sendUserList = async () => {
      const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
      const userList = users.map((u) => ({
        userId: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar,
        online: !!onlineUsers[u.id] || u.id === 0,
      }));
      io.emit("userList", userList);
  };
  await sendUserList();

  // CHAT 1-1
  socket.on("privateMessage", async (data) => {
    if (data.recipientId === 0) {
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, 0, ?)", [userId, data.content]);
      socket.emit("newMessage", { senderId: userId, content: data.content, createdAt: new Date() });
      await handleAIChat(data.content, userId, socket);
      return;
    }
    
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, data.recipientId, data.content]);
    const msg = { id: r.insertId, senderId: userId, content: data.content, createdAt: new Date() };
    
    if (onlineUsers[data.recipientId]) {
      io.to(onlineUsers[data.recipientId].socketId).emit("newMessage", msg);
    }
    socket.emit("newMessage", msg);
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  // --- WEBRTC SIGNALING (CÓ TÊN & AVATAR) ---
  socket.on("callOffer", async (d) => {
    const recipientSocket = onlineUsers[d.recipientId];
    if (recipientSocket) {
        const [rows] = await db.query("SELECT username, nickname, avatar FROM users WHERE id=?", [userId]);
        const caller = rows[0];
        const callerName = caller.nickname || caller.username;
        let callerAvatar = caller.avatar;
        
        if (!callerAvatar || (!callerAvatar.startsWith('http') && !callerAvatar.startsWith('/'))) {
             callerAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(callerName)}`;
        }

        io.to(recipientSocket.socketId).emit("callOffer", {
            ...d,
            senderId: userId,
            senderName: callerName,
            senderAvatar: callerAvatar
        });
    } else {
        // NGƯỜI NHẬN OFFLINE
        const missedCallContent = JSON.stringify({ type: "system", text: "📞 Cuộc gọi nhỡ" });
        await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, d.recipientId, missedCallContent]);
        socket.emit("userOffline", { userId: d.recipientId });
    }
  });

  socket.on("callAnswer", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", { ...d, senderId: userId });
  });

  socket.on("sendICE", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", { ...d, senderId: userId });
  });

  socket.on("callEnd", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("callEnd");
  });

  socket.on("callReject", (d) => {
    if (onlineUsers[d.callerId])
      io.to(onlineUsers[d.callerId].socketId).emit("callReject", { senderId: userId, reason: d.reason });
  });

  socket.on("disconnect", async () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

// Fallback Route
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running`));
