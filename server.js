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
import Anthropic from '@anthropic-ai/sdk'; // SDK của Claude
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. CẤU HÌNH & KHỞI TẠO CLAUDE ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // Khóa API Claude
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

// Khởi tạo Anthropic Client
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
if (!anthropic) {
    console.error("⚠️ CHƯA CẤU HÌNH ANTHROPIC_API_KEY. Claude AI không hoạt động.");
} else {
    console.log("✅ Claude AI Client initialized.");
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

app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await transporter.sendMail({ from: "Nexus", to: email, subject: "OTP", html: `<h3>OTP: <b>${otp}</b></h3>` });
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Lỗi mail" }); }
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

// ... (Các route API khác được giữ nguyên) ...

// --- CLAUDE AI CHAT LOGIC ---
async function handleAIChat(msg, uid, socket) {
  if (!anthropic) {
    return socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Chưa cấu hình API Key cho Claude AI.", createdAt: new Date() });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620', // Model mạnh mẽ và mới nhất
      max_tokens: 1024,
      system: "Bạn là trợ lý AI thân thiện, sẵn sàng giúp đỡ và trả lời các câu hỏi bằng tiếng Việt.", // Định nghĩa vai trò của AI
      messages: [
        { 
          role: "user", 
          content: msg 
        }
      ],
    });

    // Lấy kết quả từ phản hồi của Claude
    const reply = response.content[0].text; 

    // Lưu vào DB
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
    
    // Gửi phản hồi qua Socket
    socket.emit("newMessage", {
      id: r.insertId,
      senderId: AI_BOT_ID,
      content: reply,
      createdAt: new Date(),
    });

  } catch (e) {
    console.error("Claude API Error:", e.message);
    let errorMessage = "Lỗi kết nối Claude. Vui lòng kiểm tra API Key và Quota.";
    
    // Xử lý lỗi xác thực
    if (e.message && (e.message.includes("401") || e.message.includes("403"))) {
        errorMessage = "Lỗi xác thực: ANTHROPIC_API_KEY không hợp lệ hoặc bị vô hiệu hóa.";
    }
    
    socket.emit("newMessage", { senderId: AI_BOT_ID, content: errorMessage, createdAt: new Date() });
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

    // Xử lý AI Chat
    if (recipientId === AI_BOT_ID) {
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, AI_BOT_ID, content]);
      socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
      await handleAIChat(content, userId, socket);
      return;
    }

    // Xử lý User Chat (giữ nguyên logic cũ)
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content, createdAt: new Date(), ttl };
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl) setTimeout(async () => { await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]); }, ttl);
  });

  socket.on("deleteConversation", async ({ recipientId }) => {
    await db.query("DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)", [userId, recipientId, recipientId, userId]);
    socket.emit("conversationDeleted", { partnerId: recipientId });
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", { partnerId: userId });
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [userId, recipientId, recipientId, userId]);
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  socket.on("callOffer", async (d) => {
    const rec = onlineUsers[d.recipientId];
    if (rec) {
      const [u] = await db.query("SELECT username, nickname, avatar FROM users WHERE id=?", [userId]);
      const avt = u[0].avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u[0].nickname)}`;
      io.to(rec.socketId).emit("callOffer", { ...d, senderId: userId, senderName: u[0].nickname || u[0].username, senderAvatar: avt });
    }
  });

  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running`));
