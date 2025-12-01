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

// --- LINK GOOGLE SCRIPT MỚI CỦA BẠN ---
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzv4E2TAo7teW1ttV5bAoQ7qV0If9qfaIGUWgGuQ3Ky10UOu3n5HgJEnaerGlz5kHT82w/exec";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

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

// --- UPLOAD CONFIG ---
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
    params: {
      folder: "nexus_uploads",
      resource_type: "auto",
      allowed_formats: ["jpg", "png", "mp3", "wav", "mp4", "webm"],
    },
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

// Lưu OTP tạm thời trong RAM (Map)
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
app.post("/api/upload", upload.array("files", 5), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ message: "No file" });
  const files = req.files.map((f) => {
    let url = f.path;
    if (!f.path.startsWith("http")) url = `/uploads/${f.filename}`;
    return {
      type: f.mimetype.includes("image") ? "image" : "audio",
      name: f.originalname,
      url: url,
    };
  });
  res.json(files);
});

// --- AUTH APIs (OTP & REGISTER) ---

// 1. Gửi OTP (Sử dụng Google Apps Script để tránh lỗi Timeout)
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  if (!email || !username) return res.status(400).json({ message: "Thiếu thông tin!" });

  try {
    // Kiểm tra DB xem user có chưa
    const [exists] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ?",
      [email, username]
    );
    if (exists.length > 0)
      return res.status(400).json({ message: "Email hoặc Username đã tồn tại!" });

    // Tạo OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });

    console.log(`🚀 Đang gửi yêu cầu đến Google Script cho: ${email}`);

    // --- GỌI GOOGLE APPS SCRIPT ---
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, otp: otp }),
    });

    const result = await response.json();

    if (result.status === "success") {
       console.log("✅ Google đã gửi mail thành công!");
       res.json({ message: "Đã gửi mã OTP qua email!" });
    } else {
       console.error("❌ Lỗi từ Google Script:", result.message);
       // Vẫn trả về thành công để Client không bị treo, nhưng in lỗi ra server log để debug
       res.status(500).json({ message: "Lỗi gửi mail: " + result.message });
    }

  } catch (e) {
    console.error("❌ Lỗi Server:", e);
    // Nếu lỗi cú pháp JSON (do Google chặn), thông báo rõ
    if (e.name === "SyntaxError") {
        res.status(500).json({ message: "Lỗi cấu hình Google Script: Chưa chọn 'Anyone' (Bất kỳ ai) khi Deploy." });
    } else {
        res.status(500).json({ message: "Lỗi hệ thống khi gửi mail." });
    }
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp)
    return res.status(400).json({ message: "Sai OTP hoặc hết hạn" });
  res.json({ message: "OK" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  
  // Check OTP lần cuối
  const data = otpStore.get(email);
  if (!data) return res.status(400).json({ message: "Phiên OTP hết hạn" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const defaultAvatar = avatar || "https://res.cloudinary.com/your-cloud/image/upload/v1/default-avatar.png";

    await db.query(
      "INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)",
      [username, hash, email, nickname, defaultAvatar]
    );
    otpStore.delete(email);
    res.status(201).json({ message: "OK" });
  } catch (e) {
    console.error("DB Error:", e);
    res.status(500).json({ message: "Lỗi DB" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].passwordHash)))
      return res.status(400).json({ message: "Sai thông tin" });
    const token = jwt.sign(
      { userId: rows[0].id, username: rows[0].username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ message: "OK", token });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  const [r] = await db.query(
    "SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?",
    [req.user.userId]
  );
  res.json(r[0]);
});

