document.addEventListener("DOMContentLoaded", () => {
  // 1. KIỂM TRA MÔI TRƯỜNG & AUTH
  if (!window.location.pathname.endsWith("chat.html")) return;
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // 2. KẾT NỐI SOCKET
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };
  let isSecretMode = false;
  const AI_BOT_ID = 1;

  // 3. DOM ELEMENTS
  const chatContainer = document.getElementById("main-container");
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const heartBtn = document.getElementById("heart-btn");
  const secretBtn = document.getElementById("secret-mode-btn");
  const voiceBtn = document.getElementById("voice-btn");
  const attachBtn = document.getElementById("attach-btn");
  const hiddenFileInput = document.getElementById("hidden-file-input");
  const callBtn = document.getElementById("call-button");
  const videoBtn = document.getElementById("video-call-button");
  const logoutBtn = document.getElementById("logout-btn");
  const userListDiv = document.getElementById("user-list");
  const chatContentContainer = document.getElementById("chat-content-container");
  const headerAvatarContainer = document.querySelector(".chat-header .avatar-circle");

  // Xử lý Logout
  if(logoutBtn) logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
  });

  // 4. LOAD THEME & BACKGROUND (Hàm áp dụng màu nền)
  document.body.setAttribute("data-theme", localStorage.getItem("theme") || "dark");
  
  // Hàm đổi màu nền ngay lập tức
  function applyBg(val) {
    if (!val) return;
    if (val.startsWith("http") || val.startsWith("url")) {
      chatContentContainer.style.background = "none"; // Xóa màu đơn sắc
      chatContentContainer.style.backgroundImage = val.startsWith("url") ? val : `url('${val}')`;
      chatContentContainer.style.backgroundSize = "cover";
      chatContentContainer.style.backgroundPosition = "center";
    } else {
      chatContentContainer.style.backgroundImage = "none"; // Xóa ảnh nền
      chatContentContainer.style.background = val;
    }
    localStorage.setItem("chatBg", val);
  }

  // Load màu cũ khi vào trang
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg) applyBg(savedBg);

  // 5. LẤY THÔNG TIN USER
  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()).then(u=>{
    window.myUserId = u.id; window.myUsername = u.username;
    const navAvt = document.getElementById("nav-avatar");
    if(navAvt) navAvt.src = u.avatar && !u.avatar.includes("avatar1.png") ? (u.avatar.startsWith("http")?u.avatar:`/uploads/${u.avatar}`) : `https://ui-avatars.com/api/?name=${u.nickname||u.username}`;
  });

  function getAvatarHtml(u) {
    if (u.id === AI_BOT_ID || u.username === "Trợ lý AI") return `<div class="ai-icon-wrapper"><i class="fas fa-robot ai-avatar-icon"></i></div>`;
    if (u.avatar && !u.avatar.includes("avatar1.png")) {
      const src = u.avatar.startsWith("http") ? u.avatar : `/uploads/${u.avatar}`;
      return `<img src="${src}" onerror="this.src='https://ui-avatars.com/api/?name=U'">`;
    }
    return `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.nickname||u.username)}&background=random&color=fff">`;
  }

  // 6. RENDER DANH SÁCH USER
  window.socket.on("userList", (users) => {
    if (!userListDiv) return;
    userListDiv.innerHTML = "";
    window.allUsers = users; 
    users.forEach((u) => {
      if (u.id === window.myUserId) return; 
      const div = document.createElement("div");
      div.className = `user-item ${window.currentChatContext.id === u.id ? "active" : ""}`;
      const isAI = u.id === AI_BOT_ID;
      div.innerHTML = `<div class="user-avatar">${getAvatarHtml(u)}<div class="status-dot ${u.online?"online":""}"></div></div>
        <div class="user-info"><div class="user-name">${u.nickname||u.username}</div><div class="user-preview">${isAI?"Luôn sẵn sàng":(u.online?"Online":"Offline")}</div></div>`;
      div.onclick = () => selectChat(u);
      userListDiv.appendChild(div);
    });
  });

  // 7. CHỌN NGƯỜI CHAT
  function selectChat(user) {
    if (!user || (!user.id && user.id !== 0)) return;
    window.currentChatContext = { id: user.id, name: user.nickname || user.username, type: "user" };
    
    document.getElementById("chat-header-title").textContent = window.currentChatContext.name;
    const isAI = user.id === AI_BOT_ID;
    document.getElementById("chat-status").textContent = isAI ? "Trợ lý ảo thông minh" : (user.online ? "Đang hoạt động" : "Ngoại tuyến");
    
    if (headerAvatarContainer) { headerAvatarContainer.innerHTML = getAvatarHtml(user); headerAvatarContainer.className = "avatar-circle"; }

    if (messagesContainer) messagesContainer.innerHTML = "";
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (chatContainer) chatContainer.classList.add("mobile-active");

    window.socket.emit("loadPrivateHistory", { recipientId: user.id });

    // HIỆN CÁC NÚT BỊ MẤT
    const delBtn = document.getElementById("delete-chat-btn");
    if(callBtn) callBtn.style.display = isAI ? "none" : "flex"; 
    if(videoBtn) videoBtn.style.display = isAI ? "none" : "flex"; 
    if(delBtn) delBtn.style.display = isAI ? "none" : "flex"; 

    // Reset chế độ Secret khi đổi người
    isSecretMode = false;
    if(secretBtn) { secretBtn.classList.remove("active-secret"); secretBtn.style.color = ""; }
    if(messageInput) messageInput.placeholder = "Nhập tin nhắn...";
  }

  // 8. XỬ LÝ TIN NHẮN ĐẾN & TỰ HỦY
  window.socket.on("privateHistory", ({ messages }) => {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = "";
    messages.forEach((m) => appendMessage(m, false));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  window.socket.on("newMessage", (msg) => {
    const isCurrent = msg.senderId === window.currentChatContext.id;
    const isMe = msg.senderId === window.myUserId;
    const isAI = msg.senderId === AI_BOT_ID && window.currentChatContext.id === AI_BOT_ID;
    if (isCurrent || isMe || isAI) appendMessage(msg);
  });

  window.appendMessage = function (msg, shouldScroll = true) {
    if (document.getElementById(`msg-${msg.id}`)) return;
    const div = document.createElement("div");
    div.id = `msg-${msg.id || Date.now()}`;
    div.className = `message ${msg.senderId === window.myUserId ? "user" : "other"}`;
    
    // --- SỬA LỖI TỰ HỦY: Thêm setTimeout để xóa UI ---
    if (msg.ttl) {
        div.classList.add("secret");
        // Nếu là tin nhắn mới, dùng msg.ttl. Nếu load lại history, tính thời gian còn lại
        const createdAt = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
        const expiresAt = createdAt + msg.ttl;
        const timeLeft = expiresAt - Date.now();

        if (timeLeft > 0) {
            setTimeout(() => {
                div.style.opacity = "0"; // Hiệu ứng mờ dần
                setTimeout(() => div.remove(), 500); // Xóa hẳn sau 0.5s
            }, timeLeft);
        } else {
            return; // Đã hết hạn thì không hiển thị
        }
    }
    // ------------------------------------------------

    let delBtn = "";
    if (msg.senderId === window.myUserId) delBtn = `<div class="delete-msg-btn" onclick="deleteMessage(${msg.id})"><i class="fas fa-trash"></i></div>`;

    let content = msg.content;
    try {
      const json = JSON.parse(msg.content);
      if (json.type === "image") { content = `<img src="${json.url}" class="msg-image" onclick="window.open('${json.url}')">`; div.classList.add("image-message"); }
      else if (json.type === "audio") { content = `<audio controls src="${json.url}"></audio>`; div.classList.add("audio-message"); }
    } catch (e) {}

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    div.innerHTML = `${content}<span class="timestamp">${time}</span>${delBtn}`;
    
    if (messagesContainer) messagesContainer.appendChild(div);
    if (shouldScroll) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  // 9. GỬI TIN NHẮN (TEXT)
  const chatForm = document.getElementById("chat-form");
  if(chatForm) chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = messageInput.value.trim();
    if (!val || !window.currentChatContext.id) return;
    const data = { recipientId: window.currentChatContext.id, content: val };
    if (isSecretMode) data.ttl = 10000; // 10 giây
    window.socket.emit("privateMessage", data);
    messageInput.value = "";
  });

  if (messageInput) messageInput.addEventListener("input", (e) => {
    if (e.target.value.trim()) { sendBtn.classList.remove("hidden"); heartBtn.classList.add("hidden"); }
    else { sendBtn.classList.add("hidden"); heartBtn.classList.remove("hidden"); }
  });

  // 10. GỬI FILE ẢNH
  if (attachBtn && hiddenFileInput) {
    attachBtn.addEventListener("click", () => {
      if(!window.currentChatContext.id) return alert("Chọn người chat trước!");
      hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener("change", async (e) => {
      const files = e.target.files;
      if (files.length === 0) return;
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
      messageInput.placeholder = "Đang gửi ảnh...";
      
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        const uploadedFiles = await res.json();
        uploadedFiles.forEach(file => {
          const content = JSON.stringify({ type: file.type, url: file.url, name: file.name });
          window.socket.emit("privateMessage", { recipientId: window.currentChatContext.id, content });
        });
      } catch (err) { alert("Lỗi upload: " + err.message); } 
      finally { messageInput.placeholder = "Nhập tin nhắn..."; hiddenFileInput.value = ""; }
    });
  }

  // 11. GHI ÂM
  if (voiceBtn) {
    let mediaRecorder, audioChunks = [], isRecording = false;
    voiceBtn.addEventListener("click", async () => {
      if (!window.currentChatContext.id) return alert("Chọn người chat trước!");
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
          mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: "audio/webm" });
            const formData = new FormData();
            formData.append("files", blob, `voice_${Date.now()}.webm`);
            voiceBtn.classList.remove("recording");
            messageInput.placeholder = "Đang gửi...";
            try {
                const res = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
                const files = await res.json();
                if (files.length) {
                    const content = JSON.stringify({ type: "audio", url: files[0].url });
                    window.socket.emit("privateMessage", { recipientId: window.currentChatContext.id, content });
                }
            } catch(err) { alert("Lỗi gửi voice"); }
            stream.getTracks().forEach((t) => t.stop());
            messageInput.placeholder = "Nhập tin nhắn...";
          };
          mediaRecorder.start();
          isRecording = true;
          voiceBtn.classList.add("recording");
          messageInput.placeholder = "Đang ghi âm (Bấm lại để gửi)...";
        } catch (e) { alert("Không tìm thấy Micro!"); }
      } else { mediaRecorder.stop(); isRecording = false; }
    });
  }

  // 12. CALL & VIDEO CALL
  if (callBtn) callBtn.addEventListener("click", () => {
      if(!window.currentChatContext.id) return;
      alert("Đang gọi cho " + window.currentChatContext.name + "...");
      window.socket.emit("callOffer", { recipientId: window.currentChatContext.id, type: "audio" });
  });
  if (videoBtn) videoBtn.addEventListener("click", () => {
      if(!window.currentChatContext.id) return;
      alert("Đang gọi Video cho " + window.currentChatContext.name + "...");
      window.socket.emit("callOffer", { recipientId: window.currentChatContext.id, type: "video" });
  });

  // 13. ICON / EMOJI
  const emojiBtn = document.getElementById("emoji-trigger");
  const emojiPicker = document.getElementById("emoji-picker");
  if (emojiBtn && emojiPicker) {
    emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("hidden"); });
    document.querySelectorAll(".emoji-grid span").forEach(span => {
        span.addEventListener("click", () => {
            messageInput.value += span.innerText;
            messageInput.focus();
            emojiPicker.classList.add("hidden");
            sendBtn.classList.remove("hidden");
            heartBtn.classList.add("hidden");
        });
    });
    document.addEventListener("click", (e) => { if(!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden"); });
  }

  // 14. ĐỔI MÀU NỀN (SỬA LỖI ĐÓNG POPUP & UPDATE LIỀN)
  const setBtn = document.getElementById("chat-settings-btn");
  const closeBgBtn = document.getElementById("close-bg-modal");
  const saveBgBtn = document.getElementById("save-bg-btn");
  const bgModal = document.getElementById("bg-modal");
  
  if(setBtn) setBtn.addEventListener("click", () => bgModal.classList.remove("hidden"));
  if(closeBgBtn) closeBgBtn.addEventListener("click", () => bgModal.classList.add("hidden"));
  
  // Xử lý click chọn màu có sẵn
  document.querySelectorAll(".bg-preset").forEach(preset => {
      preset.addEventListener("click", () => {
          const val = preset.getAttribute("data-bg");
          applyBg(val); // Đổi màu ngay
          bgModal.classList.add("hidden"); // Đóng popup ngay
      });
  });

  // Xử lý nhập link ảnh
  if(saveBgBtn) saveBgBtn.addEventListener("click", () => {
      const url = document.getElementById("bg-url-input").value;
      if(url) { 
          applyBg(url); 
          bgModal.classList.add("hidden"); 
      }
  });

  // 15. TIM BAY & DELETE MSG
  if(heartBtn) heartBtn.addEventListener("click", () => {
    if (!window.currentChatContext.id) return;
    window.socket.emit("sendHeart", { recipientId: window.currentChatContext.id });
    showHeartAnimation();
  });
  window.socket.on("heartAnimation", () => showHeartAnimation());
  
  function showHeartAnimation() {
    const container = document.getElementById("floating-hearts-container");
    if (!container) return;
    for (let i = 0; i < 15; i++) {
      const heart = document.createElement("div");
      heart.className = "floating-heart";
      heart.innerHTML = "❤️";
      heart.style.left = Math.random() * 100 + "%";
      heart.style.animationDuration = 2 + Math.random() * 3 + "s";
      container.appendChild(heart);
      setTimeout(() => heart.remove(), 4000);
    }
  }

  window.deleteMessage = (id) => {
     if(confirm("Thu hồi?")) window.socket.emit("deleteMessage", { messageId: id, recipientId: window.currentChatContext.id });
  };
  window.socket.on("messageDeleted", ({ messageId }) => { const el = document.getElementById(`msg-${messageId}`); if(el) el.remove(); });
  
  // Chế độ Secret Mode (Toggle UI)
  if(secretBtn) {
      secretBtn.addEventListener("click", () => {
          isSecretMode = !isSecretMode;
          if(isSecretMode) {
              secretBtn.classList.add("active-secret");
              secretBtn.style.color = "#ef4444";
              messageInput.placeholder = "Chế độ tự hủy (10s)...";
          } else {
              secretBtn.classList.remove("active-secret");
              secretBtn.style.color = "";
              messageInput.placeholder = "Nhập tin nhắn...";
          }
      });
  }

  // Mobile Back & Group Modal
  const backBtn = document.getElementById("mobile-back-btn");
  if(backBtn) backBtn.addEventListener("click", () => { chatContainer.classList.remove("mobile-active"); window.currentChatContext = { id: null }; });
  
  const createGroupBtn = document.getElementById("create-group-btn");
  if(createGroupBtn) createGroupBtn.addEventListener("click", () => document.getElementById("group-modal").classList.remove("hidden"));
  document.getElementById("close-group-modal").addEventListener("click", () => document.getElementById("group-modal").classList.add("hidden"));
});
