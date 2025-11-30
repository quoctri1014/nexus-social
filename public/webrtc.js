/**
 * public/webrtc.js - PHIÊN BẢN UPDATE UI NÚT BẤM
 */

document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  const callButton = document.getElementById("call-button");
  const videoCallButton = document.getElementById("video-call-button");
  const endCallButton = document.getElementById("end-call-button");
  
  const callWindow = document.getElementById("call-window");
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  
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

  // Helper
  const playRingtone = () => { if(ringtone) { ringtone.currentTime=0; ringtone.play().catch(console.error); } };
  const stopRingtone = () => { if(ringtone) { ringtone.pause(); ringtone.currentTime=0; } };

  const handleMediaError = (err) => {
      console.error("Media Error:", err);
      let msg = "Lỗi thiết bị.";
      if (err.name === 'NotAllowedError') msg = "⚠️ Bạn đã chặn Camera/Mic. Hãy mở khóa trên thanh địa chỉ.";
      else if (err.name === 'NotFoundError') msg = "❌ Không tìm thấy Camera/Mic.";
      else if (err.name === 'NotReadableError') msg = "⛔ Camera/Mic đang bị ứng dụng khác dùng.";
      else if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') msg = "🔒 Cần HTTPS để gọi video.";
      alert(msg);
      hangUp();
  };

  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        if (targetId) window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") hangUp(false);
    };
    return pc;
  };

  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;
    // Reset buttons
    toggleMic.classList.remove("off"); toggleMic.innerHTML = '<i class="fas fa-microphone"></i>';
    toggleCam.classList.remove("off"); toggleCam.innerHTML = '<i class="fas fa-video"></i>';

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");

      peerConnection = createPeerConnection(localStream);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      window.socket.emit("callOffer", { recipientId: currentRecipientId, offer: peerConnection.localDescription, isVideo });
    } catch (err) { handleMediaError(err); }
  };

  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    incomingModal.classList.remove("hidden");
    playRingtone();

    btnAccept.onclick = async () => {
        stopRingtone();
        incomingModal.classList.add("hidden");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream;
            callWindow.classList.remove("hidden");
            
            // Reset buttons
            toggleMic.classList.remove("off"); toggleMic.innerHTML = '<i class="fas fa-microphone"></i>';
            toggleCam.classList.remove("off"); toggleCam.innerHTML = '<i class="fas fa-video"></i>';

            peerConnection = createPeerConnection(localStream);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            window.socket.emit("callAnswer", { recipientId: senderId, answer: peerConnection.localDescription });
        } catch (e) { handleMediaError(e); window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" }); }
    };

    btnReject.onclick = () => {
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
    if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  });
  window.socket.on("callEnd", () => { alert("Cuộc gọi kết thúc."); hangUp(false); });
  window.socket.on("callReject", ({ reason }) => { stopRingtone(); alert(reason==="BUSY"?"Người dùng bận.":"Đã từ chối."); hangUp(false); });
  window.socket.on("userOffline", () => { alert("Người dùng offline."); hangUp(false); });

  const hangUp = (emitEvent = true) => {
    stopRingtone();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    localStream = null;
    callWindow.classList.add("hidden");
    incomingModal.classList.add("hidden");
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) window.socket.emit("callEnd", { recipientId: targetId });
    currentRecipientId = null; currentCallerId = null;
  };

  callButton.addEventListener("click", () => startCall(false));
  videoCallButton.addEventListener("click", () => startCall(true));
  endCallButton.addEventListener("click", () => hangUp(true));

  // --- LOGIC ĐỔI MÀU NÚT BẤM (TOGGLE) ---
  toggleMic.addEventListener("click", () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled;
          // Toggle class 'off'
          toggleMic.classList.toggle("off", !audioTrack.enabled);
          // Đổi Icon
          toggleMic.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
      }
    }
  });

  toggleCam.addEventListener("click", () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled;
          toggleCam.classList.toggle("off", !videoTrack.enabled);
          toggleCam.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
      }
    }
  });

  window.addEventListener("contextChanged", () => {
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0;
    callButton.style.display = canCall ? "inline-block" : "none";
    videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
