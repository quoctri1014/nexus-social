document.addEventListener("DOMContentLoaded", async () => {
  // --- CHẶN ĐĂNG NHẬP ---
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html"; // Đá về trang login ngay
    return; // Dừng code lại
  }

  let currentUser = {};

  // --- HELPER ---
  function getAvatarDisplay(user) {
    if (user && user.avatar && user.avatar.includes("/")) return user.avatar;
    const name =
      user && (user.nickname || user.username)
        ? user.nickname || user.username
        : "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name
    )}&background=0D8ABC&color=fff&size=128`;
  }

  function updateSidebarRow(textId, rowId, value) {
    const row = document.getElementById(rowId);
    const text = document.getElementById(textId);
    if (row && text)
      value && value.trim() !== ""
        ? ((text.textContent = value), row.classList.remove("hidden"))
        : row.classList.add("hidden");
  }

  // --- 1. LOAD PROFILE (HIỂN THỊ) ---
  async function loadMyProfile() {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      currentUser = await res.json();
      const avatar = getAvatarDisplay(currentUser);
      const name = currentUser.nickname || currentUser.username;

      document.getElementById("nav-avatar").src = avatar;
      document.getElementById("nav-username").textContent = name;
      document.getElementById("sidebar-avatar").src = avatar;
      document.getElementById("sidebar-name").textContent = name;
      document.getElementById("sidebar-bio").textContent =
        currentUser.bio || "Chưa có tiểu sử";

      if (document.getElementById("story-my-avatar"))
        document.getElementById("story-my-avatar").src = avatar;
      if (document.getElementById("cp-avatar"))
        document.getElementById("cp-avatar").src = avatar;
      if (document.getElementById("edit-avatar-preview"))
        document.getElementById("edit-avatar-preview").src = avatar;

      updateSidebarRow(
        "sidebar-location",
        "sidebar-location-row",
        currentUser.location
      );
      updateSidebarRow("sidebar-work", "sidebar-work-row", currentUser.work);
      updateSidebarRow("sidebar-edu", "sidebar-edu-row", currentUser.education);

      ["nickname", "bio", "location", "work", "edu"].forEach((f) => {
        const input = document.getElementById(`edit-${f}`);
        if (input)
          input.value = currentUser[f === "edu" ? "education" : f] || "";
      });
    } catch (e) {}
  }

  // --- 2. LOAD FRIENDS (SIDEBAR PHẢI) ---
  async function loadFriends() {
    const list = document.getElementById("contact-list");
    if (!list) return;
    list.innerHTML = "";
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="contact-item" onclick="window.location.href='/chat.html'"><div class="contact-img"><img src="https://ui-avatars.com/api/?name=AI&background=000&color=fff"><div class="online-dot"></div></div><span>Trợ lý AI</span></div>`
    );

    try {
      const res = await fetch("/api/friends", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const friends = await res.json();
      friends.forEach((u) => {
        const item = document.createElement("div");
        item.className = "contact-item";
        item.innerHTML = `<div class="contact-img"><img src="${getAvatarDisplay(
          u
        )}"><div class="online-dot"></div></div><span>${
          u.nickname || u.username
        }</span>`;
        item.onclick = () => openUserProfile(u.id);
        list.appendChild(item);
      });
    } catch (e) {}
  }

  // --- 3. LOAD POSTS & STORIES ---
  const reactionIcons = {
    like: "👍",
    love: "❤️",
    haha: "😆",
    wow: "😮",
    sad: "😢",
    angry: "😡",
  };
  const reactionTexts = {
    like: "Thích",
    love: "Yêu thích",
    haha: "Haha",
    wow: "Wow",
    sad: "Buồn",
    angry: "Phẫn nộ",
  };

  function createPostHTML(post, user) {
    const mediaHtml = post.image
      ? `<img src="${post.image}" class="post-image">`
      : "";
    const avatar = getAvatarDisplay(user);
    const timeAgo = new Date(post.createdAt).toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });

    let reactClass = "",
      reactText = "Thích",
      reactIcon = '<i class="far fa-thumbs-up"></i>';
    if (post.myReaction) {
      reactClass = `reacted ${post.myReaction}`;
      reactText = reactionTexts[post.myReaction];
      reactIcon =
        post.myReaction === "like"
          ? '<i class="fas fa-thumbs-up"></i>'
          : reactionIcons[post.myReaction];
    }

    let statsHtml =
      post.totalReactions > 0
        ? `<span>${post.myReaction ? "Bạn và " : ""}${
            post.totalReactions - (post.myReaction ? 1 : 0)
          } người khác</span>`
        : `<span>Hãy là người đầu tiên bày tỏ cảm xúc</span>`;
    let summaryIcon = post.myReaction
      ? post.myReaction === "like"
        ? '<i class="fas fa-thumbs-up" style="color:#1877f2"></i>'
        : reactionIcons[post.myReaction]
      : '<i class="fas fa-thumbs-up" style="color:#65676b"></i>';

    return `
            <div class="post-card" id="post-${post.id}">
                <div class="post-header">
                    <img src="${avatar}">
                    <div class="post-info"><h3>${
                      post.nickname || post.username
                    }</h3><span>${timeAgo} · <i class="fas fa-globe-americas"></i></span></div>
                </div>
                <div class="post-content">${post.content || ""}</div>
                ${mediaHtml}
                <div class="post-stats" id="stats-${post.id}">
                    <div class="reaction-count">
                        <span id="reaction-summary-icon-${
                          post.id
                        }">${summaryIcon}</span> 
                        <span id="reaction-count-text-${post.id}" data-count="${
      post.totalReactions || 0
    }">${statsHtml}</span>
                    </div>
                    <div class="comment-count" onclick="toggleComments(${
                      post.id
                    })" style="cursor:pointer;hover:underline"><span id="comment-count-text-${
      post.id
    }">${post.totalComments || 0}</span> bình luận</div>
                </div>
                <div class="post-actions">
                    <div class="action-btn-wrapper">
                        <div class="reaction-dock">
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'like')">👍</div>
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'love')">❤️</div>
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'haha')">😆</div>
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'wow')">😮</div>
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'sad')">😢</div>
                            <div class="reaction-icon" onclick="reactPost(${
                              post.id
                            }, 'angry')">😡</div>
                        </div>
                        <div class="action-btn ${reactClass}" id="btn-react-${
      post.id
    }" data-reaction="${post.myReaction || ""}" onclick="reactPost(${
      post.id
    }, 'like')">
                            ${reactIcon} ${reactText}
                        </div>
                    </div>
                    <div class="action-btn" onclick="toggleComments(${
                      post.id
                    })"><i class="far fa-comment-alt"></i> Bình luận</div>
                    <div class="action-btn" onclick="sharePost(${
                      post.id
                    })"><i class="fas fa-share"></i> Chia sẻ</div>
                </div>
                <div class="comments-section hidden" id="comments-area-${
                  post.id
                }">
                    <div class="comment-list" id="comment-list-${
                      post.id
                    }"><p style="text-align:center;font-size:12px;color:#888">Đang tải...</p></div>
                    <div class="comment-input-area">
                        <img src="${document.getElementById("nav-avatar").src}">
                        <div class="comment-input-wrapper">
                            <input type="text" id="input-comment-${
                              post.id
                            }" placeholder="Viết bình luận..." onkeydown="if(event.key==='Enter') sendComment(${
      post.id
    })">
                            <button class="send-comment-btn" onclick="sendComment(${
                              post.id
                            })"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
  }

  // Global Functions
  window.reactPost = async (postId, type) => {
    const btn = document.getElementById(`btn-react-${postId}`);
    const countSpan = document.getElementById(`reaction-count-text-${postId}`);
    const iconSpan = document.getElementById(`reaction-summary-icon-${postId}`);
    let currentCount = parseInt(countSpan.getAttribute("data-count")) || 0;
    const currentReaction = btn.getAttribute("data-reaction");

    btn.className = "action-btn";
    btn.innerHTML = '<i class="far fa-thumbs-up"></i> Thích';
    btn.removeAttribute("data-reaction");

    let action = "remove";
    if (currentReaction !== type) {
      btn.classList.add("reacted", type);
      btn.setAttribute("data-reaction", type);
      btn.innerHTML = `${
        type === "like"
          ? '<i class="fas fa-thumbs-up"></i>'
          : reactionIcons[type]
      } ${reactionTexts[type]}`;
      action = !currentReaction || currentReaction === "" ? "add" : "change";
      iconSpan.innerHTML =
        type === "like"
          ? '<i class="fas fa-thumbs-up" style="color:#1877f2"></i>'
          : reactionIcons[type];
    } else {
      iconSpan.innerHTML =
        currentCount > 1
          ? '<i class="fas fa-thumbs-up" style="color:#1877f2"></i>'
          : '<i class="fas fa-thumbs-up" style="color:#65676b"></i>';
    }

    if (action === "add") currentCount++;
    else if (action === "remove") currentCount--;
    countSpan.setAttribute("data-count", currentCount);
    if (currentCount <= 0)
      countSpan.textContent = "Hãy là người đầu tiên bày tỏ cảm xúc";
    else
      countSpan.textContent =
        action !== "remove"
          ? currentCount - 1 > 0
            ? `Bạn và ${currentCount - 1} người khác`
            : "Bạn"
          : `${currentCount} người`;

    await fetch(`/api/posts/${postId}/react`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type }),
    });
  };

  window.toggleComments = async (postId) => {
    const area = document.getElementById(`comments-area-${postId}`);
    if (area.classList.contains("hidden")) {
      area.classList.remove("hidden");
      await loadComments(postId);
    } else {
      area.classList.add("hidden");
    }
  };
  async function loadComments(postId) {
    const list = document.getElementById(`comment-list-${postId}`);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const comments = await res.json();
      list.innerHTML = "";
      if (comments.length === 0) {
        list.innerHTML =
          "<p style='text-align:center;font-size:12px;color:#888;padding:10px'>Chưa có bình luận nào.</p>";
        return;
      }
      comments.forEach((c) => {
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="comment-item"><img src="${getAvatarDisplay(
            c
          )}"><div class="comment-bubble"><span class="comment-user">${
            c.nickname || c.username
          }</span><span class="comment-text">${
            c.content
          }</span></div><span class="comment-time">${new Date(
            c.createdAt
          ).toLocaleString("vi-VN")}</span></div>`
        );
      });
    } catch (e) {}
  }
  window.sendComment = async (postId) => {
    const input = document.getElementById(`input-comment-${postId}`);
    const content = input.value.trim();
    if (!content) return;
    input.disabled = true;
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        input.value = "";
        input.disabled = false;
        input.focus();
        await loadComments(postId);
        const countSpan = document.getElementById(
          `comment-count-text-${postId}`
        );
        if (countSpan)
          countSpan.innerText = parseInt(countSpan.innerText || 0) + 1;
      }
    } catch (e) {
      input.disabled = false;
    }
  };
  window.sharePost = (postId) => {
    const url = window.location.origin + "/home.html?post=" + postId;
    navigator.clipboard
      .writeText(url)
      .then(() => alert("Đã sao chép link!"))
      .catch(() => {});
  };

  async function loadPosts() {
    try {
      const res = await fetch("/api/posts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const posts = await res.json();
      const feed = document.getElementById("feed-container");
      feed.innerHTML = "";
      posts.forEach((p) =>
        feed.insertAdjacentHTML("beforeend", createPostHTML(p, p))
      );
    } catch (e) {}
  }
  async function loadStories() {
    try {
      const res = await fetch("/api/stories", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const stories = await res.json();
      const list = document.getElementById("stories-list");
      list.innerHTML = "";
      stories.forEach((s) =>
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="story-card story-item" style="background-image: url('${
            s.image
          }');"><div class="story-overlay"></div><img src="${getAvatarDisplay(
            s
          )}" class="story-avatar-small"><div class="story-username">${
            s.nickname || s.username
          }</div></div>`
        )
      );
    } catch (e) {}
  }

  // --- BADGE NOTIFICATION ---
  async function updateNotifBadge() {
    const badge = document.getElementById("nav-notif-badge");
    if (!badge) return;
    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const notifs = await res.json();
      if (notifs.length > 0) {
        badge.textContent = notifs.length;
        badge.classList.remove("hidden");
      }
    } catch (e) {}
  }

  // --- ACTIONS: CREATE POST/STORY, EDIT PROFILE ---
  const postBtn = document.getElementById("post-btn");
  const postImgInput = document.getElementById("post-image-input");
  let postImageFile = null;
  if (postImgInput)
    postImgInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        postImageFile = e.target.files[0];
        document.getElementById("post-preview-img").src =
          URL.createObjectURL(postImageFile);
        document.getElementById("post-preview-area").classList.remove("hidden");
      }
    });
  document.getElementById("remove-preview").addEventListener("click", () => {
    postImageFile = null;
    document.getElementById("post-preview-area").classList.add("hidden");
  });
  if (postBtn)
    postBtn.addEventListener("click", async () => {
      const content = document.getElementById("post-content").value;
      if (!content && !postImageFile) return;
      postBtn.disabled = true;
      let imgUrl = null;
      if (postImageFile) {
        const fd = new FormData();
        fd.append("files", postImageFile);
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        imgUrl = (await res.json())[0].url;
      }
      await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content, image: imgUrl }),
      });
      window.location.reload();
    });

  const storyInput = document.getElementById("story-input");
  if (storyInput)
    storyInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("Đăng Story?")) return;
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const files = await res.json();
      await fetch("/api/stories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image: files[0].url }),
      });
      loadStories();
    });

  // Edit Profile Logic
  const profileModal = document.getElementById("profile-modal");
  const closeX = document.getElementById("close-modal-x");
  const cancelBtn = document.getElementById("cancel-profile-btn");
  const saveBtn = document.getElementById("save-profile-btn");
  const editAvatarInput = document.getElementById("edit-avatar-input");
  let newAvatarFile = null;

  // Sự kiện mở modal đã gán ở trên (loadMyProfile)
  function closeProfileModal() {
    profileModal.classList.add("hidden");
    newAvatarFile = null;
    loadMyProfile();
  }
  if (closeX) closeX.addEventListener("click", closeProfileModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeProfileModal);
  window.addEventListener("click", (e) => {
    if (e.target === profileModal) closeProfileModal();
  });
  if (editAvatarInput)
    editAvatarInput.addEventListener("change", (e) => {
      if (e.target.files[0]) {
        newAvatarFile = e.target.files[0];
        document.getElementById("edit-avatar-preview").src =
          URL.createObjectURL(newAvatarFile);
      }
    });

  if (saveBtn)
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updateData),
        });
        if (res.ok) {
          alert("Thành công!");
          window.location.reload();
        }
      } catch (e) {
        alert("Lỗi");
        saveBtn.disabled = false;
      }
    });

  // View Other User Profile Logic
  async function openUserProfile(userId) {
    const modal = document.getElementById("view-user-modal");
    try {
      const res = await fetch(`/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { user, posts } = await res.json();
      document.getElementById("view-avatar").src = getAvatarDisplay(user);
      document.getElementById("view-name").textContent =
        user.nickname || user.username;
      document.getElementById("view-bio").textContent = user.bio || "";
      updateSidebarRow("view-location", "view-location-row", user.location);
      updateSidebarRow("view-work", "view-work-row", user.work);
      updateSidebarRow("view-edu", "view-edu-row", user.education);
      const pContainer = document.getElementById("view-user-posts");
      pContainer.innerHTML = posts.length
        ? ""
        : "<p style='text-align:center;color:#888'>Chưa có bài viết.</p>";
      posts.forEach((post) =>
        pContainer.insertAdjacentHTML("beforeend", createPostHTML(post, user))
      );
      modal.classList.remove("hidden");
    } catch (e) {}
  }
  document
    .getElementById("close-view-user")
    .addEventListener("click", () =>
      document.getElementById("view-user-modal").classList.add("hidden")
    );

  // INIT
  await loadMyProfile();
  loadFriends();
  loadPosts();
  loadStories();
  updateNotifBadge();
  window.logout = () => {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
  };
});
