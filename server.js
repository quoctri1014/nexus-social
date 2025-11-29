import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import axios from "axios";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import nodemailer from "nodemailer";
import { GoogleGenAI } from "@google/genai";

// ==========================================
// 1. CẤU HÌNH HỆ THỐNG (CONFIG)
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lấy Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";

if (!GEMINI_API_KEY) {
  console.error("❌ ERROR: Thiếu GEMINI_API_KEY");
  process.exit(1);
}

// Khởi tạo AI & Server
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const AI_MODEL = "gemini-2.0-flash";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

// Lưu user online: { userId: { socketId, username } }
const onlineUsers = {};

app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use(express.json());

// ==========================================
// 2. CẤU HÌNH UPLOAD & EMAIL
// ==========================================
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, f, cb) => cb(null, uploadDir),
  filename: (req, f, cb) => cb(null, Date.now() + "-" + f.originalname),
});
const upload = multer({ storage });

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
// 4. API AUTH (ĐĂNG KÝ / ĐĂNG NHẬP / OTP)
// ==========================================
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ?",
      [email, username]
    );
    if (exists.length > 0)
      return res
        .status(400)
        .json({ message: "Email hoặc Tên đăng nhập đã tồn tại!" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 }); // 5 phút

    await transporter.sendMail({
      from: '"Nexus App" <no-reply@nexus.com>',
      to: email,
      subject: "Mã xác thực Nexus",
      html: `<h3>Mã OTP của bạn là: <b style="color:#1877f2;">${otp}</b></h3>`,
    });
    res.json({ message: "Đã gửi OTP!" });
  } catch (e) {
    res.status(500).json({ message: "Lỗi gửi mail: " + e.message });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp)
    return res.status(400).json({ message: "OTP sai hoặc đã hết hạn." });
  res.json({ message: "OTP chính xác!" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  if (!otpStore.has(email))
    return res.status(400).json({ message: "Phiên đăng ký hết hạn." });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)",
      [username, hash, email, nickname, avatar]
    );
    otpStore.delete(email);
    res.status(201).json({ message: "Đăng ký thành công!" });
  } catch (e) {
    res.status(500).json({ message: "Lỗi Database." });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res
        .status(400)
        .json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ message: "Đăng nhập thành công!", token });
  } catch (e) {
    res.status(500).json({ message: "Lỗi Server." });
  }
});

