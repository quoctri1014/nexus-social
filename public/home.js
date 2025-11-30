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

      // Update Navbar
      if(document.getElementById("nav-avatar")) document.getElementById("nav-avatar").src = avatar;
      if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = name;
      
      // Update Sidebar
      if(document.getElementById("sidebar-avatar")) document.getElementById("sidebar-avatar").src = avatar;
      if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = name;
      if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiêu sự";

      // Update Story avatar
      if (document.getElementById("story-my-avatar")) document.getElementById("story-my-avatar").src = avatar;
      
      // Update Create Post avatar
      if (document.getElementById("cp-avatar")) document.getElementById("cp-avatar").src = avatar;
      
      // Update Modal preview
      if (document.getElementById("edit-avatar-preview")) document.getElementById("edit-avatar-preview").src = avatar;

      // Update detailed info
      updateSidebarRow("sidebar-location", "sidebar-location-row", currentUser.location);
      updateSidebarRow("sidebar-work", "sidebar-work-row", currentUser.work);
      updateSidebarRow("sidebar-edu", "sidebar-edu-row", currentUser.education);
      
      // Fill edit form
      if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = currentUser.nickname || "";
      if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
      if(document.getElementById("edit-location")) document.getElementById("edit-location").value = currentUser.location || "";
      if(document.getElementById("edit-work")) document.getElementById("edit-work").value = currentUser.work || "";
      if(document.getElementById("edit-edu")) document.getElementById("edit-edu").value = currentUser.education || "";

    } catch (e) {
      console.error("Error loading profile:", e);
      alert("Lỗi tải hồ sơ");
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
  
  // Avatar upload preview
  if(editAvatarInput) {
    editAvatarInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        newAvatarFile = e.target.files[0];
        document.getElementById("edit-avatar-preview").src = URL.createObjectURL(newAvatarFile);
      }
    });
  }

  // Save profile changes
  if(saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.textContent = "Đang lưu...";
      saveBtn.disabled = true;
      let finalAvatarUrl = currentUser.avatar;
      
      try {
        // Upload avatar nếu có file mới
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

        // Cập nhật profile
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
      <div class="post-card">
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
          <span>${post.likes} Thích</span>
        </div>
        <div class="post-actions">
          <div class="action-btn" onclick="likePost(${post.id})">
            <i class="far fa-thumbs-up"></i> Thích
          </div>
          <div class="action-btn" onclick="viewComments(${post.id})">
            <i class="far fa-comment-alt"></i> Bình luận
          </div>
        </div>
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

        // Upload image nếu có
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

        // Create post
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

  // ===== 6. LOAD CONTACTS =====
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

  // ===== 7. LOAD NOTIFICATIONS =====
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

  // ===== 8. STORIES =====
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
            // TODO: Create story in database
            alert("Story đã được tạo!");
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

  window.likePost = async (postId) => {
    try {
      const res = await fetch(`/api/posts/${postId}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await loadPosts();
      }
    } catch (e) {
      console.error("Error liking post:", e);
    }
  };

  window.viewComments = (postId) => {
    // TODO: Implement comments modal
    alert("Tính năng bình luận sẽ sớm được cập nhật");
  };

  // ===== INITIALIZE =====
  await loadMyProfile();
  await loadPosts();
  await loadNotifications();
  loadContacts();

  // Refresh every 30 seconds
  setInterval(loadNotifications, 30000);
});
