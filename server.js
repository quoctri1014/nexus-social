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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1; 

// Lưu trữ context cuộc trò chuyện với từng user
const userChatHistory = new Map();
const MAX_HISTORY = 20; // Lưu 20 tin nhắn gần nhất

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

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
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

// --- GEMINI AI LOGIC WITH CONTEXT (FIX 1: Thêm callGeminiAPI) ---
async function callGeminiAPI(prompt) {
  const modelName = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Lỗi từ Google API:`, errText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`❌ Lỗi khi gọi API:`, err.message);
    return null;
  }
}

// --- API ROUTES ---
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
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
    if (exists.length > 0) return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await transporter.sendMail({ from: "Nexus", to: email, subject: "OTP", html: `<h3>OTP: <b>${otp}</b></h3>` });
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
    const [users] = await db.query("SELECT id, username, nickname, avatar FROM users WHERE (username LIKE ? OR nickname LIKE ?) AND id != ? AND id != 1 LIMIT 20", [`%${query}%`, `%${query}%`, req.user.userId]);
    res.json(users);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users/suggestions", authenticateToken, async (req, res) => {
  try {
    const [u] = await db.query(`SELECT id, username, nickname, avatar FROM users WHERE id != ? AND id != 1 AND id NOT IN (SELECT receiverId FROM friend_requests WHERE senderId = ? UNION SELECT senderId FROM friend_requests WHERE receiverId = ?) LIMIT 20`, [req.user.userId, req.user.userId, req.user.userId]);
    res.json(u);
  } catch (e) { res.status(500).json({ message: "Error" }); }
});

// === NEW: AI FRIEND RECOMMENDATIONS (FIX 2: Sửa route /api/ai/recommend-friends) ===
app.post("/api/ai/recommend-friends", authenticateToken, async (req, res) => {
  const { criteria } = req.body;
  const userId = req.user.userId;
    
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ message: "Chưa cấu hình GEMINI_API_KEY" });
  }

  try {
    const [userInfo] = await db.query(
      "SELECT bio, location, work, education FROM users WHERE id=?", 
      [userId]
    );
        
    if (!userInfo || userInfo.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = userInfo[0];
        
    const [potentialFriends] = await db.query(`
      SELECT id, username, nickname, avatar, bio, location, work, education 
      FROM users 
      WHERE id != ? AND id != 1 
      AND id NOT IN (
        SELECT receiverId FROM friend_requests WHERE senderId = ? 
        UNION 
        SELECT senderId FROM friend_requests WHERE receiverId = ?
      )
      LIMIT 50
    `, [userId, userId, userId]);
    
    if (!potentialFriends || potentialFriends.length === 0) {
      return res.json({ recommendations: [], reasons: [] });
    }

    const prompt = `Bạn là một hệ thống gợi ý bạn bè thông minh cho mạng xã hội. 
    Hãy phân tích và gợi ý 5 người bạn tốt nhất từ danh sách dưới đây dựa trên tiêu chí: "${criteria || 'Những người có cùng sở thích và lĩnh vực công việc'}"
    
    Thông tin người dùng hiện tại:
    - Bio: ${user.bio || 'Không có'}
    - Vị trí: ${user.location || 'Không có'}
    - Công việc: ${user.work || 'Không có'}
    - Giáo dục: ${user.education || 'Không có'}
    
    Danh sách người dùng tiềm năng:
    ${potentialFriends.map((u, i) => `${i+1}. ${u.username} (${u.nickname}) - Bio: ${u.bio || 'Không có'}, Vị trí: ${u.location || 'Không có'}, Công việc: ${u.work || 'Không có'}, Giáo dục: ${u.education || 'Không có'}`).join('\n')}
    
    Trả lời dưới dạng JSON:
    {
      "recommendations": [
        {"id": userId, "username": "...", "reason": "..."}
      ]
    }`;

    const data = await callGeminiAPI(prompt);

    if (!data) {
      return res.status(500).json({ message: "AI đang quá tải, vui lòng thử lại" });
    }

    if (data && data.candidates && data.candidates.length > 0) {
      try {
        const responseText = data.candidates[0].content.parts[0].text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                
        if (!jsonMatch) {
          return res.status(400).json({ message: "Không thể phân tích gợi ý" });
        }
        
        const recommendations = JSON.parse(jsonMatch[0]);
        const recommendedIds = recommendations.recommendations
          .map(r => parseInt(r.id))
          .filter(id => potentialFriends.some(u => u.id === id));
          
        if (recommendedIds.length === 0) {
          return res.json({ recommendations: [], reasons: recommendations.recommendations });
        }
        
        const [detailedUsers] = await db.query(
          `SELECT id, username, nickname, avatar FROM users WHERE id IN (${recommendedIds.join(',')})`,
          []
        );
        
        res.json({ 
          recommendations: detailedUsers, 
          reasons: recommendations.recommendations 
        });
      } catch (parseErr) {
        console.error("Error parsing AI response:", parseErr);
        res.status(400).json({ message: "Lỗi xử lý phản hồi AI" });
      }
    } else {
      res.status(500).json({ message: "AI chưa sẵn sàng" });
    }
  } catch (e) {
    console.error("AI recommendation error:", e);
    res.status(500).json({ message: "Lỗi hệ thống: " + e.message });
  }
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
  } catch (e) { res.status(500).json({ message: "Duplicate" }); }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    await db.query("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [req.body.requestId]);
    res.json({ message: "OK" });
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
    const values = members.map((uid) => [g.insertId, uid]);
    if (values.length > 0) await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [values]);
    await conn.commit();
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
// ===== THÊM CÁC API ENDPOINT NÀY VÀO SERVER.JS =====
// (Thêm sau các API routes hiện có, trước phần SOCKET)

// --- UPDATE PROFILE ---
app.post("/api/profile/update", authenticateToken, async (req, res) => {
  const { nickname, bio, location, work, education, avatar } = req.body;
  const userId = req.user.userId;

  try {
    const [result] = await db.query(
      `UPDATE users SET nickname=?, bio=?, location=?, work=?, education=?, avatar=? WHERE id=?`,
      [nickname, bio, location, work, education, avatar, userId]
    );

    if (result.affectedRows > 0) {
      res.json({ message: "Profile updated successfully" });
    } else {
      res.status(400).json({ message: "Failed to update profile" });
    }
  } catch (e) {
    res.status(500).json({ message: "Error updating profile" });
  }
});

// --- GET POSTS ---
app.get("/api/posts", authenticateToken, async (req, res) => {
  try {
    const [posts] = await db.query(
      `SELECT p.*, u.username, u.nickname, u.avatar FROM posts p 
       JOIN users u ON p.userId = u.id 
       ORDER BY p.createdAt DESC LIMIT 50`
    );
    res.json(posts);
  } catch (e) {
    res.status(500).json({ message: "Error fetching posts" });
  }
});

// --- CREATE POST ---
app.post("/api/posts/create", authenticateToken, async (req, res) => {
  const { content, image } = req.body;
  const userId = req.user.userId;

  if (!content && !image) {
    return res.status(400).json({ message: "Post content or image required" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO posts (userId, content, image, likes) VALUES (?, ?, ?, 0)`,
      [userId, content, image]
    );

    res.status(201).json({
      message: "Post created successfully",
      postId: result.insertId
    });
  } catch (e) {
    res.status(500).json({ message: "Error creating post" });
  }
});

