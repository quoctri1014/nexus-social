import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import path from "path";
import fs from "fs"; // QUAN TRỌNG: Để tạo thư mục uploads
import { fileURLToPath } from "url";
import multer from "multer";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CẤU HÌNH CƠ BẢN ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1; // ID của AI trong Database là 1

// --- KHỞI TẠO AI ---
let aiModel = null;
if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    aiModel = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log("✅ AI Model initialized");
  } catch (err) {
    console.error("⚠️ AI Error:", err.message);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});
const onlineUsers = {};

app.use(express.static("public"));
app.use(express.json());

// --- XỬ LÝ UPLOAD (FIX LỖI 500) ---
// 1. Tạo thư mục uploads nếu chưa có
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Cấu hình Multer (Tự động chọn Cloudinary hoặc Local)
let upload;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  console.log("☁️  Storage: Cloudinary");
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: "nexus_uploads",
      resource_type: "auto",
      allowed_formats: ["jpg", "png", "jpeg", "mp3", "wav", "mp4", "webm"],
    },
  });
  upload = multer({ storage });
} else {
  console.log("💾 Storage: Local Disk (public/uploads)");
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      // Đặt tên file unique để tránh trùng
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname) || ".webm"; // Mặc định webm cho voice nếu thiếu đuôi
      cb(null, uniqueSuffix + ext);
    },
  });
  upload = multer({ storage });
}

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const otpStore = new Map();

// --- MIDDLEWARE AUTH ---
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ================= API ROUTES =================

// 1. API Upload (Đã fix đường dẫn file)
app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No file uploaded" });

  const files = req.files.map((f) => {
    // Nếu là Local Storage, f.path là đường dẫn tuyệt đối -> Cần chuyển thành URL tương đối
    let url = f.path;
    if (!f.path.startsWith("http")) {
      url = `/uploads/${f.filename}`;
    }
    return {
      type: f.mimetype.includes("image") ? "image" : "audio",
      name: f.originalname,
      url: url,
    };
  });
  res.json(files);
});

// 2. Auth APIs
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Email hoặc Username đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await transporter.sendMail({ from: "Nexus", to: email, subject: "Mã xác thực OTP", html: `<h3>Mã OTP của bạn là: <b>${otp}</b></h3>` });
    res.json({ message: "OK" });
  } catch (e) { console.error(e); res.status(500).json({ message: "Lỗi gửi mail" }); }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp) return res.status(400).json({ message: "OTP không đúng hoặc đã hết hạn" });
  res.json({ message: "OK" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)", [username, hash, email, nickname, avatar]);
    otpStore.delete(email);
    res.status(201).json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Lỗi Database" }); }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].passwordHash))) return res.status(400).json({ message: "Sai tên đăng nhập hoặc mật khẩu" });
    const token = jwt.sign({ userId: rows[0].id, username: rows[0].username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "OK", token });
  } catch (e) { res.status(500).json({ message: "Lỗi Server" }); }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  const [r] = await db.query("SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?", [req.user.userId]);
  res.json(r[0]);
});

// 3. User & Friends APIs
app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 1 LIMIT 20", [`%${query}%`, `%${query}%`, req.user.userId]);
    res.json(users);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try {
    // Gợi ý user chưa kết bạn
    const [u] = await db.query(`SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`, [req.user.userId, req.user.userId, req.user.userId]);
    res.json(u);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/friends", authenticateToken, async (req, res) => {
  try {
    const [f] = await db.query(`SELECT u.id, u.username, u.nickname, u.avatar FROM users u JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ?`, [req.user.userId, req.user.userId, req.user.userId]);
    res.json(f);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const [reqs] = await db.query(`SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' as type FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`, [req.user.userId]);
    res.json(reqs);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try {
    await db.query("INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)", [req.user.userId, req.body.receiverId]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Đã gửi lời mời rồi" }); }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    await db.query("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [req.body.requestId]);
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

// 4. Group API
app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!members.includes(creatorId)) members.push(creatorId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query("INSERT INTO groups (name, creatorId) VALUES (?, ?)", [name, creatorId]);
    const values = members.map((uid) => [g.insertId, uid]);
    if (values.length > 0) await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [values]);
    await conn.commit();
    
    // Notify online users
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [g.insertId]);
    members.forEach((uid) => {
      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
        const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
        if (s) s.join(`group_${g.insertId}`);
      }
    });
    res.json({ message: "OK" });
  } catch (e) { await conn.rollback(); res.status(500).json({ message: "Error" }); } finally { conn.release(); }
});

