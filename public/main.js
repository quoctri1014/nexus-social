document.addEventListener("DOMContentLoaded", () => {
  if (!window.location.pathname.endsWith("chat.html")) return;
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };
  let isSecretMode = false;
  const AI_BOT_ID = 1;

  // DOM
  const chatContainer = document.getElementById("main-container");
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const heartBtn = document.getElementById("heart-btn");
  const secretBtn = document.getElementById("secret-mode-btn");
  const voiceBtn = document.getElementById("voice-btn");
  const userListDiv = document.getElementById("user-list");
  const chatContentContainer = document.getElementById("chat-content-container");
  const headerAvatarContainer = document.querySelector(".chat-header .avatar-circle");

  // Load Theme & Bg
  document.body.setAttribute("data-theme", localStorage.getItem("theme") || "dark");
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg && chatContentContainer) {
    if (savedBg.startsWith("http") || savedBg.startsWith("url")) chatContentContainer.style.backgroundImage = savedBg.startsWith("url") ? savedBg : `url('${savedBg}')`;
    else { chatContentContainer.style.backgroundImage = "none"; chatContentContainer.style.background = savedBg; }
  }

  // Get Me
  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()).then(u=>{
    window.myUserId = u.id; window.myUsername = u.username;
    const navAvt = document.getElementById("nav-avatar");
    if(navAvt) navAvt.src = u.avatar && !u.avatar.includes("avatar1.png") ? (u.avatar.startsWith("http")?u.avatar:`/uploads/${u.avatar}`) : `https://ui-avatars.com/api/?name=${u.nickname||u.username}`;
  });

  // Avatar Helper
  function getAvatarHtml(u) {
    if (u.id === AI_BOT_ID || u.username === "Trợ lý AI") return `<div class="ai-icon-wrapper"><i class="fas fa-robot ai-avatar-icon"></i></div>`;
    if (u.avatar && !u.avatar.includes("avatar1.png")) {
      const src = u.avatar.startsWith("http") ? u.avatar : `/uploads/${u.avatar}`;
      return `<img src="${src}" onerror="this.src='https://ui-avatars.com/api/?name=U'">`;
    }
    return `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.nickname||u.username)}&background=random&color=fff">`;
  }

  // Socket: User List
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

  // Select Chat
  function selectChat(user) {
    if (!user || (!user.id && user.id !== 0)) return;
    window.currentChatContext = { id: user.id, name: user.nickname || user.username, type: "user" };
    
    document.getElementById("chat-header-title").textContent = window.currentChatContext.name;
    const isAI = user.id === AI_BOT_ID;
    document.getElementById("chat-status").textContent = isAI ? "Trợ lý ảo" : (user.online ? "Đang hoạt động" : "Ngoại tuyến");
    
    if (headerAvatarContainer) { headerAvatarContainer.innerHTML = getAvatarHtml(user); headerAvatarContainer.className = "avatar-circle"; }

    if (messagesContainer) messagesContainer.innerHTML = "";
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (chatContainer) chatContainer.classList.add("mobile-active");

    window.socket.emit("loadPrivateHistory", { recipientId: user.id });

    // Show/Hide Buttons
    const delBtn = document.getElementById("delete-chat-btn");
    const callBtn = document.getElementById("call-button");
    const vidBtn = document.getElementById("video-call-button");
    if(delBtn) delBtn.style.display = isAI ? "none" : "flex"; 
    if(callBtn) callBtn.style.display = isAI ? "none" : "flex"; 
    if(vidBtn) vidBtn.style.display = isAI ? "none" : "flex"; 

    isSecretMode = false;
    if(secretBtn) { secretBtn.classList.remove("active-secret"); secretBtn.style.color = ""; }
    if(messageInput) messageInput.placeholder = "Nhập tin nhắn...";
  }

  // Message Handling
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
    if (msg.ttl) div.classList.add("secret");

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

  // Actions
  const chatForm = document.getElementById("chat-form");
  if(chatForm) chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = messageInput.value.trim();
    if (!val || !window.currentChatContext.id) return;
    const data = { recipientId: window.currentChatContext.id, content: val };
    if (isSecretMode) data.ttl = 10000;
    window.socket.emit("privateMessage", data);
    messageInput.value = "";
  });

  if (messageInput) messageInput.addEventListener("input", (e) => {
    if (e.target.value.trim()) { sendBtn.classList.remove("hidden"); heartBtn.classList.add("hidden"); }
    else { sendBtn.classList.add("hidden"); heartBtn.classList.remove("hidden"); }
  });

  // Fix Heart Position
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

  // Modal Logic
  const setBtn = document.getElementById("chat-settings-btn");
  const closeBgBtn = document.getElementById("close-bg-modal");
  const saveBgBtn = document.getElementById("save-bg-btn");
  if(setBtn) setBtn.addEventListener("click", () => document.getElementById("bg-modal").classList.remove("hidden"));
  if(closeBgBtn) closeBgBtn.addEventListener("click", () => document.getElementById("bg-modal").classList.add("hidden"));
  
  window.changeBg = (val) => {
    chatContentContainer.style.background = val.includes("http") ? "none" : val;
    if(val.includes("http")) chatContentContainer.style.backgroundImage = `url('${val}')`;
    else chatContentContainer.style.backgroundImage = "none";
    localStorage.setItem("chatBg", val);
  };
  if(saveBgBtn) saveBgBtn.addEventListener("click", () => {
      const url = document.getElementById("bg-url-input").value;
      if(url) { changeBg(url); document.getElementById("bg-modal").classList.add("hidden"); }
  });

  // Mobile Back
  const backBtn = document.getElementById("mobile-back-btn");
  if(backBtn) backBtn.addEventListener("click", () => { chatContainer.classList.remove("mobile-active"); window.currentChatContext = { id: null }; });
});
