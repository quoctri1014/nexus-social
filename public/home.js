document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  let currentUser = {};

  // HELPER
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

  // 1. LOAD PROFILE
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      currentUser = await res.json();
      const avatar = getAvatarDisplay(currentUser);
      const name = currentUser.nickname || currentUser.username;

      if(document.getElementById("nav-avatar")) document.getElementById("nav-avatar").src = avatar;
      if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = name;
      if(document.getElementById("sidebar-avatar")) document.getElementById("sidebar-avatar").src = avatar;
      if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = name;
      if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";

      if (document.getElementById("story-my-avatar")) document.getElementById("story-my-avatar").src = avatar;
      if (document.getElementById("cp-avatar")) document.getElementById("cp-avatar").src = avatar;
      if (document.getElementById("edit-avatar-preview")) document.getElementById("edit-avatar-preview").src = avatar;

      updateSidebarRow("sidebar-location", "sidebar-location-row", currentUser.location);
      updateSidebarRow("sidebar-work", "sidebar-work-row", currentUser.work);
      updateSidebarRow("sidebar-edu", "sidebar-edu-row", currentUser.education);
      
      // Fill form
      if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = currentUser.nickname || "";
      if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
      if(document.getElementById("edit-location")) document.getElementById("edit-location").value = currentUser.location || "";
      if(document.getElementById("edit-work")) document.getElementById("edit-work").value = currentUser.work || "";
      if(document.getElementById("edit-edu")) document.getElementById("edit-edu").value = currentUser.education || "";

    } catch (e) {}
  }

  // 2. DARK MODE
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

  // 3. MODALS & ACTIONS
  const profileModal = document.getElementById("profile-modal");
  const closeX = document.getElementById("close-modal-x");
  const cancelBtn = document.getElementById("cancel-profile-btn");
  const saveBtn = document.getElementById("save-profile-btn");
  const editAvatarInput = document.getElementById("edit-avatar-input");
  let newAvatarFile = null;

  function openProfileModal() { if(profileModal) { profileModal.classList.remove("hidden"); loadMyProfile(); } }
  function closeProfileModal() { if(profileModal) profileModal.classList.add("hidden"); newAvatarFile = null; }

  if(document.getElementById("open-profile-btn")) document.getElementById("open-profile-btn").addEventListener("click", openProfileModal);
  if(document.getElementById("my-profile-card")) document.getElementById("my-profile-card").addEventListener("click", openProfileModal);
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
                  const upRes = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
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
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify(updateData),
              });
              if (res.ok) { alert("Cập nhật thành công!"); closeProfileModal(); window.location.reload(); }
          } catch (e) { alert("Lỗi"); } finally { saveBtn.textContent = "Lưu thay đổi"; saveBtn.disabled = false; }
      });
  }

  // 4. LOAD POSTS
  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", { headers: { Authorization: `Bearer ${token}` } });
      const posts = await res.json();
      const feed = document.getElementById("feed-container");
      if(feed) {
          feed.innerHTML = "";
          posts.forEach(p => feed.insertAdjacentHTML("beforeend", createPostHTML(p, p)));
      }
    } catch (e) {}
  }

  function createPostHTML(post, user) {
    const mediaHtml = post.image ? `<img src="${post.image}" class="post-image">` : "";
    const avatar = getAvatarDisplay(user);
    const timeAgo = new Date(post.createdAt).toLocaleString("vi-VN");
    return `
            <div class="post-card">
                <div class="post-header">
                    <img src="${avatar}">
                    <div class="post-info"><h3>${user.nickname || user.username}</h3><span>${timeAgo}</span></div>
                </div>
                <div class="post-content">${post.content || ""}</div>
                ${mediaHtml}
                <div class="post-actions">
                    <div class="action-btn"><i class="far fa-thumbs-up"></i> Thích</div>
                    <div class="action-btn"><i class="far fa-comment-alt"></i> Bình luận</div>
                </div>
            </div>`;
  }

  // Init
  await loadMyProfile();
  loadPosts();

  window.logout = () => { localStorage.removeItem("token"); window.location.href = "/index.html"; };
});