// --- LIKE POST ---
app.post("/api/posts/:postId/like", authenticateToken, async (req, res) => {
  const postId = req.params.postId;

  try {
    const [post] = await db.query(
      `SELECT likes FROM posts WHERE id=?`,
      [postId]
    );

    if (post.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    const newLikes = (post[0].likes || 0) + 1;

    await db.query(
      `UPDATE posts SET likes=? WHERE id=?`,
      [newLikes, postId]
    );

    res.json({ message: "Post liked", likes: newLikes });
  } catch (e) {
    res.status(500).json({ message: "Error liking post" });
  }
});

// --- GET POST COMMENTS ---
app.get("/api/posts/:postId/comments", async (req, res) => {
  const postId = req.params.postId;

  try {
    const [comments] = await db.query(
      `SELECT pc.*, u.username, u.nickname, u.avatar FROM post_comments pc 
       JOIN users u ON pc.userId = u.id 
       WHERE pc.postId=? 
       ORDER BY pc.createdAt DESC`,
      [postId]
    );

    res.json(comments);
  } catch (e) {
    res.status(500).json({ message: "Error fetching comments" });
  }
});

// --- CREATE COMMENT ---
app.post("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  const { content } = req.body;
  const postId = req.params.postId;
  const userId = req.user.userId;

  if (!content || !content.trim()) {
    return res.status(400).json({ message: "Comment content required" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO post_comments (postId, userId, content) VALUES (?, ?, ?)`,
      [postId, userId, content]
    );

    res.status(201).json({
      message: "Comment created",
      commentId: result.insertId
    });
  } catch (e) {
    res.status(500).json({ message: "Error creating comment" });
  }
});

// --- GET STORIES ---
app.get("/api/stories", async (req, res) => {
  try {
    const [stories] = await db.query(
      `SELECT s.*, u.username, u.nickname, u.avatar FROM stories s 
       JOIN users u ON s.userId = u.id 
       WHERE s.expiresAt > NOW() OR s.expiresAt IS NULL 
       ORDER BY s.createdAt DESC LIMIT 50`
    );

    res.json(stories);
  } catch (e) {
    res.status(500).json({ message: "Error fetching stories" });
  }
});

// --- CREATE STORY ---
app.post("/api/stories/create", authenticateToken, async (req, res) => {
  const { image } = req.body;
  const userId = req.user.userId;

  if (!image) {
    return res.status(400).json({ message: "Story image required" });
  }

  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expires in 24 hours

    const [result] = await db.query(
      `INSERT INTO stories (userId, image, expiresAt) VALUES (?, ?, ?)`,
      [userId, image, expiresAt]
    );

    res.status(201).json({
      message: "Story created",
      storyId: result.insertId
    });
  } catch (e) {
    res.status(500).json({ message: "Error creating story" });
  }
});

// --- GET USER PROFILE ---
app.get("/api/users/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const [user] = await db.query(
      `SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?`,
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user[0]);
  } catch (e) {
    res.status(500).json({ message: "Error fetching user" });
  }
});

// --- GET USER POSTS ---
app.get("/api/users/:userId/posts", async (req, res) => {
  const userId = req.params.userId;

  try {
    const [posts] = await db.query(
      `SELECT p.* FROM posts p WHERE p.userId=? ORDER BY p.createdAt DESC LIMIT 20`,
      [userId]
    );

    res.json(posts);
  } catch (e) {
    res.status(500).json({ message: "Error fetching user posts" });
  }
});

// --- REACT TO POST (LIKE, LOVE, etc.) ---
app.post("/api/posts/:postId/react", authenticateToken, async (req, res) => {
  const { type } = req.body;
  const postId = req.params.postId;
  const userId = req.user.userId;

  if (!['like','love','haha','wow','sad','angry'].includes(type)) {
    return res.status(400).json({ message: "Invalid reaction type" });
  }

  try {
    await db.query(
      `INSERT INTO post_reactions (postId, userId, type) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE type=?`,
      [postId, userId, type, type]
    );

    res.json({ message: "Reaction added" });
  } catch (e) {
    res.status(500).json({ message: "Error adding reaction" });
  }
});

// --- DELETE COMMENT ---
app.delete("/api/comments/:commentId", authenticateToken, async (req, res) => {
  const commentId = req.params.commentId;
  const userId = req.user.userId;

  try {
    const [comment] = await db.query(
      `SELECT userId FROM post_comments WHERE id=?`,
      [commentId]
    );

    if (comment.length === 0) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment[0].userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await db.query(`DELETE FROM post_comments WHERE id=?`, [commentId]);

    res.json({ message: "Comment deleted" });
  } catch (e) {
    res.status(500).json({ message: "Error deleting comment" });
  }
});

// --- DELETE POST ---
app.delete("/api/posts/:postId", authenticateToken, async (req, res) => {
  const postId = req.params.postId;
  const userId = req.user.userId;

  try {
    const [post] = await db.query(
      `SELECT userId FROM posts WHERE id=?`,
      [postId]
    );

    if (post.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (post[0].userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await db.query(`DELETE FROM posts WHERE id=?`, [postId]);

    res.json({ message: "Post deleted" });
  } catch (e) {
    res.status(500).json({ message: "Error deleting post" });
  }
});

// ===== END OF NEW API ENDPOINTS =====


// --- SOCKET ---
// (FIX 3: Sửa hàm handleAIChat trong Socket)
async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY) {
    return socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "AI chưa sẵn sàng. Vui lòng kiểm tra cấu hình.",
      createdAt: new Date()
    });
  }
    
  try {
    // Lấy lịch sử cuộc trò chuyện
    const [chatHistory] = await db.query(
      "SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt DESC LIMIT ?",
      [uid, AI_BOT_ID, AI_BOT_ID, uid, MAX_HISTORY]
    );
    
    // Xây dựng context từ lịch sử
    let contextPrompt = `Bạn là một trợ lý ảo thông minh cho mạng xã hội Nexus. Hãy trả lời bằng tiếng Việt.
    
Lịch sử trò chuyện gần đây:
${chatHistory.reverse().map(h => `${h.senderId === AI_BOT_ID ? '🤖 Trợ lý' : '🧑 Người dùng'}: ${h.content}`).join('\n')}

Câu hỏi mới từ người dùng: ${msg}

Hãy trả lời một cách thân thiện, hữu ích và liên quan đến lịch sử cuộc trò chuyện.`;

    const data = await callGeminiAPI(contextPrompt);

    if (!data) {
      return socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: "Xin lỗi, hệ thống AI đang gặp sự cố. Vui lòng thử lại sau.",
        createdAt: new Date()
      });
    }

    if (data.candidates && data.candidates.length > 0) {
      const reply = data.candidates[0].content.parts[0].text;
      const [r] = await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
        [AI_BOT_ID, uid, reply]
      );
            
      socket.emit("newMessage", {
        id: r.insertId,
        senderId: AI_BOT_ID,
        content: reply,
        createdAt: new Date()
      });
            
      console.log("✅ Phản hồi AI gửi thành công");
    } else {
      socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: "Xin lỗi, tôi đang quá tải. Vui lòng thử lại sau.",
        createdAt: new Date()
      });
    }
  } catch (e) {
    console.error("❌ Lỗi AI:", e.message);
    socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "Lỗi hệ thống AI. Vui lòng thử lại.",
      createdAt: new Date()
    });
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
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
