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
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. CẤU HÌNH & VỆ SINH API KEY ---
// Thêm .trim() để xóa khoảng trắng thừa nếu lỡ copy paste sai
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : "";
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});
const onlineUsers = {};

app.use(express.static("public"));
app.use(express.json());

// --- 2. UPLOAD CONFIG ---
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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
    params: { folder: "nexus_uploads", resource_type: "auto", allowed_formats: ["jpg", "png", "mp3", "wav", "mp4", "webm"] },
  });
  upload = multer({ storage });
} else {
  console.log("💾 Storage: Local Disk");
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".webm";
      cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
    },
  });
  upload = multer({ storage });
}

// --- 3. HELPER FUNCTIONS ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

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
app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No file" });
  const files = req.files.map((f) => {
    let url = f.path;
    if (!f.path.startsWith("http")) url = `/uploads/${f.filename}`;
    return { type: f.mimetype.includes("image") ? "image" : "audio", name: f.originalname, url: url };
  });
  res.json(files);
});

// Auth & User APIs
app.post("/api/send-otp", async (req, res) => { /* Code gửi OTP cũ */
  const { email, username } = req.body;
  // ... (Giữ nguyên logic cũ để tiết kiệm dòng) ...
  res.json({ message: "OK" });
});
// (Lưu ý: Bạn hãy giữ nguyên các API login/register/me/friends như file cũ nhé, ở đây tôi rút gọn để tập trung vào phần AI)
// Nếu bạn lỡ xóa thì copy lại các API đó từ file server.js trước.
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
// ... (Các API friends, groups, search... giữ nguyên) ...


// ================= SOCKET.IO & AI LOGIC (FIX MỚI) =================

// Hàm gọi Google API (Hỗ trợ thử nhiều model)
async function tryCallGemini(modelName, text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`🤖 Đang thử model: ${modelName}...`);
    
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] })
    });

    if (!response.ok) {
        // Nếu lỗi 404 (Model không tìm thấy), trả về null để thử model khác
        if (response.status === 404) {
            console.warn(`⚠️ Model ${modelName} không tồn tại (404).`);
            return null;
        }
        throw new Error(`Google API Error: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY) {
    return socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Chưa cấu hình API Key.", createdAt: new Date() });
  }

  // DANH SÁCH MODEL ĐỂ THỬ (Ưu tiên Flash -> Pro -> 1.5 Pro)
  const modelsToTry = ["gemini-1.5-flash", "gemini-pro", "gemini-1.5-pro"];
  let reply = "Xin lỗi, tôi đang gặp chút trục trặc.";

  try {
    let data = null;
    // Vòng lặp thử từng model
    for (const model of modelsToTry) {
        try {
            data = await tryCallGemini(model, msg);
            if (data) {
                console.log(`✅ Thành công với model: ${model}`);
                break; // Nếu thành công thì thoát vòng lặp ngay
            }
        } catch (err) {
            console.error(`❌ Lỗi khi gọi ${model}:`, err.message);
        }
    }

    if (data) {
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI không trả lời được câu này.";
    } else {
        reply = "Tất cả các kết nối AI đều thất bại. Vui lòng kiểm tra lại API Key.";
    }

    // Lưu vào DB
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
    
    // Gửi lại Client
    socket.emit("newMessage", {
      id: r.insertId,
      senderId: AI_BOT_ID,
      content: reply,
      createdAt: new Date(),
    });

  } catch (e) {
    console.error("AI Fatal Error:", e);
    socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Lỗi hệ thống AI.", createdAt: new Date() });
  }
}

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
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };

  const sendUserList = async () => {
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
    const list = users.map((u) => ({ ...u, online: !!onlineUsers[u.id] || u.id === AI_BOT_ID }));
    io.emit("userList", list);
  };
  await sendUserList();

  socket.on("privateMessage", async (data) => {
    const { recipientId, content, ttl } = data;
    if (!recipientId || !content) return;

    // AI CHAT
    if (recipientId === AI_BOT_ID) {
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, AI_BOT_ID, content]);
      socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
      await handleAIChat(content, userId, socket);
      return;
    }

    // USER CHAT
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content, createdAt: new Date(), ttl };
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl) setTimeout(async () => { await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]); }, ttl);
  });

  // ... (Giữ nguyên các sự kiện deleteConversation, deleteMessage, loadPrivateHistory, sendHeart, callOffer... như cũ)
  socket.on("deleteConversation", async ({ recipientId }) => {
    await db.query("DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)", [userId, recipientId, recipientId, userId]);
    socket.emit("conversationDeleted", { partnerId: recipientId });
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", { partnerId: userId });
  });
  
  socket.on("deleteMessage", async ({ messageId, recipientId }) => {
    await db.query("DELETE FROM messages WHERE id = ? AND senderId = ?", [messageId, userId]);
    socket.emit("messageDeleted", { messageId });
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", { messageId });
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

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
  // ... (Giữ các sự kiện callAnswer, sendICE, callEnd, callReject, disconnect) ...
  socket.on("callAnswer", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", { ...d, senderId: userId }));
  socket.on("sendICE", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", { ...d, senderId: userId }));
  socket.on("callEnd", (d) => onlineUsers[d.recipientId] && io.to(onlineUsers[d.recipientId].socketId).emit("callEnd"));
  socket.on("callReject", (d) => onlineUsers[d.callerId] && io.to(onlineUsers[d.callerId].socketId).emit("callReject", { senderId: userId }));

  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
