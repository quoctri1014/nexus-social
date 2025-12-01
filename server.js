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
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CẤU HÌNH API ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;
const GOOGLE_SCRIPT_ID = "AKfycbzv4E2TAo7teW1ttV5bAoQ7qV0If9qfaIGUWgGuQ3Ky10UOu3n5HgJEnaerGlz5kHT82w";
const OTP_SCRIPT_URL = `https://script.google.com/macros/s/${GOOGLE_SCRIPT_ID}/exec`;

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

// --- UPLOAD CONFIG (ĐÃ FIX CHO VIDEO .MOV) ---
let upload;
console.log("ℹ️ Checking Cloudinary Config...");

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  console.log("☁️  Storage System: Cloudinary (Online)");
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      return {
        folder: "nexus_uploads",
        resource_type: "auto", 
        // Đã thêm mov, avi, m4v
        allowed_formats: ["jpg", "png", "jpeg", "gif", "mp3", "wav", "mp4", "webm", "mov", "avi", "m4v"], 
        public_id: file.originalname.split('.')[0] + "-" + Date.now(),
      };
    },
  });
  upload = multer({ storage });
} else {
  console.log("💾 Storage System: Local Disk (Offline/Backup)");
  const uploadDir = path.join(__dirname, "public/uploads");
  if (!fs.existsSync(uploadDir)) {
    try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) {}
  }
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".webm";
      cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
    },
  });
  upload = multer({ storage });
}

const otpStore = new Map();

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API ROUTES ---

app.post("/api/upload", (req, res) => {
    const uploadMiddleware = upload.array("files", 5);
    uploadMiddleware(req, res, (err) => {
        if (err) {
            console.error("❌ UPLOAD ERROR:", err);
            return res.status(500).json({ message: "Lỗi Upload: " + (err.message || err) });
        }
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Chưa chọn file nào!" });
        try {
            const files = req.files.map((f) => {
                let url = f.path;
                if (!f.path.startsWith("http")) {
                    const filename = f.filename || path.basename(f.path);
                    url = `/uploads/${filename}`;
                }
                return {
                    type: (f.mimetype.includes("image")) ? "image" : "audio", 
                    name: f.originalname,
                    url: url,
                };
            });
            console.log("✅ Upload thành công:", files);
            res.json(files);
        } catch (processError) {
            console.error("❌ Lỗi xử lý sau khi upload:", processError);
            res.status(500).json({ message: "Lỗi xử lý file" });
        }
    });
});

// --- AI LOGIC (THỜI TIẾT & MAP) ---
async function callGeminiAPI(text) {
  const modelName = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: text }] }] }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    return null;
  }
}

async function getWeather(location) {
    try {
        const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
        if (!response.ok) return null;
        const data = await response.json();
        const current = data.current_condition[0];
        return `Thời tiết tại ${location}: ${current.temp_C}°C, ${current.weatherDesc[0].value}. Độ ẩm: ${current.humidity}%. Gió: ${current.windspeedKmph} km/h.`;
    } catch (e) { return null; }
}

