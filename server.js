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

// --- CẤU HÌNH CƠ BẢN ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

// Lưu trữ context cuộc trò chuyện với từng user (hiện dùng DB, phần này chỉ để tham khảo)
// const userChatHistory = new Map();
const MAX_HISTORY = 20; // Lưu 20 tin nhắn gần nhất

if (!GEMINI_API_KEY) {
  console.error("❌ CHƯA CẤU HÌNH GEMINI_API_KEY. AI không hoạt động.");
} else {
  console.log("✅ Gemini API Key found.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});
const onlineUsers = {}; // { userId: { socketId, username } }

app.use(express.static("public"));
app.use(express.json());

// --- UPLOAD CONFIG ---
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

let upload;
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  console.log("  Storage: Cloudinary");
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
  console.log("  Storage: Local Disk");
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".webm";
      cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
    },
  });
  upload = multer({ storage });
}

// --- EMAIL CONFIG ---
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

// --- GEMINI AI LOGIC WITH CONTEXT ---
async function callGeminiAPI(prompt) {
  if (!GEMINI_API_KEY) return null;
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
      console.error("❌ Lỗi từ Google API:", errText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error("❌ Lỗi khi gọi API:", err.message);
    return null;
  }
}

// --- API ROUTES ---

// Upload
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

// Auth & User APIs
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ?",
      [email, username]
    );
    if (exists.length > 0)
      return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await transporter.sendMail({
      from: "Nexus",
      to: email,
      subject: "Mã OTP Xác Nhận Đăng Ký",
      html: `<h3>Mã OTP của bạn là: <b>${otp}</b>. Mã có giá trị trong 5 phút.</h3>`,
    });
    res.json({ message: "OK" });
  } catch (e) {
    console.error("Lỗi gửi mail:", e);
    res.status(500).json({ message: "Lỗi gửi mail" });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp)
    return res.status(400).json({ message: "Sai OTP hoặc OTP đã hết hạn" });
  res.json({ message: "OK" });
});

app.post("/api/complete-register", async (req, res) => {
  const { username, password, email, nickname, avatar } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, passwordHash, email, nickname, avatar) VALUES (?, ?, ?, ?, ?)",
      [username, hash, email, nickname, avatar]
    );
    otpStore.delete(email);
    res.status(201).json({ message: "Đăng ký thành công" });
  } catch (e) {
    console.error("Lỗi DB:", e);
    res.status(500).json({ message: "Lỗi DB" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    if (
      !rows[0] ||
      !(await bcrypt.compare(password, rows[0].passwordHash))
    )
      return res.status(400).json({ message: "Sai tên đăng nhập hoặc mật khẩu" });
    const token = jwt.sign(
      { userId: rows[0].id, username: rows[0].username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ message: "Đăng nhập thành công", token });
  } catch (e) {
    console.error("Lỗi:", e);
    res.status(500).json({ message: "Lỗi hệ thống" });
  }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const [r] = await db.query(
      "SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?",
      [req.user.userId]
    );
    if (!r[0]) return res.status(404).json({ message: "User not found" });
    res.json(r[0]);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// Search
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
      `SELECT id, username, nickname, avatar FROM users 
       WHERE id != ? AND id != 1 
       AND id NOT IN (
         SELECT receiverId FROM friend_requests WHERE senderId = ? 
         UNION 
         SELECT senderId FROM friend_requests WHERE receiverId = ?
       ) 
       LIMIT 20`,
      [req.user.userId, req.user.userId, req.user.userId]
    );
    res.json(u);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// === AI FRIEND RECOMMENDATIONS ===
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
      `
      SELECT id, username, nickname, avatar, bio, location, work, education 
      FROM users 
      WHERE id != ? AND id != 1 
      AND id NOT IN (
        SELECT receiverId FROM friend_requests WHERE senderId = ? 
        UNION 
        SELECT senderId FROM friend_requests WHERE receiverId = ?
      )
      LIMIT 50
    `,
      [userId, userId, userId]
    );

    const prompt = `Bạn là một hệ thống gợi ý bạn bè thông minh cho mạng xã hội. 
    Hãy phân tích và gợi ý 5 người bạn tốt nhất từ danh sách dưới đây dựa trên tiêu chí: "${
      criteria || "Những người có cùng sở thích và lĩnh vực công việc"
    }"
    
    Thông tin người dùng hiện tại:
    - Bio: ${user.bio || "Không có"}
    - Vị trí: ${user.location || "Không có"}
    - Công việc: ${user.work || "Không có"}
    - Giáo dục: ${user.education || "Không có"}
    
    Danh sách người dùng tiềm năng:
    ${potentialFriends
      .map(
        (u, i) =>
          `${i + 1}. ${u.username} (${u.nickname}) - Bio: ${
            u.bio || "Không có"
          }, Vị trí: ${u.location || "Không có"}, Công việc: ${
            u.work || "Không có"
          }, Giáo dục: ${u.education || "Không có"}`
      )
      .join("\n")}
    
    Trả lời dưới dạng JSON (chỉ JSON, không có văn bản giải thích):
    {
      "recommendations": [
        {"id": userId, "username": "...", "reason": "Lý do gợi ý..."}
      ]
    }`;

    const data = await callGeminiAPI(prompt);

    if (data && data.candidates && data.candidates.length > 0) {
      const responseText = data.candidates[0].content.parts[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const recommendations = JSON.parse(jsonMatch[0]);
        const recommendedIds = recommendations.recommendations.map((r) => r.id);

        const [detailedUsers] = await db.query(
          `SELECT id, username, nickname, avatar FROM users WHERE id IN (${recommendedIds.join(
            ","
          )})`,
          []
        );

        res.json({
          recommendations: detailedUsers,
          reasons: recommendations.recommendations,
        });
      } else {
        res
          .status(400)
          .json({ message: "Không thể phân tích gợi ý từ AI. Thử lại." });
      }
    } else {
      res.status(500).json({ message: "AI đang quá tải hoặc không phản hồi" });
    }
  } catch (e) {
    console.error("AI recommendation error:", e);
    res.status(500).json({ message: "Lỗi hệ thống" });
  }
});

