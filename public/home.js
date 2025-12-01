document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    // window.location.href = "/index.html"; // Bỏ comment khi chạy thật
  }

  let currentUser = {};

  // HELPER: Avatar Placeholder
  function getAvatar(user) {
    if (user && user.avatar) return user.avatar;
    const name = user && (user.nickname || user.username) ? (user.nickname || user.username) : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
  }

  // HELPER: Time Ago
  function timeAgo(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleString('vi-VN'); 
  }

  // 1. LOAD PROFILE
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        currentUser = await res.json();
        const avatarUrl = getAvatar(currentUser);
        const displayName = currentUser.nickname || currentUser.username;

        // Update UI
        const avatars = document.querySelectorAll("#nav-avatar, #sidebar-avatar, #story-my-avatar, #cp-avatar, #comment-my-avatar, #edit-avatar-preview");
        avatars.forEach(img => img.src = avatarUrl);

        if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = displayName;
        if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = displayName;
        if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
        
        // Update edit profile form if exists
        if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = displayName;
        if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
      }
    } catch (e) {
      console.error("Lỗi load profile:", e);
    }
  }

  // 2. LOAD POSTS
  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const posts = await res.json();
        renderFeed(posts);
      }
    } catch (e) {
      console.error("Lỗi load posts:", e);
    }
  }

  // RENDER FEED
  const feedContainer = document.getElementById("feed-container");
  
  // Map Reaction Icon
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
    feedContainer.innerHTML = "";
    posts.forEach(post => {
      feedContainer.insertAdjacentHTML("beforeend", createPostHTML(post));
    });
  }

  function createPostHTML(post) {
    const authorName = post.author ? (post.author.nickname || post.author.username) : "Người dùng";
    const authorAvatar = getAvatar(post.author);
    
    // Tính tổng reaction (API cần trả về object reactions hoặc count)
    let totalReactions = 0;
    if (post.reactions && typeof post.reactions === 'object') {
        totalReactions = Object.values(post.reactions).reduce((a, b) => a + b, 0);
    } else if (post.reactionCount) {
        totalReactions = post.reactionCount;
    }

    const totalComments = post.comments ? post.comments.length : 0;

    // Trạng thái nút Like của User
    let btnIcon = reactionMap.default.icon;
    let btnText = reactionMap.default.text;
    let btnClass = reactionMap.default.class;

    if (post.userReaction && reactionMap[post.userReaction]) {
        const r = reactionMap[post.userReaction];
        btnIcon = r.icon;
        btnText = r.text;
        btnClass = r.class;
    }

    let mediaHtml = "";
    if (post.image) {
      mediaHtml = `<img src="${post.image}" class="post-image" loading="lazy">`;
    }

    return `
      <div class="post-card" id="post-${post._id || post.id}">
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
            ${totalReactions > 0 ? `<span>👍❤️ ${totalReactions}</span>` : '<span></span>'}
          </div>
          <div class="stat-text" onclick="openCommentModal('${post._id || post.id}')">
            ${totalComments} bình luận
          </div>
        </div>

        <div class="post-actions">
          <div class="reaction-wrapper">
            <div class="reaction-popup-box">
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'like')">👍</div>
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'love')">❤️</div>
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'haha')">😆</div>
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'wow')">😮</div>
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'sad')">😢</div>
              <div class="reaction-icon" onclick="sendReaction('${post._id || post.id}', 'angry')">😡</div>
            </div>
            <button class="action-btn" onclick="toggleLike('${post._id || post.id}', '${post.userReaction}')">
              <span class="action-icon">${btnIcon}</span>
              <span class="action-text ${btnClass}">${btnText}</span>
            </button>
          </div>
          <button class="action-btn" onclick="openCommentModal('${post._id || post.id}')">
            <i class="far fa-comment-alt"></i><span>Bình luận</span>
          </button>
          <button class="action-btn"><i class="fas fa-share"></i><span>Chia sẻ</span></button>
        </div>
      </div>
    `;
  }

  // 3. REACTION LOGIC
  window.sendReaction = async (postId, type) => {
    try {
      const res = await fetch("/api/posts/react", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ postId, type })
      });
      if (res.ok) {
        loadPosts(); // Reload để cập nhật UI chính xác
      }
    } catch (e) {
      console.error(e);
    }
  };

  window.toggleLike = (postId, currentReaction) => {
    // Nếu đã like rồi thì hủy (gửi 'unlike' hoặc null tuỳ backend), chưa like thì gửi 'like'
    // Giả sử backend nhận 'unlike' để xóa reaction
    const newType = (currentReaction && currentReaction !== 'null' && currentReaction !== 'undefined') ? 'unlike' : 'like';
    sendReaction(postId, newType);
  };

  // 4. COMMENT LOGIC
  const commentModal = document.getElementById("comment-modal");
  const commentsListEl = document.getElementById("comments-list");
  const commentInput = document.getElementById("comment-input");
  const sendCommentBtn = document.getElementById("send-comment-btn");
  let currentPostId = null;

  window.openCommentModal = async (postId) => {
    currentPostId = postId;
    commentModal.classList.remove("hidden");
    commentsListEl.innerHTML = '<div class="center" style="padding:20px;">Đang tải...</div>';
    
    // Fetch chi tiết post để lấy comments mới nhất
    try {
        const res = await fetch(`/api/posts/${postId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if(res.ok) {
            const post = await res.json();
            const authorName = post.author ? (post.author.nickname || post.author.username) : "";
            document.getElementById("modal-post-author").textContent = authorName;
            renderComments(post.comments || []);
        }
    } catch(e) {
        commentsListEl.innerHTML = '<div class="center">Lỗi tải bình luận</div>';
    }
  };

  function renderComments(comments) {
    if(!comments || comments.length === 0) {
        commentsListEl.innerHTML = "";
        return;
    }
    commentsListEl.innerHTML = comments.map(c => {
        const user = c.user || {};
        const name = user.nickname || user.username || "Người dùng";
        const avatar = getAvatar(user);
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
                        ${(currentUser._id === user._id || currentUser.id === user.id) ? `<button class="delete-comment-btn" onclick="deleteComment('${c._id || c.id}')">Xóa</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    commentsListEl.scrollTop = commentsListEl.scrollHeight;
  }

  // Close Modal
  document.getElementById("close-comment-modal-x").addEventListener("click", () => {
    commentModal.classList.add("hidden");
    currentPostId = null;
  });

  // Gửi Comment
  commentInput.addEventListener("input", () => {
    sendCommentBtn.disabled = commentInput.value.trim() === "";
  });

  sendCommentBtn.addEventListener("click", async () => {
    const content = commentInput.value.trim();
    if(!content || !currentPostId) return;
    
    sendCommentBtn.disabled = true;
    try {
        const res = await fetch("/api/posts/comment", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json", 
                Authorization: `Bearer ${token}` 
            },
            body: JSON.stringify({ postId: currentPostId, content })
        });
        if(res.ok) {
            commentInput.value = "";
            openCommentModal(currentPostId); // Reload comments
            loadPosts(); // Reload feed counter
        }
    } catch(e) {
        console.error(e);
    } finally {
        sendCommentBtn.disabled = false;
    }
  });

  // HAMBURGER & THEME (Giữ nguyên)
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

  // INIT
  await loadMyProfile();
  await loadPosts();
});