app.get("/api/users/search", authenticateToken, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const [users] = await db.query(
      "SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 1 LIMIT 20",
      [`%${query}%`, `%${query}%`, req.user.userId]
    );
    res.json(users);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try {
    const [u] = await db.query(
      `SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`,
      [req.user.userId, req.user.userId, req.user.userId]
    );
    res.json(u);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

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

app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const [reqs] = await db.query(
      `SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' as type FROM friend_requests fr JOIN users u ON fr.senderId = u.id WHERE fr.receiverId = ? AND fr.status = 'pending'`,
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
    const values = members.map((uid) => [g.insertId, uid]);
    if (values.length > 0)
      await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [
        values,
      ]);
    await conn.commit();
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [
      g.insertId,
    ]);
    members.forEach((uid) => {
      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
        const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
        if (s) s.join(`group_${g.insertId}`);
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

// --- PROFILE UPDATE ---
app.post("/api/profile/update", authenticateToken, async (req, res) => {
  const { nickname, bio, location, work, education, avatar } = req.body;
  const userId = req.user.userId;
  try {
    await db.query(
      "UPDATE users SET nickname=?, bio=?, location=?, work=?, education=?, avatar=? WHERE id=?",
      [nickname, bio, location, work, education, avatar, userId]
    );
    res.json({ message: "Profile updated successfully" });
  } catch (e) {
    res.status(500).json({ message: "Error updating profile" });
  }
});

// --- POSTS ---
app.post("/api/posts/create", authenticateToken, async (req, res) => {
  const { content, image } = req.body;
  const userId = req.user.userId;
  if (!content && !image)
    return res.status(400).json({ message: "Content required" });
  try {
    const [result] = await db.query(
      "INSERT INTO posts (userId, content, image) VALUES (?, ?, ?)",
      [userId, content, image]
    );
    res.status(201).json({ message: "OK", postId: result.insertId });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/posts/:postId/react", authenticateToken, async (req, res) => {
  const { type } = req.body;
  const postId = req.params.postId;
  const userId = req.user.userId;
  try {
    await db.query(
      "INSERT INTO post_reactions (postId, userId, type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE type=?",
      [postId, userId, type, type]
    );
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/posts", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const query = `
      SELECT p.*, u.username, u.nickname, u.avatar,
        (SELECT COUNT(*) FROM post_reactions WHERE postId = p.id) AS reactionCount,
        (SELECT COUNT(*) FROM post_comments WHERE postId = p.id) AS commentCount,
        (SELECT type FROM post_reactions WHERE postId = p.id AND userId = ?) AS userReaction
      FROM posts p JOIN users u ON p.userId = u.id 
      ORDER BY p.createdAt DESC LIMIT 50
    `;
    const [posts] = await db.query(query, [currentUserId]);
    res.json(posts);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  const { content } = req.body;
  const postId = req.params.postId;
  const userId = req.user.userId;
  if (!content) return res.status(400).json({ message: "Content required" });
  try {
    const [result] = await db.query(
      "INSERT INTO post_comments (postId, userId, content) VALUES (?, ?, ?)",
      [postId, userId, content]
    );
    res.status(201).json({ message: "OK", commentId: result.insertId });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.delete("/api/comments/:commentId", authenticateToken, async (req, res) => {
  const commentId = req.params.commentId;
  const userId = req.user.userId;
  try {
    const [comment] = await db.query(
      "SELECT userId FROM post_comments WHERE id=?",
      [commentId]
    );
    if (comment.length === 0)
      return res.status(404).json({ message: "Not found" });
    if (comment[0].userId !== userId)
      return res.status(403).json({ message: "Unauthorized" });
    await db.query("DELETE FROM post_comments WHERE id=?", [commentId]);
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// --- STORIES ---
app.get("/api/stories", async (req, res) => {
  try {
    const [stories] = await db.query(
      "SELECT s.*, u.username, u.nickname, u.avatar FROM stories s JOIN users u ON s.userId = u.id WHERE s.expiresAt > NOW() OR s.expiresAt IS NULL ORDER BY s.createdAt DESC LIMIT 50"
    );
    res.json(stories);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/stories/create", authenticateToken, async (req, res) => {
  const { image } = req.body;
  const userId = req.user.userId;
  if (!image) return res.status(400).json({ message: "Image required" });
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    const [result] = await db.query(
      "INSERT INTO stories (userId, image, expiresAt) VALUES (?, ?, ?)",
      [userId, image, expiresAt]
    );
    res.status(201).json({ message: "OK", storyId: result.insertId });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// --- MESSAGES ---
app.get("/api/messages/:userId", authenticateToken, async (req, res) => {
  try {
    const [msgs] = await db.query(
      "SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC",
      [req.user.userId, req.params.userId, req.params.userId, req.user.userId]
    );
    res.json(msgs);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/conversations", authenticateToken, async (req, res) => {
  try {
    const [convs] = await db.query(
      "SELECT DISTINCT u.id, u.username, u.nickname, u.avatar, m.content as lastMessage FROM messages m JOIN users u ON (CASE WHEN m.senderId = ? THEN u.id = m.recipientId ELSE u.id = m.senderId END) WHERE m.senderId = ? OR m.recipientId = ? GROUP BY u.id ORDER BY MAX(m.createdAt) DESC",
      [req.user.userId, req.user.userId, req.user.userId]
    );
    res.json(convs);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// --- AI RECOMMENDATIONS & GEMINI ---
app.post("/api/ai/recommend-friends", authenticateToken, async (req, res) => {
  const { criteria } = req.body;
  const userId = req.user.userId;

  try {
    const [userInfo] = await db.query(
      "SELECT bio, location, work, education FROM users WHERE id=?",
      [userId]
    );
    const user = userInfo[0];

    const [potentialFriends] = await db.query(
      `SELECT id, username, nickname, avatar, bio, location, work, education FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 50`,
      [userId, userId, userId]
    );

    const prompt = `Bạn là một hệ thống gợi ý bạn bè thông minh. Hãy gợi ý 5 người tốt nhất dựa trên tiêu chí: "${
      criteria || "Những người có cùng sở thích"
    }"
    
Thông tin người dùng hiện tại: Bio: ${user.bio || "N/A"}, Vị trí: ${
      user.location || "N/A"
    }, Công việc: ${user.work || "N/A"}

Danh sách: ${potentialFriends
      .map(
        (u, i) =>
          `${i + 1}. ${u.username} - Bio: ${u.bio || "N/A"}, Vị trí: ${
            u.location || "N/A"
          }`
      )
      .join("; ")}

Trả về JSON: {"recommendations": [{"id": ID, "username": "...", "reason": "..."}]}`;

    const data = await callGeminiAPI(prompt);

    if (data && data.candidates?.[0]) {
      const responseText = data.candidates[0].content.parts[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const recommendations = JSON.parse(jsonMatch[0]);
        const recommendedIds = recommendations.recommendations.map((r) => r.id);
        
        if (recommendedIds.length > 0) {
            const [detailedUsers] = await db.query(
            `SELECT id, username, nickname, avatar FROM users WHERE id IN (${recommendedIds.join(",")})`
            );
            res.json({
            recommendations: detailedUsers,
            reasons: recommendations.recommendations,
            });
        } else {
             res.json({ recommendations: [], reasons: [] });
        }
      } else {
        res.status(400).json({ message: "Parse error" });
      }
    } else {
      res.status(500).json({ message: "AI error" });
    }
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ message: "Error" });
  }
});

async function callGeminiAPI(text) {
  const modelName = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ API Error:`, errText);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    return null;
  }
}

async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY)
    return socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "AI chưa sẵn sàng.",
      createdAt: new Date(),
    });

  try {
    const [chatHistory] = await db.query(
      "SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt DESC LIMIT 20",
      [uid, AI_BOT_ID, AI_BOT_ID, uid]
    );

    let contextPrompt = `Bạn là trợ lý ảo Nexus. Hãy trả lời tiếng Việt.

Lịch sử: ${chatHistory
      .reverse()
      .map((h) => `${h.senderId === AI_BOT_ID ? "🤖" : "👤"}: ${h.content}`)
      .join("\n")}

Câu hỏi: ${msg}`;

    const data = await callGeminiAPI(contextPrompt);

    if (data?.candidates?.[0]) {
      const reply = data.candidates[0].content.parts[0].text;
      await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
        [AI_BOT_ID, uid, reply]
      );
      socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: reply,
        createdAt: new Date(),
      });
    } else {
      socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: "Xin lỗi, AI đang gặp sự cố.",
        createdAt: new Date(),
      });
    }
  } catch (e) {
    console.error("AI Error:", e);
    socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "Lỗi hệ thống.",
      createdAt: new Date(),
    });
  }
}

