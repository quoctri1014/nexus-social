document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy ở trang chat
  if (!window.location.pathname.endsWith("chat.html")) return;

  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // 1. KHỞI TẠO SOCKET & BIẾN
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };
  
  let isSecretMode = false;

  // DOM Elements (Khai báo 1 lần duy nhất ở đây)
  const chatContainer = document.getElementById("main-container");
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const userListDiv = document.getElementById("user-list");
  const chatContentContainer = document.getElementById("chat-content-container"); // Sửa tên biến tránh trùng
  const headerAvatarContainer = document.querySelector(".chat-header .avatar-circle");

  // Nút chức năng
  const heartBtn = document.getElementById("heart-btn");
  const secretBtn = document.getElementById("secret-mode-btn");
  const voiceBtn = document.getElementById("voice-btn");
  const attachBtn = document.getElementById("attach-btn");
  const mobileBack = document.getElementById("mobile-back-btn");

  // Modals
  const groupModal = document.getElementById("group-modal");
  const membersListDiv = document.getElementById("group-members-list");
  const createGroupBtn = document.getElementById("create-group-btn");
  const closeGroupBtn = document.getElementById("close-group-modal");
  const confirmGroupBtn = document.getElementById("confirm-create-group");
  
  const bgModal = document.getElementById("bg-modal");
  const settingsBtn = document.getElementById("chat-settings-btn");
  const closeBgBtn = document.getElementById("close-bg-modal");
  const saveBgBtn = document.getElementById("save-bg-btn");

  // --- DARK MODE ---
  const themeToggle = document.getElementById("theme-toggle");
  const currentTheme = localStorage.getItem("theme") || "dark";
  document.body.setAttribute("data-theme", currentTheme);
  
  if(themeToggle) {
      themeToggle.addEventListener("click", () => {
          const newTheme = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
          document.body.setAttribute("data-theme", newTheme);
          localStorage.setItem("theme", newTheme);
      });
  }

  // --- LOAD HÌNH NỀN ---
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg && chatContentContainer) {
      if(savedBg.startsWith('http') || savedBg.startsWith('url')) {
          chatContentContainer.style.backgroundImage = savedBg.startsWith('url') ? savedBg : `url('${savedBg}')`;
      } else { 
          chatContentContainer.style.backgroundImage = "none"; 
          chatContentContainer.style.background = savedBg; 
      }
  }

  // --- GET ME (LẤY THÔNG TIN BẢN THÂN) ---
  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((u) => {
      window.myUserId = u.id;
      window.myUsername = u.username;
      const navAvt = document.getElementById("nav-avatar");
      if(navAvt) navAvt.src = getAvatar(u);
    });

  function getAvatar(u) {
    if (u.id === 0 || u.userId === 0 || u.username === "AI_Assistant") return '<i class="fas fa-robot ai-avatar-icon"></i>';
    if (u.avatar && u.avatar.trim() !== "") return u.avatar.startsWith("http") || u.avatar.startsWith("data:") ? u.avatar : `/uploads/${u.avatar}`;
    const n = u.nickname || u.username || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=random&color=fff&size=128&bold=true`;
  }

  function scrollToBottom() { if(messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight; }

  // --- 2. RENDER USER LIST ---
  window.socket.on("userList", (users) => {
    if(!userListDiv) return;
    userListDiv.innerHTML = "";
    window.allUsers = users; 
    users.forEach((u) => {
      if (u.userId === window.myUserId) return;
      const isActive = window.currentChatContext.id === u.userId;
      const div = document.createElement("div");
      div.className = `user-item ${isActive ? "active" : ""}`;
      
      const avt = getAvatar(u);
      const imgHtml = avt.startsWith("<i") ? `<div class="user-avatar ai-icon-wrapper">${avt}</div>` : `<div class="user-avatar"><img src="${avt}" onerror="this.src='https://ui-avatars.com/api/?name=U'"></div>`;
      
      div.innerHTML = `${imgHtml}<div class="user-info"><div class="user-name">${u.nickname || u.username}</div><div class="user-preview">${u.userId===0?"Trợ lý ảo":(u.online?"Online":"Offline")}</div></div>`;
      div.onclick = () => selectChat(u);
      userListDiv.appendChild(div);
    });
  });

  // --- SELECT CHAT (CHỌN NGƯỜI) ---
  function selectChat(user) {
    // Cập nhật context
    window.currentChatContext = { id: user.userId, name: user.nickname || user.username, type: "user" };
    
    // Update UI Header
    document.getElementById("chat-header-title").textContent = window.currentChatContext.name;
    document.getElementById("chat-status").textContent = user.userId === 0 ? "Trợ lý AI" : (user.online ? "Đang hoạt động" : "Ngoại tuyến");
    
    if(headerAvatarContainer) {
        headerAvatarContainer.innerHTML = "";
        const avt = getAvatar(user);
        if(avt.startsWith("<i")) { 
            headerAvatarContainer.className="avatar-circle ai-icon-wrapper"; 
            headerAvatarContainer.innerHTML = avt; 
        } else { 
            headerAvatarContainer.className="avatar-circle"; 
            headerAvatarContainer.innerHTML = `<img src="${avt}" onerror="this.src='https://ui-avatars.com/api/?name=C'">`; 
        }
    }

    // Reset UI Chat
    messagesContainer.innerHTML = "";
    messageInput.disabled = false;
    if(sendBtn) sendBtn.disabled = false;
    
    // Mobile slide effect
    if(chatContainer) chatContainer.classList.add("mobile-active");

    // Load tin nhắn cũ
    window.socket.emit("loadPrivateHistory", { recipientId: user.userId });
    
    // Ẩn/Hiện nút gọi (Không cho gọi AI)
    const callBtns = document.querySelectorAll(".tool-btn");
    callBtns.forEach(btn => btn.style.display = user.userId === 0 ? "none" : "inline-block");
    
    window.dispatchEvent(new Event("contextChanged"));
  }

  // --- 3. MESSAGE HANDLING ---
  window.socket.on("privateHistory", ({ messages }) => {
    if(!messagesContainer) return;
    messagesContainer.innerHTML = "";
    messages.forEach(m => appendMessage(m, false));
    scrollToBottom();
  });

  window.socket.on("newMessage", (msg) => {
    const isCurrent = msg.senderId === window.currentChatContext.id;
    const isMe = msg.senderId === window.myUserId;
    const isAI = msg.senderId === 0 && window.currentChatContext.id === 0;
    if (isCurrent || isMe || isAI) appendMessage(msg);
  });

  window.appendMessage = function (msg, shouldScroll = true) {
    if(document.getElementById(`msg-${msg.id}`)) return; 

    const div = document.createElement("div");
    div.id = `msg-${msg.id || Date.now()}`; // Fallback ID nếu chưa có
    const type = msg.senderId === window.myUserId ? "user" : "other";
    div.className = `message ${type}`;

    // Xử lý TTL (Secret Mode)
    if (msg.ttl) {
        div.classList.add("secret");
        setTimeout(() => div.remove(), msg.ttl);
    }

    // Nút xóa tin nhắn
    let deleteBtnHtml = "";
    if (msg.senderId === window.myUserId) {
        deleteBtnHtml = `<div class="delete-msg-btn" onclick="deleteMessage(${msg.id})"><i class="fas fa-trash"></i></div>`;
    }

    let content = msg.content;
    try {
        const json = JSON.parse(msg.content);
        if (json.type === "image") {
            content = `<img src="${json.url}" class="msg-image" onclick="window.open('${json.url}')">`;
            div.classList.add("image-message");
        } else if (json.type === "audio") {
            content = `<audio controls src="${json.url}"></audio>`;
            div.classList.add("audio-message");
        } else if (json.type === "file") {
            content = `<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file"></i> <a href="${json.url}" download style="color:inherit">${json.name}</a></div>`;
            div.classList.add("file-type-message");
        } else if (json.type === "system") {
            div.className = "message system"; content = `🔔 ${json.text}`; 
        }
    } catch (e) { }

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString("vi-VN", {hour:"2-digit", minute:"2-digit"});
    div.innerHTML = `${content}<span class="timestamp">${time}</span>${deleteBtnHtml}`;
    
    if(messagesContainer) messagesContainer.appendChild(div);
    if(shouldScroll) scrollToBottom();
  };

  // DELETE MSG
  window.deleteMessage = (msgId) => {
      if(confirm("Thu hồi tin nhắn?")) {
          window.socket.emit("deleteMessage", { messageId: msgId, recipientId: window.currentChatContext.id });
      }
  };
  window.socket.on("messageDeleted", ({ messageId }) => {
      const el = document.getElementById(`msg-${messageId}`);
      if(el) el.remove();
  });

  // --- 4. INPUT & SEND ---
  const chatForm = document.getElementById("chat-form");
  if(chatForm) {
      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const val = messageInput.value.trim();
        if (!val || !window.currentChatContext.id) return;
        
        const msgData = { recipientId: window.currentChatContext.id, content: val };
        if(isSecretMode) msgData.ttl = 10000;

        window.socket.emit("privateMessage", msgData);
        messageInput.value = "";
        
        // Reset UI nút
        if(sendBtn) sendBtn.classList.add("hidden");
        if(heartBtn) heartBtn.classList.remove("hidden");
      });
  }

  if(messageInput) {
      messageInput.addEventListener("input", (e) => {
          if(e.target.value.trim()) {
              if(sendBtn) sendBtn.classList.remove("hidden");
              if(heartBtn) heartBtn.classList.add("hidden");
          } else {
              if(sendBtn) sendBtn.classList.add("hidden");
              if(heartBtn) heartBtn.classList.remove("hidden");
          }
      });
  }

  // --- 5. BUTTON ACTIONS ---
  
  // Secret Mode
  if(secretBtn) {
      secretBtn.addEventListener("click", () => {
          isSecretMode = !isSecretMode;
          if(isSecretMode) {
              secretBtn.classList.add("active-secret");
              messageInput.placeholder = "Chế độ tự hủy (10s)...";
          } else {
              secretBtn.classList.remove("active-secret");
              messageInput.placeholder = "Nhập tin nhắn...";
          }
      });
  }

  // Heart Rain
  if(heartBtn) {
      heartBtn.addEventListener("click", () => {
          if(!window.currentChatContext.id) return;
          window.socket.emit("sendHeart", { recipientId: window.currentChatContext.id });
          showHeartAnimation();
      });
  }
  window.socket.on("heartAnimation", () => showHeartAnimation());

  function showHeartAnimation() {
      const container = document.getElementById("floating-hearts-container");
      if(!container) return;
      for(let i=0; i<10; i++) {
          const heart = document.createElement("div");
          heart.className = "floating-heart";
          heart.innerHTML = "❤️";
          heart.style.left = Math.random() * 100 + "%";
          heart.style.animationDuration = (2 + Math.random() * 3) + "s";
          container.appendChild(heart);
          setTimeout(() => heart.remove(), 3000);
      }
  }

  // Emoji
  const emojiBtn = document.getElementById("emoji-trigger");
  const emojiPicker = document.getElementById("emoji-picker");
  if(emojiBtn && emojiPicker) {
      emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("hidden"); });
      document.querySelectorAll(".emoji-grid span").forEach(s => {
          s.addEventListener("click", () => {
              if(messageInput) { 
                  messageInput.value += s.innerText; 
                  messageInput.focus();
                  if(sendBtn) sendBtn.classList.remove("hidden");
                  if(heartBtn) heartBtn.classList.add("hidden");
              }
              emojiPicker.classList.add("hidden");
          });
      });
      document.addEventListener("click", (e) => { if(!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden"); });
  }

  // Voice Chat
  if(voiceBtn) {
      let mediaRecorder, audioChunks=[], isRecording=false;
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
                      messageInput.placeholder = "Đang gửi...";
                      
                      const res = await fetch("/api/upload", {method:"POST", headers:{"Authorization":`Bearer ${token}`}, body:formData});
                      const files = await res.json();
                      if(files.length) {
                          const content = JSON.stringify({type:"audio", url:files[0].url});
                          window.socket.emit("privateMessage", {recipientId: window.currentChatContext.id, content});
                      }
                      stream.getTracks().forEach(t=>t.stop());
                      messageInput.placeholder = "Nhập tin nhắn...";
                  };
                  mediaRecorder.start();
                  isRecording=true;
                  voiceBtn.classList.add("recording");
                  messageInput.placeholder = "Đang ghi âm...";
              } catch(e) { alert("Lỗi Mic: "+e.message); }
          } else {
              mediaRecorder.stop();
              isRecording=false;
          }
      });
  }

  // --- 6. MODALS ---
  if(mobileBack) mobileBack.addEventListener("click", () => {
      if(chatContainer) chatContainer.classList.remove("mobile-active");
      window.currentChatContext = { id: null };
  });

  // Group Modal
  if(createGroupBtn) {
      createGroupBtn.addEventListener("click", () => {
          if(groupModal) groupModal.classList.remove("hidden");
          if(membersListDiv) {
              membersListDiv.innerHTML = "";
              if(window.allUsers) window.allUsers.forEach(u => {
                  if(u.userId !== window.myUserId && u.userId !== 0) {
                      const div = document.createElement("div");
                      div.className = "member-option";
                      div.innerHTML = `<label style="display:flex;align-items:center;gap:10px;width:100%"><input type="checkbox" value="${u.userId}"><span>${u.nickname || u.username}</span></label>`;
                      membersListDiv.appendChild(div);
                  }
              });
          }
      });
  }
  if(closeGroupBtn) closeGroupBtn.addEventListener("click", () => groupModal.classList.add("hidden"));

  if(confirmGroupBtn) {
      confirmGroupBtn.addEventListener("click", async () => {
          const groupName = document.getElementById("group-name-input").value.trim();
          const checkedBoxes = membersListDiv.querySelectorAll("input:checked");
          const members = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
          if(!groupName || members.length === 0) return alert("Nhập tên và thành viên!");
          try {
              const res = await fetch("/api/groups/create", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                  body: JSON.stringify({ name: groupName, members: members })
              });
              if(res.ok) { alert("Xong!"); groupModal.classList.add("hidden"); window.location.reload(); }
          } catch(e) { console.error(e); }
      });
  }

  // BG Modal
  window.changeBg = function(val) {
      chatContentContainer.style.backgroundImage = "none"; chatContentContainer.style.background = val;
      localStorage.setItem("chatBg", val); document.getElementById("bg-modal").classList.add("hidden");
  }
  if(settingsBtn) settingsBtn.addEventListener("click", () => document.getElementById("bg-modal").classList.remove("hidden"));
  if(closeBgBtn) closeBgBtn.addEventListener("click", () => document.getElementById("bg-modal").classList.add("hidden"));
  if(saveBgBtn) saveBgBtn.addEventListener("click", () => {
      const url = document.getElementById("bg-url-input").value;
      if(url) { chatContentContainer.style.background = "none"; chatContentContainer.style.backgroundImage = `url('${url}')`; localStorage.setItem("chatBg", url); document.getElementById("bg-modal").classList.add("hidden"); }
  });
  
  // Attach
  if (attachBtn) attachBtn.addEventListener("click", () => { if (window.openFileModal) window.openFileModal(); });
});
