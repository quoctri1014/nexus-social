document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    // Nếu chưa đăng nhập thì đá về trang login
    // window.location.href = "/index.html"; 
  }

  let currentUser = {};

  // --- HELPER FUNCTIONS ---

  // Lấy Avatar (nếu không có thì dùng ảnh mặc định tạo theo tên)
  function getAvatar(user) {
    if (user && user.avatar) return user.avatar;
    const name = user && (user.nickname || user.username) ? (user.nickname || user.username) : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
  }

  // Format thời gian hiển thị
  function timeAgo(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); 
  }

  // --- 1. TẢI THÔNG TIN PROFILE ---
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        currentUser = await res.json();
        const avatarUrl = getAvatar(currentUser);
        const displayName = currentUser.nickname || currentUser.username;

        // Cập nhật Avatar trên giao diện
        const avatars = document.querySelectorAll("#nav-avatar, #sidebar-avatar, #story-my-avatar, #cp-avatar, #comment-my-avatar, #edit-avatar-preview");
        avatars.forEach(img => img.src = avatarUrl);

        if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = displayName;
        if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = displayName;
        if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
        
        // Điền thông tin vào form sửa profile
        if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = displayName;
        if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
        if(document.getElementById("edit-location")) document.getElementById("edit-location").value = currentUser.location || "";
        if(document.getElementById("edit-work")) document.getElementById("edit-work").value = currentUser.work || "";
        if(document.getElementById("edit-edu")) document.getElementById("edit-edu").value = currentUser.education || "";
      }
    } catch (e) {
      console.error("Lỗi load profile:", e);
    }
  }

  // --- 2. TẢI DANH SÁCH BÀI VIẾT ---
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

  // Render HTML cho danh sách bài viết
  const feedContainer = document.getElementById("feed-container");
  
  // Cấu hình Icon cảm xúc
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
    const authorName = post.nickname || post.username || "Người dùng"; // Sửa lại key theo server trả về
    const authorAvatar = getAvatar({ avatar: post.avatar, username: post.username, nickname: post.nickname });
    
    // Server của bạn chưa trả về danh sách reaction chi tiết trong route /api/posts
    // Nên tạm thời ta giả định hoặc hiển thị số reaction nếu có
    // Nếu bạn muốn hiển thị số like chính xác, cần sửa query SQL trong server.js để COUNT
    let totalReactions = post.reactionCount || 0; 
    let totalComments = post.commentCount || 0; // Tương tự với comment

    // Xác định trạng thái Like của user (Server cần trả về trường này nếu muốn hiện màu xanh)
    let btnIcon = reactionMap.default.icon;
    let btnText = reactionMap.default.text;
    let btnClass = reactionMap.default.class;

    // Logic kiểm tra nếu user đã like (cần server hỗ trợ trả về 'userReaction')
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
            <span>👍❤️ Tương tác</span> 
          </div>
          <div class="stat-text" onclick="openCommentModal('${post.id}')">
            Bình luận
          </div>
        </div>

        <div class="post-actions">
          <div class="reaction-wrapper">
            <div class="reaction-popup-box">
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'like')">👍</div>
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'love')">❤️</div>
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'haha')">😆</div>
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'wow')">😮</div>
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'sad')">😢</div>
              <div class="reaction-icon" onclick="sendReaction('${post.id}', 'angry')">😡</div>
            </div>
            <button class="action-btn" onclick="toggleLike('${post.id}', '${post.userReaction}')">
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

  // --- 3. XỬ LÝ REACTION (FIX LỖI 404 TẠI ĐÂY) ---
  window.sendReaction = async (postId, type) => {
    try {
      // SỬA: Đưa postId vào URL thay vì body để khớp với server.js
      // Server: app.post("/api/posts/:postId/react", ...)
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type }) // Chỉ gửi type trong body
      });
      
      if (res.ok) {
        console.log("React thành công");
        // Reload lại bài viết để cập nhật giao diện (cách đơn giản nhất)
        // loadPosts(); 
        // Hoặc chỉ hiển thị thông báo nhỏ
      } else {
          console.error("Lỗi react:", res.status);
      }
    } catch (e) {
      console.error(e);
    }
  };

  window.toggleLike = (postId, currentReaction) => {
    const newType = (currentReaction && currentReaction !== 'null') ? 'like' : 'like'; // Tạm thời mặc định là like
    sendReaction(postId, newType);
  };

  // --- 4. XỬ LÝ COMMENT MODAL ---
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
        // Server: app.get("/api/posts/:postId/comments", ...)
        const res = await fetch(`/api/posts/${postId}/comments`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if(res.ok) {
            const comments = await res.json();
            // Lấy tên tác giả bài viết (Cần fetch thêm info post nếu muốn chính xác)
            document.getElementById("modal-post-author").textContent = "Người đăng"; 
            renderComments(comments || []);
        }
    } catch(e) {
        if(commentsListEl) commentsListEl.innerHTML = '<div class="center">Lỗi tải bình luận</div>';
    }
  };

  function renderComments(comments) {
    if(!comments || comments.length === 0) {
        commentsListEl.innerHTML = "<p style='text-align:center; color:#65676b; margin-top:20px'>Chưa có bình luận nào.</p>";
        return;
    }
    commentsListEl.innerHTML = comments.map(c => {
        // Dữ liệu từ bảng post_comments join users
        const name = c.nickname || c.username || "Người dùng";
        const avatar = getAvatar({ avatar: c.avatar, username: c.username, nickname: c.nickname });
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
                        ${(currentUser.id === c.userId) ? `<button class="delete-comment-btn" onclick="deleteComment('${c.id}')">Xóa</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    commentsListEl.scrollTop = commentsListEl.scrollHeight;
  }

  // Đóng Modal
  const closeCommentBtn = document.getElementById("close-comment-modal-x");
  if(closeCommentBtn){
      closeCommentBtn.addEventListener("click", () => {
        commentModal.classList.add("hidden");
        currentPostId = null;
      });
  }

  // Xử lý nút Gửi Comment
  if(commentInput){
      commentInput.addEventListener("input", () => {
        sendCommentBtn.disabled = commentInput.value.trim() === "";
      });
  }

  if(sendCommentBtn){
      sendCommentBtn.addEventListener("click", async () => {
        const content = commentInput.value.trim();
        if(!content || !currentPostId) return;
        
        sendCommentBtn.disabled = true;
        try {
            // SỬA: Đưa postId vào URL để khớp server.js
            // Server: app.post("/api/posts/:postId/comments", ...)
            const res = await fetch(`/api/posts/${currentPostId}/comments`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    Authorization: `Bearer ${token}` 
                },
                body: JSON.stringify({ content })
            });
            if(res.ok) {
                commentInput.value = "";
                openCommentModal(currentPostId); // Reload lại danh sách comment
            } else {
                alert("Lỗi gửi bình luận");
            }
        } catch(e) {
            console.error(e);
        } finally {
            sendCommentBtn.disabled = false;
        }
      });
  }
  
  // Xóa bình luận
  window.deleteComment = async (commentId) => {
      if(!confirm("Bạn có chắc muốn xóa?")) return;
      try {
          const res = await fetch(`/api/comments/${commentId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` }
          });
          if(res.ok) {
              openCommentModal(currentPostId); // Reload lại modal
          }
      } catch(e) { console.error(e); }
  }

  // --- 5. ĐĂNG BÀI VIẾT MỚI ---
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
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ content, image: imageUrl })
            });

            if (res.ok) {
                postContentInput.value = "";
                postImageInput.value = "";
                const previewArea = document.getElementById("post-preview-area");
                if(previewArea) previewArea.classList.add("hidden");
                loadPosts(); 
            }
        } catch (e) {
            alert("Lỗi đăng bài");
        } finally {
            postBtn.textContent = "Đăng";
            postBtn.disabled = false;
        }
      });
  }
  
  // Preview ảnh khi chọn file đăng bài
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

  // Profile Modal Logic
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

  // --- INIT ---
  await loadMyProfile();
  await loadPosts();
});
