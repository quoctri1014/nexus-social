// public/auth.js - XỬ LÝ ĐĂNG NHẬP & ĐĂNG KÝ (KHÔNG DÙNG SOCKET)

document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const token = localStorage.getItem("token");

  // --- 1. KIỂM TRA ĐIỀU HƯỚNG ---
  // Nếu đã có token mà người dùng cố vào trang Login hoặc Register -> Đẩy vào Home
  if (token) {
    // Kiểm tra xem đang ở trang auth hay không dựa trên sự tồn tại của form
    if (
      document.getElementById("login-form") ||
      document.getElementById("step-1-form")
    ) {
      window.location.href = "/home.html";
      return;
    }
  }

  // --- 2. HÀM HIỂN THỊ THÔNG BÁO ---
  function displayAuthMessage(message, isError = true) {
    const msgElement = document.getElementById("auth-message");
    if (!msgElement) return;
    msgElement.textContent = message;
    msgElement.style.display = "block";
    msgElement.className = isError
      ? "message-display error"
      : "message-display success";
  }

  // ============================================================
  // 3. LOGIC ĐĂNG NHẬP (index.html)
  // ============================================================
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault(); // QUAN TRỌNG: Chặn load lại trang

      // UI Loading
      const btn = loginForm.querySelector("button");
      const originalText = btn.textContent;
      btn.textContent = "Đang đăng nhập...";
      btn.disabled = true;

      const username = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();

        if (res.ok) {
          localStorage.setItem("token", data.token);
          window.location.href = "/home.html"; // Chuyển trang thành công
        } else {
          displayAuthMessage(data.message, true);
          btn.textContent = originalText;
          btn.disabled = false;
        }
      } catch (err) {
        displayAuthMessage("Lỗi kết nối server!", true);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
  }

  // ============================================================
  // 4. LOGIC ĐĂNG KÝ (register.html)
  // ============================================================
  const step1Form = document.getElementById("step-1-form");

  // Chỉ chạy logic đăng ký nếu tìm thấy form bước 1
  if (step1Form) {
    const step2Form = document.getElementById("step-2-form");
    const step3Form = document.getElementById("step-3-form");
    let regData = {}; // Lưu tạm thông tin giữa các bước

    // --- BƯỚC 1: GỬI OTP ---
    step1Form.addEventListener("submit", async (e) => {
      e.preventDefault(); // Chặn load lại trang

      const btn = step1Form.querySelector("button");
      const originalText = btn.textContent;
      btn.textContent = "Đang gửi OTP...";
      btn.disabled = true;

      const username = document.getElementById("reg-username").value.trim();
      const email = document.getElementById("reg-email").value.trim();
      const password = document.getElementById("reg-password").value;
      const confirm = document.getElementById("reg-confirm-password").value;

      if (password !== confirm) {
        displayAuthMessage("Mật khẩu nhập lại không khớp!", true);
        btn.textContent = originalText;
        btn.disabled = false;
        return;
      }

      try {
        const res = await fetch("/api/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, username }),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.message);

        // Lưu lại dữ liệu để dùng ở bước 3
        regData = { username, email, password };

        displayAuthMessage("Đã gửi OTP! Vui lòng kiểm tra Email.", false);
        step1Form.classList.add("hidden");
        step2Form.classList.remove("hidden");

        const loginLink = document.getElementById("login-link");
        if (loginLink) loginLink.classList.add("hidden");
      } catch (e) {
        displayAuthMessage(e.message, true);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });

    // --- BƯỚC 2: XÁC THỰC OTP ---
    if (step2Form) {
      step2Form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const btn = step2Form.querySelector("button");
        const originalText = btn.textContent;
        btn.textContent = "Đang kiểm tra...";
        btn.disabled = true;

        const otp = document.getElementById("reg-otp").value.trim();
        try {
          const res = await fetch("/api/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: regData.email, otp }),
          });
          const data = await res.json();

          if (!res.ok) throw new Error(data.message);

          displayAuthMessage("Xác thực thành công! Hãy tạo hồ sơ.", false);
          step2Form.classList.add("hidden");
          step3Form.classList.remove("hidden");
        } catch (e) {
          displayAuthMessage(e.message, true);
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }

    // --- BƯỚC 3: HOÀN TẤT ---
    if (step3Form) {
      step3Form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const btn = step3Form.querySelector("button");
        const originalText = btn.textContent;
        btn.textContent = "Đang tạo tài khoản...";
        btn.disabled = true;

        const nickname = document.getElementById("reg-nickname").value.trim();
        const avatar = document.getElementById("reg-avatar").value;

        try {
          // Gửi toàn bộ dữ liệu lên server để tạo user
          const res = await fetch("/api/complete-register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...regData, nickname, avatar }),
          });
          const data = await res.json();

          if (!res.ok) throw new Error(data.message);

          displayAuthMessage("Đăng ký thành công! Đang chuyển hướng...", false);
          setTimeout(() => (window.location.href = "/index.html"), 2000);
        } catch (e) {
          displayAuthMessage(e.message, true);
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }
  }
});
