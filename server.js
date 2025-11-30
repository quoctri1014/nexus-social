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
// REMOVE: import Anthropic from '@anthropic-ai/sdk';
// ADD: (Using direct fetch for stability, but require the Google key)
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. CẤU HÌNH & KHỞI TẠO ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : "";
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

// KHÔNG CẦN KHỞI TẠO CLIENT SDK, sử dụng FETCH trực tiếp
if (!GEMINI_API_KEY) {
    console.error("⚠️ CHƯA CẤU HÌNH GEMINI_API_KEY. AI không hoạt động.");
} else {
    console.log("✅ Gemini API Key found.");
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

// --- 2. UPLOAD CONFIG ---
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

let upload;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
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

// ... (Giữ nguyên các API Auth/User/Friends/Groups cũ) ...

// ================= GEMINI AI LOGIC (FIX LỖI 404) =================

// Hàm gọi Google API: Tự động thử các model
async function tryCallGemini(modelName, text) {
    const apiVersion = modelName === "gemini-pro" ? "v1" : "v1beta"; 
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`🤖 Đang thử model: ${modelName} (API ${apiVersion})...`);
    
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`❌ LỖI GOOGLE (${modelName}):`, errText);
        return null; 
    }
    return await response.json();
}

async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY) {
    return socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Chưa cấu hình API Key.", createdAt: new Date() });
  }

  // DANH SÁCH MODEL ĐỂ THỬ (Thứ tự ưu tiên)
  const modelsToTry = [
      "gemini-1.5-flash", // Mới và nhanh (v1beta)
      "gemini-pro",       // Ổn định và cũ (v1)
      "gemini-1.5-pro"    // Mạnh mẽ (v1beta)
  ];

  let data = null;

  for (const model of modelsToTry) {
      try {
          data = await tryCallGemini(model, msg);
          if (data) {
              console.log(`✅ Kết nối thành công với: ${model}`);
              break; 
          }
      } catch (err) {
          console.error(`⚠️ Lỗi ngoại lệ khi gọi ${model}:`, err.message);
      }
  }

  if (data && data.candidates && data.candidates.length > 0) {
      const reply = data.candidates[0].content.parts[0].text;
      const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
      
      socket.emit("newMessage", { id: r.insertId, senderId: AI_BOT_ID, content: reply, createdAt: new Date() });
  } else {
      socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Hệ thống AI đang quá tải. Vui lòng kiểm tra lại Key.", createdAt: new Date() });
  }
}


// --- SOCKET.IO LOGIC ---
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

    if (recipientId === AI_BOT_ID) {
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, AI_BOT_ID, content]);
      socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
      await handleAIChat(content, userId, socket);
      return;
    }

    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content, createdAt: new Date(), ttl };
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl) setTimeout(async () => { await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]); }, ttl);
  });

  // ... (Giữ nguyên các sự kiện Socket.io khác) ...
  
  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running`));
