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
import fetch from "node-fetch"; // <-- đảm bảo node-fetch được cài và import (ESM)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_nexus_2025";
const AI_BOT_ID = 1;

// Lưu trữ context cuộc trò chuyện với từng user (chi tiết nếu cần mở rộng)
const MAX_HISTORY = 20; // Lưu 20 tin nhắn gần nhất

if (!GEMINI_API_KEY) {
  console.warn("⚠️ CHƯA CẤU HÌNH GEMINI_API_KEY. AI sẽ không hoạt động.");
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

// Auth & User APIs
app.post("/api/send-otp", async (req, res) => {
  const { email, username } = req.body;
  try {
    const [exists] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ?",
      [email, username]
    );
    if (exists.length > 0) return res.status(400).json({ message: "Đã tồn tại!" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, expires: Date.now() + 300000 });
    await transporter.sendMail({
      from: "Nexus",
      to: email,
      subject: "OTP",
      html: `<h3>OTP: <b>${otp}</b></h3>`,
    });
    res.json({ message: "OK" });
  } catch (e) {
    console.error("send-otp error:", e);
    res.status(500).json({ message: "Lỗi mail" });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore.get(email);
  if (!data || Date.now() > data.expires || data.otp !== otp)
    return res.status(400).json({ message: "Sai OTP" });
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
    res.status(201).json({ message: "OK" });
  } catch (e) {
    console.error("complete-register error:", e);
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
    console.error("login error:", e);
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const [r] = await db.query(
      "SELECT id, username, nickname, email, avatar, bio, location, work, education FROM users WHERE id=?",
      [req.user.userId]
    );
    res.json(r[0]);
  } catch (e) {
    console.error("/api/me error:", e);
    res.status(500).json({ message: "Error" });
  }
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
    console.error("/api/users/search error:", e);
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
    console.error("/api/users/suggestions error:", e);
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
    console.error("/api/friends error:", e);
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
    console.error("/api/notifications error:", e);
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
    console.error("/api/friends/request error:", e);
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
    console.error("/api/friends/accept error:", e);
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  const memberList = Array.isArray(members) ? [...members] : [];
  if (!memberList.includes(creatorId)) memberList.push(creatorId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [g] = await conn.query(
      "INSERT INTO groups (name, creatorId) VALUES (?, ?)",
      [name, creatorId]
    );
    const values = memberList.map((uid) => [g.insertId, uid]);
    if (values.length > 0)
      await conn.query("INSERT INTO group_members (groupId, userId) VALUES ?", [
        values,
      ]);
    await conn.commit();
    const [gInfo] = await db.query("SELECT * FROM groups WHERE id=?", [
      g.insertId,
    ]);

    memberList.forEach((uid) => {
      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid].socketId).emit("newGroupAdded", gInfo[0]);
        const s = io.sockets.sockets.get(onlineUsers[uid].socketId);
        if (s) s.join(`group_${g.insertId}`);
      }
    });
    res.json({ message: "OK" });
  } catch (e) {
    await conn.rollback();
    console.error("/api/groups/create error:", e);
    res.status(500).json({ message: "Error" });
  } finally {
    conn.release();
  }
});

