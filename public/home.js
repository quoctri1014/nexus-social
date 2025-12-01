document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html"; // Chuyển hướng nếu chưa đăng nhập
    return;
  }

  let currentUser = {};

  // --- HELPER FUNCTIONS ---
  function getAvatar(user) {
    if (user && user.avatar) return user.avatar;
    const name = user && (user.nickname || user.username) ? (user.nickname || user.username) : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
  }

  function timeAgo(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function isVideo(url) {
      return url && url.match(/\.(mp4|webm|ogg|mov)$/i);
  }

  // --- 1. LOAD PROFILE ---
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        currentUser = await res.json();
        const avatarUrl = getAvatar(currentUser);
        const displayName = currentUser.nickname || currentUser.username;

        const avatarElements = document.querySelectorAll("#nav-avatar, #sidebar-avatar, #story-my-avatar, #cp-avatar, #comment-my-avatar, #edit-avatar-preview");
        avatarElements.forEach(img => img.src = avatarUrl);

        if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = displayName;
        if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = displayName;
        if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
      }
    } catch (e) {
      console.error("Lỗi load profile:", e);
    }
  }

  // --- 2. LOAD POSTS ---
  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const posts = await res.json();
        renderFeed(posts);
      }
    } catch (e) { console.error(e); }
  }

  // --- 3. LOAD STORIES (MỚI: HỖ TRỢ VIDEO) ---
  async function loadStories() {
      try {
          const res = await fetch("/api/stories");
          if (res.ok) {
              const stories = await res.json();
              renderStories(stories);
          }
      } catch (e) { console.error(e); }
  }

  function renderStories(stories) {
      const storiesList = document.getElementById("stories-list");
      if (!storiesList) return;
      storiesList.innerHTML = "";
      
      stories.forEach(s => {
          const authorName = s.nickname || s.username || "User";
          const authorAvatar = getAvatar({ avatar: s.avatar, username: s.username, nickname: s.nickname });
          
          let mediaHtml = "";
          if (isVideo(s.image)) {
              mediaHtml = `<video src="${s.image}" class="story-media" autoplay muted loop playsinline></video>`;
          } else {
              mediaHtml = `<img src="${s.image}" class="story-media" alt="story">`;
          }

          const html = `
            <div class="story-card">
                <div class="story-media-wrapper">${mediaHtml}</div>
                <div class="story-profile"><img src="${authorAvatar}" class="story-profile-img"></div>
                <div class="story-name">${authorName}</div>
            </div>
          `;
          storiesList.insertAdjacentHTML("beforeend", html);
      });
  }

  // ĐĂNG STORY (Hỗ trợ ảnh + video)
  const storyInput = document.getElementById("story-input");
  if (storyInput) {
      storyInput.addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          
          const addBtn = document.querySelector(".add-story-btn");
          if(addBtn) addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

          try {
              const fd = new FormData();
              fd.append("files", file);
              const upRes = await fetch("/api/upload", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: fd
              });
              const data = await upRes.json();
              const mediaUrl = data[0]?.url;

              if (!mediaUrl) throw new Error("Upload thất bại");

              const res = await fetch("/api/stories/create", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ image: mediaUrl }) 
              });

              if (res.ok) {
                  alert("Đã đăng tin!");
                  loadStories(); 
              }
          } catch (e) {
              alert("Lỗi đăng tin");
          } finally {
              if(addBtn) addBtn.innerHTML = '<i class="fas fa-plus"></i>';
              storyInput.value = "";
          }
      });
  }

  // --- RENDER FEED & ACTIONS ---
  const feedContainer = document.getElementById("feed-container");
  
  const reactionMap = {
    like:  { icon: '👍', text: 'Thích',  class: 'liked' },
    love:  { icon: '❤️', text: 'Yêu thích', class: 'loved' },
    haha:  { icon: '😆', text: 'Haha',   class: 'haha' },
    wow:   { icon: '😮', text: 'Wow',    class: 'wow' },
    sad:   { icon: '😢', text: 'Buồn',   class: 'sad' },
    angry: { icon: '😡', text: 'Phẫn nộ', class: 'angry' },
    default: { icon: '<i class="far fa-thumbs-up"></i>', text: 'Thích', class: '' }
  };

  function renderFeed(posts) {
    if (!feedContainer) return;
    feedContainer.innerHTML = "";
    posts.forEach(post => {
      feedContainer.insertAdjacentHTML("beforeend", createPostHTML(post));
    });
  }

  function createPostHTML(post) {
    const authorName = post.nickname || post.username || "Người dùng";
    const authorAvatar = getAvatar({ avatar: post.avatar, username: post.username, nickname: post.nickname });
    
    // Số liệu từ Server
    const totalReactions = post.reactionCount || 0; 
    const totalComments = post.commentCount || 0;
    const userReaction = post.userReaction;

    let btnIcon = reactionMap.default.icon;
    let btnText = reactionMap.default.text;
    let btnClass = reactionMap.default.class;

    if (userReaction && reactionMap[userReaction]) {
        btnIcon = reactionMap[userReaction].icon;
        btnText = reactionMap[userReaction].text;
        btnClass = reactionMap[userReaction].class;
    }

    let mediaHtml = "";
    if (post.image) {
      if(isVideo(post.image)) {
          mediaHtml = `<video src="${post.image}" class="post-image" controls playsinline></video>`;
      } else {
          mediaHtml = `<img src="${post.image}" class="post-image" loading="lazy">`;
      }
    }

    return `
      <div class="post-card" id="post-${post.id}">
        <div class="post-header">
          <img src="${authorAvatar}" alt="${authorName}">
          <div class="post-info">
            <h3>${authorName}</h3>
            <span>${timeAgo(post.createdAt)}</span>
          </div>
        </div>
        <div class="post-content">${post.content || ""}</div>
        ${mediaHtml}
        
        <div class="post-stats">
          <div class="reaction-icons-display">
            ${totalReactions > 0 ? `<span>👍❤️ ${totalReactions}</span>` : '<span>Hãy là người đầu tiên bày tỏ cảm xúc</span>'}
          </div>
          <div class="stat-text" style="cursor:pointer" onclick="openCommentModal('${post.id}')">
            ${totalComments} bình luận
          </div>
        </div>

        <div class="post-actions">
          <div class="reaction-wrapper">
            <div class="reaction-popup-box">
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'like')">👍</div>
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'love')">❤️</div>
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'haha')">😆</div>
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'wow')">😮</div>
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'sad')">😢</div>
              <div class="reaction-icon" onclick="handleSendReaction(${post.id}, 'angry')">😡</div>
            </div>
            <button class="action-btn" onclick="handleToggleLike(${post.id}, '${userReaction || ''}')">
              <span class="action-icon">${btnIcon}</span>
              <span class="action-text ${btnClass}">${btnText}</span>
            </button>
          </div>
          <button class="action-btn" onclick="openCommentModal('${post.id}')">
            <i class="far fa-comment-alt"></i><span>Bình luận</span>
          </button>
          <button class="action-btn"><i class="fas fa-share"></i><span>Chia sẻ</span></button>
        </div>
      </div>
    `;
  }

  // --- REACTION LOGIC ---
  window.handleSendReaction = async (postId, type) => {
    if(event) event.stopPropagation();
    try {
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type })
      });
      if (res.ok) loadPosts(); 
    } catch (e) { console.error(e); }
  };

  window.handleToggleLike = (postId, currentReaction) => {
    const typeToSend = (currentReaction && currentReaction !== 'null' && currentReaction !== 'undefined') ? 'like' : 'like'; 
    handleSendReaction(postId, typeToSend);
  };

  // --- COMMENT LOGIC ---
  const commentModal = document.getElementById("comment-modal");
  const commentsListEl = document.getElementById("comments-list");
  const commentInput = document.getElementById("comment-input");
  const sendCommentBtn = document.getElementById("send-comment-btn");
  let currentPostId = null;

  window.openCommentModal = async (postId) => {
    currentPostId = postId;
    if(commentModal) commentModal.classList.remove("hidden");
    if(commentsListEl) commentsListEl.innerHTML = '<div class="center" style="padding:20px;">Đang tải...</div>';
    
    try {
        const res = await fetch(`/api/posts/${postId}/comments`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if(res.ok) {
            const comments = await res.json();
            document.getElementById("modal-post-author").textContent = "Người dùng"; 
            renderComments(comments || []);
        }
    } catch(e) {
        if(commentsListEl) commentsListEl.innerHTML = '<div class="center" style="color:red">Lỗi tải bình luận</div>';
    }
  };

  function renderComments(comments) {
    if(!comments || comments.length === 0) {
        commentsListEl.innerHTML = "<p style='text-align:center; color:var(--text-sub); margin-top:20px'>Chưa có bình luận nào.</p>";
        return;
    }
    commentsListEl.innerHTML = comments.map(c => {
        const name = c.nickname || c.username || "Người dùng";
        const avatar = getAvatar({ avatar: c.avatar, username: c.username, nickname: c.nickname });
        const canDelete = (currentUser.id === c.userId);

        return `
            <div class="comment-item">
                <img src="${avatar}" alt="${name}">
                <div class="comment-content-wrapper">
                    <div class="comment-content">
                        <a href="#" class="comment-author">${name}</a>
                        <p class="comment-text">${c.content}</p>
                    </div>
                    <div class="comment-footer">
                        <span>${timeAgo(c.createdAt)}</span>
                        <button>Thích</button>
                        ${canDelete ? `<button class="delete-comment-btn" onclick="deleteComment('${c.id}')" style="color:red">Xóa</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    commentsListEl.scrollTop = commentsListEl.scrollHeight;
  }

  // Đóng Modal Comment
  const closeCommentBtn = document.getElementById("close-comment-modal-x");
  if(closeCommentBtn){
      closeCommentBtn.addEventListener("click", () => {
        if(commentModal) commentModal.classList.add("hidden");
        currentPostId = null;
      });
  }

  // Gửi Comment
  if(commentInput){
      commentInput.addEventListener("input", () => {
        if(sendCommentBtn) sendCommentBtn.disabled = commentInput.value.trim() === "";
      });
  }

  if(sendCommentBtn){
      sendCommentBtn.addEventListener("click", async () => {
        const content = commentInput.value.trim();
        if(!content || !currentPostId) return;
        
        sendCommentBtn.disabled = true;
        try {
            const res = await fetch(`/api/posts/${currentPostId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ content })
            });
            if(res.ok) {
                commentInput.value = "";
                openCommentModal(currentPostId);
                loadPosts(); 
            }
        } catch(e) { console.error(e); } 
        finally { sendCommentBtn.disabled = false; }
      });
  }
  
  // Xóa Comment
  window.deleteComment = async (commentId) => {
      if(!confirm("Bạn có chắc muốn xóa bình luận này?")) return;
      try {
          const res = await fetch(`/api/comments/${commentId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` }
          });
          if(res.ok) {
              openCommentModal(currentPostId);
              loadPosts();
          }
      } catch(e) { console.error(e); }
  };

  // --- 5. ĐĂNG BÀI VIẾT (ẢNH/VIDEO) ---
  const postBtn = document.getElementById("post-btn");
  const postContentInput = document.getElementById("post-content-input");
  const postImageInput = document.getElementById("post-image-input");
  
  if(postBtn){
      postBtn.addEventListener("click", async () => {
        const content = postContentInput.value.trim();
        const file = postImageInput.files[0];

        if (!content && !file) return;

        postBtn.textContent = "Đang đăng...";
        postBtn.disabled = true;

        try {
            let imageUrl = "";
            if (file) {
                const fd = new FormData();
                fd.append("files", file);
                const upRes = await fetch("/api/upload", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: fd
                });
                const data = await upRes.json();
                imageUrl = data[0]?.url || ""; 
            }

            const res = await fetch("/api/posts/create", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ content, image: imageUrl })
            });

            if (res.ok) {
                postContentInput.value = "";
                postImageInput.value = "";
                document.getElementById("post-preview-area").classList.add("hidden");
                loadPosts(); 
            }
        } catch (e) { alert("Lỗi đăng bài"); } 
        finally {
            postBtn.textContent = "Đăng";
            postBtn.disabled = false;
        }
      });
  }
  
  if(postImageInput){
      postImageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            document.getElementById("post-preview-img").src = url;
            document.getElementById("post-preview-area").classList.remove("hidden");
        }
      });
  }
  const removePreviewBtn = document.getElementById("remove-preview");
  if(removePreviewBtn){
      removePreviewBtn.addEventListener("click", () => {
        postImageInput.value = "";
        document.getElementById("post-preview-area").classList.add("hidden");
      });
  }

  // --- HAMBURGER MENU & THEME ---
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const sidebarLeft = document.getElementById("sidebar-left");
  const overlay = document.getElementById("home-overlay");
  
  if(hamburgerBtn) {
      hamburgerBtn.addEventListener("click", () => {
        hamburgerBtn.classList.toggle("active");
        sidebarLeft.classList.toggle("active");
        overlay.classList.toggle("active");
      });
  }
  if(overlay) {
      overlay.addEventListener("click", () => {
        hamburgerBtn.classList.remove("active");
        sidebarLeft.classList.remove("active");
        overlay.classList.remove("active");
        if(commentModal) commentModal.classList.add("hidden");
      });
  }

  const themeToggle = document.getElementById("theme-toggle");
  if(themeToggle) {
      themeToggle.addEventListener("click", () => {
          const currentTheme = document.body.getAttribute("data-theme");
          const newTheme = currentTheme === "dark" ? "light" : "dark";
          document.body.setAttribute("data-theme", newTheme);
          localStorage.setItem("theme", newTheme);
      });
  }
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.setAttribute("data-theme", savedTheme);

  // --- PROFILE MODAL LOGIC ---
  const profileModal = document.getElementById("profile-modal");
  const openProfileBtn = document.getElementById("open-profile-btn");
  const closeProfileX = document.getElementById("close-modal-x");
  const cancelProfileBtn = document.getElementById("cancel-profile-btn");
  const saveProfileBtn = document.getElementById("save-profile-btn");

  function toggleProfileModal(show) {
      if(profileModal) {
          show ? profileModal.classList.remove("hidden") : profileModal.classList.add("hidden");
          if(show) loadMyProfile();
      }
  }

  if(openProfileBtn) openProfileBtn.addEventListener("click", () => toggleProfileModal(true));
  if(document.getElementById("my-profile-card")) document.getElementById("my-profile-card").addEventListener("click", () => toggleProfileModal(true));
  if(closeProfileX) closeProfileX.addEventListener("click", () => toggleProfileModal(false));
  if(cancelProfileBtn) cancelProfileBtn.addEventListener("click", () => toggleProfileModal(false));

  if(saveProfileBtn) {
      saveProfileBtn.addEventListener("click", async () => {
          const nickname = document.getElementById("edit-nickname").value;
          const bio = document.getElementById("edit-bio").value;
          const location = document.getElementById("edit-location").value;
          const work = document.getElementById("edit-work").value;
          const edu = document.getElementById("edit-edu").value;
          const avatarFile = document.getElementById("edit-avatar-input").files[0];

          saveProfileBtn.textContent = "Đang lưu...";
          saveProfileBtn.disabled = true;

          try {
              let avatarUrl = currentUser.avatar;
              if (avatarFile) {
                  const fd = new FormData();
                  fd.append("files", avatarFile);
                  const upRes = await fetch("/api/upload", {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                      body: fd
                  });
                  const data = await upRes.json();
                  avatarUrl = data[0]?.url || avatarUrl;
              }

              const res = await fetch("/api/profile/update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ nickname, bio, location, work, education, avatar: avatarUrl })
              });

              if(res.ok) {
                  alert("Cập nhật thành công!");
                  toggleProfileModal(false);
                  loadMyProfile();
              }
          } catch(e) {
              console.error(e);
              alert("Lỗi cập nhật");
          } finally {
              saveProfileBtn.textContent = "Lưu thay đổi";
              saveProfileBtn.disabled = false;
          }
      });
  }

  // --- START APP ---
  await loadMyProfile();
  await loadPosts();
  await loadStories();
});

function logout() {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
}
