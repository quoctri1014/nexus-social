// db.js - Cấu hình kết nối MySQL an toàn (cho TiDB Cloud)

import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';

// 1. Đảm bảo đọc các biến từ file .env (nếu chạy cục bộ)
dotenv.config();

const DB_CA_PATH = process.env.DB_CA_PATH || './ca.pem';
const DB_HOST = process.env.DB_HOST || 'localhost';

const dbConfig = {
  // Lấy từ Biến Môi Trường (Quan trọng khi Deploy)
  host: DB_HOST,
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '', // Nếu đang chạy local
  database: process.env.DB_DATABASE || 'chatbot_db',

  // Thiết lập Pool Connection
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,

  // --- 2. CẤU HÌNH TLS/SSL CHO TiDB CLOUD ---
  // Chỉ thêm cấu hình SSL nếu host không phải là localhost (nghĩa là đang kết nối công khai)
  ...(DB_HOST !== 'localhost' ? {
      ssl: {
        // Đọc nội dung file chứng chỉ CA (.pem) đã tải xuống
        ca: fs.readFileSync(DB_CA_PATH),
        // Bật xác minh máy chủ
        rejectUnauthorized: true 
      }
  } : {})
};

// Tạo Pool Connection
const pool = mysql.createPool(dbConfig);

// Kiểm tra kết nối
pool.getConnection()
  .then(connection => {
    console.log("✅ Database connected successfully!");
    connection.release();
  })
  .catch(err => {
    console.error("❌ Database connection failed:", err.message);
    if (err.code === 'ER_BAD_DB_ERROR') {
      console.error('Lỗi: Database không tồn tại.');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error(`Lỗi: Không thể kết nối đến host ${DB_HOST}. Server database có đang chạy không?`);
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Lỗi: Sai user hoặc mật khẩu database.');
    } else if (err.code === 'ENOENT' && DB_HOST !== 'localhost') {
        console.error(`Lỗi: Không tìm thấy file chứng chỉ CA tại đường dẫn: ${DB_CA_PATH}.`);
    }
    process.exit(1);
  });


// --- 3. EXPORT CHUẨN ---
// Export module để server.js có thể sử dụng (ví dụ: db.query(...))
const db = {
    query: (sql, params) => pool.execute(sql, params),
    getConnection: () => pool.getConnection(),
    pool: pool 
};

export default db;