// === AI FRIEND RECOMMENDATIONS ===
app.post("/api/ai/recommend-friends", authenticateToken, async (req, res) => {
  const { criteria } = req.body;
  const userId = req.user.userId;

  if (!GEMINI_API_KEY) {
    return res.status(503).json({ message: "AI chưa được cấu hình" });
  }

  try {
    const [userInfo] = await db.query(
      "SELECT bio, location, work, education FROM users WHERE id=?",
      [userId]
    );
    const user = userInfo[0] || {};

    const [potentialFriends] = await db.query(`
      SELECT id, username, nickname, avatar, bio, location, work, education 
      FROM users 
      WHERE id != ? AND id != 1 
      AND id NOT IN (
        SELECT receiverId FROM friend_requests WHERE senderId = ? AND status = 'accepted'
        UNION 
        SELECT senderId FROM friend_requests WHERE receiverId = ? AND status = 'accepted'
      )
      AND id NOT IN (
        SELECT receiverId FROM friend_requests WHERE senderId = ? AND status = 'pending'
        UNION 
        SELECT senderId FROM friend_requests WHERE receiverId = ? AND status = 'pending'
      )
      LIMIT 50
    `, [userId, userId, userId, userId, userId]);

    if (!potentialFriends || potentialFriends.length === 0) {
      return res.json({ recommendations: [], reasons: [] });
    }

    const prompt = `Bạn là hệ thống AI gợi ý bạn bè thông minh.\n\nThông tin người dùng:\n- Bio: ${user.bio || "Chưa có"}\n- Vị trí: ${user.location || "Chưa có"}\n- Công việc: ${user.work || "Chưa có"}\n- Học vấn: ${user.education || "Chưa có"}\n\nTiêu chí tìm kiếm: "${criteria || "Những người phù hợp nhất"}"\n\nDanh sách ${potentialFriends.length} người dùng:\n${potentialFriends
      .map(
        (u, i) =>
          `${i + 1}. ID: ${u.id}, Username: ${u.username}, Nickname: ${u.nickname}\n   Bio: ${u.bio || "Không có"}\n   Vị trí: ${u.location || "Không có"}\n   Công việc: ${u.work || "Không có"}\n   Học vấn: ${u.education || "Không có"}`
      )
      .join("\n\n")}\n\nHãy phân tích và gợi ý TOP 5 người phù hợp nhất. Trả lời CHÍNH XÁC theo định dạng JSON này:\n{\n  "recommendations": [\n    {"id": 123, "username": "abc", "reason": "Lý do cụ thể tại sao phù hợp"}\n  ]\n}\n\nLƯU Ý: \n- ID phải là số nguyên chính xác từ danh sách\n- Reason phải ngắn gọn, cụ thể (1-2 câu)\n- Chỉ trả về JSON, không thêm text nào khác`;

    const messages = [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ];

    const data = await callGeminiAPI(messages);

    if (data && data.candidates && data.candidates.length > 0) {
      const responseText =
        data.candidates[0]?.content?.parts?.[0]?.text ||
        (data.candidates[0] && JSON.stringify(data.candidates[0])) ||
        "";

      // Trích xuất JSON an toàn
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in AI response");
        const parsed = JSON.parse(jsonMatch[0]);
        const recommendedIds = parsed.recommendations.map((r) => parseInt(r.id));

        const [detailedUsers] = await db.query(
          `SELECT id, username, nickname, avatar FROM users WHERE id IN (?)`,
          [recommendedIds]
        );

        const finalRecommendations = detailedUsers.map((u) => {
          const reason = parsed.recommendations.find((r) => parseInt(r.id) === u.id);
          return {
            ...u,
            reason: reason ? reason.reason : "Người dùng phù hợp",
          };
        });

        res.json({
          recommendations: finalRecommendations,
          total: finalRecommendations.length,
        });
      } catch (err) {
        console.warn("⚠️ Không parse được JSON từ AI:", responseText, err);
        return res.status(400).json({ message: "AI trả về không hợp lệ" });
      }
    } else {
      console.warn("⚠️ AI không phản hồi or malformed response", data);
      res.status(500).json({ message: "AI không phản hồi" });
    }
  } catch (e) {
    console.error("❌ AI recommendation error:", e);
    res.status(500).json({ message: "Lỗi hệ thống: " + e.message });
  }
});

