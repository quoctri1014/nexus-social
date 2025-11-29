/**
 * public/main.js - PHIÊN BẢN SỬ DỤNG ICON ROBOT THAY CHO ẢNH
 */

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy ở trang chat
  if (!window.location.pathname.endsWith("chat.html")) return;

  // --- CHẶN ĐĂNG NHẬP ---
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html"; // Đá về login
    return;
  }

  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };

  // Init
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg)
    document.getElementById(
      "chat-content-container"
    ).style.backgroundImage = `url('${savedBg}')`;

  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((u) => {
      window.myUserId = u.id;
      window.myUsername = u.username;
      document.getElementById("nav-avatar").src = getAvatar(u); // Dùng cho avatar của tôi
    })
    .catch(() => (window.location.href = "/index.html"));

  // --- HÀM XỬ LÝ AVATAR (TRẢ VỀ URL HOẶC CHUỖI HTML ICON) ---
  function getAvatar(u) {
    // 1. Dành cho Trợ lý ảo AI (ID = 0)
    if (u.id === 0 || u.userId === 0 || u.username === "AI_Assistant") {
      // Trả về chuỗi đặc biệt để code nhận diện đây là icon FA
      return '<i class="fas fa-robot ai-avatar-icon"></i>';
    }

    // 2. Dành cho User đã upload ảnh
    if (u.avatar && u.avatar.trim() !== "") {
      if (u.avatar.startsWith("http") || u.avatar.startsWith("data:"))
        return u.avatar;
      return u.avatar.startsWith("/") ? u.avatar : `/uploads/${u.avatar}`;
    }

    // 3. Dành cho User Mặc định (Tạo Avatar chữ cái)
    const n = u.nickname || u.username || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      n
    )}&background=random&color=fff&size=128&bold=true&length=2`;
  }

  // --- RENDER DANH SÁCH USER ---
  const userListDiv = document.getElementById("user-list");
  window.socket.on("userList", (users) => {
    userListDiv.innerHTML = "";
    users.forEach((u) => {
      if (u.userId === window.myUserId) return;

      const isActive = window.currentChatContext.id === u.userId;
      const div = document.createElement("div");
      div.className = `user-item ${isActive ? "active" : ""}`;

      const avatarContent = getAvatar(u); // Lấy nội dung avatar

      let avatarHtml;
      // KIỂM TRA: Nếu chuỗi trả về bắt đầu bằng '<i', nghĩa là đó là icon Robot
      if (avatarContent.startsWith("<i")) {
        avatarHtml = `<div class="user-avatar ai-icon-wrapper">${avatarContent}</div>`;
      } else {
        // Nếu không, đó là URL ảnh (User đã upload hoặc UI Avatars)
        avatarHtml = `<div class="user-avatar"><img src="${avatarContent}" onerror="this.src='https://ui-avatars.com/api/?name=U'"></div>`;
      }

      div.innerHTML = `
          ${avatarHtml}
          <div class="user-info">
            <div class="user-name">${u.nickname || u.username}</div>
            <div class="user-preview">${
              u.userId === 0
                ? "Sẵn sàng hỗ trợ"
                : u.online
                ? "Đang hoạt động"
                : "Ngoại tuyến"
            }</div>
          </div>`;
      div.onclick = () => selectChat(u);
      userListDiv.appendChild(div);
    });
  });

  // --- CHỌN HỘI THOẠI ---
  function selectChat(user) {
    window.currentChatContext = {
      id: user.userId,
      name: user.nickname || user.username,
      type: "user",
    };

    // Cập nhật Header Chat (Phần này cần chỉnh lại để hiển thị icon Robot nếu là AI)
    document.getElementById("chat-header-title").textContent =
      window.currentChatContext.name;
    document.getElementById("chat-status").textContent =
      user.userId === 0
        ? "Trợ lý AI"
        : user.online
        ? "Đang hoạt động"
        : "Ngoại tuyến";

    // --- Cập nhật Avatar trên Header ---
    const headerAvatarContainer = document.querySelector(
      ".chat-header .avatar-circle"
    );
    headerAvatarContainer.innerHTML = ""; // Xóa nội dung cũ
    const avatarContent = getAvatar(user);

    if (avatarContent.startsWith("<i")) {
      // Nếu là icon Robot
      headerAvatarContainer.innerHTML = avatarContent;
      headerAvatarContainer.classList.add("ai-icon-wrapper");
    } else {
      // Nếu là ảnh (User)
      headerAvatarContainer.innerHTML = `<img id="header-avatar" src="${avatarContent}">`;
      headerAvatarContainer.classList.remove("ai-icon-wrapper");
    }
    // **********************************

    document.getElementById("messages").innerHTML = "";
    document.getElementById("message-input").disabled = false;
    document.getElementById("send-btn").disabled = false;

    window.socket.emit("loadPrivateHistory", { recipientId: user.userId });
    document
      .querySelectorAll(".user-item")
      .forEach((el) => el.classList.remove("active"));
    const callBtns = document.querySelectorAll(".tool-btn");
    callBtns.forEach(
      (btn) => (btn.style.display = user.userId === 0 ? "none" : "inline-block")
    );
    window.dispatchEvent(new Event("contextChanged"));
  }

  // --- LOGIC TIN NHẮN VÀ CHỨC NĂNG KHÁC (Giữ nguyên) ---
  window.socket.on("privateHistory", ({ messages }) => {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    messages.forEach((m) => appendMessage(m));
  });

  window.socket.on("newMessage", (msg) => {
    const isCurrent = msg.senderId === window.currentChatContext.id;
    const isMe = msg.senderId === window.myUserId;
    const isAI = msg.senderId === 0 && window.currentChatContext.id === 0;
    if (isCurrent || isMe || isAI) appendMessage(msg);
  });

  window.appendMessage = function (msg) {
    const container = document.getElementById("messages");
    const div = document.createElement("div");
    const type = msg.senderId === window.myUserId ? "user" : "other";
    div.className = `message ${type}`;
    let contentHtml = msg.content;
    try {
      const json = JSON.parse(msg.content);
      if (json.type === "image") {
        div.className += " image-message";
        contentHtml = `<img src="${json.url}" class="msg-image" onclick="window.open('${json.url}')">`;
      } else if (json.type === "audio") {
        div.className += " audio-message";
        contentHtml = `<audio controls src="${json.url}"></audio>`;
      } else if (json.type === "file") {
        div.className += " file-message";
        contentHtml = `<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-alt" style="font-size:24px"></i><div><div style="font-weight:bold">${json.name}</div><a href="${json.url}" download style="color:white;text-decoration:underline">Tải xuống</a></div></div>`;
      }
    } catch (e) {}
    const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString(
      "vi-VN",
      { hour: "2-digit", minute: "2-digit" }
    );
    div.innerHTML = `${contentHtml}<span class="timestamp">${timeStr}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  };

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("message-input");
    const val = input.value.trim();
    if (!val || !window.currentChatContext.id) return;
    window.socket.emit("privateMessage", {
      recipientId: window.currentChatContext.id,
      content: val,
    });
    input.value = "";
  });

  // Voice
  const voiceBtn = document.getElementById("voice-btn");
  let mediaRecorder,
    audioChunks = [],
    isRecording = false;
  if (voiceBtn) {
    voiceBtn.addEventListener("click", async () => {
      if (!window.currentChatContext.id) return alert("Chọn người để gửi!");
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          mediaRecorder.ondataavailable = (event) =>
            audioChunks.push(event.data);
          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            const formData = new FormData();
            formData.append("files", audioBlob, `voice_${Date.now()}.webm`);
            const res = await fetch("/api/upload", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: formData,
            });
            const files = await res.json();
            if (files.length) {
              const content = JSON.stringify({
                type: "audio",
                url: files[0].url,
                name: "Voice",
              });
              window.socket.emit("privateMessage", {
                recipientId: window.currentChatContext.id,
                content,
              });
              window.appendMessage({
                senderId: window.myUserId,
                content,
                createdAt: new Date(),
              });
            }
            stream.getTracks().forEach((track) => track.stop());
          };
          mediaRecorder.start();
          isRecording = true;
          voiceBtn.classList.add("recording");
          document.getElementById("message-input").placeholder =
            "Đang ghi âm...";
        } catch (err) {
          alert("Lỗi Mic: " + err.message);
        }
      } else {
        mediaRecorder.stop();
        isRecording = false;
        voiceBtn.classList.remove("recording");
        document.getElementById("message-input").placeholder =
          "Nhập tin nhắn...";
      }
    });
  }

  // Attach & Emoji
  const attachBtn = document.getElementById("attach-btn");
  if (attachBtn)
    attachBtn.addEventListener("click", () => {
      if (window.openFileModal) window.openFileModal();
    });

  const emojiBtn = document.getElementById("emoji-btn");
  const emojiPicker = document.getElementById("emoji-picker");
  if (emojiBtn) {
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPicker.classList.toggle("hidden");
    });
    document.querySelectorAll(".emoji-grid span").forEach((s) => {
      s.addEventListener("click", () => {
        document.getElementById("message-input").value += s.innerText;
        emojiPicker.classList.add("hidden");
      });
    });
    document.addEventListener("click", (e) => {
      if (!emojiPicker.contains(e.target) && e.target !== emojiBtn)
        emojiPicker.classList.add("hidden");
    });
  }

  // Modals
  document
    .getElementById("chat-settings-btn")
    .addEventListener("click", () =>
      document.getElementById("bg-modal").classList.remove("hidden")
    );
  document
    .getElementById("close-bg-modal")
    .addEventListener("click", () =>
      document.getElementById("bg-modal").classList.add("hidden")
    );
  document.getElementById("save-bg-btn").addEventListener("click", () => {
    const url = document.getElementById("bg-url-input").value;
    if (url) {
      document.getElementById(
        "chat-content-container"
      ).style.backgroundImage = `url('${url}')`;
      localStorage.setItem("chatBg", url);
      document.getElementById("bg-modal").classList.add("hidden");
    }
  });
});
