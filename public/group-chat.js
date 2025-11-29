// Tên file: public/group-chat.js (ĐÃ HOÀN CHỈNH VÀ FIX LỖI SOCKET UNDEFINED)

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy nếu đang ở trang chat
  if (window.location.pathname.endsWith("/chat.html")) {
    // --- DOM Elements cho Nhóm ---
    const groupListDiv = document.getElementById("group-list");
    const createGroupBtn = document.getElementById("create-group-btn");
    const modal = document.getElementById("create-group-modal");
    const modalUserList = document.getElementById("modal-user-list");
    const cancelCreateGroupBtn = document.getElementById("cancel-create-group");
    const confirmCreateGroupBtn = document.getElementById(
      "confirm-create-group"
    );
    const groupNameInput = document.getElementById("group-name-input");

    // Lấy token (cần thiết cho API)
    const token = localStorage.getItem("token");

    // --- HÀM RENDER DANH SÁCH NHÓM ---
    window.renderGroupListFromCache = function () {
      groupListDiv.innerHTML = "";

      if (!window.allGroupsCache || window.allGroupsCache.length === 0) {
        groupListDiv.innerHTML =
          '<p class="empty-list-msg">Bạn chưa tham gia nhóm nào.</p>';
        return;
      }

      window.allGroupsCache.forEach((group) => {
        const groupItem = document.createElement("div");
        groupItem.className = "group-item";

        const avatar = document.createElement("div");
        avatar.className = "user-avatar";
        avatar.textContent = group.name.charAt(0).toUpperCase();

        const groupInfo = document.createElement("div");
        groupInfo.className = "user-info";

        const groupName = document.createElement("div");
        groupName.className = "user-name";
        groupName.textContent = group.name;

        const groupPreview = document.createElement("div");
        groupPreview.className = "user-preview";
        groupPreview.textContent = "Chat nhóm";

        groupInfo.appendChild(groupName);
        groupInfo.appendChild(groupPreview);
        groupItem.appendChild(avatar);
        groupItem.appendChild(groupInfo);
        groupItem.dataset.groupId = group.id;

        // Kiểm tra trạng thái active (dùng window.currentChatContext)
        if (
          window.currentChatContext &&
          window.currentChatContext.type === "group" &&
          window.currentChatContext.id === group.id
        ) {
          groupItem.classList.add("active");
        }

        groupItem.onclick = () => {
          const newContext = { type: "group", id: group.id, name: group.name };
          // Gọi hàm global từ main.js
          if (window.activateChat) {
            window.activateChat(newContext);
          }
        };
        groupListDiv.appendChild(groupItem);
      });
    };

    // Hàm highlight item (để main.js gọi)
    window.highlightGroupItem = function (groupId) {
      const activeGroupItem = groupListDiv.querySelector(
        `[data-group-id="${groupId}"]`
      );
      if (activeGroupItem) activeGroupItem.classList.add("active");
    };

    // --- FIX LỖI SOCKET: TẠO HÀM KHỞI TẠO SOCKET LISTENERS AN TOÀN ---
    function initGroupSocketListeners() {
      // Kiểm tra window.socket đã tồn tại chưa
      if (!window.socket || !window.allUsersCache) {
        // Nếu chưa, đợi 50ms và gọi lại
        setTimeout(initGroupSocketListeners, 50);
        return;
      }

      // 1. Nhận thông tin về 1 nhóm mới (khi mình được thêm vào)
      window.socket.on("newGroupAdded", (newGroup) => {
        window.allGroupsCache.push(newGroup);
        window.renderGroupListFromCache();
        alert(`Bạn vừa được thêm vào nhóm mới: ${newGroup.name}`);
      });
    }
    // --- KẾT THÚC KHỐI SỬA LỖI SOCKET ---

    // --- LOGIC MODAL TẠO NHÓM (Giữ nguyên) ---

    // 1. Mở Modal: Hiển thị danh sách user từ cache
    createGroupBtn.addEventListener("click", () => {
      modalUserList.innerHTML = "";
      // Lấy danh sách user từ cache global (do main.js tạo)
      const users = Object.values(window.allUsersCache).filter(
        (user) => user.userId !== 0 // Lọc AI
      );

      // ... (Logic render modal user list) ...
      users.forEach((user) => {
        if (user.userId === window.myUserId) return; // Không tự thêm mình

        const item = document.createElement("label");
        item.className = "modal-user-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = user.userId;

        const avatar = document.createElement("div");
        avatar.className = "user-avatar small";
        avatar.textContent = user.username.charAt(0).toUpperCase();

        const username = document.createElement("span");
        username.textContent = user.username;

        item.appendChild(checkbox);
        item.appendChild(avatar);
        item.appendChild(username);
        modalUserList.appendChild(item);
      });
      modal.classList.remove("hidden");
      groupNameInput.focus();
    });

    // 2. Đóng Modal
    cancelCreateGroupBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      groupNameInput.value = "";
    });

    // 3. Xác nhận Tạo Nhóm (Gửi API)
    confirmCreateGroupBtn.addEventListener("click", async () => {
      const groupName = groupNameInput.value.trim();
      const selectedUsers = [];

      // Lấy ID các user được chọn
      modalUserList
        .querySelectorAll('input[type="checkbox"]:checked')
        .forEach((input) => {
          selectedUsers.push(parseInt(input.value));
        });

      if (!groupName || selectedUsers.length === 0) {
        alert("Vui lòng nhập tên nhóm và chọn ít nhất 1 thành viên.");
        return;
      }

      try {
        const res = await fetch("/api/groups/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: groupName, members: selectedUsers }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message);
        }

        modal.classList.add("hidden");
        groupNameInput.value = "";

        // Sau khi tạo thành công, server sẽ gửi socket "newGroupAdded" đến người tạo và thành viên.
      } catch (error) {
        alert(`Lỗi khi tạo nhóm: ${error.message}`);
      }
    });

    // GỌI HÀM KHỞI TẠO SOCKET SAU CÙNG
    initGroupSocketListeners();
  }
});
