// db.js - Cấu hình kết nối MySQL (Hỗ trợ Render & TiDB Cloud)

import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';

// 1. Đảm bảo đọc các biến từ file .env (nếu chạy cục bộ)
dotenv.config();

const DB_HOST = process.env.DB_HOST || 'localhost';

// Hàm lấy cấu hình SSL linh hoạt (File hoặc Biến môi trường)
const getSSLConfig = () => {
  if (DB_HOST === 'localhost') return undefined; // Localhost không cần SSL

  // Ưu tiên 1: Đọc nội dung CA từ biến môi trường (Dành cho Render)
  if (process.env.DB_CA_CONTENT) {
    console.log("🔒 Đang sử dụng SSL từ biến môi trường DB_CA_CONTENT");
    return {
      ca: process.env.DB_CA_CONTENT,
      rejectUnauthorized: true
    };
  }

  // Ưu tiên 2: Đọc từ file (Dành cho Local nếu có file)
  const caPath = process.env.DB_CA_PATH || './ca.pem';
  if (fs.existsSync(caPath)) {
    console.log(`🔒 Đang sử dụng SSL từ file: ${caPath}`);
    return {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true
    };
  }

  // Nếu không có cả 2 -> Cảnh báo (TiDB bắt buộc phải có SSL)
  console.warn("⚠️ Cảnh báo: Không tìm thấy chứng chỉ SSL (CA). Kết nối có thể thất bại.");
  return { rejectUnauthorized: false }; // Thử kết nối không xác minh (không khuyến khích)
};

const dbConfig = {
  host: DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'chatbot_db',

  // Thiết lập Pool Connection
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true, // Cho phép dùng params kiểu :name (nếu cần)
  
  // Cấu hình SSL
  ssl: getSSLConfig()
};

// Tạo Pool Connection
const pool = mysql.createPool(dbConfig);

// Kiểm tra kết nối ngay khi khởi động
pool.getConnection()
  .then(connection => {
    console.log(`✅ Database connected successfully to ${DB_HOST}!`);
    connection.release();
  })
  .catch(err => {
    console.error("❌ Database connection failed:", err.message);
    if (err.code === 'ENOENT') {
       console.error("💡 Gợi ý: Trên Render, hãy copy nội dung file ca.pem vào biến môi trường 'DB_CA_CONTENT'");
    }
  });

// --- 3. EXPORT CHUẨN ---
const db = {
    // Lưu ý: pool.execute tốt hơn pool.query cho bảo mật, nhưng kén cú pháp hơn. 
    // Nếu gặp lỗi cú pháp SQL, hãy thử đổi thành pool.query(sql, params)
    query: (sql, params) => pool.execute(sql, params),
    getConnection: () => pool.getConnection(),
    pool: pool 
};

export default db;