// Friends & Requests
app.get("/api/friends", authenticateToken, async (req, res) => {
  try {
    const [f] = await db.query(
      `SELECT u.id, u.username, u.nickname, u.avatar 
       FROM users u 
       JOIN friend_requests fr ON (fr.senderId = u.id OR fr.receiverId = u.id) 
       WHERE (fr.senderId = ? OR fr.receiverId = ?) AND fr.status = 'accepted' AND u.id != ?`,
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
      `SELECT fr.id, u.username, u.nickname, u.avatar, fr.createdAt, 'request' AS type 
       FROM friend_requests fr 
       JOIN users u ON fr.senderId = u.id 
       WHERE fr.receiverId = ? AND fr.status = 'pending'`,
      [req.user.userId]
    );
    res.json(reqs);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try {
    const { receiverId } = req.body;
    if (req.user.userId == receiverId)
      return res.status(400).json({ message: "Không thể tự kết bạn" });
    await db.query(
      "INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)",
      [req.user.userId, receiverId]
    );
    res.json({ message: "OK" });
    // TODO: Emit socket event for notification
  } catch (e) {
    res.status(500).json({ message: "Lỗi, có thể đã gửi yêu cầu trước đó" });
  }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.body;
    const [result] = await db.query(
      "UPDATE friend_requests SET status = 'accepted' WHERE id = ? AND receiverId = ?",
      [requestId, req.user.userId]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Yêu cầu không hợp lệ" });
    res.json({ message: "OK" });
    // TODO: Emit socket event
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// Group APIs
app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!name || !members || members.length < 1)
    return res.status(400).json({ message: "Thiếu thông tin" });
  if (!members.includes(creatorId)) members.push(creatorId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query(
      "INSERT INTO groups (name, creatorId) VALUES (?, ?)",
      [name, creatorId]
    );
    const groupId = g.insertId;
    const values = members.map((uid) => [groupId, uid]);
    if (values.length > 0)
      await conn.query(
        "INSERT INTO group_members (groupId, userId) VALUES ?",
        [values]
      );
    await conn.commit();
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [
      groupId,
    ]);
    const groupData = gInfo[0];
    members.forEach((uid) => {
      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid].socketId).emit("newGroupAdded", groupData);
        const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
        if (s) s.join(`group_${groupId}`); // Thêm user vào phòng group
      }
    });
    res.json({ message: "OK", group: groupData });
  } catch (e) {
    console.error("Lỗi tạo nhóm:", e);
    await conn.rollback();
    res.status(500).json({ message: "Error" });
  } finally {
    conn.release();
  }
});