// ==========================================
// 5. API USER & PROFILE
// ==========================================
app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id = ?",
      [req.user.userId]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: "User not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/profile/update", authenticateToken, async (req, res) => {
  const { nickname, avatar, bio, location, work, education } = req.body;
  try {
    await db.query(
      `UPDATE users SET nickname=?, avatar=?, bio=?, location=?, work=?, education=? WHERE id=?`,
      [nickname, avatar, bio, location, work, education, req.user.userId]
    );
    res.json({ message: "Cập nhật thành công!" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, username, nickname, avatar, bio, location, work, education FROM users WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: "Not found" });
    const [posts] = await db.query(
      `SELECT p.*, (SELECT COUNT(*) FROM post_reactions WHERE postId = p.id) as totalReactions, (SELECT COUNT(*) FROM post_comments WHERE postId = p.id) as totalComments FROM posts p WHERE userId = ? ORDER BY createdAt DESC`,
      [req.params.id]
    );
    res.json({ user: rows[0], posts: posts });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q;
  const userId = req.user.userId;
  if (!query) return res.json([]);
  try {
    const [users] = await db.query(
      `SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 0 LIMIT 20`,
      [`%${query}%`, `%${query}%`, userId]
    );
    res.json(users);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// ==========================================
// 6. API BẠN BÈ (FRIENDS)
// ==========================================
app.get("/api/friends", authenticateToken, async (req, res) => {
  try {
    const [f] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar FROM users u JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ?`,
      [req.user.userId, req.user.userId, req.user.userId]
    );
    res.json(f);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try {
    const [u] = await db.query(
      `SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 0 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`,
      [req.user.userId, req.user.userId, req.user.userId]
    );
    res.json(u);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/friends/pending", authenticateToken, async (req, res) => {
  try {
    const [reqs] = await db.query(
      `SELECT fr.id as requestId, u.id as userId, u.username, u.nickname, u.avatar FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`,
      [req.user.userId]
    );
    res.json(reqs);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try {
    await db.query(
      "INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)",
      [req.user.userId, req.body.receiverId]
    );
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Duplicate" });
  }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    await db.query(
      "UPDATE friend_requests SET status = 'accepted' WHERE id = ?",
      [req.body.requestId]
    );
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// ==========================================
// 7. API MẠNG XÃ HỘI (POSTS, STORIES, UPLOAD)
// ==========================================
app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ message: "No file" });
  const files = req.files.map((f) => ({
    type: f.mimetype.startsWith("image") ? "image" : "file",
    name: f.originalname,
    url: `/uploads/${f.filename}`,
  }));
  res.json(files);
});

app.get("/api/posts", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [posts] = await db.query(
      `
            SELECT p.*, u.username, u.nickname, u.avatar, 
            (SELECT COUNT(*) FROM post_reactions WHERE postId = p.id) as totalReactions, 
            (SELECT COUNT(*) FROM post_comments WHERE postId = p.id) as totalComments, 
            (SELECT type FROM post_reactions WHERE postId = p.id AND userId = ?) as myReaction 
            FROM posts p JOIN users u ON p.userId = u.id 
            ORDER BY p.createdAt DESC LIMIT 50`,
      [userId]
    );
    res.json(posts);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/posts", authenticateToken, async (req, res) => {
  try {
    await db.query(
      "INSERT INTO posts (userId, content, image) VALUES (?, ?, ?)",
      [req.user.userId, req.body.content, req.body.image]
    );
    res.json({ message: "Posted" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/posts/:id/react", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { type } = req.body;
  try {
    const [ex] = await db.query(
      "SELECT id, type FROM post_reactions WHERE postId=? AND userId=?",
      [id, req.user.userId]
    );
    if (ex.length > 0) {
      if (ex[0].type === type)
        await db.query("DELETE FROM post_reactions WHERE id=?", [ex[0].id]);
      // Toggle Off
      else
        await db.query("UPDATE post_reactions SET type=? WHERE id=?", [
          type,
          ex[0].id,
        ]); // Change
    } else {
      await db.query(
        "INSERT INTO post_reactions (postId, userId, type) VALUES (?, ?, ?)",
        [id, req.user.userId, type]
      );
    }
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/posts/:id/comments", authenticateToken, async (req, res) => {
  try {
    const [c] = await db.query(
      "SELECT c.*, u.username, u.nickname, u.avatar FROM post_comments c JOIN users u ON c.userId = u.id WHERE c.postId = ? ORDER BY c.createdAt ASC",
      [req.params.id]
    );
    res.json(c);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/posts/:id/comments", authenticateToken, async (req, res) => {
  if (!req.body.content) return res.status(400).json({ message: "Empty" });
  try {
    await db.query(
      "INSERT INTO post_comments (postId, userId, content) VALUES (?, ?, ?)",
      [req.params.id, req.user.userId, req.body.content]
    );
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/stories", authenticateToken, async (req, res) => {
  try {
    const [s] = await db.query(
      "SELECT s.*, u.username, u.nickname, u.avatar FROM stories s JOIN users u ON s.userId = u.id WHERE s.createdAt >= NOW() - INTERVAL 1 DAY ORDER BY s.createdAt DESC"
    );
    res.json(s);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/stories", authenticateToken, async (req, res) => {
  try {
    await db.query(
      "INSERT INTO stories (userId, image, expiresAt) VALUES (?, ?, ?)",
      [req.user.userId, req.body.image, new Date(Date.now() + 86400000)]
    );
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const uid = req.user.userId;
    const [reqs] = await db.query(
      `SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' as type FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`,
      [uid]
    );
    const [posts] = await db.query(
      `SELECT p.id, u.username, u.nickname, u.avatar, p.createdAt, 'post' as type FROM posts p JOIN users u ON p.userId = u.id JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ? AND p.createdAt >= NOW() - INTERVAL 1 DAY ORDER BY p.createdAt DESC LIMIT 5`,
      [uid, uid, uid]
    );
    res.json([...reqs, ...posts]);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!members.includes(creatorId)) members.push(creatorId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query(
      "INSERT INTO groups (name, creatorId) VALUES (?, ?)",
      [name, creatorId]
    );
    const vals = members.map((uid) => [g.insertId, uid]);
    await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [
      vals,
    ]);
    await conn.commit();

    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [
      g.insertId,
    ]);
    members.forEach((uid) => {
      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
        io.sockets.sockets
          .get(onlineUsers[uid].socketId)
          ?.join(`group_${g.insertId}`);
      }
    });
    res.json({ message: "OK" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: "Error" });
  } finally {
    conn.release();
  }
});

// ==========================================
// 8. SOCKET.IO (CHAT & AI & WEBRTC)
// ==========================================

