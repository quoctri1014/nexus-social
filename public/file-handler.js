/**
 * public/file-handler.js - PHIÊN BẢN HOÀN CHỈNH (Upload File & Realtime Message)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy ở trang chat
  if (!window.location.pathname.endsWith("chat.html")) return;

  const fileModal = document.getElementById("file-modal");
  const fileInput = document.getElementById("file-input");
  const sendFileButton = document.getElementById("send-file");
  const cancelFileButton = document.getElementById("cancel-file");
  const selectedFilesList = document.getElementById("selected-files-list");

  let filesToSend = [];

  // 1. Hàm mở Modal (Được gọi từ main.js)
  window.openFileModal = () => {
    if (!window.currentChatContext.id)
      return alert("Vui lòng chọn người để gửi file.");
    fileModal.classList.remove("hidden");
    filesToSend = []; // Reset list
    fileInput.value = "";
    renderSelectedFiles();
  };

  // 2. Render danh sách file đã chọn trong Modal
  const renderSelectedFiles = () => {
    selectedFilesList.innerHTML = "";
    if (filesToSend.length === 0) {
      selectedFilesList.innerHTML =
        '<p style="color:#888; text-align:center;">Chưa chọn file nào.</p>';
      sendFileButton.disabled = true;
      sendFileButton.textContent = "Gửi ngay";
      return;
    }

    filesToSend.forEach((file) => {
      const div = document.createElement("div");
      div.className = "file-list-item";
      // Chỉnh style để dễ nhìn trong modal box
      div.style.padding = "8px";
      div.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
      div.style.textAlign = "left";
      div.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(
        2
      )} MB)`;
      selectedFilesList.appendChild(div);
    });
    sendFileButton.disabled = false;
    sendFileButton.textContent = `Gửi (${filesToSend.length} file)`;
  };

  // 3. Sự kiện chọn file từ máy
  fileInput?.addEventListener("change", (e) => {
    filesToSend = Array.from(e.target.files);
    renderSelectedFiles();
  });

  // 4. Sự kiện đóng Modal
  cancelFileButton?.addEventListener("click", () => {
    fileModal.classList.add("hidden");
  });

  // 5. Gửi File (Upload -> Get Link -> Socket)
  sendFileButton?.addEventListener("click", async () => {
    if (filesToSend.length === 0 || !window.currentChatContext.id) return;

    sendFileButton.textContent = "Đang tải lên...";
    sendFileButton.disabled = true;

    const formData = new FormData();
    filesToSend.forEach((f) => formData.append("files", f));

    try {
      const token = localStorage.getItem("token");
      // Upload lên Server
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload thất bại");

      const uploadedFiles = await res.json(); // Server trả về mảng [{type, name, url, size}]

      // Gửi từng file qua Socket
      uploadedFiles.forEach((fileData) => {
        const msgContent = JSON.stringify(fileData); // Đóng gói thành JSON

        // Gửi Socket
        if (window.currentChatContext.type === "user") {
          window.socket.emit("privateMessage", {
            recipientId: window.currentChatContext.id,
            content: msgContent,
          });
        }

        // Hiển thị ngay lên màn hình của mình (dùng hàm từ main.js)
        if (window.appendMessage) {
          window.appendMessage({
            senderId: window.myUserId,
            content: msgContent,
            createdAt: new Date(),
          });
        }
      });

      // Thành công -> Đóng Modal
      fileModal.classList.add("hidden");
      alert(`Đã gửi thành công ${uploadedFiles.length} file!`);
    } catch (error) {
      alert("Lỗi Gửi File: " + error.message);
    } finally {
      sendFileButton.textContent = "Gửi ngay";
      sendFileButton.disabled = false;
    }
  });
});
