document.addEventListener("DOMContentLoaded", () => {
  // Kiểm tra điều kiện tiên quyết
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  // Ẩn các modal khi mới vào trang để tránh lỗi giao diện
  const incomingModal = document.getElementById("incoming-call-modal");
  const callWindow = document.getElementById("call-window");
  if (incomingModal) incomingModal.classList.add("hidden");
  if (callWindow) callWindow.classList.add("hidden");

  // DOM Elements
  const callButton = document.getElementById("call-button");
  const videoCallButton = document.getElementById("video-call-button");
  const endCallButton = document.getElementById("end-call-button");
  
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  
  const incomingAvatar = document.getElementById("incoming-avatar");
  const incomingName = document.getElementById("incoming-name");
  const btnAccept = document.getElementById("btn-accept-call");
  const btnReject = document.getElementById("btn-reject-call");
  const ringtone = document.getElementById("ringtone");

  const toggleMic = document.getElementById("toggle-mic");
  const toggleCam = document.getElementById("toggle-cam");

  // Biến toàn cục
  let peerConnection = null;
  let localStream = null;
  let currentCallerId = null;
  let currentRecipientId = null;
  let callTimeout = null;

  // Cấu hình máy chủ STUN (Thêm nhiều server để kết nối khỏe hơn)
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      { urls: "stun:stun.framasoft.org:3478" }
    ]
  };

  // --- HÀM HỖ TRỢ ---

  // Xử lý âm thanh nhạc chuông an toàn (tránh lỗi trình duyệt chặn autoplay)
  const playRingtone = () => { 
    if(ringtone) { 
        ringtone.currentTime = 0; 
        ringtone.play().catch(e => console.log("Không thể phát nhạc chuông (do chưa tương tác):", e)); 
    } 
  };
  const stopRingtone = () => { 
    if(ringtone) { 
        ringtone.pause(); 
        ringtone.currentTime = 0; 
    } 
  };

  // Báo lỗi chi tiết để người dùng biết cách sửa
  const handleMediaError = (err) => {
      console.error("Chi tiết lỗi Media:", err);
      let msg = `Lỗi không xác định: ${err.name}`;

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = "⚠️ BẠN ĐÃ CHẶN QUYỀN TRUY CẬP!\n\n👉 Hãy bấm vào biểu tượng ổ khóa 🔒 trên thanh địa chỉ trình duyệt > Chọn 'Cho phép' (Allow) cho Camera và Micro.";
      } 
      else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = "❌ KHÔNG TÌM THẤY THIẾT BỊ.\n👉 Vui lòng kiểm tra lại dây cắm Camera/Micro.";
      } 
      else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          msg = "⛔ THIẾT BỊ ĐANG BẬN.\n👉 Có thể Zoom, Meet hoặc Zalo đang dùng Camera. Hãy tắt chúng đi.";
      }
      else if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
           msg = "🔒 LỖI BẢO MẬT.\n👉 Trình duyệt bắt buộc phải dùng HTTPS để gọi video. Hãy kiểm tra lại link deploy.";
      }

      alert(msg);
      hangUp(); // Tắt cuộc gọi để reset trạng thái
  };

  // Tạo kết nối P2P
  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Thêm luồng video/audio của mình vào kết nối
    if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    
    // Khi tìm thấy đường kết nối mạng (ICE Candidate)
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        if (targetId) window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate });
      }
    };

    // Khi nhận được luồng video của đối phương
    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0]) {
          remoteVideo.srcObject = e.streams[0];
          console.log("✅ Đã nhận được video của đối phương!");
      }
    };

    // Khi kết nối bị ngắt
    pc.onconnectionstatechange = () => {
        console.log("Trạng thái kết nối:", pc.connectionState);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            alert("Mất kết nối với đối phương.");
            hangUp(false);
        }
    };
    return pc;
  };

  // Bắt đầu cuộc gọi (Người gọi)
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Vui lòng chọn một người bạn để gọi.");
    
    currentRecipientId = window.currentChatContext.id;
    
    // Reset giao diện nút
    toggleMic.style.background = "rgba(255,255,255,0.2)"; 
    toggleMic.innerHTML = '<i class="fas fa-microphone"></i>';
    
    toggleCam.style.background = "rgba(255,255,255,0.2)";
    toggleCam.innerHTML = '<i class="fas fa-video"></i>';

    try {
      // Lấy quyền truy cập Media
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      
      // Hiển thị video của mình
      localVideo.srcObject = localStream; 
      localVideo.muted = true; // Tắt tiếng video mình để không bị vọng
      callWindow.classList.remove("hidden");

      // Khởi tạo kết nối
      peerConnection = createPeerConnection(localStream);
      
      // Tạo lời mời (Offer)
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Gửi tín hiệu lên Server
      window.socket.emit("callOffer", { recipientId: currentRecipientId, offer: peerConnection.localDescription, isVideo });
      
    } catch (err) {
      handleMediaError(err);
    }
  };

  // --- XỬ LÝ SỰ KIỆN TỪ SERVER (Socket.IO) ---

  // 1. Nhận cuộc gọi đến
  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    // Nếu đang có cuộc gọi khác -> Báo bận
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    
    // Hiển thị Popup
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    if (incomingModal) incomingModal.classList.remove("hidden");
    playRingtone();

    // TỰ ĐỘNG TẮT SAU 30 GIÂY NẾU KHÔNG NGHE
    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
        if (!peerConnection) { // Nếu chưa bắt máy
            stopRingtone();
            if (incomingModal) incomingModal.classList.add("hidden");
            window.socket.emit("callMissed", { callerId: senderId }); 
            currentCallerId = null;
        }
    }, 30000); // 30s

    // Xử lý nút Trả lời
    if (btnAccept) btnAccept.onclick = async () => {
        clearTimeout(callTimeout);
        stopRingtone();
        if (incomingModal) incomingModal.classList.add("hidden");
        
        try {
            // Lấy Media
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream; 
            localVideo.muted = true;
            if (callWindow) callWindow.classList.remove("hidden");
            
            // Kết nối
            peerConnection = createPeerConnection(localStream);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Gửi trả lời
            window.socket.emit("callAnswer", { recipientId: senderId, answer: peerConnection.localDescription });
        } catch (e) {
            handleMediaError(e);
            window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" });
        }
    };

    // Xử lý nút Từ chối
    if (btnReject) btnReject.onclick = () => {
        clearTimeout(callTimeout);
        stopRingtone();
        if (incomingModal) incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
    };
  });

  // 2. Nhận tín hiệu trả lời (Answer)
  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  // 3. Nhận ứng viên mạng (ICE Candidate)
  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) { console.error("Lỗi thêm ICE:", e); }
    }
  });
  
  // 4. Các sự kiện kết thúc
  window.socket.on("callEnd", () => { 
      // alert("Cuộc gọi đã kết thúc."); // Bỏ alert này nếu thấy phiền
      hangUp(false); 
  });
  
  window.socket.on("callMissed", () => { 
      alert("Người kia không bắt máy (Cuộc gọi nhỡ)."); 
      hangUp(false); 
  });
  
  window.socket.on("callReject", ({ reason }) => { 
      stopRingtone();
      if (reason === "BUSY") alert("Người dùng đang bận.");
      else if (reason === "REJECT") alert("Người dùng đã từ chối cuộc gọi.");
      else alert("Không thể kết nối.");
      hangUp(false); 
  });
  
  window.socket.on("userOffline", () => { 
      alert("Người dùng hiện không trực tuyến."); 
      hangUp(false); 
  });

  // --- HÀM NGẮT CUỘC GỌI ---
  const hangUp = (emitEvent = true) => {
    stopRingtone();
    if (callTimeout) clearTimeout(callTimeout);

    // Tắt Camera & Mic
    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
    }
    
    // Đóng kết nối P2P
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    localStream = null;
    
    // Ẩn giao diện
    if (callWindow) callWindow.classList.add("hidden");
    if (incomingModal) incomingModal.classList.add("hidden");
    
    // Gửi tín hiệu kết thúc cho đối phương
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) {
        window.socket.emit("callEnd", { recipientId: targetId });
    }
    
    currentRecipientId = null;
    currentCallerId = null;
  };

  // --- GẮN SỰ KIỆN CHO NÚT ---
  if (callButton) callButton.addEventListener("click", () => startCall(false)); // Gọi thoại
  if (videoCallButton) videoCallButton.addEventListener("click", () => startCall(true)); // Gọi video
  if (endCallButton) endCallButton.addEventListener("click", () => hangUp(true));

  // Nút tắt/bật Mic
  if (toggleMic) toggleMic.addEventListener("click", () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        toggleMic.style.background = audioTrack.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
        toggleMic.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
      }
    }
  });

  // Nút tắt/bật Camera
  if (toggleCam) toggleCam.addEventListener("click", () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        toggleCam.style.background = videoTrack.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
        toggleCam.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
      }
    }
  });

  // Hiển thị nút gọi chỉ khi chọn người dùng thật (không phải AI)
  window.addEventListener("contextChanged", () => {
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0 && window.currentChatContext.id !== 1;
    if (callButton) callButton.style.display = canCall ? "inline-block" : "none";
    if (videoCallButton) videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
