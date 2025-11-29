document.addEventListener("DOMContentLoaded", async () => {
  // --- CHẶN ĐĂNG NHẬP ---
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html";
    return;
  }

  function getAvatarDisplay(user) {
    if (user && user.avatar && user.avatar.includes("/")) return user.avatar;
    const name = user.nickname || user.username || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name
    )}&background=0D8ABC&color=fff&size=128`;
  }

  // 1. Load Nav Info
  async function loadNavInfo() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const user = await res.json();
      document.getElementById("nav-avatar").src = getAvatarDisplay(user);
      document.getElementById("nav-username").textContent =
        user.nickname || user.username;
    } catch (e) {}
  }

  // 2. Load Notifications Full Page
  async function loadNotificationsPage() {
    const container = document.getElementById("notification-list-container");
    const badge = document.getElementById("nav-notif-badge");

    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const notifs = await res.json();
      container.innerHTML = "";

      if (notifs.length === 0) {
        container.innerHTML = `<div class="empty-state">Hiện tại không có thông báo mới nào.</div>`;
        badge.classList.add("hidden");
        return;
      }

      // Cập nhật badge trên navbar
      badge.textContent = notifs.length;
      badge.classList.remove("hidden");

      notifs.forEach((n) => {
        const iconHtml =
          n.type === "request"
            ? `<div class="notif-icon icon-req"><i class="fas fa-user-plus"></i></div>`
            : `<div class="notif-icon icon-post"><i class="fas fa-newspaper"></i></div>`;

        const contentText =
          n.type === "request"
            ? `<b>${
                n.nickname || n.username
              }</b> đã gửi cho bạn một lời mời kết bạn.`
            : `<b>${n.nickname || n.username}</b> vừa đăng một bài viết mới.`;

        const linkAction =
          n.type === "request"
            ? "window.location.href='/friends.html'"
            : "window.location.href='/home.html'";

        const html = `
                    <div class="notif-item-full" onclick="${linkAction}">
                        <div class="notif-img-full">
                            <img src="${getAvatarDisplay(n)}">
                        </div>
                        <div class="notif-content-full">
                            <div class="notif-text">${contentText}</div>
                            <div class="notif-time">${new Date(
                              n.createdAt
                            ).toLocaleString("vi-VN")}</div>
                        </div>
                        ${iconHtml}
                    </div>
                `;
        container.insertAdjacentHTML("beforeend", html);
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state">Lỗi tải thông báo.</div>`;
    }
  }

  window.logout = () => {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
  };

  loadNavInfo();
  loadNotificationsPage();
});