// --- GEMINI AI LOGIC WITH CONTEXT ---
async function callGeminiAPI(messages) {
  if (!GEMINI_API_KEY) return null;
  const modelName = "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // Build payload: ensure contents is an array of { role, parts }
    const payload = {
      contents: messages.map((m) => ({ role: m.role, parts: m.parts })),
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Lỗi từ Google API:`, data);
      return null;
    }

    return data;
  } catch (err) {
    console.error(`❌ Lỗi khi gọi API:`, err.message);
    return null;
  }
}

// --- SOCKET AI CHAT HANDLER ---
async function handleAIChat(msg, uid, socket) {
  if (!GEMINI_API_KEY) {
    return socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: "⚠️ AI chưa được cấu hình. Vui lòng liên hệ quản trị viên.",
      createdAt: new Date(),
    });
  }

  try {
    // Lấy lịch sử cuộc trò chuyện từ database (mới nhất trước rồi đảo lại)
    const [chatHistory] = await db.query(
      `SELECT content, senderId, createdAt 
       FROM messages 
       WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) 
       ORDER BY createdAt DESC 
       LIMIT ?`,
      [uid, AI_BOT_ID, AI_BOT_ID, uid, MAX_HISTORY]
    );

    const systemPrompt = {
      role: "user",
      parts: [
        {
          text: `Bạn là trợ lý ảo thông minh tên "Nexus AI" cho mạng xã hội Nexus. \nNhiệm vụ của bạn:\n- Trả lời bằng tiếng Việt thân thiện, tự nhiên\n- Hỗ trợ người dùng về các tính năng mạng xã hội\n- Gợi ý bạn bè, nhóm, hoạt động\n- Trò chuyện như một người bạn thật sự\n- Nhớ ngữ cảnh cuộc trò chuyện trước đó`,
        },
      ],
    };

    const messages = [systemPrompt];

    // Thêm lịch sử chat (đảo ngược để đúng thứ tự thời gian)
    if (Array.isArray(chatHistory)) {
      chatHistory.reverse().forEach((h) => {
        if (h.senderId === AI_BOT_ID) {
          messages.push({ role: "model", parts: [{ text: h.content }] });
        } else {
          messages.push({ role: "user", parts: [{ text: h.content }] });
        }
      });
    }

    // Thêm tin nhắn mới nhất từ user
    messages.push({ role: "user", parts: [{ text: msg }] });

    console.log(`🤖 Đang xử lý câu hỏi từ user ${uid}:`, msg);

    const data = await callGeminiAPI(messages);

    if (data && data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];

      // Kiểm tra finishReason (safety, stop, length, etc.)
      if (candidate.finishReason === "SAFETY") {
        const reply =
          "Xin lỗi, tôi không thể trả lời câu hỏi này do vi phạm chính sách an toàn nội dung. Bạn có thể hỏi tôi điều gì khác không? 😊";

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
        return;
      }

      // An toàn khi lấy text
      const replyText = candidate?.content?.parts?.[0]?.text?.trim();
      const reply = replyText ||
        "Xin lỗi, tôi chưa hiểu ý bạn. Bạn có thể nói rõ hơn không? 😊";

      // Lưu phản hồi vào database
      const [r] = await db.query(
        "INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)",
        [AI_BOT_ID, uid, reply]
      );

      // Gửi phản hồi cho user
      socket.emit("newMessage", {
        id: r.insertId,
        senderId: AI_BOT_ID,
        content: reply,
        createdAt: new Date(),
      });

      console.log(`✅ AI phản hồi thành công cho user ${uid}`);
    } else {
      // Không có phản hồi hợp lệ
      const errorMsg =
        "Xin lỗi, tôi đang gặp chút vấn đề. Bạn có thể thử lại không? 🤔";

      socket.emit("newMessage", {
        senderId: AI_BOT_ID,
        content: errorMsg,
        createdAt: new Date(),
      });

      console.warn(`⚠️ Không nhận được phản hồi hợp lệ từ AI`, data);
    }
  } catch (e) {
    console.error(`❌ Lỗi AI:`, e.message, e.stack);

    const errorMsg = "Rất xin lỗi, có lỗi xảy ra. Bạn vui lòng thử lại sau nhé! 😅";

    socket.emit("newMessage", {
      senderId: AI_BOT_ID,
      content: errorMsg,
      createdAt: new Date(),
    });
  }
}

// --- SOCKET.IO ---
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
  const { userId } = socket.user;
  onlineUsers[userId] = { socketId: socket.id, username: socket.user.username };

  const sendUserList = async () => {
    try {
      const [users] = await db.query("SELECT id, username, nickname, avatar FROM users");
      const list = users.map((u) => ({
        ...u,
        online: !!onlineUsers[u.id] || u.id === AI_BOT_ID,
      }));
      io.emit("userList", list);
    } catch (e) {
      console.error("sendUserList error:", e);
    }
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
        try {
          await db.query("DELETE FROM messages WHERE id = ?", [r.insertId]);
        } catch (e) {
          console.error("TTL delete failed:", e);
        }
      }, ttl);
  });

  socket.on("deleteConversation", async ({ recipientId }) => {
    try {
      await db.query(
        "DELETE FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?)",
        [userId, recipientId, recipientId, userId]
      );
      socket.emit("conversationDeleted", { partnerId: recipientId });
      if (onlineUsers[recipientId])
        io.to(onlineUsers[recipientId].socketId).emit("conversationDeleted", {
          partnerId: userId,
        });
    } catch (e) {
      console.error("deleteConversation error:", e);
    }
  });

  socket.on("deleteMessage", async ({ messageId, recipientId }) => {
    try {
      await db.query("DELETE FROM messages WHERE id = ? AND senderId = ?", [
        messageId,
        userId,
      ]);
      socket.emit("messageDeleted", { messageId });
      if (onlineUsers[recipientId])
        io.to(onlineUsers[recipientId].socketId).emit("messageDeleted", {
          messageId,
        });
    } catch (e) {
      console.error("deleteMessage error:", e);
    }
  });

  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    try {
      const [msgs] = await db.query(
        "SELECT * FROM messages WHERE (senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?) ORDER BY createdAt ASC",
        [userId, recipientId, recipientId, userId]
      );
      socket.emit("privateHistory", { recipientId, messages: msgs });
    } catch (e) {
      console.error("loadPrivateHistory error:", e);
    }
  });

  socket.on("sendHeart", ({ recipientId }) => {
    if (onlineUsers[recipientId])
      io.to(onlineUsers[recipientId].socketId).emit("heartAnimation");
  });

  socket.on("callOffer", async (d) => {
    const rec = onlineUsers[d.recipientId];
    if (rec) {
      try {
        const [u] = await db.query("SELECT username, nickname, avatar FROM users WHERE id=?", [userId]);
        const avt =
          u[0].avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(u[0].nickname)}`;
        io.to(rec.socketId).emit("callOffer", {
          ...d,
          senderId: userId,
          senderName: u[0].nickname || u[0].username,
          senderAvatar: avt,
        });
      } catch (e) {
        console.error("callOffer error:", e);
      }
    }
  });
  socket.on(
    "callAnswer",
    (d) =>
      onlineUsers[d.recipientId] &&
      io
        .to(onlineUsers[d.recipientId].socketId)
        .emit("callAnswer", { ...d, senderId: userId })
  );
  socket.on(
    "sendICE",
    (d) =>
      onlineUsers[d.recipientId] &&
      io
        .to(onlineUsers[d.recipientId].socketId)
        .emit("receiveICE", { ...d, senderId: userId })
  );
  socket.on(
    "callEnd",
    (d) =>
      onlineUsers[d.recipientId] &&
      io.to(onlineUsers[d.recipientId].socketId).emit("callEnd")
  );
  socket.on(
    "callReject",
    (d) =>
      onlineUsers[d.callerId] &&
      io
        .to(onlineUsers[d.callerId].socketId)
        .emit("callReject", { senderId: userId })
  );

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
