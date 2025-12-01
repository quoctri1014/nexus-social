document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  document.getElementById("incoming-call-modal").classList.add("hidden");
  document.getElementById("call-window").classList.add("hidden");

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
  let callTimeout = null;

  const playRingtone = () => { if(ringtone) { ringtone.currentTime=0; ringtone.play().catch(() => {}); } };
  const stopRingtone = () => { if(ringtone) { ringtone.pause(); ringtone.currentTime=0; } };

  const handleMediaError = (err) => {
      let msg = "Lỗi thiết bị.";
      if (err.name === 'NotAllowedError') msg = "⚠️ Bạn đã chặn Camera/Mic.";
      else if (err.name === 'NotFoundError') msg = "❌ Không tìm thấy Camera/Mic.";
      else if (err.name === 'NotReadableError') msg = "⛔ Camera/Mic đang bị ứng dụng khác dùng.";
      alert(msg); hangUp();
  };

  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = (e) => { if (e.candidate) { const targetId = currentRecipientId || currentCallerId; if (targetId) window.socket.emit("sendICE", { recipientId: targetId, candidate: e.candidate }); } };
    pc.ontrack = (e) => { if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "disconnected" || pc.connectionState === "failed") hangUp(false); };
    return pc;
  };

  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;
    toggleMic.style.background = "rgba(255,255,255,0.2)"; toggleCam.style.background = "rgba(255,255,255,0.2)";
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      localVideo.srcObject = localStream; callWindow.classList.remove("hidden");
      peerConnection = createPeerConnection(localStream);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      window.socket.emit("callOffer", { recipientId: currentRecipientId, offer: peerConnection.localDescription, isVideo });
    } catch (err) { handleMediaError(err); }
  };

  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    if (currentCallerId || currentRecipientId) { window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" }); return; }
    
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName||"User")}`;
    incomingModal.classList.remove("hidden");
    playRingtone();

    callTimeout = setTimeout(() => {
        if (!peerConnection) {
            stopRingtone();
            incomingModal.classList.add("hidden");
            window.socket.emit("callMissed", { callerId: senderId }); 
            currentCallerId = null;
        }
    }, 30000);

    btnAccept.onclick = async () => {
        clearTimeout(callTimeout);
        stopRingtone(); incomingModal.classList.add("hidden");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream; callWindow.classList.remove("hidden");
            peerConnection = createPeerConnection(localStream);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            window.socket.emit("callAnswer", { recipientId: senderId, answer: peerConnection.localDescription });
        } catch (e) { handleMediaError(e); window.socket.emit("callReject", { callerId: senderId, reason: "ERROR" }); }
    };

    btnReject.onclick = () => {
        clearTimeout(callTimeout);
        stopRingtone(); incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
    };
  });

  window.socket.on("callAnswer", async ({ answer }) => { if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); });
  window.socket.on("receiveICE", async ({ candidate }) => { if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); });
  
  window.socket.on("callEnd", () => { hangUp(false); });
  window.socket.on("callMissed", () => { alert("Cuộc gọi nhỡ."); hangUp(false); });
  window.socket.on("callReject", ({ reason }) => { stopRingtone(); alert(reason==="BUSY"?"Người dùng bận.":"Đã từ chối."); hangUp(false); });
  window.socket.on("userOffline", () => { alert("Người dùng offline."); hangUp(false); });

  const hangUp = (emitEvent = true) => {
    stopRingtone(); clearTimeout(callTimeout);
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    localStream = null; callWindow.classList.add("hidden"); incomingModal.classList.add("hidden");
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) window.socket.emit("callEnd", { recipientId: targetId });
    currentRecipientId = null; currentCallerId = null;
  };

  callButton.addEventListener("click", () => startCall(false));
  videoCallButton.addEventListener("click", () => startCall(true));
  endCallButton.addEventListener("click", () => hangUp(true));

  toggleMic.addEventListener("click", () => { if (localStream) { const t = localStream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; toggleMic.style.background = t.enabled ? "rgba(255,255,255,0.2)" : "#ef4444"; } } });
  toggleCam.addEventListener("click", () => { if (localStream) { const t = localStream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; toggleCam.style.background = t.enabled ? "rgba(255,255,255,0.2)" : "#ef4444"; } } });

  window.addEventListener("contextChanged", () => {
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0;
    callButton.style.display = canCall ? "inline-block" : "none";
    videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
