document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html"; // Chuyển hướng nếu chưa đăng nhập
    return;
  }

  let currentUser = {};

  // --- 1. CÁC HÀM TIỆN ÍCH (HELPER) ---

  // Lấy ảnh đại diện (Nếu không có ảnh thì tạo ảnh theo tên)
  function getAvatar(user) {
    if (user && user.avatar) return user.avatar;
    const name = user && (user.nickname || user.username) ? (user.nickname || user.username) : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
  }

  // Định dạng thời gian (Ví dụ: 10 phút trước, hoặc ngày tháng)
  function timeAgo(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      const now = new Date();
      const seconds = Math.floor((now - date) / 1000);
      
      let interval = seconds / 31536000;
      if (interval > 1) return Math.floor(interval) + " năm trước";
      interval = seconds / 2592000;
      if (interval > 1) return Math.floor(interval) + " tháng trước";
      interval = seconds / 86400;
      if (interval > 1) return Math.floor(interval) + " ngày trước";
      interval = seconds / 3600;
      if (interval > 1) return Math.floor(interval) + " giờ trước";
      interval = seconds / 60;
      if (interval > 1) return Math.floor(interval) + " phút trước";
      
      return "Vừa xong";
  }

  // --- 2. TẢI THÔNG TIN CÁ NHÂN (PROFILE) ---
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        currentUser = await res.json();
        const avatarUrl = getAvatar(currentUser);
        const displayName = currentUser.nickname || currentUser.username;

        // Cập nhật Avatar ở mọi nơi trên giao diện
        const avatarElements = document.querySelectorAll("#nav-avatar, #sidebar-avatar, #story-my-avatar, #cp-avatar, #comment-my-avatar, #edit-avatar-preview");
        avatarElements.forEach(img => img.src = avatarUrl);

        // Cập nhật Tên
        if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = displayName;
        if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = displayName;
        if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
        
        // Điền dữ liệu vào Modal sửa Profile (nếu có)
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

  // --- 3. TẢI DANH SÁCH BÀI VIẾT (FEED) ---
  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const posts = await res.json();
        renderFeed(posts);
      } else {
        console.error("Lỗi tải bài viết:", res.status);
      }
    } catch (e) {
      console.error("Lỗi kết nối:", e);
    }
  }

  // --- 4. RENDER GIAO DIỆN BÀI VIẾT ---
  const feedContainer = document.getElementById("feed-container");
  
  // Bản đồ Icon và Màu sắc cho Reaction
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
    // Xử lý dữ liệu tác giả
    const authorName = post.nickname || post.username || "Người dùng";
    const authorAvatar = getAvatar({ avatar: post.avatar, username: post.username, nickname: post.nickname });
    
    // Xử lý số liệu (Lấy từ SQL Server trả về)
    // Lưu ý: Backend cần trả về reactionCount, commentCount, userReaction
    const totalReactions = post.reactionCount || 0; 
    const totalComments = post.commentCount || 0;
    const userReaction = post.userReaction; // 'like', 'love', ... hoặc null

    // Xác định giao diện nút Like (Màu sắc & Icon)
    let btnIcon = reactionMap.default.icon;
    let btnText = reactionMap.default.text;
    let btnClass = reactionMap.default.class;

    if (userReaction && reactionMap[userReaction]) {
        btnIcon = reactionMap[userReaction].icon; // Nếu đã like thì hiện icon cảm xúc
        btnText = reactionMap[userReaction].text;
        btnClass = reactionMap[userReaction].class; // Class đổi màu chữ
    }

    // HTML cho ảnh bài viết
    let mediaHtml = "";
    if (post.image) {
      mediaHtml = `<img src="${post.image}" class="post-image" loading="lazy" alt="Post Image">`;
    }

    // HTML hoàn chỉnh cho 1 bài viết
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
          
          <button class="action-btn">
            <i class="fas fa-share"></i><span>Chia sẻ</span>
          </button>
        </div>
      </div>
    `;
  }

  // --- 5. LOGIC GỬI CẢM XÚC (REACTION) ---
  
  // Hàm này gọi khi click vào 1 icon cụ thể (Tim, Haha...)
  window.handleSendReaction = async (postId, type) => {
    // Dừng sự kiện nổi bọt để tránh click nhầm vào nút cha
    if(event) event.stopPropagation();

    try {
      // Gọi API: POST /api/posts/:id/react
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ type }) // Gửi loại cảm xúc
      });
      
      if (res.ok) {
        // Nếu thành công, tải lại danh sách bài viết để cập nhật số lượng và màu sắc
        loadPosts(); 
      } else {
        console.error("Lỗi gửi cảm xúc:", res.status);
      }
    } catch (e) {
      console.error("Lỗi mạng:", e);
    }
  };

  // Hàm này gọi khi click nút Like chính (Toggle)
  window.handleToggleLike = (postId, currentReaction) => {
    // Nếu đã like rồi thì ấn lần nữa sẽ like (hoặc backend bạn có thể xử lý xóa like nếu gửi trùng)
    // Tạm thời logic: Nếu chưa có gì -> Like. Nếu có rồi -> vẫn gửi Like (để đổi lại icon like thường hoặc update)
    const typeToSend = (currentReaction && currentReaction !== 'null' && currentReaction !== 'undefined') ? 'like' : 'like'; 
    handleSendReaction(postId, typeToSend);
  };

  // --- 6. LOGIC BÌNH LUẬN (COMMENT) ---
  const commentModal = document.getElementById("comment-modal");
  const commentsListEl = document.getElementById("comments-list");
  const commentInput = document.getElementById("comment-input");
  const sendCommentBtn = document.getElementById("send-comment-btn");
  let currentPostId = null;

  // Mở Modal Bình Luận
  window.openCommentModal = async (postId) => {
    currentPostId = postId;
    if(commentModal) commentModal.classList.remove("hidden");
    if(commentsListEl) commentsListEl.innerHTML = '<div class="center" style="padding:20px; color: var(--text-sub)">Đang tải bình luận...</div>';
    
    try {
        // Gọi API lấy bình luận: GET /api/posts/:id/comments
        const res = await fetch(`/api/posts/${postId}/comments`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if(res.ok) {
            const comments = await res.json();
            // Lấy tên tác giả bài viết để hiển thị trên header modal
            const postAuthorEl = document.getElementById("modal-post-author");
            if(postAuthorEl) postAuthorEl.textContent = "người dùng"; // Có thể cải thiện nếu API trả về chi tiết post
            renderComments(comments || []);
        }
    } catch(e) {
        if(commentsListEl) commentsListEl.innerHTML = '<div class="center" style="color:red">Lỗi tải bình luận</div>';
    }
  };

  // Render danh sách bình luận
  function renderComments(comments) {
    if(!comments || comments.length === 0) {
        commentsListEl.innerHTML = "<p style='text-align:center; color:var(--text-sub); margin-top:20px'>Chưa có bình luận nào. Hãy là người đầu tiên!</p>";
        return;
    }
    commentsListEl.innerHTML = comments.map(c => {
        const name = c.nickname || c.username || "Người dùng";
        const avatar = getAvatar({ avatar: c.avatar, username: c.username, nickname: c.nickname });
        const canDelete = (currentUser.id === c.userId); // Kiểm tra quyền xóa

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
                        <button>Phản hồi</button>
                        ${canDelete ? `<button class="delete-comment-btn" onclick="deleteComment('${c.id}')" style="color:red">Xóa</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    // Cuộn xuống cuối
    commentsListEl.scrollTop = commentsListEl.scrollHeight;
  }

  // Đóng Modal
  const closeCommentBtn = document.getElementById("close-comment-modal-x");
  if(closeCommentBtn){
      closeCommentBtn.addEventListener("click", () => {
        if(commentModal) commentModal.classList.add("hidden");
        currentPostId = null;
      });
  }

  // Bật/tắt nút gửi khi nhập liệu
  if(commentInput){
      commentInput.addEventListener("input", () => {
        if(sendCommentBtn) sendCommentBtn.disabled = commentInput.value.trim() === "";
      });
  }

  // Gửi Bình Luận
  if(sendCommentBtn){
      sendCommentBtn.addEventListener("click", async () => {
        const content = commentInput.value.trim();
        if(!content || !currentPostId) return;
        
        sendCommentBtn.disabled = true;
        try {
            // API Gửi: POST /api/posts/:id/comments
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
                // Tải lại comment ngay lập tức
                openCommentModal(currentPostId); 
                // Tải lại feed để cập nhật số lượng comment bên ngoài
                loadPosts(); 
            } else {
                alert("Gửi bình luận thất bại");
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
      if(!confirm("Bạn có chắc muốn xóa bình luận này?")) return;
      try {
          const res = await fetch(`/api/comments/${commentId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` }
          });
          if(res.ok) {
              // Reload modal để mất dòng comment vừa xóa
              openCommentModal(currentPostId);
              loadPosts(); // Update số lượng
          }
      } catch(e) { console.error(e); }
  };

  // --- 7. ĐĂNG BÀI VIẾT MỚI ---
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
            // Nếu có ảnh -> Upload trước
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

            // Gửi dữ liệu bài viết
            const res = await fetch("/api/posts/create", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ content, image: imageUrl })
            });

            if (res.ok) {
                // Reset form
                postContentInput.value = "";
                postImageInput.value = "";
                const previewArea = document.getElementById("post-preview-area");
                if(previewArea) previewArea.classList.add("hidden");
                
                // Tải lại feed
                loadPosts(); 
            }
        } catch (e) {
            alert("Lỗi đăng bài: " + e.message);
        } finally {
            postBtn.textContent = "Đăng";
            postBtn.disabled = false;
        }
      });
  }
  
  // Xem trước ảnh khi chọn file
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

  // --- 8. UI CHUNG (HAMBURGER, THEME, LOGOUT) ---
  
  // Mobile Menu
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const sidebarLeft = document.getElementById("sidebar-left");
  const overlay = document.getElementById("home-overlay");
  
  if(hamburgerBtn) {
      hamburgerBtn.addEventListener("click", () => {
        hamburgerBtn.classList.toggle("active");
        if(sidebarLeft) sidebarLeft.classList.toggle("active");
        if(overlay) overlay.classList.toggle("active");
      });
  }
  if(overlay) {
      overlay.addEventListener("click", () => {
        if(hamburgerBtn) hamburgerBtn.classList.remove("active");
        if(sidebarLeft) sidebarLeft.classList.remove("active");
        if(overlay) overlay.classList.remove("active");
        if(commentModal) commentModal.classList.add("hidden");
      });
  }

  // Dark/Light Mode
  const themeToggle = document.getElementById("theme-toggle");
  if(themeToggle) {
      themeToggle.addEventListener("click", () => {
          const currentTheme = document.body.getAttribute("data-theme");
          const newTheme = currentTheme === "dark" ? "light" : "dark";
          document.body.setAttribute("data-theme", newTheme);
          localStorage.setItem("theme", newTheme);
      });
  }
  // Load theme đã lưu
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.setAttribute("data-theme", savedTheme);

  // Profile Modal (Mở/Đóng)
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

  // Lưu Profile
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

  // --- 9. KHỞI CHẠY LẦN ĐẦU ---
  await loadMyProfile();
  await loadPosts();
});

// Hàm Logout toàn cục
function logout() {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
}