app.get("/api/groups", authenticateToken, async (req, res) => {
  try {
    const [groups] = await db.query(
      `SELECT g.id, g.name, g.avatar, g.creatorId, g.createdAt 
       FROM groups g 
       JOIN group_members gm ON g.id = gm.groupId 
       WHERE gm.userId = ?`,
      [req.user.userId]
    );
    res.json(groups);
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

// --- SOCKET.IO LOGIC ---

// Xử lý chat với AI
async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY)
    return socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "AI chưa sẵn sàng.",
      createdAt: new Date(),
    });

  try {
    // Lấy lịch sử cuộc trò chuyện
    const [chatHistory] = await db.query(
      "SELECT content, senderId FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt DESC LIMIT ?",
      [uid, AI_BOT_ID, AI_BOT_ID, uid, MAX_HISTORY]
    );

    // Xây dựng context từ lịch sử
    let contextPrompt = `Bạn là một trợ lý ảo thông minh cho mạng xã hội Nexus. Hãy trả lời bằng tiếng Việt.
    
Lịch sử trò chuyện gần đây (từ cũ đến mới):
${chatHistory
      .reverse()
      .map(
        (h) =>
          `${h.senderId === AI_BOT_ID ? "🤖 Trợ lý" : "👤 Người dùng"}: ${
            h.content
          }`
      )
      .join("\n")}

Câu hỏi mới từ người dùng: ${msg}

Hãy trả lời một cách thân thiện, hữu ích và liên quan đến lịch sử cuộc trò chuyện.`;

    const data = await callGeminiAPI(contextPrompt);

    if (data && data.candidates && data.candidates.length > 0) {
      const reply = data.candidates[0].content.parts[0].text;
      const [r] = await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
        [AI_BOT_ID, uid, reply]
      );
      socket.emit("newMessage", {
        id: r.insertId,
        senderId: AI_BOT_ID,
        content: reply,
        createdAt: new Date(),
      });
      console.log("✅ Phản hồi AI gửi thành công");
    } else {
      socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: "Xin lỗi, tôi đang quá tải. Vui lòng thử lại sau.",
        createdAt: new Date(),
      });
    }
  } catch (e) {
    socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "Lỗi hệ thống AI. Vui lòng thử lại.",
      createdAt: new Date(),
    });
    console.error("❌ Lỗi AI:", e.message);
  }
}

// Middleware xác thực Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Auth Error: Token Missing"));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error("Auth Error: Invalid Token"));
    socket.user = user;
    next();
  });
});