// ================= SOCKET.IO LOGIC =================

// Helper: Xử lý chat AI
async function handleAIChat(msg, uid, socket) {
  if (!aiModel)
    return socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Hệ thống AI đang bảo trì hoặc chưa cấu hình API Key.", createdAt: new Date() });
  
  try {
    const result = await aiModel.generateContent(msg);
    const reply = result.response.text();
    // Lưu tin nhắn AI vào DB (ID = 1)
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
    socket.emit("newMessage", {
      id: r.insertId,
      senderId: AI_BOT_ID,
      content: reply,
      createdAt: new Date(),
    });
  } catch (e) {
    socket.emit("newMessage", { senderId: AI_BOT_ID, content: "AI đang bận, vui lòng thử lại sau.", createdAt: new Date() });
  }
}

// Middleware Socket Auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error("Auth Error"));
    socket.user = user;
    next();
  });
});

io.on("connection", async (socket) => {
  const { userId } = socket.user;
  // Lưu user vào map onlineUsers
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };

  // Gửi danh sách user online cho tất cả
  const sendUserList = async () => {
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
    const list = users.map((u) => ({
      ...u,
      online: !!onlineUsers[u.id] || u.id === AI_BOT_ID, // AI luôn online
    }));
    io.emit("userList", list);
  };
  await sendUserList();

  // 1. Private Message
  socket.on("privateMessage", async (data) => {
    const { recipientId, content, ttl } = data;
    if (!recipientId || !content) return;

    // Chat với AI
    if (recipientId === AI_BOT_ID) {
      // Lưu câu hỏi của user
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, AI_BOT_ID, content]);
      // Phản hồi ngay lập tức để hiện trên UI
      socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
      // Gọi AI xử lý
      await handleAIChat(content, userId, socket);
      return;
    }

    // Chat người với người
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = {
      id: r.insertId,
      senderId: userId,
      content: content,
      createdAt: new Date(),
      ttl: ttl,
    };

    // Gửi cho người nhận nếu online
    if (onlineUsers[recipientId]) {
        io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    }
    // Gửi lại cho người gửi (để hiện lên UI)
    socket.emit("newMessage", msg);

    // Xử lý tin nhắn tự hủy (Secret Mode)
    if (ttl && ttl > 0) {
      setTimeout(async () => {
        await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]);
      }, ttl);
    }
  });

  // 2. Load History
  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  // 3. Delete Conversation
  socket.on("deleteConversation", async ({ recipientId }) => {
    await db.query("DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)", [userId, recipientId, recipientId, userId]);
    socket.emit("conversationDeleted", { partnerId: recipientId });
    if (onlineUsers[recipientId]) {
      io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", { partnerId: userId });
    }
  });

  // 4. Delete Single Message
  socket.on("deleteMessage", async ({ messageId, recipientId }) => {
    await db.query("DELETE FROM messages WHERE id = ? AND senderId = ?", [messageId, userId]);
    socket.emit("messageDeleted", { messageId });
    if (onlineUsers[recipientId]) {
      io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", { messageId });
    }
  });

  // 5. Heart & Call Signals
  socket.on("sendHeart", ({ recipientId }) => {
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("heartAnimation");
  });

  socket.on("callOffer", async (d) => {
      const rec = onlineUsers[d.recipientId];
      if (rec) {
        const [u] = await db.query("SELECT username, nickname, avatar FROM users WHERE id=?", [userId]);
        const avt = u[0].avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u[0].nickname)}`;
        io.to(rec.socketId).emit("callOffer", { ...d, senderId: userId, senderName: u[0].nickname || u[0].username, senderAvatar: avt });
      }
  });
  socket.on("callAnswer", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", { ...d, senderId: userId }));
  socket.on("sendICE", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", { ...d, senderId: userId }));
  socket.on("callEnd", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callEnd"));
  socket.on("callReject", (d) => onlineUsers[d.callerId] && io.to(onlineUsers[d.callerId].socketId).emit("callReject", { senderId: userId }));

  // Disconnect
  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
