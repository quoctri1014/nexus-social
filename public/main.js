document.addEventListener("DOMContentLoaded", () => {
  if (!window.location.pathname.endsWith("chat.html")) return;

  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // 1. INIT SOCKET & VARS
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.currentChatContext = { id: null, name: null, type: "user" };

  const chatContainer = document.getElementById("main-container");
  const messagesContainer = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const headerAvatarContainer = document.querySelector(".chat-header .avatar-circle");
  const userListDiv = document.getElementById("user-list");

  // Mobile Back Button
  document.getElementById("mobile-back-btn").addEventListener("click", () => {
      chatContainer.classList.remove("mobile-active");
      window.currentChatContext = { id: null };
  });

  // Load Info
  const savedBg = localStorage.getItem("chatBg");
  if (savedBg) document.getElementById("chat-content-container").style.backgroundImage = `url('${savedBg}')`;

  fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((u) => {
      window.myUserId = u.id;
      window.myUsername = u.username;
      document.getElementById("nav-avatar").src = getAvatar(u);
    });

  // 2. AVATAR & EMOJI
  function getAvatar(u) {
    if (u.id === 0 || u.userId === 0 || u.username === "AI_Assistant") return '<i class="fas fa-robot ai-avatar-icon"></i>';
    if (u.avatar && u.avatar.trim() !== "") return u.avatar.startsWith("http") || u.avatar.startsWith("data:") ? u.avatar : `/uploads/${u.avatar}`;
    const n = u.nickname || u.username || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=random&color=fff&size=128&bold=true`;
  }

  // Emoji Button Init
  const picker = new EmojiButton({ position: 'top-start', theme: 'dark', autoHide: false });
  const emojiTrigger = document.getElementById('emoji-trigger');
  
  picker.on('emoji', selection => {
      messageInput.value += selection.emoji;
      messageInput.focus();
  });
  emojiTrigger.addEventListener('click', () => picker.togglePicker(emojiTrigger));

  // 3. RENDER USER LIST & SELECT CHAT
  window.socket.on("userList", (users) => {
    userListDiv.innerHTML = "";
    window.allUsers = users; 
    users.forEach((u) => {
      if (u.userId === window.myUserId) return;
      const isActive = window.currentChatContext.id === u.userId;
      const div = document.createElement("div");
      div.className = `user-item ${isActive ? "active" : ""}`;
      const avt = getAvatar(u);
      const imgHtml = avt.startsWith("<i") ? `<div class="user-avatar ai-icon-wrapper">${avt}</div>` : `<div class="user-avatar"><img src="${avt}"></div>`;
      div.innerHTML = `${imgHtml}<div class="user-info"><div class="user-name">${u.nickname || u.username}</div><div class="user-preview">${u.userId===0?"Trợ lý ảo":(u.online?"Online":"Offline")}</div></div>`;
      div.onclick = () => selectChat(u);
      userListDiv.appendChild(div);
    });
  });

  function selectChat(user) {
    window.currentChatContext = { id: user.userId, name: user.nickname || user.username, type: "user" };
    document.getElementById("chat-header-title").textContent = window.currentChatContext.name;
    document.getElementById("chat-status").textContent = user.userId === 0 ? "Trợ lý AI" : (user.online ? "Đang hoạt động" : "Ngoại tuyến");
    
    headerAvatarContainer.innerHTML = "";
    const avt = getAvatar(user);
    if(avt.startsWith("<i")) { headerAvatarContainer.className="avatar-circle ai-icon-wrapper"; headerAvatarContainer.innerHTML = avt; }
    else { headerAvatarContainer.className="avatar-circle"; headerAvatarContainer.innerHTML = `<img src="${avt}">`; }

    messagesContainer.innerHTML = "";
    messageInput.disabled = false;
    document.getElementById("send-btn").disabled = false;
    chatContainer.classList.add("mobile-active"); // Mobile slide

    window.socket.emit("loadPrivateHistory", { recipientId: user.userId });
    
    const callBtns = document.querySelectorAll(".tool-btn");
    callBtns.forEach(btn => btn.style.display = user.userId === 0 ? "none" : "inline-block");
    window.dispatchEvent(new Event("contextChanged"));
  }

  // 4. MESSAGE HANDLING
  function scrollToBottom() { messagesContainer.scrollTop = messagesContainer.scrollHeight; }

  window.socket.on("privateHistory", ({ messages }) => {
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
    if(document.getElementById(`msg-${msg.id || msg.createdAt}`)) return; 

    const div = document.createElement("div");
    div.id = `msg-${msg.id || Date.now()}`;
    const type = msg.senderId === window.myUserId ? "user" : "other";
    div.className = `message ${type}`;

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
    div.innerHTML = `${content}<span class="timestamp">${time}</span>`;
    messagesContainer.appendChild(div);
    if(shouldScroll) scrollToBottom();
  };

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = messageInput.value.trim();
    if (!val || !window.currentChatContext.id) return;
    window.socket.emit("privateMessage", { recipientId: window.currentChatContext.id, content: val });
    messageInput.value = "";
  });

  // 5. VOICE CHAT (FIXED)
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
                      
                      // Hiển thị loading
                      messageInput.placeholder = "Đang gửi voice...";
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
                  messageInput.placeholder = "Đang ghi âm (Bấm lại để gửi)...";
              } catch(e) { alert("Lỗi Mic: "+e.message); }
          } else {
              mediaRecorder.stop();
              isRecording=false;
          }
      });
  }

  // 6. GROUP CREATE LOGIC
  const groupModal = document.getElementById("group-modal");
  const membersListDiv = document.getElementById("group-members-list");
  
  document.getElementById("create-group-btn").addEventListener("click", () => {
      groupModal.classList.remove("hidden");
      membersListDiv.innerHTML = "";
      if(window.allUsers) {
          window.allUsers.forEach(u => {
              if(u.userId !== window.myUserId && u.userId !== 0) {
                  const div = document.createElement("div");
                  div.className = "member-option";
                  div.style.padding = "10px";
                  div.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
                  div.innerHTML = `<label style="display:flex;align-items:center;cursor:pointer;gap:10px;width:100%"><input type="checkbox" value="${u.userId}" style="width:20px;height:20px;"><span>${u.nickname || u.username}</span></label>`;
                  membersListDiv.appendChild(div);
              }
          });
      }
  });

  document.getElementById("close-group-modal").addEventListener("click", () => groupModal.classList.add("hidden"));

  document.getElementById("confirm-create-group").addEventListener("click", async () => {
      const groupName = document.getElementById("group-name-input").value.trim();
      const checkedBoxes = membersListDiv.querySelectorAll("input:checked");
      const members = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

      if(!groupName) return alert("Nhập tên nhóm!");
      if(members.length === 0) return alert("Chọn thành viên!");

      try {
          const res = await fetch("/api/groups/create", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
              body: JSON.stringify({ name: groupName, members: members })
          });
          const data = await res.json();
          if(res.ok) {
              alert("Tạo nhóm thành công!");
              groupModal.classList.add("hidden");
              window.location.reload(); 
          } else alert("Lỗi: " + data.message);
      } catch(e) { console.error(e); }
  });

  // 7. UTILS: Attach & Settings
  const attachBtn = document.getElementById("attach-btn");
  if (attachBtn) attachBtn.addEventListener("click", () => { if (window.openFileModal) window.openFileModal(); });
  
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

  // Dark Mode Toggle
  document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.body.getAttribute("data-theme");
      const next = current === "light" ? "dark" : "light";
      document.body.setAttribute("data-theme", next);
  });
});
