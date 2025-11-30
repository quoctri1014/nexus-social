document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // DARK MODE
  const themeToggle = document.getElementById("theme-toggle");
  const currentTheme = localStorage.getItem("theme") || "light";
  document.body.setAttribute("data-theme", currentTheme);
  themeToggle.querySelector("i").className = currentTheme === "dark" ? "fas fa-sun" : "fas fa-moon";

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const newTheme = document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.body.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      themeToggle.querySelector("i").className = newTheme === "dark" ? "fas fa-sun" : "fas fa-moon";
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
    if (row && text)
      value && value.trim() !== "" ? ((text.textContent = value), row.classList.remove("hidden")) : row.classList.add("hidden");
  }

  // LOAD PROFILE
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      currentUser = await res.json();
      const avatar = getAvatarDisplay(currentUser);
      const name = currentUser.nickname || currentUser.username;

      document.getElementById("nav-avatar").src = avatar;
      document.getElementById("nav-username").textContent = name;
      
      if(document.getElementById("sidebar-avatar")) document.getElementById("sidebar-avatar").src = avatar;
      if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = name;
      if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
      
      if (document.getElementById("story-my-avatar")) document.getElementById("story-my-avatar").src = avatar;
      if (document.getElementById("cp-avatar")) document.getElementById("cp-avatar").src = avatar;
      if (document.getElementById("edit-avatar-preview")) document.getElementById("edit-avatar-preview").src = avatar;

      updateSidebarRow("sidebar-location", "sidebar-location-row", currentUser.location);
      updateSidebarRow("sidebar-work", "sidebar-work-row", currentUser.work);
    } catch (e) {}
  }

  // MODAL LOGIC
  const profileModal = document.getElementById("profile-modal");
  const openProfileBtn = document.getElementById("open-profile-btn");
  const myProfileCard = document.getElementById("my-profile-card");
  const closeX = document.getElementById("close-modal-x");
  const cancelBtn = document.getElementById("cancel-profile-btn");
  const saveBtn = document.getElementById("save-profile-btn");
  const editAvatarInput = document.getElementById("edit-avatar-input");
  const editAvatarPreview = document.getElementById("edit-avatar-preview");
  let newAvatarFile = null;

  function openModal() {
    profileModal.classList.remove("hidden");
    newAvatarFile = null;
    document.getElementById("edit-nickname").value = currentUser.nickname || "";
    document.getElementById("edit-bio").value = currentUser.bio || "";
    document.getElementById("edit-location").value = currentUser.location || "";
    document.getElementById("edit-work").value = currentUser.work || "";
    document.getElementById("edit-education").value = currentUser.education || "";
  }

  function closeModal() { profileModal.classList.add("hidden"); }

  if (openProfileBtn) openProfileBtn.addEventListener("click", openModal);
  if (myProfileCard) myProfileCard.addEventListener("click", openModal);
  if (closeX) closeX.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  window.addEventListener("click", (e) => { if (e.target === profileModal) closeModal(); });

  if (editAvatarInput) {
    editAvatarInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        newAvatarFile = e.target.files[0];
        editAvatarPreview.src = URL.createObjectURL(newAvatarFile);
      }
    });
  }

  if (saveBtn) {
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
          if (files.length > 0) finalAvatarUrl = files[0].url;
        }

        const updateData = {
          nickname: document.getElementById("edit-nickname").value.trim(),
          bio: document.getElementById("edit-bio").value.trim(),
          location: document.getElementById("edit-location").value.trim(),
          work: document.getElementById("edit-work").value.trim(),
          education: document.getElementById("edit-education").value.trim(),
          avatar: finalAvatarUrl,
        };

        await fetch("/api/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(updateData),
        });
        
        alert("Thành công!");
        closeModal();
        window.location.reload();
      } catch (e) { alert("Lỗi"); } 
      finally { saveBtn.textContent = "Lưu thay đổi"; saveBtn.disabled = false; }
    });
  }

  // INIT
  await loadMyProfile();
  
  window.logout = () => { localStorage.removeItem("token"); window.location.href = "/index.html"; };
});
