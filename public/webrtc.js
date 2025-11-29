document.addEventListener("DOMContentLoaded", () => {
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

  // --- HÀM KHỞI TẠO ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");

      peerConnection = createPeerConnection(localStream, currentRecipientId);
      const offer = await peerConnection.createOffer({
        offerToReceiveVideo: isVideo,
        offerToReceiveAudio: true,
      });
      await peerConnection.setLocalDescription(offer);

      window.socket.emit("callOffer", {
        recipientId: currentRecipientId,
        offer: peerConnection.localDescription,
        isVideo,
      });
    } catch (err) {
      alert("Lỗi truy cập Camera/Mic");
      hangUp();
    }
  };

  const createPeerConnection = (stream, recipientId) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate)
        window.socket.emit("sendICE", { recipientId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0])
        remoteVideo.srcObject = e.streams[0];
    };
    return pc;
  };

  const hangUp = (emit = true) => {
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callWindow.classList.add("hidden");
    if (emit && currentRecipientId)
      window.socket.emit("callEnd", { recipientId: currentRecipientId });
    currentRecipientId = null;
  };

  // Listeners
  callButton.addEventListener("click", () => startCall(false));
  videoCallButton.addEventListener("click", () => startCall(true));
  endCallButton.addEventListener("click", () => hangUp(true));

  toggleMic.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      toggleMic.style.background = track.enabled ? "#333" : "#ff4757";
    }
  });
  toggleCam.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        toggleCam.style.background = track.enabled ? "#333" : "#ff4757";
      }
    }
  });

  // Socket Events
  window.socket.on("callOffer", async ({ senderId, offer, isVideo }) => {
    if (
      !confirm(
        `Có cuộc gọi ${isVideo ? "Video" : "Thoại"} từ ${senderId}. Trả lời?`
      )
    ) {
      window.socket.emit("callReject", { callerId: senderId });
      return;
    }
    currentRecipientId = senderId;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden");
      peerConnection = createPeerConnection(localStream, senderId);
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      window.socket.emit("callAnswer", {
        recipientId: senderId,
        answer: peerConnection.localDescription,
      });
    } catch (e) {
      hangUp(false);
    }
  });

  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection)
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
  });
  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection)
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  });
  window.socket.on("callEnd", () => {
    alert("Kết thúc cuộc gọi");
    hangUp(false);
  });

  // Context check
  window.addEventListener("contextChanged", () => {
    const canCall =
      window.currentChatContext.type === "user" &&
      window.currentChatContext.id !== 0;
    callButton.style.display = canCall ? "" : "none";
    videoCallButton.style.display = canCall ? "" : "none";
  });
});
