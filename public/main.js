/**
 * public/main.js - PHIÊN BẢN HOÀN CHỈNH (Realtime Chat & UX)
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
  const chatContentContainer = document.getElementById(
    "chat-content-container"
  );
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-btn");
  const userListDiv = document.getElementById("user-list");
  const headerAvatarContainer = document.querySelector(
    ".chat-header .avatar-circle"
  );

  const savedBg = localStorage.getItem("chatBg");
  if (savedBg) chatContentContainer.style.backgroundImage = `url('${savedBg}')`;

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

  // --- HÀM TỰ ĐỘNG CUỘN XUỐNG DƯỚI CÙNG ---
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // --- RENDER DANH SÁCH USER ---
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

    // Cập nhật Header Chat
    document.getElementById("chat-header-title").textContent =
      window.currentChatContext.name;
    document.getElementById("chat-status").textContent =
      user.userId === 0
        ? "Trợ lý AI"
        : user.online
        ? "Đang hoạt động"
        : "Ngoại tuyến";

    // --- Cập nhật Avatar trên Header ---
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

    messagesContainer.innerHTML = "";
    messageInput.disabled = false;
    sendButton.disabled = false;

    window.socket.emit("loadPrivateHistory", { recipientId: user.userId });

    // Cập nhật trạng thái active cho user item
    document.querySelectorAll(".user-item").forEach((el) => {
      const itemUser = el.querySelector(".user-name").textContent;
      const isSelected =
        itemUser === user.nickname || itemUser === user.username;
      el.classList.toggle("active", isSelected);
    });

    // Ẩn/Hiện nút gọi cho AI
    const callBtns = document.querySelectorAll(".tool-btn");
    callBtns.forEach(
      (btn) => (btn.style.display = user.userId === 0 ? "none" : "inline-block")
    );
    window.dispatchEvent(new Event("contextChanged"));
  }

  // --- XỬ LÝ LỊCH SỬ TIN NHẮN (LOAD HISTORY) ---
  window.socket.on("privateHistory", ({ messages }) => {
    messagesContainer.innerHTML = "";
    messages.forEach((m) => appendMessage(m, false)); // false: không cuộn
    scrollToBottom(); // Cuộn xuống cuối sau khi load xong
  });

  // --- XỬ LÝ TIN NHẮN REALTIME MỚI ---
  window.socket.on("newMessage", (msg) => {
    const isCurrent = msg.senderId === window.currentChatContext.id;
    const isMe = msg.senderId === window.myUserId;
    const isAI = msg.senderId === 0 && window.currentChatContext.id === 0;

    // Chỉ hiển thị tin nhắn nếu nó thuộc cuộc hội thoại đang mở (của mình gửi, người kia gửi, hoặc AI gửi cho mình)
    if (isCurrent || isMe || isAI) appendMessage(msg);
  });

  // --- HÀM RENDER TIN NHẮN ---
  window.appendMessage = function (msg, shouldScroll = true) {
    const div = document.createElement("div");
    const type = msg.senderId === window.myUserId ? "user" : "other";
    div.className = `message ${type}`;
    let contentHtml = msg.content;
    let isFile = false;

    try {
      const json = JSON.parse(msg.content);
      if (json.type === "image") {
        div.className += " image-message";
        contentHtml = `<img src="${json.url}" class="msg-image" onclick="window.open('${json.url}')">`;
        isFile = true;
      } else if (json.type === "audio") {
        div.className += " audio-message";
        contentHtml = `<audio controls src="${json.url}"></audio>`;
        isFile = true;
      } else if (json.type === "file") {
        div.className += " file-message";
        contentHtml = `<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-alt" style="font-size:24px"></i><div><div style="font-weight:bold">${json.name}</div><a href="${json.url}" download style="color:inherit;text-decoration:underline">Tải xuống</a></div></div>`;
        isFile = true;
      }
    } catch (e) {
      // Tin nhắn dạng text thường
    }

    const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString(
      "vi-VN",
      { hour: "2-digit", minute: "2-digit" }
    );

    // Thêm nội dung tin nhắn và timestamp
    div.innerHTML = `${contentHtml}<span class="timestamp">${timeStr}</span>`;

    // Nếu là file, thêm class riêng để style
    if (isFile) div.classList.add("file-type-message");

    messagesContainer.appendChild(div);

    // Chỉ cuộn xuống cuối khi có tin nhắn mới đến
    if (shouldScroll) {
      scrollToBottom();
    }
  };

  // --- XỬ LÝ GỬI TIN NHẮN TEXT ---
  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = messageInput.value.trim();
    if (!val || !window.currentChatContext.id) return;

    // Gửi Socket
    window.socket.emit("privateMessage", {
      recipientId: window.currentChatContext.id,
      content: val,
    });

    // Hiển thị ngay lên màn hình của mình
    window.appendMessage({
      senderId: window.myUserId,
      content: val,
      createdAt: new Date(),
    });

    messageInput.value = "";
  });

  // --- CHỨC NĂNG GHI ÂM (Voice) ---
  const voiceBtn = document.getElementById("voice-btn");
  let mediaRecorder,
    audioChunks = [],
    isRecording = false;
  if (voiceBtn) {
    voiceBtn.addEventListener("click", async () => {
      if (!window.currentChatContext.id) return alert("Chọn người để gửi!");
      const isSendingFile = document.getElementById("send-file")?.disabled;
      if (isSendingFile) return alert("Đang gửi file, vui lòng đợi!"); // Thêm check

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

            // Hiện trạng thái đang gửi
            voiceBtn.classList.remove("recording");
            document.getElementById("message-input").placeholder =
              "Đang tải lên...";

            try {
              const res = await fetch("/api/upload", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
              });

              if (!res.ok) throw new Error("Upload thất bại");

              const files = await res.json();
              if (files.length) {
                const content = JSON.stringify({
                  type: "audio",
                  url: files[0].url,
                  name: "Voice",
                });

                // Gửi tin nhắn socket
                window.socket.emit("privateMessage", {
                  recipientId: window.currentChatContext.id,
                  content,
                });

                // Hiển thị lên màn hình
                window.appendMessage({
                  senderId: window.myUserId,
                  content,
                  createdAt: new Date(),
                });
              }
            } catch (err) {
              alert("Lỗi Gửi Tin Nhắn Thoại: " + err.message);
            } finally {
              stream.getTracks().forEach((track) => track.stop());
              document.getElementById("message-input").placeholder =
                "Nhập tin nhắn...";
            }
          };

          mediaRecorder.start();
          isRecording = true;
          voiceBtn.classList.add("recording");
          document.getElementById("message-input").placeholder =
            "Đang ghi âm (Bấm lại để dừng)...";
        } catch (err) {
          alert("Lỗi Mic: " + err.message);
        }
      } else {
        mediaRecorder.stop();
        isRecording = false;
      }
    });
  }

  // --- NÚT ĐÍNH KÈM (Attach) & EMOJI ---
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
        document.getElementById("message-input").focus(); // Giúp gõ tiếp
      });
    });
    document.addEventListener("click", (e) => {
      if (!emojiPicker.contains(e.target) && e.target !== emojiBtn)
        emojiPicker.classList.add("hidden");
    });
  }

  // --- MODALS (Cài đặt nền) ---
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
      chatContentContainer.style.backgroundImage = `url('${url}')`;
      localStorage.setItem("chatBg", url);
      document.getElementById("bg-modal").classList.add("hidden");
    }
  });
});