async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY) return socket.emit("newMessage", { senderId: AI_BOT_ID, content: "AI chưa sẵn sàng.", createdAt: new Date() });
  
  const lowerMsg = msg.toLowerCase();
  
  // Logic Map
  if (lowerMsg.includes("bản đồ") || lowerMsg.includes("chỉ đường") || lowerMsg.includes("ở đâu")) {
      const location = msg.replace(/(bản đồ|chỉ đường|ở đâu|tới|đến)/gi, "").trim();
      if (location.length > 2) {
          const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(location)}`;
          const reply = `🗺️ Đây là bản đồ tới **${location}**: <a href="${mapUrl}" target="_blank" style="color:#3b82f6; text-decoration:underline;">Nhấn để xem trên Google Maps</a>`;
          
          await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
          return socket.emit("newMessage", { senderId: AI_BOT_ID, content: reply, createdAt: new Date() });
      }
  }

  // Logic Thời tiết
  if (lowerMsg.includes("thời tiết")) {
      const location = msg.replace(/(thời tiết|ở|tại)/gi, "").trim() || "Ho Chi Minh City";
      const weatherInfo = await getWeather(location);
      if (weatherInfo) {
          const reply = `🌤️ ${weatherInfo}`;
          await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
          return socket.emit("newMessage", { senderId: AI_BOT_ID, content: reply, createdAt: new Date() });
      }
  }

  // Gọi Gemini
  try {
    const [chatHistory] = await db.query("SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt DESC LIMIT 20", [uid, AI_BOT_ID, AI_BOT_ID, uid]);
    let contextPrompt = `Bạn là trợ lý ảo Nexus. Hãy trả lời tiếng Việt ngắn gọn.\nLịch sử:\n${chatHistory.reverse().map((h) => `${h.senderId === AI_BOT_ID ? "🤖" : "👤"}: ${h.content}`).join("\n")}\nCâu hỏi: ${msg}`;
    
    const data = await callGeminiAPI(contextPrompt);
    if (data?.candidates?.[0]) {
      const reply = data.candidates[0].content.parts[0].text;
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [AI_BOT_ID, uid, reply]);
      socket.emit("newMessage", { senderId: AI_BOT_ID, content: reply, createdAt: new Date() });
    } else {
      socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Xin lỗi, AI đang gặp sự cố.", createdAt: new Date() });
    }
  } catch (e) {
    socket.emit("newMessage", { senderId: AI_BOT_ID, content: "Lỗi hệ thống.", createdAt: new Date() });
  }
}

// --- BASIC API ---
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await fetch(OTP_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ to: email, subject: "Nexus OTP", body: `OTP: <b>${otp}</b>` }) });
    res.json({ message: "OK" });
  } catch (e) { res.status(500).json({ message: "Lỗi hệ thống" }); }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body; const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp) return res.status(400).json({ message: "Sai OTP" });
  res.json({ message: "OK" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  try { const hash = await bcrypt.hash(password, 10); await db.query("INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)", [username, hash, email, nickname, avatar]); otpStore.delete(email); res.status(201).json({ message: "OK" }); } catch (e) { res.status(500).json({ message: "Lỗi DB" }); }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try { const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]); if (!rows[0] || !(await bcrypt.compare(password, rows[0].passwordHash))) return res.status(400).json({ message: "Sai thông tin" }); const token = jwt.sign({ userId: rows[0].id, username: rows[0].username }, JWT_SECRET, { expiresIn: "7d" }); res.json({ message: "OK", token }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  const [r] = await db.query("SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?", [req.user.userId]); res.json(r[0]);
});

app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q; if (!query) return res.json([]);
  try { const [users] = await db.query("SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 1 LIMIT 20", [`%${query}%`, `%${query}%`, req.user.userId]); res.json(users); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try { const [u] = await db.query(`SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`, [req.user.userId, req.user.userId, req.user.userId]); res.json(u); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/friends", authenticateToken, async (req, res) => {
  try { const [f] = await db.query(`SELECT u.id, u.username, u.nickname, u.avatar FROM users u JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ?`, [req.user.userId, req.user.userId, req.user.userId]); res.json(f); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/notifications", authenticateToken, async (req, res) => {
  try { const [reqs] = await db.query(`SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' as type FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`, [req.user.userId]); res.json(reqs); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try { await db.query("INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)", [req.user.userId, req.body.receiverId]); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ message: "Duplicate" }); }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try { await db.query("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [req.body.requestId]); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body; const creatorId = req.user.userId;
  if (!members.includes(creatorId)) members.push(creatorId);
  const conn = await db.getConnection();
  try { await conn.beginTransaction(); const [g] = await conn.query("INSERT INTO groups (name, creatorId) VALUES (?, ?)", [name, creatorId]); const values = members.map((uid) => [g.insertId, uid]); if (values.length > 0) await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [values]); await conn.commit(); const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [g.insertId]); members.forEach((uid) => { if (onlineUsers[uid]) { io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]); const s = io.sockets.sockets.get(onlineUsers[uid].socketId); if (s) s.join(`group_${g.insertId}`); } }); res.json({ message: "OK" }); } catch (e) { await conn.rollback(); res.status(500).json({ message: "Error" }); } finally { conn.release(); }
});

