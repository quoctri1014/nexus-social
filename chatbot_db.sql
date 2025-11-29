USE chatbot_db;

-- Sửa: Không xóa bảng users, chỉ tạo nếu chưa có
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- (SỬA LỖI) Thêm một user đặc biệt cho AI với ID = 0
-- Điều này là BẮT BUỘC để ràng buộc khóa ngoại (FOREIGN KEY) hoạt động
-- Chạy lệnh này MỘT LẦN DUY NHẤT sau khi tạo bảng users
INSERT INTO users (id, username, passwordHash) VALUES (0, 'Trợ lý AI', 'no_password_needed') ON DUPLICATE KEY UPDATE username='Trợ lý AI';


-- 1. Bảng tin nhắn 1-1
-- Sửa: Không xóa bảng, chỉ tạo nếu chưa có
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  senderId INT NOT NULL,
  recipientId INT NOT NULL,
  content TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (senderId) REFERENCES users(id),
  FOREIGN KEY (recipientId) REFERENCES users(id),
  INDEX idx_messages_sender_recipient (senderId, recipientId), -- INDEX MỚI
  INDEX idx_messages_recipient_sender (recipientId, senderId)  -- INDEX MỚI
);

-- 2. Bảng lưu thông tin nhóm
-- Sửa: Không xóa bảng, chỉ tạo nếu chưa có
CREATE TABLE IF NOT EXISTS groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  creatorId INT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creatorId) REFERENCES users(id)
);

-- 3. Bảng liên kết User và Nhóm (Ai ở trong nhóm nào)
-- Sửa: Không xóa bảng, chỉ tạo nếu chưa có
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupId INT NOT NULL,
  userId INT NOT NULL,
  joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY (groupId, userId)
);

-- 4. Bảng tin nhắn nhóm
-- Sửa: Không xóa bảng, chỉ tạo nếu chưa có
CREATE TABLE IF NOT EXISTS group_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupId INT NOT NULL,
  senderId INT NOT NULL,
  content TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (senderId) REFERENCES users(id),
  INDEX idx_group_messages_groupid (groupId) -- INDEX MỚI
);
