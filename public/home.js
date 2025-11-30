document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // --- DARK MODE ---
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

  let currentUser = {};

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

  // --- LOAD PROFILE ---
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      currentUser = await res.json();
      const avatar = getAvatarDisplay(currentUser);
      const name = currentUser.nickname || currentUser.username;

      // Update ALL Avatar Locations
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

      // Fill Modal Data
      if(document.getElementById("edit-nickname")) document.getElementById("edit-nickname").value = currentUser.nickname || "";
      if(document.getElementById("edit-bio")) document.getElementById("edit-bio").value = currentUser.bio || "";
      if(document.getElementById("edit-location")) document.getElementById("edit-location").value = currentUser.location || "";
      if(document.getElementById("edit-work")) document.getElementById("edit-work").value = currentUser.work || "";
      if(document.getElementById("edit-edu")) document.getElementById("edit-edu").value = currentUser.education || "";
    } catch (e) {}
  }

  // --- PROFILE MODAL LOGIC ---
  const profileModal = document.getElementById("profile-modal");
  const openProfileBtn = document.getElementById("open-profile-btn");
  const openCardBtn = document.getElementById("my-profile-card");
  const closeX = document.getElementById("close-modal-x");
  const cancelBtn = document.getElementById("cancel-profile-btn");
  const saveBtn = document.getElementById("save-profile-btn");
  const editAvatarInput = document.getElementById("edit-avatar-input");
  const editAvatarPreview = document.getElementById("edit-avatar-preview");
  let newAvatarFile = null;

  function openModal() {
      profileModal.classList.remove("hidden");
      newAvatarFile = null;
      loadMyProfile(); 
  }
  function closeModal() { profileModal.classList.add("hidden"); }

  if(openProfileBtn) openProfileBtn.addEventListener("click", openModal);
  if(openCardBtn) openCardBtn.addEventListener("click", openModal); // Click vào card cũng mở
  if(closeX) closeX.addEventListener("click", closeModal);
  if(cancelBtn) cancelBtn.addEventListener("click", closeModal);
  window.addEventListener("click", (e) => { if (e.target === profileModal) closeModal(); });

  if(editAvatarInput) {
    editAvatarInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        newAvatarFile = e.target.files[0];
        editAvatarPreview.src = URL.createObjectURL(newAvatarFile);
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
            body: fd,
          });
          finalAvatarUrl = (await upRes.json())[0].url;
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
        if (res.ok) { alert("Cập nhật thành công!"); closeModal(); loadMyProfile(); }
      } catch (e) { alert("Lỗi"); } 
      finally { saveBtn.textContent = "Lưu thay đổi"; saveBtn.disabled = false; }
    });
  }

  // --- POST LOGIC ---
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

  const postBtn = document.getElementById("post-btn");
  const postImgInput = document.getElementById("post-image-input");
  let postImageFile = null;
  
  if(postImgInput) postImgInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        postImageFile = e.target.files[0];
        document.getElementById("post-preview-img").src = URL.createObjectURL(postImageFile);
        document.getElementById("post-preview-area").classList.remove("hidden");
      }
  });

  if(postBtn) postBtn.addEventListener("click", async () => {
      const content = document.getElementById("post-content").value;
      if (!content && !postImageFile) return;
      postBtn.disabled = true;
      let imgUrl = null;
      if (postImageFile) {
        const fd = new FormData();
        fd.append("files", postImageFile);
        const res = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        imgUrl = (await res.json())[0].url;
      }
      await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, image: imgUrl }),
      });
      window.location.reload();
  });

  // Logout
  window.logout = () => { localStorage.removeItem("token"); window.location.href = "/index.html"; };

  // Init
  await loadMyProfile();
  loadPosts();
});
