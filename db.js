// Tên file: db.js (ĐÃ CẬP NHẬT CHO CHAT NHÓM)
import mysql from 'mysql2/promise';

/*
  --- Bảng database nha  ---
  Chạy các lệnh này trong công cụ MySQL của bạn (phpMyAdmin, Workbench):
  
  USE chatbot_db; -- Đảm bảo bạn đang dùng đúng database

  -- Bảng users giữ nguyên
  
  -- 1. Bảng tin nhắn 1-1 (Giữ nguyên)
  DROP TABLE IF EXISTS messages; 
  CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    senderId INT NOT NULL,
    recipientId INT NOT NULL,
    content TEXT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (recipientId) REFERENCES users(id)
  );

  -- 2. Bảng lưu thông tin nhóm
  DROP TABLE IF EXISTS groups;
  CREATE TABLE groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    creatorId INT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creatorId) REFERENCES users(id)
  );

  -- 3. Bảng liên kết User và Nhóm (Ai ở trong nhóm nào)
  DROP TABLE IF EXISTS group_members;
  CREATE TABLE group_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    groupId INT NOT NULL,
    userId INT NOT NULL,
    joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY (groupId, userId) -- Đảm bảo mỗi user chỉ ở trong nhóm 1 lần
  );

  -- 4. Bảng tin nhắn nhóm
  DROP TABLE IF EXISTS group_messages;
  CREATE TABLE group_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    groupId INT NOT NULL,
    senderId INT NOT NULL,
    content TEXT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (senderId) REFERENCES users(id)
  );
*/
// ----------------------------------------

// Cấu hình kết nối database (giữ nguyên, đảm bảo mật khẩu đúng)
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // <-- Nhập mật khẩu CỦA BẠN (nếu có)
  database: 'chatbot_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Thêm 2 dòng này để xử lý Promise và Transaction tốt hơn
  namedPlaceholders: true,
});

// Kiểm tra kết nối
pool.getConnection()
  .then(connection => {
    console.log('✅ Kết nối Database MySQL thành công!');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Lỗi kết nối Database:', err.message);
    if (err.code === 'ER_BAD_DB_ERROR') {
         console.error('Lỗi: Database "chatbot_db" không tồn tại. Vui lòng tạo nó trước.');
    } else if (err.code === 'ECONNREFUSED') {
         console.error('Lỗi: Không thể kết nối đến MySQL server. Server có đang chạy không?');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
         console.error('Lỗi: Sai user hoặc mật khẩu MySQL.');
    }
  });

export default pool;