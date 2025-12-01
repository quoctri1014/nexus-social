document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  // Ẩn modal ngay lập tức để tránh lỗi giao diện
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

  // Cấu hình STUN Server (Quan trọng để kết nối mạng khác nhau)
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ]
  };

  // --- 1. SỬA LỖI NHẠC CHUÔNG (AbortError) ---
  const playRingtone = async () => {
    if (ringtone) {
      try {
        ringtone.currentTime = 0;
        await ringtone.play();
      } catch (err) {
        // Bỏ qua lỗi AbortError (do pause gọi quá nhanh) hoặc NotAllowedError (chưa tương tác)
        if (err.name !== "AbortError") {
          console.warn("Không thể phát nhạc chuông (Người dùng cần tương tác trước):", err);
        }
      }
    }
  };

  const stopRingtone = () => {
    if (ringtone) {
      ringtone.pause();
      ringtone.currentTime = 0;
    }
  };

  const handleMediaError = (err) => {
      console.error("Lỗi Media:", err);
      let msg = "Lỗi thiết bị.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') msg = "⚠️ Bạn đã chặn quyền Camera/Mic. Vui lòng mở khóa trên thanh địa chỉ.";
      else if (err.name === 'NotFoundError') msg = "❌ Không tìm thấy Camera/Mic.";
      else if (err.name === 'NotReadableError') msg = "⛔ Camera/Mic đang bị ứng dụng khác (Zoom/Zalo) sử dụng.";
      
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
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            hangUp(false);
        }
    };
    return pc;
  };

  // --- 2. SỬA LỖI GỬI OFFER (Sửa lỗi 'type is null') ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;
    
    // Reset nút
    if(toggleMic) toggleMic.style.background = "rgba(255,255,255,0.2)";
    if(toggleCam) toggleCam.style.background = "rgba(255,255,255,0.2)";

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      localVideo.srcObject = localStream;
      localVideo.muted = true; // Tắt tiếng mình để đỡ vọng
      callWindow.classList.remove("hidden");

      peerConnection = createPeerConnection(localStream);
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // QUAN TRỌNG: Gửi object rõ ràng để tránh lỗi "type is null"
      const offerPayload = { 
          type: offer.type, 
          sdp: offer.sdp 
      };

      window.socket.emit("callOffer", { 
          recipientId: currentRecipientId, 
          offer: offerPayload, 
          isVideo 
      });

    } catch (err) { handleMediaError(err); }
  };

  // --- 3. XỬ LÝ NHẬN CUỘC GỌI ---
  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    // Kiểm tra tính hợp lệ của offer
    if (!offer || !offer.type || !offer.sdp) {
        console.error("❌ Nhận được Offer lỗi:", offer);
        return; 
    }

    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    incomingModal.classList.remove("hidden");
    
    playRingtone(); // Phát nhạc chuông (đã sửa lỗi)

    // Timeout 30s
    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
        if (!peerConnection) {
            stopRingtone();
            incomingModal.classList.add("hidden");
            window.socket.emit("callMissed", { callerId: senderId });
            currentCallerId = null;
        }
    }, 30000);

    // Chấp nhận cuộc gọi
    btnAccept.onclick = async () => {
        clearTimeout(callTimeout);
        stopRingtone();
        incomingModal.classList.add("hidden");
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream;
            localVideo.muted = true;
            callWindow.classList.remove("hidden");
            
            peerConnection = createPeerConnection(localStream);
            
            // Thiết lập Remote Description (đã fix lỗi type null nhờ bước kiểm tra trên)
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Gửi Answer rõ ràng
            const answerPayload = { type: answer.type, sdp: answer.sdp };
            window.socket.emit("callAnswer", { recipientId: senderId, answer: answerPayload });

        } catch (e) {
            console.error("Lỗi khi chấp nhận cuộc gọi:", e);
            handleMediaError(e);
            window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" });
        }
    };

    // Từ chối cuộc gọi
    btnReject.onclick = () => {
        clearTimeout(callTimeout);
        stopRingtone();
        incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
    };
  });

  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection && answer && answer.type) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) { console.error("Lỗi setRemoteDescription (Answer):", e); }
    }
  });

  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection && candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) { console.error("Lỗi addIceCandidate:", e); }
    }
  });
  
  window.socket.on("callEnd", () => { hangUp(false); });
  window.socket.on("callMissed", () => { alert("Người kia không bắt máy."); hangUp(false); });
  window.socket.on("callReject", ({ reason }) => { 
      stopRingtone(); 
      alert(reason==="BUSY" ? "Người dùng đang bận." : "Cuộc gọi bị từ chối."); 
      hangUp(false); 
  });
  window.socket.on("userOffline", () => { alert("Người dùng đang Offline."); hangUp(false); });

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
  };

  // Event Listeners
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
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0 && window.currentChatContext.id !== 1; // 1 là AI Bot
    if (callButton) callButton.style.display = canCall ? "inline-block" : "none";
    if (videoCallButton) videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
