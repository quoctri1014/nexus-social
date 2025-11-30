/**
 * public/file-handler.js - PHIÊN BẢN FINAL (Giao diện đẹp + Fix lỗi lặp tin nhắn)
 */

document.addEventListener("DOMContentLoaded", () => {
  if (!window.location.pathname.endsWith("chat.html")) return;

  const fileModal = document.getElementById("file-modal");
  const fileInput = document.getElementById("file-input");
  const sendFileButton = document.getElementById("send-file");
  const cancelFileButton = document.getElementById("cancel-file");
  const selectedFilesList = document.getElementById("selected-files-list");

  let filesToSend = [];

  // 1. Mở Modal
  window.openFileModal = () => {
    if (!window.currentChatContext.id) return alert("Vui lòng chọn người để gửi file.");
    fileModal.classList.remove("hidden");
    filesToSend = [];
    fileInput.value = "";
    renderSelectedFiles();
  };

  // 2. Render danh sách file (Giao diện thẻ đẹp)
  const renderSelectedFiles = () => {
    selectedFilesList.innerHTML = "";
    if (filesToSend.length === 0) {
      selectedFilesList.innerHTML = '<p style="color:#94a3b8; text-align:center; font-size:14px; margin-top:10px;">Chưa chọn file nào.</p>';
      sendFileButton.disabled = true;
      sendFileButton.textContent = "Gửi ngay";
      sendFileButton.style.opacity = "0.5";
      return;
    }
    
    sendFileButton.disabled = false;
    sendFileButton.style.opacity = "1";
    sendFileButton.textContent = `Gửi ${filesToSend.length} tệp`;

    filesToSend.forEach((file) => {
      const div = document.createElement("div");
      div.className = "file-list-item";
      
      // Tự động chọn icon theo loại file
      let iconClass = "fas fa-file";
      if (file.type.startsWith("image/")) iconClass = "fas fa-image";
      else if (file.type.startsWith("video/")) iconClass = "fas fa-video";
      else if (file.type.startsWith("audio/")) iconClass = "fas fa-music";

      div.innerHTML = `
        <div class="file-info-icon"><i class="${iconClass}"></i></div>
        <div class="file-info-name">${file.name}</div>
        <div style="font-size:12px; color:#94a3b8;">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
      `;
      selectedFilesList.appendChild(div);
    });
  };

  // 3. Sự kiện chọn file
  fileInput?.addEventListener("change", (e) => {
    filesToSend = Array.from(e.target.files);
    renderSelectedFiles();
  });

  cancelFileButton?.addEventListener("click", () => {
    fileModal.classList.add("hidden");
  });

  // 4. Gửi File (Logic Upload + Socket)
  sendFileButton?.addEventListener("click", async () => {
    if (filesToSend.length === 0 || !window.currentChatContext.id) return;

    sendFileButton.textContent = "Đang tải lên...";
    sendFileButton.disabled = true;
    sendFileButton.style.opacity = "0.7";

    const formData = new FormData();
    filesToSend.forEach((f) => formData.append("files", f));

    try {
      const token = localStorage.getItem("token");
      
      // Upload
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      // Kiểm tra lỗi Server trả về HTML thay vì JSON (Lỗi 500/502)
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Lỗi Server: Cấu hình Cloudinary sai hoặc file quá lớn.");
      }
      
      const uploadedFiles = await res.json(); 
      if (!res.ok) throw new Error(uploadedFiles.message || "Upload thất bại");

      // Gửi Socket (Không tự appendMessage để tránh lặp)
      uploadedFiles.forEach((fileData) => {
        const msgContent = JSON.stringify(fileData);
        if (window.currentChatContext.type === "user") {
          window.socket.emit("privateMessage", {
            recipientId: window.currentChatContext.id,
            content: msgContent,
          });
        }
      });

      // Xong
      fileModal.classList.add("hidden");
    } catch (error) {
      console.error(error);
      alert("Lỗi: " + error.message);
    } finally {
      sendFileButton.textContent = "Gửi ngay";
      sendFileButton.disabled = false;
    }
  });
});
