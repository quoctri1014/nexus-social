/**
 * public/webrtc.js - PHIÊN BẢN HOÀN CHỈNH (Realtime WebRTC)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Đảm bảo chỉ chạy trên trang chat và socket đã kết nối
  if (!window.socket || !window.location.pathname.endsWith("/chat.html"))
    return;

  const callButton = document.getElementById("call-button");
  const videoCallButton = document.getElementById("video-call-button");
  const endCallButton = document.getElementById("end-call-button");
  const callWindow = document.getElementById("call-window");
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  const toggleMic = document.getElementById("toggle-mic");
  const toggleCam = document.getElementById("toggle-cam");

  let peerConnection = null;
  let localStream = null;
  let currentRecipientId = null;

  // --- HÀM TẠO PEER CONNECTION ---
  const createPeerConnection = (stream, recipientId) => {
    // Sử dụng STUN server để NAT Traversal
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Gửi stream cục bộ đến peer
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // Xử lý ICE Candidate (gửi thông tin kết nối qua socket)
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("Sending ICE Candidate:", e.candidate);
        window.socket.emit("sendICE", { recipientId, candidate: e.candidate });
      }
    };

    // Xử lý khi nhận được stream từ peer
    pc.ontrack = (e) => {
      console.log("Received remote track.");
      if (remoteVideo.srcObject !== e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      }
    };

    // Xử lý sự kiện thay đổi trạng thái kết nối
    pc.onconnectionstatechange = (e) => {
      console.log(`Connection state: ${pc.connectionState}`);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        hangUp(false); // Tự động ngắt khi lỗi
        alert("Kết nối cuộc gọi thất bại hoặc bị ngắt.");
      }
    };

    return pc;
  };

  // --- HÀM KHỞI TẠO CUỘC GỌI (CALLER) ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;

    // Reset nút điều khiển
    toggleMic.style.background = "#333";
    toggleCam.style.background = "#333";

    try {
      // Lấy media cục bộ
      localStream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");

      peerConnection = createPeerConnection(localStream, currentRecipientId);

      // Tạo Offer
      const offer = await peerConnection.createOffer({
        offerToReceiveVideo: isVideo,
        offerToReceiveAudio: true,
      });
      await peerConnection.setLocalDescription(offer);

      // Gửi Offer qua socket
      window.socket.emit("callOffer", {
        recipientId: currentRecipientId,
        offer: peerConnection.localDescription,
        isVideo,
      });
      console.log("Sent Call Offer.");
    } catch (err) {
      console.error("Lỗi truy cập Camera/Mic:", err);
      alert("Lỗi truy cập Camera/Mic. Vui lòng kiểm tra quyền truy cập.");
      hangUp(false);
    }
  };

  // --- HÀM KẾT THÚC CUỘC GỌI ---
  const hangUp = (emit = true) => {
    console.log("Hanging up call. Emit:", emit);
    // Dừng tracks media
    if (localStream) localStream.getTracks().forEach((t) => t.stop());

    // Đóng Peer Connection
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    localStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callWindow.classList.add("hidden");

    // Gửi tín hiệu kết thúc qua socket
    if (emit && currentRecipientId) {
      window.socket.emit("callEnd", { recipientId: currentRecipientId });
    }
    currentRecipientId = null;
  };

  // --- LISTENERS NÚT ĐIỀU KHIỂN ---
  callButton.addEventListener("click", () => startCall(false)); // Gọi thoại
  videoCallButton.addEventListener("click", () => startCall(true)); // Video Call
  endCallButton.addEventListener("click", () => hangUp(true)); // Kết thúc

  toggleMic.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        // Cập nhật giao diện
        toggleMic.style.background = track.enabled ? "#333" : "#ff4757";
        toggleMic.title = track.enabled ? "Tắt Mic" : "Bật Mic";
      }
    }
  });

  toggleCam.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        // Cập nhật giao diện
        toggleCam.style.background = track.enabled ? "#333" : "#ff4757";
        toggleCam.title = track.enabled ? "Tắt Cam" : "Bật Cam";
      }
    }
  });

  // --- SOCKET EVENTS (RECEIVER) ---

  // Xử lý khi nhận được Offer (Cuộc gọi đến)
  window.socket.on("callOffer", async ({ senderId, offer, isVideo }) => {
    if (currentRecipientId) {
      // Đã có cuộc gọi khác đang diễn ra
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }

    // Hỏi người dùng có chấp nhận cuộc gọi không
    const chatTitle =
      document.getElementById("chat-header-title")?.textContent || "Bạn bè";
    if (
      !confirm(
        `Có cuộc gọi ${isVideo ? "Video" : "Thoại"} từ ${chatTitle}. Trả lời?`
      )
    ) {
      window.socket.emit("callReject", {
        callerId: senderId,
        reason: "REJECT",
      });
      return;
    }

    currentRecipientId = senderId;

    // Reset nút điều khiển
    toggleMic.style.background = "#333";
    toggleCam.style.background = "#333";

    try {
      // Lấy media cục bộ
      localStream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");

      // Tạo Peer Connection, thêm stream cục bộ
      peerConnection = createPeerConnection(localStream, senderId);

      // Đặt Remote Description (Offer)
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      // Tạo Answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Gửi Answer qua socket
      window.socket.emit("callAnswer", {
        recipientId: senderId,
        answer: peerConnection.localDescription,
      });
      console.log("Sent Call Answer.");
    } catch (e) {
      console.error("Lỗi khi trả lời cuộc gọi:", e);
      alert("Lỗi khi trả lời cuộc gọi. Vui lòng thử lại.");
      hangUp(false);
    }
  });

  // Xử lý khi nhận được Answer
  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection) {
      console.log("Received Call Answer.");
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    }
  });

  // Xử lý khi nhận được ICE Candidate
  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection && candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added ICE Candidate.");
      } catch (e) {
        console.error("Error adding received ICE candidate:", e);
      }
    }
  });

  // Xử lý khi đối phương kết thúc cuộc gọi
  window.socket.on("callEnd", () => {
    alert("Cuộc gọi đã kết thúc.");
    hangUp(false);
  });

  // Xử lý khi cuộc gọi bị từ chối
  window.socket.on("callReject", ({ reason }) => {
    const msg =
      reason === "BUSY"
        ? "Người dùng đang bận cuộc gọi khác."
        : "Người dùng từ chối cuộc gọi.";
    alert(`Cuộc gọi bị từ chối: ${msg}`);
    hangUp(false); // Ngắt kết nối cục bộ
  });

  // Context check: Ẩn nút gọi khi chat với AI
  window.addEventListener("contextChanged", () => {
    const canCall =
      window.currentChatContext.type === "user" &&
      window.currentChatContext.id !== 0; // AI User ID là 0
    callButton.style.display = canCall ? "inline-block" : "none";
    videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