// AI TOOLS
const tools = [
  {
    functionDeclarations: [
      {
        name: "get_weather",
        description: "Lấy thời tiết",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
      {
        name: "get_places",
        description: "Lấy địa điểm",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ],
  },
];

async function handleAIChat(msg, uid) {
  const socket = onlineUsers[uid]
    ? io.sockets.sockets.get(onlineUsers[uid].socketId)
    : null;
  if (!socket) return;
  try {
    const [hist] = await db.query(
      "SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=0) OR (senderId=0 AND recipientId=?) ORDER BY createdAt DESC LIMIT 6",
      [uid, uid]
    );
    let history = hist.reverse().map((m) => ({
      role: m.senderId === uid ? "user" : "model",
      parts: [{ text: m.content }],
    }));
    history.push({ role: "user", parts: [{ text: msg }] });

    const model = ai.getGenerativeModel({ model: AI_MODEL });
    const result = await model.generateContent({ contents: history });
    const reply = result.response.text();

    const [r] = await db.query(
      "INSERT INTO messages (senderId, recipientId, content) VALUES (0, ?, ?)",
      [uid, reply]
    );
    socket.emit("newMessage", {
      id: r.insertId,
      senderId: 0,
      content: reply,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error(e);
    socket.emit("newMessage", {
      senderId: 0,
      content: "AI đang bận, vui lòng thử lại sau.",
      createdAt: new Date(),
    });
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

  const [grps] = await db.query(
    "SELECT groupId FROM group_members WHERE userId=?",
    [userId]
  );
  grps.forEach((g) => socket.join(`group_${g.groupId}`));

  // Gửi danh sách user ngay khi kết nối
  const [users] = await db.query(
    "SELECT id, username, nickname, avatar FROM users"
  );
  const userList = users.map((u) => ({
    userId: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    online: !!onlineUsers[u.id] || u.id === 0,
  }));

  // Gửi cho người mới vào
  socket.emit("userList", userList);
  // Gửi cập nhật trạng thái online cho người khác
  socket.broadcast.emit("userList", userList);

  socket.on("privateMessage", async (data) => {
    if (data.recipientId === 0) {
      // Chat với AI
      await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, 0, ?)",
        [userId, data.content]
      );
      socket.emit("newMessage", {
        senderId: userId,
        content: data.content,
        createdAt: new Date(),
      });
      await handleAIChat(data.content, userId);
      return;
    }
    const [r] = await db.query(
      "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
      [userId, data.recipientId, data.content]
    );
    const msg = {
      id: r.insertId,
      senderId: userId,
      content: data.content,
      createdAt: new Date(),
    };
    if (onlineUsers[data.recipientId])
      io.to(onlineUsers[data.recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
  });

  socket.on("groupMessage", async (data) => {
    const [r] = await db.query(
      "INSERT INTO group_messages (senderId, groupId, content) VALUES (?, ?, ?)",
      [userId, data.groupId, data.content]
    );
    io.to(`group_${data.groupId}`).emit("newGroupMessage", {
      id: r.insertId,
      senderId: userId,
      senderUsername: username,
      groupId: data.groupId,
      content: data.content,
      createdAt: new Date(),
    });
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query(
      "SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC",
      [userId, recipientId, recipientId, userId]
    );
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });
  socket.on("loadGroupHistory", async ({ groupId }) => {
    const [msgs] = await db.query(
      "SELECT gm.*, u.username as senderUsername FROM group_messages gm JOIN users u ON gm.senderId = u.id WHERE groupId=? ORDER BY createdAt ASC",
      [groupId]
    );
    socket.emit("groupHistory", { groupId, messages: msgs });
  });

  // WebRTC Signaling
  socket.on("callOffer", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("callOffer", {
        ...d,
        senderId: userId,
      });
  });
  socket.on("callAnswer", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", {
        ...d,
        senderId: userId,
      });
  });
  socket.on("sendICE", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", {
        ...d,
        senderId: userId,
      });
  });
  socket.on("callEnd", (d) => {
    if (onlineUsers[d.recipientId])
      io.to(onlineUsers[d.recipientId].socketId).emit("callEnd");
  });
  socket.on("callReject", (d) => {
    if (onlineUsers[d.callerId])
      io.to(onlineUsers[d.callerId].socketId).emit("callReject", {
        senderId: userId,
      });
  });
  socket.on("callBusy", (d) => {
    if (onlineUsers[d.callerId])
      io.to(onlineUsers[d.callerId].socketId).emit("callBusy", {
        senderId: userId,
      });
  });

  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    io.emit("userOffline", { userId });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