io.on("connection", async (socket) => {
  const { userId } = socket.user;
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };

  // 1. Gửi danh sách user online
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

  // 2. Tham gia phòng nhóm
  const [groups] = await db.query(
    "SELECT groupId FROM group_members WHERE userId = ?",
    [userId]
  );
  groups.forEach((g) => socket.join(`group_${g.groupId}`));
  console.log(`User ${userId} connected, joined ${groups.length} groups.`);

  // --- EVENTS ---

  // Tin nhắn cá nhân
  socket.on("privateMessage", async (data) => {
    const { recipientId, content, ttl, attachments } = data;
    if (!recipientId || !content) return;

    // Chat với AI
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

    // Chat với người dùng khác
    const [r] = await db.query(
      "INSERT INTO messages (senderId, recipientId, content, attachments) VALUES (?, ?, ?, ?)",
      [userId, recipientId, content, JSON.stringify(attachments || [])]
    );
    const msg = {
      id: r.insertId,
      senderId: userId,
      content,
      createdAt: new Date(),
      ttl,
      attachments,
    };
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("newMessage", msg);
    socket.emit("newMessage", msg);
    if (ttl)
      setTimeout(async () => {
        await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]);
        // Gửi thông báo xóa tin nhắn
        if (onlineUsers[recipientId])
          io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", {
            messageId: r.insertId,
          });
        socket.emit("messageDeleted", { messageId: r.insertId });
      }, ttl);
  });

  // Tin nhắn nhóm
  socket.on("groupMessage", async (data) => {
    const { groupId, content, attachments } = data;
    if (!groupId || !content) return;
    const [member] = await db.query(
      "SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?",
      [groupId, userId]
    );
    if (member.length === 0) return;

    const [r] = await db.query(
      "INSERT INTO messages (senderId, groupId, content, attachments) VALUES (?, ?, ?, ?)",
      [userId, groupId, content, JSON.stringify(attachments || [])]
    );
    const msg = {
      id: r.insertId,
      senderId: userId,
      groupId,
      content,
      createdAt: new Date(),
      attachments,
    };
    io.to(`group_${groupId}`).emit("newGroupMessage", msg);
  });

  // Xóa cuộc trò chuyện
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

  // Xóa tin nhắn cá nhân
  socket.on("deleteMessage", async ({ messageId, recipientId, groupId }) => {
    if (groupId) {
      // Xóa tin nhắn nhóm
      const [r] = await db.query(
        "DELETE FROM messages WHERE id = ? AND senderId = ? AND groupId = ?",
        [messageId, userId, groupId]
      );
      if (r.affectedRows > 0)
        io.to(`group_${groupId}`).emit("messageDeleted", { messageId });
    } else {
      // Xóa tin nhắn cá nhân
      const [r] = await db.query(
        "DELETE FROM messages WHERE id = ? AND senderId = ?",
        [messageId, userId]
      );
      if (r.affectedRows > 0) {
        socket.emit("messageDeleted", { messageId });
        if (recipientId && onlineUsers[recipientId])
          io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", {
            messageId,
          });
      }
    }
  });

  // Tải lịch sử chat cá nhân
  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    const [msgs] = await db.query(
      "SELECT id, senderId, content, createdAt, attachments, ttl FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC",
      [userId, recipientId, recipientId, userId]
    );
    const messages = msgs.map((m) => ({
      ...m,
      attachments: JSON.parse(m.attachments || "[]"),
    }));
    socket.emit("privateHistory", { recipientId, messages });
  });

  // Tải lịch sử chat nhóm
  socket.on("loadGroupHistory", async ({ groupId }) => {
    const [member] = await db.query(
      "SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?",
      [groupId, userId]
    );
    if (member.length === 0)
      return socket.emit("groupHistoryError", {
        groupId,
        message: "Không phải thành viên nhóm",
      });

    const [msgs] = await db.query(
      "SELECT id, senderId, content, createdAt, attachments FROM messages WHERE groupId = ? ORDER BY createdAt ASC",
      [groupId]
    );
    const messages = msgs.map((m) => ({
      ...m,
      attachments: JSON.parse(m.attachments || "[]"),
    }));
    socket.emit("groupHistory", { groupId, messages });
  });

  // Gửi Heart (Animation)
  socket.on("sendHeart", ({ recipientId }) => {
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("heartAnimation", {
        senderId: userId,
      });
  });

  // CÁC SỰ KIỆN GỌI ĐIỆN (Call/WebRTC)
  socket.on("callOffer", async (d) => {
    const rec = onlineUsers[d.recipientId];
    if (rec) {
      const [u] = await db.query(
        "SELECT username, nickname, avatar FROM users WHERE id=?",
        [userId]
      );
      const avt =
        u[0].avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          u[0].nickname || u[0].username
        )}`;
      io.to(rec.socketId).emit("callOffer", {
        ...d,
        senderId: userId,
        senderName: u[0].nickname || u[0].username,
        senderAvatar: avt,
      });
    }
  });
  socket.on("callAnswer", (d) =>
    onlineUsers[d.recipientId] &&
    io.to(onlineUsers[d.recipientId].socketId).emit("callAnswer", {
      ...d,
      senderId: userId,
    })
  );
  socket.on("sendICE", (d) =>
    onlineUsers[d.recipientId] &&
    io.to(onlineUsers[d.recipientId].socketId).emit("receiveICE", {
      ...d,
      senderId: userId,
    })
  );
  socket.on("callEnd", (d) =>
    onlineUsers[d.recipientId] &&
    io.to(onlineUsers[d.recipientId].socketId).emit("callEnd")
  );
  socket.on("callReject", (d) =>
    onlineUsers[d.callerId] &&
    io.to(onlineUsers[d.callerId].socketId).emit("callReject", {
      senderId: userId,
    })
  );

  // Ngắt kết nối
  socket.on("disconnect", () => {
    delete onlineUsers[userId];
    sendUserList();
    console.log(`User ${userId} disconnected.`);
  });
});

// --- SERVE STATIC FILES ---
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
