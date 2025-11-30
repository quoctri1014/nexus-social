/**
 * public/main.js - PHIÊN BẢN FIX LỖI (NO DOUBLE MESSAGE)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy ở trang chat
  if (!window.location.pathname.endsWith("chat.html")) return;

  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html";
    return;
  }

  // --- KẾT NỐI SOCKET ---
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };

  // DOM Elements
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const chatContentContainer = document.getElementById("chat-content-container");
  const userListDiv = document.getElementById("user-list");
  const headerAvatarContainer = document.querySelector(".chat-header .avatar-circle");

  // Load Background
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg) chatContentContainer.style.backgroundImage = `url('${savedBg}')`;

  // Lấy thông tin bản thân
  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((u) => {
      window.myUserId = u.id;
      window.myUsername = u.username;
      document.getElementById("nav-avatar").src = getAvatar(u);
    })
    .catch(() => (window.location.href = "/index.html"));

  // --- HÀM XỬ LÝ AVATAR ---
  function getAvatar(u) {
    // 1. AI Robot
    if (u.id === 0 || u.userId === 0 || u.username === "AI_Assistant") {
      return '<i class="fas fa-robot ai-avatar-icon"></i>';
    }
    // 2. User có ảnh upload
    if (u.avatar && u.avatar.trim() !== "") {
      if (u.avatar.startsWith("http") || u.avatar.startsWith("data:")) return u.avatar;
      return u.avatar.startsWith("/") ? u.avatar : `/uploads/${u.avatar}`;
    }
    // 3. Avatar chữ cái
    const n = u.nickname || u.username || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=random&color=fff&size=128&bold=true&length=2`;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // --- DANH SÁCH USER ---
  window.socket.on("userList", (users) => {
    userListDiv.innerHTML = "";
    users.forEach((u) => {
      if (u.userId === window.myUserId) return;
      const isActive = window.currentChatContext.id === u.userId;
      const div = document.createElement("div");
      div.className = `user-item ${isActive ? "active" : ""}`;
      
      const avatarData = getAvatar(u);
      let avatarHtml = avatarData.startsWith("<i") 
        ? `<div class="user-avatar ai-icon-wrapper">${avatarData}</div>`
        : `<div class="user-avatar"><img src="${avatarData}" onerror="this.src='https://ui-avatars.com/api/?name=U'"></div>`;

      div.innerHTML = `
          ${avatarHtml}
          <div class="user-info">
            <div class="user-name">${u.nickname || u.username}</div>
            <div class="user-preview">${u.userId === 0 ? "Trợ lý ảo" : (u.online ? "Online" : "Offline")}</div>
          </div>`;
      div.onclick = () => selectChat(u);
      userListDiv.appendChild(div);
    });
  });

  // --- CHỌN CHAT ---
  function selectChat(user) {
    window.currentChatContext = { id: user.userId, name: user.nickname || user.username, type: "user" };
    document.getElementById("chat-header-title").textContent = window.currentChatContext.name;
    document.getElementById("chat-status").textContent = user.userId === 0 ? "Trợ lý AI" : (user.online ? "Đang hoạt động" : "Ngoại tuyến");

    // Cập nhật Header Avatar
    headerAvatarContainer.innerHTML = "";
    const avt = getAvatar(user);
    if(avt.startsWith("<i")) {
        headerAvatarContainer.innerHTML = avt;
        headerAvatarContainer.className = "avatar-circle ai-icon-wrapper";
    } else {
        headerAvatarContainer.innerHTML = `<img src="${avt}">`;
        headerAvatarContainer.className = "avatar-circle";
    }

    messagesContainer.innerHTML = "";
    messageInput.disabled = false;
    document.getElementById("send-btn").disabled = false;

    window.socket.emit("loadPrivateHistory", { recipientId: user.userId });
    
    // Active UI
    document.querySelectorAll(".user-item").forEach(el => el.classList.remove("active"));
    window.dispatchEvent(new Event("contextChanged"));
  }

  // --- XỬ LÝ TIN NHẮN ---
  
  // 1. Load lịch sử
  window.socket.on("privateHistory", ({ messages }) => {
    messagesContainer.innerHTML = "";
    messages.forEach((m) => appendMessage(m, false));
    scrollToBottom();
  });

  // 2. Nhận tin nhắn mới (FIX LỖI DOUBLE: Chỉ nghe socket, không tự vẽ)
  window.socket.on("newMessage", (msg) => {
    const isCurrent = msg.senderId === window.currentChatContext.id;
    const isMe = msg.senderId === window.myUserId;
    const isAI = msg.senderId === 0 && window.currentChatContext.id === 0;

    if (isCurrent || isMe || isAI) {
        appendMessage(msg);
    }
  });

  // 3. Hàm vẽ tin nhắn
  window.appendMessage = function (msg, shouldScroll = true) {
    // Kiểm tra trùng lặp (phòng hờ)
    const existingMsg = document.getElementById(`msg-${msg.id || msg.createdAt}`);
    if(existingMsg) return;

    const div = document.createElement("div");
    // Tạo ID tạm để tránh trùng lặp
    div.id = `msg-${msg.id || new Date(msg.createdAt).getTime()}`; 
    const type = msg.senderId === window.myUserId ? "user" : "other";
    div.className = `message ${type}`;

    let content = msg.content;
    let isFile = false;

    try {
        const json = JSON.parse(msg.content);
        if (json.type === "image") {
            content = `<img src="${json.url}" class="msg-image" onclick="window.open('${json.url}')">`;
            div.classList.add("image-message");
            isFile = true;
        } else if (json.type === "audio") {
            content = `<audio controls src="${json.url}"></audio>`;
            div.classList.add("audio-message");
            isFile = true;
        } else if (json.type === "file") {
            content = `<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file"></i> <a href="${json.url}" download style="color:inherit">${json.name}</a></div>`;
            div.classList.add("file-type-message");
            isFile = true;
        }
    } catch (e) {}

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString("vi-VN", {hour:"2-digit", minute:"2-digit"});
    div.innerHTML = `${content}<span class="timestamp">${time}</span>`;
    messagesContainer.appendChild(div);
    if(shouldScroll) scrollToBottom();
  };

  // 4. Gửi tin nhắn (FIX LỖI DOUBLE: Chỉ emit, không append)
  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = messageInput.value.trim();
    if (!val || !window.currentChatContext.id) return;

    window.socket.emit("privateMessage", { 
        recipientId: window.currentChatContext.id, 
        content: val 
    });
    // KHÔNG GỌI appendMessage Ở ĐÂY NỮA
    messageInput.value = "";
  });

  // --- CÁC NÚT CHỨC NĂNG KHÁC (Voice, File, Emoji...) ---
  // (Giữ nguyên logic Voice/File như cũ vì đã ổn)
  const voiceBtn = document.getElementById("voice-btn");
  let mediaRecorder, audioChunks=[], isRecording=false;
  if(voiceBtn) {
      voiceBtn.addEventListener("click", async () => {
          if(!window.currentChatContext.id) return alert("Chọn người chat!");
          if(!isRecording) {
              try {
                  const stream = await navigator.mediaDevices.getUserMedia({audio:true});
                  mediaRecorder = new MediaRecorder(stream);
                  audioChunks=[];
                  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                  mediaRecorder.onstop = async () => {
                      const blob = new Blob(audioChunks, {type:'audio/webm'});
                      const formData = new FormData();
                      formData.append("files", blob, `voice_${Date.now()}.webm`);
                      voiceBtn.classList.remove("recording");
                      
                      const res = await fetch("/api/upload", {method:"POST", headers:{"Authorization":`Bearer ${token}`}, body:formData});
                      const files = await res.json();
                      if(files.length) {
                          const content = JSON.stringify({type:"audio", url:files[0].url});
                          // Chỉ emit, không append
                          window.socket.emit("privateMessage", {recipientId: window.currentChatContext.id, content});
                      }
                      stream.getTracks().forEach(t=>t.stop());
                  };
                  mediaRecorder.start();
                  isRecording=true;
                  voiceBtn.classList.add("recording");
              } catch(e) { alert("Lỗi Mic: "+e.message); }
          } else {
              mediaRecorder.stop();
              isRecording=false;
          }
      });
  }

  // Attach & Emoji & Modal logic giữ nguyên...
  const attachBtn = document.getElementById("attach-btn");
  if (attachBtn) attachBtn.addEventListener("click", () => { if (window.openFileModal) window.openFileModal(); });
  
  const emojiBtn = document.getElementById("emoji-btn");
  const emojiPicker = document.getElementById("emoji-picker");
  if(emojiBtn) {
      emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("hidden"); });
      document.querySelectorAll(".emoji-grid span").forEach(s => {
          s.addEventListener("click", () => {
              messageInput.value += s.innerText;
              emojiPicker.classList.add("hidden");
          });
      });
      document.addEventListener("click", (e) => { if(!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden"); });
  }
  
  // Settings Modal
  document.getElementById("chat-settings-btn").addEventListener("click", () => document.getElementById("bg-modal").classList.remove("hidden"));
  document.getElementById("close-bg-modal").addEventListener("click", () => document.getElementById("bg-modal").classList.add("hidden"));
  document.getElementById("save-bg-btn").addEventListener("click", () => {
      const url = document.getElementById("bg-url-input").value;
      if(url) {
          chatContentContainer.style.backgroundImage = `url('${url}')`;
          localStorage.setItem("chatBg", url);
          document.getElementById("bg-modal").classList.add("hidden");
      }
  });
});
