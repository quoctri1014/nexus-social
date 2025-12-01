document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  const incomingModal = document.getElementById("incoming-call-modal");
  const callWindow = document.getElementById("call-window");
  if (incomingModal) incomingModal.classList.add("hidden");
  if (callWindow) callWindow.classList.add("hidden");

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

  // CẤU HÌNH STUN SERVER MẠNH MẼ HƠN
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ]
  };

  const playRingtone = async () => { if(ringtone) { try { ringtone.currentTime = 0; await ringtone.play(); } catch (e) {} } };
  const stopRingtone = () => { if(ringtone) { ringtone.pause(); ringtone.currentTime = 0; } };

  const handleMediaError = (err) => {
      console.error("Lỗi Media:", err);
      let msg = "Lỗi thiết bị.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') msg = "⚠️ Bạn đã chặn quyền Camera/Mic.";
      else if (err.name === 'NotFoundError') msg = "❌ Không tìm thấy Camera/Mic.";
      else if (err.name === 'NotReadableError') msg = "⛔ Camera/Mic đang bận.";
      alert(msg); hangUp();
  };

  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Thêm stream của mình vào kết nối
    if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        if (targetId) window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate });
      }
    };

    // SỬA LỖI MÀN HÌNH ĐEN: Ép video chạy
    pc.ontrack = (e) => {
      console.log("🎥 Nhận được video từ đối phương!");
      if (remoteVideo.srcObject !== e.streams[0]) {
          remoteVideo.srcObject = e.streams[0];
          // Ép play
          remoteVideo.play().catch(err => console.log("Cần tương tác để phát video:", err));
      }
    };

    pc.onconnectionstatechange = () => {
        console.log("Connection State:", pc.connectionState);
        if (pc.connectionState === "failed") {
            alert("Mất kết nối mạng với đối phương (Do tường lửa/Mạng yếu).");
            hangUp(false);
        }
    };
    return pc;
  };

  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;
    
    // Reset giao diện
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

      window.socket.emit("callOffer", { 
          recipientId: currentRecipientId, 
          offer: { type: offer.type, sdp: offer.sdp }, 
          isVideo 
      });

    } catch (err) { handleMediaError(err); }
  };

  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Nexus User";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    incomingModal.classList.remove("hidden");
    
    playRingtone();

    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
        if (!peerConnection) {
            stopRingtone();
            incomingModal.classList.add("hidden");
            window.socket.emit("callMissed", { callerId: senderId });
            currentCallerId = null;
        }
    }, 30000);

    // CHẤP NHẬN CUỘC GỌI
    btnAccept.onclick = async () => {
        clearTimeout(callTimeout);
        stopRingtone();
        incomingModal.classList.add("hidden");
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream;
            localVideo.muted = true;
            callWindow.classList.remove("hidden");
            
            peerConnection = createPeerConnection(localStream); // Đã bao gồm addTrack bên trong hàm này
            
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            window.socket.emit("callAnswer", { 
                recipientId: senderId, 
                answer: { type: answer.type, sdp: answer.sdp } 
            });

        } catch (e) {
            console.error("Lỗi accept:", e);
            handleMediaError(e);
            window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" });
        }
    };

    btnReject.onclick = () => {
        clearTimeout(callTimeout);
        stopRingtone();
        incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
    };
  });

  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } 
        catch (e) { console.error("Lỗi ICE:", e); }
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
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0 && window.currentChatContext.id !== 1;
    if (callButton) callButton.style.display = canCall ? "inline-block" : "none";
    if (videoCallButton) videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