// --- SOCKET.IO ---
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
    const [users] = await db.query(
      "SELECT id, username, nickname, avatar FROM users"
    );
    const list = users.map((u) => ({
      ...u,
      online: !!onlineUsers[u.id] || u.id === AI_BOT_ID,
    }));
    io.emit("userList", list);
  };
  await sendUserList();

  socket.on("privateMessage", async (data) => {
    const { recipientId, content, ttl } = data;
    if (!recipientId || !content) return;

    if (recipientId === AI_BOT_ID) {
      await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
        [userId, AI_BOT_ID, content]
      );
      socket.emit("newMessage", {
        senderId: userId,
        content: content,
        createdAt: new Date(),
      });
      await handleAIChat(content, userId, socket);
      return;
    }

    const [r] = await db.query(
      "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
      [userId, recipientId, content]
    );
    const msg = {
      id: r.insertId,
      senderId: userId,
      content,
      createdAt: new Date(),
      ttl,
    };
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl)
      setTimeout(async () => {
        await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]);
      }, ttl);
  });

  socket.on("deleteConversation", async ({ recipientId }) => {
    await db.query(
      "DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)",
      [userId, recipientId, recipientId, userId]
    );
    socket.emit("conversationDeleted", { partnerId: recipientId });
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", {
        partnerId: userId,
      });
  });

  socket.on("deleteMessage", async ({ messageId, recipientId }) => {
    await db.query("DELETE FROM messages WHERE id = ? AND senderId = ?", [
      messageId,
      userId,
    ]);
    socket.emit("messageDeleted", { messageId });
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", {
        messageId,
      });
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query(
      "SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC",
      [userId, recipientId, recipientId, userId]
    );
    socket.emit("privateHistory", { recipientId, messages: msgs });
  });

  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
  });
});

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
