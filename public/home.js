document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  let currentUser = {};
  let socket = null;
  let userList = [];

  // ===== SOCKET.IO SETUP =====
  if (typeof io !== 'undefined') {
    socket = io({
      auth: { token: token }
    });

    socket.on('userList', (users) => {
      userList = users;
      loadContacts();
    });

    socket.on('newMessage', (msg) => {
      console.log('New message:', msg);
      loadNotifications();
    });
  }

  // ===== HELPER FUNCTIONS =====
  function getAvatarDisplay(user) {
    if (user && user.avatar && user.avatar.includes("/")) return user.avatar;
    const name = user && (user.nickname || user.username) ? user.nickname || user.username : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
  }

  function updateSidebarRow(textId, rowId, value) {
    const row = document.getElementById(rowId);
    const text = document.getElementById(textId);
    if (row && text) value && value.trim() !== "" ? ((text.textContent = value), row.classList.remove("hidden")) : row.classList.add("hidden");
  }

  function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins}p trước`;
    if (diffHours < 24) return `${diffHours}h trước`;
    if (diffDays < 7) return `${diffDays}d trước`;
    
    return new Date(date).toLocaleDateString('vi-VN');
  }

  // ===== 1. LOAD PROFILE =====
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      
      if (!res.ok) throw new Error('Failed to load profile');
      
      currentUser = await res.json();
      const avatar = getAvatarDisplay(currentUser);
      const name = currentUser.nickname || currentUser.username;

      if(document.getElementById("nav-avatar")) document.getElementById("nav-avatar").src = avatar;
      if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = name;
      if(document.getElementById("sidebar-avatar")) document.getElementById("sidebar-avatar").src = avatar;
      if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = name;
      if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiêu sự";

      if (document.getElementById("story-my-avatar")) document.getElementById("story-my-avatar").src = avatar;
      if (document.getElementById("cp-avatar")) document.getElementById("cp-avatar").src = avatar;
      if (document.getElementById("edit-avatar-preview")) document.getElementById("edit-avatar-preview").src = avatar;

      updateSidebarRow("sidebar-location", "sidebar-location-row", currentUser.location);
      updateSidebarRow("sidebar-work", "sidebar-work-row", currentUser.work);
      updateSidebarRow("sidebar-edu", "sidebar-edu-row", currentUser.education);
      
      if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = currentUser.nickname || "";
      if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
      if(document.getElementById("edit-location")) document.getElementById("edit-location").value = currentUser.location || "";
      if(document.getElementById("edit-work")) document.getElementById("edit-work").value = currentUser.work || "";
      if(document.getElementById("edit-edu")) document.getElementById("edit-edu").value = currentUser.education || "";

    } catch (e) {
      console.error("Error loading profile:", e);
    }
  }

  // ===== 2. DARK MODE =====
  const themeToggle = document.getElementById("theme-toggle");
  const currentTheme = localStorage.getItem("theme") || "light";
  document.body.setAttribute("data-theme", currentTheme);
  
  if(themeToggle) {
    themeToggle.addEventListener("click", () => {
      const newTheme = document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.body.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
    });
  }

  // ===== 3. PROFILE MODAL & EDITING =====
  const profileModal = document.getElementById("profile-modal");
  const closeX = document.getElementById("close-modal-x");
  const cancelBtn = document.getElementById("cancel-profile-btn");
  const saveBtn = document.getElementById("save-profile-btn");
  const editAvatarInput = document.getElementById("edit-avatar-input");
  let newAvatarFile = null;

  function openProfileModal() { 
    if(profileModal) { 
      profileModal.classList.remove("hidden"); 
      loadMyProfile(); 
    } 
  }
  
  function closeProfileModal() { 
    if(profileModal) profileModal.classList.add("hidden"); 
    newAvatarFile = null; 
  }

  if(document.getElementById("open-profile-btn")) 
    document.getElementById("open-profile-btn").addEventListener("click", openProfileModal);
  
  if(document.getElementById("my-profile-card")) 
    document.getElementById("my-profile-card").addEventListener("click", openProfileModal);
  
  if(closeX) closeX.addEventListener("click", closeProfileModal);
  if(cancelBtn) cancelBtn.addEventListener("click", closeProfileModal);
  
  if(editAvatarInput) {
    editAvatarInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        newAvatarFile = e.target.files[0];
        document.getElementById("edit-avatar-preview").src = URL.createObjectURL(newAvatarFile);
      }
    });
  }

  if(saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.textContent = "Đang lưu...";
      saveBtn.disabled = true;
      let finalAvatarUrl = currentUser.avatar;
      
      try {
        if (newAvatarFile) {
          const fd = new FormData();
          fd.append("files", newAvatarFile);
          const upRes = await fetch("/api/upload", { 
            method: "POST", 
            headers: { Authorization: `Bearer ${token}` }, 
            body: fd 
          });
          const files = await upRes.json();
          if(files.length > 0) finalAvatarUrl = files[0].url;
        }

        const updateData = {
          nickname: document.getElementById("edit-nickname").value.trim(),
          bio: document.getElementById("edit-bio").value.trim(),
          location: document.getElementById("edit-location").value.trim(),
          work: document.getElementById("edit-work").value.trim(),
          education: document.getElementById("edit-edu").value.trim(),
          avatar: finalAvatarUrl,
        };

        const res = await fetch("/api/profile/update", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json", 
            Authorization: `Bearer ${token}` 
          },
          body: JSON.stringify(updateData),
        });

        if (res.ok) { 
          alert("Cập nhật thành công!"); 
          closeProfileModal(); 
          await loadMyProfile();
        } else {
          alert("Lỗi cập nhật profile");
        }
      } catch (e) { 
        console.error("Error saving profile:", e);
        alert("Lỗi: " + e.message); 
      } finally { 
        saveBtn.textContent = "Lưu thay đổi"; 
        saveBtn.disabled = false; 
      }
    });
  }

  // ===== 4. LOAD POSTS =====
  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      
      if (!res.ok) throw new Error('Failed to load posts');
      
      const posts = await res.json();
      const feed = document.getElementById("feed-container");
      
      if(feed) {
        feed.innerHTML = "";
        if (posts.length === 0) {
          feed.innerHTML = '<div style="text-align: center; padding: 40px; color: #65676b;">Chưa có bài viết nào</div>';
        } else {
          posts.forEach(p => feed.insertAdjacentHTML("beforeend", createPostHTML(p)));
        }
      }
    } catch (e) {
      console.error("Error loading posts:", e);
    }
  }

  function createPostHTML(post) {
    const mediaHtml = post.image ? `<img src="${post.image}" class="post-image" alt="Post image">` : "";
    const avatar = getAvatarDisplay(post);
    const timeAgo = formatTimeAgo(post.createdAt);
    
    return `
      <div class="post-card" data-post-id="${post.id}">
        <div class="post-header">
          <img src="${avatar}" alt="Avatar">
          <div class="post-info">
            <h3>${post.nickname || post.username}</h3>
            <span>${timeAgo}</span>
          </div>
        </div>
        <div class="post-content">${post.content || ""}</div>
        ${mediaHtml}
        <div class="post-stats">
          <span>
            <span class="like-count">${post.likes || 0}</span> Thích
          </span>
          <span>
            <span class="comment-count">0</span> Bình luận
          </span>
          <span>
            <span class="share-count">0</span> Chia sẻ
          </span>
        </div>
        <div class="post-actions">
          <div class="action-btn like-btn" onclick="likePost(${post.id})">
            <i class="far fa-thumbs-up"></i> Thích
          </div>
          <div class="action-btn" onclick="openCommentModal(${post.id})">
            <i class="far fa-comment-alt"></i> Bình luận
          </div>
          <div class="action-btn" onclick="sharePost(${post.id})">
            <i class="fas fa-share"></i> Chia sẻ
          </div>
        </div>
        <div class="reactions-bar hidden" id="reactions-${post.id}" style="padding: 10px; display: flex; gap: 5px; justify-content: center; background: #f0f2f5; border-radius: 8px; margin: 10px 15px 0;">
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'like')" title="Thích">👍</button>
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'love')" title="Yêu thích">❤️</button>
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'haha')" title="Haha">😂</button>
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'wow')" title="Wow">😮</button>
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'sad')" title="Buồn">😢</button>
          <button class="reaction-btn" onclick="addReaction(${post.id}, 'angry')" title="Tức giận">😠</button>
        </div>
        <div class="comments-section hidden" id="comments-${post.id}" style="padding: 15px; border-top: 1px solid #e5e7eb;"></div>
      </div>
    `;
  }

  // ===== 5. CREATE POST =====
  const postBtn = document.getElementById("post-btn");
  const postContentInput = document.getElementById("post-content");
  const postImageInput = document.getElementById("post-image-input");
  let selectedPostImage = null;

  if(postImageInput) {
    postImageInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        selectedPostImage = e.target.files[0];
        document.getElementById("post-preview-area").classList.remove("hidden");
        document.getElementById("post-preview-img").src = URL.createObjectURL(selectedPostImage);
      }
    });
  }

  if(postBtn) {
    postBtn.addEventListener("click", async () => {
      const content = postContentInput.value.trim();
      if (!content && !selectedPostImage) {
        alert("Vui lòng nhập nội dung hoặc chọn ảnh");
        return;
      }

      postBtn.textContent = "Đang đăng...";
      postBtn.disabled = true;

      try {
        let imageUrl = null;

        if (selectedPostImage) {
          const fd = new FormData();
          fd.append("files", selectedPostImage);
          const upRes = await fetch("/api/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd
          });
          const files = await upRes.json();
          if(files.length > 0) imageUrl = files[0].url;
        }

        const res = await fetch("/api/posts/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            content: content,
            image: imageUrl
          })
        });

        if (res.ok) {
          alert("Đăng thành công!");
          postContentInput.value = "";
          selectedPostImage = null;
          document.getElementById("post-preview-area").classList.add("hidden");
          postImageInput.value = "";
          await loadPosts();
        }
      } catch (e) {
        console.error("Error creating post:", e);
        alert("Lỗi đăng bài");
      } finally {
        postBtn.textContent = "Đăng";
        postBtn.disabled = false;
      }
    });
  }

  // ===== 6. REACTIONS (LIKE, LOVE, etc.) =====
  window.addReaction = async (postId, type) => {
    try {
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ type })
      });

      if (res.ok) {
        hideReactionBar(postId);
        await loadPosts();
      }
    } catch (e) {
      console.error("Error adding reaction:", e);
    }
  };

  window.likePost = (postId) => {
    const reactionsBar = document.getElementById(`reactions-${postId}`);
    if (reactionsBar.classList.contains("hidden")) {
      reactionsBar.classList.remove("hidden");
    } else {
      reactionsBar.classList.add("hidden");
    }
  };

  function hideReactionBar(postId) {
    const reactionsBar = document.getElementById(`reactions-${postId}`);
    if (reactionsBar) {
      reactionsBar.classList.add("hidden");
    }
  }

  // ===== 7. COMMENTS =====
  const commentModal = document.createElement("div");
  commentModal.id = "comment-modal";
  commentModal.className = "modal-backdrop hidden";
  commentModal.innerHTML = `
    <div class="modal-content profile-edit-box" style="width: 500px;">
      <div class="modal-header">
        <h2>Bình luận</h2>
        <i class="fas fa-times" id="close-comment-modal" style="cursor: pointer; color: #65676b;"></i>
      </div>
      <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
        <div id="comments-list"></div>
      </div>
      <div class="modal-footer" style="padding: 15px; border-top: 1px solid #e5e7eb; display: flex; gap: 10px;">
        <input type="text" id="comment-input" placeholder="Viết bình luận..." style="flex: 1; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: var(--bg-body); color: var(--text-main);">
        <button id="submit-comment-btn" class="btn-primary">Gửi</button>
      </div>
    </div>
  `;
  document.body.appendChild(commentModal);

  let currentCommentPostId = null;

  window.openCommentModal = async (postId) => {
    currentCommentPostId = postId;
    commentModal.classList.remove("hidden");
    await loadComments(postId);
  };

  document.getElementById("close-comment-modal").addEventListener("click", () => {
    commentModal.classList.add("hidden");
  });

  async function loadComments(postId) {
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Failed to load comments");

      const comments = await res.json();
      const commentsList = document.getElementById("comments-list");
      const postCard = document.querySelector(`[data-post-id="${postId}"]`);
      
      if (postCard) {
        const commentCount = postCard.querySelector(".comment-count");
        commentCount.textContent = comments.length;
      }

      commentsList.innerHTML = "";

      if (comments.length === 0) {
        commentsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #65676b;">Chưa có bình luận nào</div>';
      } else {
        comments.forEach(c => {
          const avatar = getAvatarDisplay(c);
          const timeAgo = formatTimeAgo(c.createdAt);
          commentsList.innerHTML += `
            <div style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
              <div style="display: flex; gap: 10px;">
                <img src="${avatar}" alt="Avatar" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;">
                <div style="flex: 1;">
                  <div style="background: #f0f2f5; padding: 10px; border-radius: 8px;">
                    <h4 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--text-main);">${c.nickname || c.username}</h4>
                    <p style="margin: 5px 0 0; font-size: 14px; color: var(--text-main);">${c.content}</p>
                  </div>
                  <span style="font-size: 12px; color: #65676b; margin-top: 5px; display: block;">${timeAgo}</span>
                </div>
                ${c.userId === currentUser.id ? `<i class="fas fa-trash" style="cursor: pointer; color: #e41e3f;" onclick="deleteComment(${c.id})"></i>` : ''}
              </div>
            </div>
          `;
        });
      }
    } catch (e) {
      console.error("Error loading comments:", e);
    }
  }

  document.getElementById("submit-comment-btn").addEventListener("click", async () => {
    const content = document.getElementById("comment-input").value.trim();
    
    if (!content) {
      alert("Vui lòng nhập bình luận");
      return;
    }

    try {
      const res = await fetch(`/api/posts/${currentCommentPostId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });

      if (res.ok) {
        document.getElementById("comment-input").value = "";
        await loadComments(currentCommentPostId);
      }
    } catch (e) {
      console.error("Error posting comment:", e);
    }
  });

  window.deleteComment = async (commentId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa bình luận này?")) return;

    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        await loadComments(currentCommentPostId);
      }
    } catch (e) {
      console.error("Error deleting comment:", e);
    }
  };

  // ===== 8. SHARE =====
  window.sharePost = async (postId) => {
    try {
      const post = document.querySelector(`[data-post-id="${postId}"]`);
      if (!post) return;

      const postContent = post.querySelector(".post-content").textContent;
      const postImage = post.querySelector(".post-image")?.src;

      // Copy to clipboard
      const postUrl = `${window.location.origin}/home.html?post=${postId}`;
      navigator.clipboard.writeText(`Chia sẻ: ${postContent}\n${postUrl}`);

      // Update share count
      const shareCount = post.querySelector(".share-count");
      shareCount.textContent = parseInt(shareCount.textContent) + 1;

      alert("Đã sao chép liên kết chia sẻ!");
    } catch (e) {
      console.error("Error sharing post:", e);
    }
  };

  // ===== 9. LOAD CONTACTS =====
  function loadContacts() {
    const contactList = document.getElementById("contact-list");
    if (!contactList) return;

    contactList.innerHTML = "";
    
    const onlineUsers = userList.filter(u => u.online && u.id !== currentUser.id && u.id !== 1);
    
    if (onlineUsers.length === 0) {
      contactList.innerHTML = '<div style="padding: 10px; color: #65676b; text-align: center; font-size: 13px;">Không có người liên hệ trực tuyến</div>';
      return;
    }

    onlineUsers.forEach(u => {
      const avatar = getAvatarDisplay(u);
      contactList.innerHTML += `
        <div class="contact-item" onclick="window.location.href='/chat.html?userId=${u.id}'">
          <div class="contact-img">
            <img src="${avatar}" alt="${u.nickname}">
            <div class="online-dot"></div>
          </div>
          <span>${u.nickname || u.username}</span>
        </div>
      `;
    });
  }

  // ===== 10. LOAD NOTIFICATIONS =====
  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const notifs = await res.json();
      const badge = document.getElementById("nav-notif-badge");
      
      if (badge) {
        if (notifs.length > 0) {
          badge.textContent = notifs.length;
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      }
    } catch (e) {
      console.error("Error loading notifications:", e);
    }
  }

  // ===== 11. STORIES =====
  const storyInput = document.getElementById("story-input");
  if(storyInput) {
    storyInput.addEventListener("change", async (e) => {
      if (e.target.files[0]) {
        const fd = new FormData();
        fd.append("files", e.target.files[0]);
        
        try {
          const upRes = await fetch("/api/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd
          });
          const files = await upRes.json();
          
          if(files.length > 0) {
            const createRes = await fetch("/api/stories/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ image: files[0].url })
            });

            if (createRes.ok) {
              alert("Story đã được tạo!");
              storyInput.value = "";
            }
          }
        } catch (e) {
          alert("Lỗi tải story");
        }
      }
    });
  }

  // ===== GLOBAL FUNCTIONS =====
  window.logout = () => { 
    localStorage.removeItem("token"); 
    window.location.href = "/index.html"; 
  };

  // ===== INITIALIZE =====
  await loadMyProfile();
  await loadPosts();
  await loadNotifications();
  loadContacts();

  // Refresh every 30 seconds
  setInterval(loadNotifications, 30000);
  setInterval(loadPosts, 60000);
});
