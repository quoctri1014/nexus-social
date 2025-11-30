document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) { window.location.href = "/index.html"; return; }

  // Dark Mode Check
  const currentTheme = localStorage.getItem("theme") || "light";
  document.body.setAttribute("data-theme", currentTheme);

  function getAvatarDisplay(user) {
    if (user && user.avatar && user.avatar.includes("/")) return user.avatar;
    const name = user && (user.nickname || user.username) ? user.nickname || user.username : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=200`;
  }

  async function loadNavInfo() {
    try {
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const user = await res.json();
      document.getElementById("nav-avatar").src = getAvatarDisplay(user);
      document.getElementById("nav-username").textContent = user.nickname || user.username;
    } catch (e) {}
  }

  async function loadRequests() {
    const list = document.getElementById("request-list");
    const section = document.getElementById("requests-section");
    try {
      const res = await fetch("/api/friends/pending", { headers: { Authorization: `Bearer ${token}` } });
      const reqs = await res.json();

      if (reqs.length > 0) {
        section.classList.remove("hidden");
        document.getElementById("req-count").textContent = reqs.length;
        list.innerHTML = "";
        reqs.forEach((u) => {
          list.insertAdjacentHTML("beforeend", `
            <div class="friend-card-full">
                <img src="${getAvatarDisplay(u)}" class="friend-card-img" onclick="openUserProfile(${u.userId})">
                <div class="friend-card-body">
                    <div class="friend-card-name" onclick="openUserProfile(${u.userId})">${u.nickname || u.username}</div>
                    <button class="btn-confirm" onclick="acceptFriend(${u.requestId})">Xác nhận</button>
                    <button class="btn-delete">Xóa</button>
                </div>
            </div>`);
        });
      } else { section.classList.add("hidden"); }
    } catch (e) {}
  }

  async function loadSuggestions() {
    const list = document.getElementById("suggestion-list");
    try {
      const res = await fetch("/api/users/suggestions", { headers: { Authorization: `Bearer ${token}` } });
      const users = await res.json();
      list.innerHTML = "";
      if (users.length === 0) { list.innerHTML = "<p style='color:var(--text-sub)'>Không có gợi ý mới.</p>"; return; }

      users.forEach((u) => {
        list.insertAdjacentHTML("beforeend", `
            <div class="friend-card-full">
                <img src="${getAvatarDisplay(u)}" class="friend-card-img" onclick="openUserProfile(${u.id})">
                <div class="friend-card-body">
                    <div class="friend-card-name" onclick="openUserProfile(${u.id})">${u.nickname || u.username}</div>
                    <button class="btn-confirm" onclick="addFriend(this, ${u.id})" style="background:var(--hover-bg); color:var(--primary)">Thêm bạn bè</button>
                </div>
            </div>`);
      });
    } catch (e) {}
  }

  async function loadAllFriends() {
    const list = document.getElementById("all-friends-list");
    try {
      const res = await fetch("/api/friends", { headers: { Authorization: `Bearer ${token}` } });
      const friends = await res.json();
      list.innerHTML = "";
      if (friends.length === 0) { list.innerHTML = "<p style='color:var(--text-sub)'>Chưa có bạn bè nào.</p>"; return; }

      friends.forEach((u) => {
        list.insertAdjacentHTML("beforeend", `
            <div class="friend-card-full">
                <img src="${getAvatarDisplay(u)}" class="friend-card-img" onclick="openUserProfile(${u.id})">
                <div class="friend-card-body">
                    <div class="friend-card-name" onclick="openUserProfile(${u.id})">${u.nickname || u.username}</div>
                    <div style="font-size:12px; color:var(--text-sub)">Bạn bè</div>
                    <button class="btn-view" onclick="openUserProfile(${u.id})">Xem trang</button>
                </div>
            </div>`);
      });
    } catch (e) {}
  }

  window.addFriend = async (btn, id) => {
    btn.textContent = "Đã gửi lời mời"; btn.disabled = true;
    await fetch("/api/friends/request", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ receiverId: id }) });
  };

  window.acceptFriend = async (reqId) => {
    await fetch("/api/friends/accept", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ requestId: reqId }) });
    window.location.reload();
  };

  window.openUserProfile = async (userId) => {
    const modal = document.getElementById("view-user-modal");
    try {
      const res = await fetch(`/api/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const { user, posts } = await res.json();

      document.getElementById("view-avatar").src = getAvatarDisplay(user);
      document.getElementById("view-name").textContent = user.nickname || user.username;
      document.getElementById("view-bio").textContent = user.bio || "";

      const pContainer = document.getElementById("view-user-posts");
      pContainer.innerHTML = posts.length ? "" : "<p style='text-align:center;color:var(--text-sub)'>Chưa có bài viết nào.</p>";
      
      posts.forEach((p) => {
        const img = p.image ? `<img src="${p.image}" style="width:100%; border-radius:8px; margin-top:5px;">` : "";
        pContainer.insertAdjacentHTML("beforeend", `
          <div style="background:var(--bg-card); padding:15px; margin-bottom:10px; border-radius:8px; border:1px solid var(--border); color:var(--text-main)">
            ${p.content || ""} ${img} <br><small style="color:var(--text-sub)">${new Date(p.createdAt).toLocaleString()}</small>
          </div>`);
      });
      modal.classList.remove("hidden");
    } catch (e) {}
  };
  
  document.getElementById("close-view-user").addEventListener("click", () => document.getElementById("view-user-modal").classList.add("hidden"));
  window.logout = () => { localStorage.removeItem("token"); window.location.href = "/index.html"; };

  // INIT
  loadNavInfo();
  loadRequests();
  loadSuggestions();
  loadAllFriends();
});
