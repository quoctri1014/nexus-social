document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  // 1. Ẩn modal ngay lập tức
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

  let peerConnection = null;
  let localStream = null;
  let currentCallerId = null;
  let currentRecipientId = null;
  let callTimeout = null;
  
  // ✅ LƯU THÔNG TIN CUỘC GỌI ĐẾN (FIX CHÍNH)
  let pendingOffer = null;
  let pendingIsVideo = false;

  // Cấu hình STUN Server
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ]
  };

  // --- XỬ LÝ NHẠC CHUÔNG AN TOÀN ---
  const playRingtone = async () => {
    if (ringtone) {
      try {
        ringtone.currentTime = 0;
        ringtone.loop = true; // ✅ Thêm loop để nhạc chuông lặp lại
        await ringtone.play();
      } catch (err) {
        console.warn("Không thể phát nhạc (Cần tương tác):", err);
      }
    }
  };

  const stopRingtone = () => {
    if (ringtone) {
      ringtone.pause();
      ringtone.currentTime = 0;
      ringtone.loop = false;
    }
  };

  const handleMediaError = (err) => {
    console.error("Lỗi Media:", err);
    let msg = "Lỗi kết nối.";
    
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = "⚠️ Bạn đã chặn quyền Camera/Mic. Hãy bấm vào ổ khóa 🔒 trên thanh địa chỉ để mở lại.";
    } 
    else if (err.name === 'NotFoundError') {
      msg = "❌ Không tìm thấy Camera/Mic.";
    }
    else if (err.message && err.message.includes("sdp")) {
      msg = "⚠️ Lỗi dữ liệu cuộc gọi. Vui lòng thử lại.";
    }

    alert(msg);
    hangUp();
  };

  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection(rtcConfig);
    if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        if (targetId) window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        hangUp(false);
      }
    };
    
    return pc;
  };

  // --- BẮT ĐẦU GỌI (Người gọi) ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;
    
    if(toggleMic) toggleMic.style.background = "rgba(255,255,255,0.2)";
    if(toggleCam) toggleCam.style.background = "rgba(255,255,255,0.2)";

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      callWindow.classList.remove("hidden");

      peerConnection = createPeerConnection(localStream);
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // ✅ Gửi offer đầy đủ
      window.socket.emit("callOffer", { 
        recipientId: currentRecipientId, 
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }, 
        isVideo 
      });

    } catch (err) { 
      handleMediaError(err); 
    }
  };

  // --- XỬ LÝ KHI CÓ CUỘC GỌI ĐẾN (Người nhận) ---
  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    console.log("📞 Cuộc gọi đến từ:", senderName, "Offer:", offer);
    
    // ✅ Kiểm tra offer hợp lệ
    if (!offer || !offer.sdp) {
      console.error("❌ Offer không hợp lệ:", offer);
      window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" });
      return;
    }
    
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    
    // ✅ LƯU THÔNG TIN CUỘC GỌI (FIX CHÍNH)
    currentCallerId = senderId;
    pendingOffer = offer;
    pendingIsVideo = isVideo;
    
    // Hiển thị popup
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    incomingModal.classList.remove("hidden");
    
    playRingtone();

    // Timeout 30s
    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
      if (!peerConnection) {
        stopRingtone();
        incomingModal.classList.add("hidden");
        window.socket.emit("callMissed", { callerId: senderId });
        currentCallerId = null;
        pendingOffer = null;
      }
    }, 30000);
  });

  // ✅ GẮN EVENT LISTENER 1 LẦN DUY NHẤT (FIX CHÍNH)
  if (btnAccept) {
    btnAccept.onclick = async () => {
      if (!pendingOffer || !currentCallerId) {
        alert("❌ Lỗi: Thông tin cuộc gọi bị mất.");
        hangUp();
        return;
      }
      
      clearTimeout(callTimeout);
      stopRingtone();
      incomingModal.classList.add("hidden");
      
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: pendingIsVideo, 
          audio: true 
        });
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        callWindow.classList.remove("hidden");
        
        peerConnection = createPeerConnection(localStream);
        
        // ✅ Sử dụng pendingOffer đã lưu
        const remoteDesc = new RTCSessionDescription({
          type: 'offer',
          sdp: pendingOffer.sdp
        });
        
        await peerConnection.setRemoteDescription(remoteDesc);
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        window.socket.emit("callAnswer", { 
          recipientId: currentCallerId, 
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });
        
        // ✅ Xóa thông tin tạm sau khi xử lý xong
        pendingOffer = null;

      } catch (e) {
        console.error("Lỗi Accept Call:", e);
        handleMediaError(e);
        window.socket.emit("callReject", { callerId: currentCallerId, reason: "ERROR" });
      }
    };
  }

  // ✅ GẮN EVENT LISTENER 1 LẦN DUY NHẤT
  if (btnReject) {
    btnReject.onclick = () => {
      clearTimeout(callTimeout);
      stopRingtone();
      incomingModal.classList.add("hidden");
      if (currentCallerId) {
        window.socket.emit("callReject", { callerId: currentCallerId, reason: "REJECT" });
      }
      currentCallerId = null;
      pendingOffer = null;
    };
  }

  // --- XỬ LÝ NHẬN ANSWER ---
  window.socket.on("callAnswer", async ({ answer }) => {
    console.log("📱 Nhận answer:", answer);
    
    if (peerConnection && answer && answer.sdp) {
      try {
        const remoteDesc = new RTCSessionDescription({
          type: 'answer',
          sdp: answer.sdp
        });
        await peerConnection.setRemoteDescription(remoteDesc);
      } catch (e) { 
        console.error("Lỗi setRemoteDescription Answer:", e); 
      }
    }
  });

  // --- XỬ LÝ ICE CANDIDATE ---
  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection && candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) { 
        console.error("Lỗi ICE:", e); 
      }
    }
  });
  
  // --- XỬ LÝ KẾT THÚC CUỘC GỌI ---
  window.socket.on("callEnd", () => { hangUp(false); });
  window.socket.on("callMissed", () => { 
    alert("Người kia không bắt máy."); 
    hangUp(false); 
  });
  window.socket.on("callReject", ({ reason }) => { 
    stopRingtone(); 
    alert(reason==="BUSY" ? "Người dùng đang bận." : "Cuộc gọi bị từ chối."); 
    hangUp(false); 
  });
  window.socket.on("userOffline", () => { 
    alert("Người dùng đang Offline."); 
    hangUp(false); 
  });

  const hangUp = (emitEvent = true) => {
    stopRingtone();
    if (callTimeout) clearTimeout(callTimeout);
    
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    
    localStream = null;
    callWindow.classList.add("hidden");
    incomingModal.classList.add("hidden");
    
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) {
      window.socket.emit("callEnd", { recipientId: targetId });
    }
    
    currentRecipientId = null;
    currentCallerId = null;
    pendingOffer = null; // ✅ Reset pendingOffer
  };

  // --- EVENT LISTENERS ---
  if (callButton) callButton.addEventListener("click", () => startCall(false));
  if (videoCallButton) videoCallButton.addEventListener("click", () => startCall(true));
  if (endCallButton) endCallButton.addEventListener("click", () => hangUp(true));

  if (toggleMic) toggleMic.addEventListener("click", () => {
    if (localStream) {
      const t = localStream.getAudioTracks()[0];
      if (t) { 
        t.enabled = !t.enabled; 
        toggleMic.style.background = t.enabled ? "rgba(255,255,255,0.2)" : "#ef4444"; 
      }
    }
  });

  if (toggleCam) toggleCam.addEventListener("click", () => {
    if (localStream) {
      const t = localStream.getVideoTracks()[0];
      if (t) { 
        t.enabled = !t.enabled; 
        toggleCam.style.background = t.enabled ? "rgba(255,255,255,0.2)" : "#ef4444"; 
      }
    }
  });

  window.addEventListener("contextChanged", () => {
    const canCall = window.currentChatContext.type === "user" && 
                    window.currentChatContext.id !== 0 && 
                    window.currentChatContext.id !== 1;
    if (callButton) callButton.style.display = canCall ? "inline-block" : "none";
    if (videoCallButton) videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
