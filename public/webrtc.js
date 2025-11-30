/**
 * public/webrtc.js - PHIÊN BẢN FIX LỖI CAMERA/MIC & HTTPS
 */

document.addEventListener("DOMContentLoaded", () => {
  // Chỉ chạy khi socket đã kết nối và đang ở trang chat
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  // --- DOM ELEMENTS ---
  const callButton = document.getElementById("call-button");
  const videoCallButton = document.getElementById("video-call-button");
  const endCallButton = document.getElementById("end-call-button");
  
  const callWindow = document.getElementById("call-window");
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  
  // Elements Modal Cuộc gọi đến
  const incomingModal = document.getElementById("incoming-call-modal");
  const incomingAvatar = document.getElementById("incoming-avatar");
  const incomingName = document.getElementById("incoming-name");
  const btnAccept = document.getElementById("btn-accept-call");
  const btnReject = document.getElementById("btn-reject-call");
  const ringtone = document.getElementById("ringtone");

  const toggleMic = document.getElementById("toggle-mic");
  const toggleCam = document.getElementById("toggle-cam");

  let peerConnection = null;
  let localStream = null;
  let currentCallerId = null; 
  let currentRecipientId = null; 

  // --- HÀM HELPER: NHẠC CHUÔNG ---
  const playRingtone = () => {
      if(ringtone) {
          ringtone.currentTime = 0;
          ringtone.play().catch(e => console.log("Trình duyệt chặn tự phát nhạc:", e));
      }
  };
  const stopRingtone = () => {
      if(ringtone) {
          ringtone.pause();
          ringtone.currentTime = 0;
      }
  };

  // --- HÀM HELPER: XỬ LÝ LỖI CAMERA/MIC (QUAN TRỌNG) ---
  const handleMediaError = (err) => {
      console.error("Media Error:", err);
      let msg = "Không thể truy cập thiết bị. Vui lòng thử lại.";

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = "⚠️ BẠN ĐÃ CHẶN QUYỀN TRUY CẬP!\n\n👉 Hãy nhấn vào biểu tượng 🔒 (Ổ khóa) hoặc ⚙️ trên thanh địa chỉ.\n👉 Bật 'Cho phép' (Allow) cho Camera và Micro.\n👉 Sau đó tải lại trang (F5).";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = "❌ KHÔNG TÌM THẤY THIẾT BỊ\n\nMáy tính của bạn không có Camera hoặc Micro, hoặc chúng đã bị rút ra.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          msg = "⛔ THIẾT BỊ ĐANG BẬN\n\nCamera/Mic đang được sử dụng bởi ứng dụng khác (Zoom, Zalo, Meet...). Hãy tắt chúng đi và thử lại.";
      } else if (err.name === 'OverconstrainedError') {
          msg = "⚠️ Thiết bị không đáp ứng được yêu cầu video (độ phân giải/tốc độ khung hình).";
      } else if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
          msg = "🔒 LỖI BẢO MẬT (HTTPS)\n\nTrình duyệt chặn Camera trên giao thức HTTP thường.\nBạn phải truy cập bằng HTTPS (Ví dụ: Link Render) hoặc Localhost.";
      }

      alert(msg);
      hangUp(); // Ngắt trạng thái gọi
  };

  // --- 1. TẠO KẾT NỐI WEBRTC ---
  const createPeerConnection = (stream) => {
    // Sử dụng máy chủ STUN miễn phí của Google để xuyên qua NAT/Wifi
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Thêm luồng video/audio vào kết nối
    if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // Khi tìm thấy đường kết nối mạng (ICE Candidate) -> Gửi cho đối phương
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        if (targetId) {
            window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate });
        }
      }
    };

    // Khi nhận được video của đối phương -> Hiển thị lên màn hình
    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      }
    };

    // Theo dõi trạng thái kết nối
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
            console.log("Đối phương đã ngắt kết nối.");
            hangUp(false); // Ngắt âm thầm
        }
    };

    return pc;
  };

  // --- 2. NGƯỜI GỌI (CALLER) ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Vui lòng chọn một người bạn để gọi.");
    currentRecipientId = window.currentChatContext.id;

    // Reset giao diện nút
    toggleMic.style.background = "rgba(255,255,255,0.2)";
    toggleCam.style.background = "rgba(255,255,255,0.2)";

    try {
      // Yêu cầu quyền truy cập Camera/Mic
      localStream = await navigator.mediaDevices.getUserMedia({ 
          video: isVideo, 
          audio: true 
      });
      
      // Hiển thị video của mình
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");

      // Khởi tạo kết nối
      peerConnection = createPeerConnection(localStream);
      
      // Tạo lời mời (Offer)
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Gửi tín hiệu gọi lên Server
      window.socket.emit("callOffer", {
        recipientId: currentRecipientId,
        offer: peerConnection.localDescription,
        isVideo,
      });

    } catch (err) {
      handleMediaError(err); // Gọi hàm xử lý lỗi chi tiết
    }
  };

  // --- 3. NGƯỜI NHẬN (RECEIVER) ---
  
  // Khi có cuộc gọi đến
  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    // Nếu đang bận (đang gọi người khác)
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }

    // Hiển thị thông báo cuộc gọi đến
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName || "User")}`;
    incomingModal.classList.remove("hidden");
    playRingtone(); // Phát nhạc chuông

    // XỬ LÝ: CHẤP NHẬN
    btnAccept.onclick = async () => {
        stopRingtone();
        incomingModal.classList.add("hidden");
        
        try {
            // Người nhận cũng phải bật Camera/Mic
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: isVideo, 
                audio: true 
            });
            localVideo.srcObject = localStream;
            callWindow.classList.remove("hidden");

            peerConnection = createPeerConnection(localStream);
            
            // Nhận Offer từ người gọi
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            // Tạo câu trả lời (Answer)
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // Gửi Answer lại cho người gọi
            window.socket.emit("callAnswer", {
                recipientId: senderId,
                answer: peerConnection.localDescription
            });

        } catch (e) {
            handleMediaError(e);
            // Nếu lỗi thiết bị, báo từ chối để bên kia không đợi
            window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" });
            currentCallerId = null;
        }
    };

    // XỬ LÝ: TỪ CHỐI
    btnReject.onclick = () => {
        stopRingtone();
        incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
    };
  });

  // --- 4. CÁC SỰ KIỆN KẾT NỐI KHÁC ---

  // Khi người gọi nhận được Answer từ người nghe
  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  // Trao đổi thông tin mạng (ICE Candidates)
  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Lỗi thêm ICE:", e);
      }
    }
  });

  // Khi đối phương tắt máy
  window.socket.on("callEnd", () => {
    alert("Cuộc gọi đã kết thúc.");
    hangUp(false); // false = không cần gửi lại sự kiện end
  });

  // Khi đối phương từ chối hoặc bận
  window.socket.on("callReject", ({ reason }) => {
    stopRingtone();
    let msg = "Đối phương đã từ chối cuộc gọi.";
    if (reason === "BUSY") msg = "Người dùng đang bận cuộc gọi khác.";
    if (reason === "ERROR") msg = "Người dùng gặp sự cố thiết bị.";
    
    alert(msg);
    hangUp(false);
  });
  
  // Khi đối phương Offline
  window.socket.on("userOffline", () => {
      alert("Người dùng hiện không trực tuyến. Đã gửi thông báo cuộc gọi nhỡ.");
      hangUp(false);
  });

  // --- 5. HÀM TẮT MÁY (DỌN DẸP) ---
  const hangUp = (emitEvent = true) => {
    stopRingtone();
    
    // Tắt Camera/Mic
    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
    }

    // Đóng kết nối
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    localStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    // Ẩn giao diện
    callWindow.classList.add("hidden");
    incomingModal.classList.add("hidden");

    // Gửi tín hiệu tắt máy cho đối phương (nếu cần)
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) {
      window.socket.emit("callEnd", { recipientId: targetId });
    }
    
    currentRecipientId = null;
    currentCallerId = null;
  };

  // --- 6. GÁN SỰ KIỆN CHO CÁC NÚT ---
  callButton.addEventListener("click", () => startCall(false)); // Gọi thoại (chỉ Audio)
  videoCallButton.addEventListener("click", () => startCall(true)); // Gọi Video
  endCallButton.addEventListener("click", () => hangUp(true));

  // Nút Bật/Tắt Mic
  toggleMic.addEventListener("click", () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled;
          toggleMic.style.background = audioTrack.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
          toggleMic.querySelector("i").className = audioTrack.enabled ? "fas fa-microphone" : "fas fa-microphone-slash";
      }
    }
  });

  // Nút Bật/Tắt Camera
  toggleCam.addEventListener("click", () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled;
          toggleCam.style.background = videoTrack.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
          toggleCam.querySelector("i").className = videoTrack.enabled ? "fas fa-video" : "fas fa-video-slash";
      }
    }
  });
  
  // Logic ẩn hiện nút gọi (Không cho gọi AI)
  window.addEventListener("contextChanged", () => {
    const isUser = window.currentChatContext.type === "user";
    const isNotAI = window.currentChatContext.id !== 0;
    
    // Chỉ hiện nút gọi nếu là User thật và không phải AI
    const displayStyle = (isUser && isNotAI) ? "flex" : "none";
    
    callButton.style.display = displayStyle;
    videoCallButton.style.display = displayStyle;
  });
});