app.post("/api/profile/update", authenticateToken, async (req, res) => {
  const { nickname, bio, location, work, education, avatar } = req.body;
  try { await db.query("UPDATE users SET nickname=?, bio=?, location=?, work=?, education=?, avatar=? WHERE id=?", [nickname, bio, location, work, education, avatar, req.user.userId]); res.json({ message: "Updated" }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/posts/create", authenticateToken, async (req, res) => {
  const { content, image } = req.body;
  if (!content && !image) return res.status(400).json({ message: "Content required" });
  try { const [result] = await db.query("INSERT INTO posts (userId, content, image) VALUES (?, ?, ?)", [req.user.userId, content, image]); res.status(201).json({ message: "OK", postId: result.insertId }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/posts/:postId/react", authenticateToken, async (req, res) => {
  const { type } = req.body;
  try { await db.query("INSERT INTO post_reactions (postId, userId, type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE type=?", [req.params.postId, req.user.userId, type, type]); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/posts", authenticateToken, async (req, res) => {
  try { const query = `SELECT p.*, u.username, u.nickname, u.avatar, (SELECT COUNT(*) FROM post_reactions WHERE postId = p.id) AS reactionCount, (SELECT COUNT(*) FROM post_comments WHERE postId = p.id) AS commentCount, (SELECT type FROM post_reactions WHERE postId = p.id AND userId = ?) AS userReaction FROM posts p JOIN users u ON p.userId = u.id ORDER BY p.createdAt DESC LIMIT 50`; const [posts] = await db.query(query, [req.user.userId]); res.json(posts); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  const { content } = req.body; if (!content) return res.status(400).json({ message: "Required" });
  try { const [result] = await db.query("INSERT INTO post_comments (postId, userId, content) VALUES (?, ?, ?)", [req.params.postId, req.user.userId, content]); res.status(201).json({ message: "OK", commentId: result.insertId }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.delete("/api/comments/:commentId", authenticateToken, async (req, res) => {
  try { const [c] = await db.query("SELECT userId FROM post_comments WHERE id=?", [req.params.commentId]); if (!c[0]) return res.status(404).json({ message: "Not found" }); if (c[0].userId !== req.user.userId) return res.status(403).json({ message: "Unauthorized" }); await db.query("DELETE FROM post_comments WHERE id=?", [req.params.commentId]); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/stories", async (req, res) => {
  try { const [s] = await db.query("SELECT s.*, u.username, u.nickname, u.avatar FROM stories s JOIN users u ON s.userId = u.id WHERE s.expiresAt > NOW() OR s.expiresAt IS NULL ORDER BY s.createdAt DESC LIMIT 50"); res.json(s); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/stories/create", authenticateToken, async (req, res) => {
  const { image } = req.body;
  try { const expiresAt = new Date(); expiresAt.setHours(expiresAt.getHours() + 24); const [r] = await db.query("INSERT INTO stories (userId, image, expiresAt) VALUES (?, ?, ?)", [req.user.userId, image, expiresAt]); res.status(201).json({ message: "OK", storyId: r.insertId }); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/messages/:userId", authenticateToken, async (req, res) => {
  try { const [m] = await db.query("SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC", [req.user.userId, req.params.userId, req.params.userId, req.user.userId]); res.json(m); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/conversations", authenticateToken, async (req, res) => {
  try { const [c] = await db.query("SELECT DISTINCT u.id, u.username, u.nickname, u.avatar, m.content as lastMessage FROM messages m JOIN users u ON (CASE WHEN m.senderId = ? THEN u.id = m.recipientId ELSE u.id = m.senderId END) WHERE m.senderId = ? OR m.recipientId = ? GROUP BY u.id ORDER BY MAX(m.createdAt) DESC", [req.user.userId, req.user.userId, req.user.userId]); res.json(c); } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/ai/recommend-friends", authenticateToken, async (req, res) => {
    const { criteria } = req.body; const userId = req.user.userId;
    try {
        const [userInfo] = await db.query("SELECT bio, location, work, education FROM users WHERE id=?", [userId]);
        const user = userInfo[0];
        const [potentialFriends] = await db.query(`SELECT id, username, nickname, avatar, bio, location, work, education FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 50`, [userId, userId, userId]);
        const prompt = `Gợi ý 5 bạn bè. User: ${user.bio}, ${user.location}. List: ${potentialFriends.map((u, i) => `${u.username} (${u.bio})`).join("; ")}. Trả JSON {"recommendations": [{"id": ID, "username": "...", "reason": "..."}]}`;
        const data = await callGeminiAPI(prompt);
        if (data?.candidates?.[0]) {
            const jsonMatch = data.candidates[0].content.parts[0].text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const recs = JSON.parse(jsonMatch[0]); const ids = recs.recommendations.map((r) => r.id);
                if (ids.length === 0) return res.json({ recommendations: [], reasons: [] });
                const [users] = await db.query(`SELECT id, username, nickname, avatar FROM users WHERE id IN (${ids.join(",")})`);
                res.json({ recommendations: users, reasons: recs.recommendations });
            } else res.status(400).json({ message: "Parse error" });
        } else res.status(500).json({ message: "AI error" });
    } catch (e) { res.status(500).json({ message: "Error" }); }
});

// --- SOCKET ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return next(new Error("Auth Error")); socket.user = user; next(); });
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
    const { recipientId, content, ttl } = data; if (!recipientId || !content) return;
    if (recipientId === AI_BOT_ID) {
      await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, AI_BOT_ID, content]);
      socket.emit("newMessage", { senderId: userId, content: content, createdAt: new Date() });
      await handleAIChat(content, userId, socket); return;
    }
    const [r] = await db.query("INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)", [userId, recipientId, content]);
    const msg = { id: r.insertId, senderId: userId, content, createdAt: new Date(), ttl };
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl) setTimeout(async () => { await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]); }, ttl);
  });

  // --- SỰ KIỆN MỚI: TIM & CUỘC GỌI ---
  socket.on("sendHeart", ({ recipientId }) => {
    if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("heartAnimation");
    socket.emit("heartAnimation");
  });

  socket.on("callMissed", async ({ callerId }) => {
    const recipientId = socket.user.userId;
    const msg = "📞 Cuộc gọi nhỡ";
    // Tùy chọn lưu DB nếu có cột isSystem, nếu không thì bỏ dòng await db.query
    const msgObj = { senderId: recipientId, content: msg, createdAt: new Date(), isSystem: true };
    if (onlineUsers[callerId]) io.to(onlineUsers[callerId].socketId).emit("newMessage", msgObj);
    socket.emit("newMessage", msgObj);
  });

  socket.on("callEnd", async ({ recipientId }) => {
    const senderId = socket.user.userId;
    const msg = "☎️ Cuộc gọi đã kết thúc";
    const msgObj = { senderId: senderId, content: msg, createdAt: new Date(), isSystem: true };
    if (onlineUsers[recipientId]) {
        io.to(onlineUsers[recipientId].socketId).emit("newMessage", msgObj);
        io.to(onlineUsers[recipientId].socketId).emit("callEnd");
    }
    socket.emit("newMessage", msgObj);
  });

  // Sự kiện WebRTC
  socket.on("callOffer", (data) => {
      const { recipientId, offer, isVideo } = data;
      if (onlineUsers[recipientId]) {
          io.to(onlineUsers[recipientId].socketId).emit("callOffer", {
              senderId: userId,
              senderName: socket.user.username, 
              offer, isVideo
          });
      }
  });
  socket.on("callAnswer", (data) => {
      const { recipientId, answer } = data;
      if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("callAnswer", { answer });
  });
  socket.on("sendICE", (data) => {
      const { recipientId, candidate } = data;
      if (onlineUsers[recipientId]) io.to(onlineUsers[recipientId].socketId).emit("receiveICE", { candidate });
  });
  socket.on("callReject", (data) => {
      const { callerId, reason } = data;
      if (onlineUsers[callerId]) io.to(onlineUsers[callerId].socketId).emit("callReject", { reason });
  });

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

  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
