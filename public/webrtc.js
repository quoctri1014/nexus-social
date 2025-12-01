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
  
  // ✅ LƯU THÔNG TIN CUỘC GỌI ĐẾN
  let pendingOffer = null;
  let pendingIsVideo = false;
  let isProcessingCall = false;
  let pendingICECandidates = []; // ✅ Lưu ICE candidates đến sớm

  // Cấu hình STUN/TURN Server (✅ Thêm TURN để vượt firewall)
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ],
    iceCandidatePoolSize: 10 // ✅ Tăng pool size
  };

  // --- XỬ LÝ NHẠC CHUÔNG ---
  const playRingtone = async () => {
    if (ringtone) {
      try {
        ringtone.currentTime = 0;
        ringtone.loop = true;
        await ringtone.play();
      } catch (err) {
        console.warn("Không thể phát nhạc:", err);
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

    alert(msg);
    hangUp();
  };

  const createPeerConnection = (stream) => {
    console.log("📡 Tạo PeerConnection mới...");
    const pc = new RTCPeerConnection(rtcConfig);
    
    // ✅ Add tracks từ localStream
    if (stream) {
      stream.getTracks().forEach((track) => {
        console.log(`➕ Thêm track: ${track.kind} (enabled: ${track.enabled})`);
        pc.addTrack(track, stream);
      });
    }
    
    // ✅ Xử lý ICE Candidate
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const targetId = currentRecipientId || currentCallerId;
        console.log("🧊 Gửi ICE candidate:", e.candidate.type);
        if (targetId) {
          window.socket.emit("sendICE", { 
            recipientId: targetId, 
            candidate: e.candidate 
          });
        }
      }
    };

    // ✅ Xử lý khi nhận Remote Track (QUAN TRỌNG!)
    pc.ontrack = (e) => {
      console.log("📺 Nhận remote track:", e.track.kind, "Stream ID:", e.streams[0].id);
      console.log("Track enabled:", e.track.enabled, "readyState:", e.track.readyState);
      
      if (remoteVideo.srcObject !== e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
        console.log("✅ Đã gán remoteVideo.srcObject");
        
        // ✅ Force play remoteVideo
        remoteVideo.play().catch(err => {
          console.error("❌ Không thể play remoteVideo:", err);
        });
      }
    };

    // ✅ Theo dõi trạng thái kết nối
    pc.oniceconnectionstatechange = () => {
      console.log("🔌 ICE Connection State:", pc.iceConnectionState);
      if (pc.iceConnectionState === "connected") {
        console.log("✅ Kết nối P2P thành công!");
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("🔗 Connection State:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        console.warn("⚠️ Kết nối bị ngắt");
        hangUp(false);
      }
    };

    // ✅ Debug signaling state
    pc.onsignalingstatechange = () => {
      console.log("📡 Signaling State:", pc.signalingState);
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
      console.log("🎤 Yêu cầu quyền Camera/Mic...");
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: isVideo ? { width: 640, height: 480 } : false, 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      await localVideo.play();
      callWindow.classList.remove("hidden");

      console.log("📡 Tạo PeerConnection (Caller)...");
      peerConnection = createPeerConnection(localStream);
      
      console.log("📤 Tạo Offer...");
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideo
      });
      await peerConnection.setLocalDescription(offer);

      console.log("📨 Gửi Offer đến người nhận");
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
    
    // ✅ BỎ QUA DUPLICATE
    if (isProcessingCall) {
      console.log("⚠️ Đã có cuộc gọi đang xử lý, bỏ qua");
      return;
    }
    
    // ✅ VALIDATE OFFER
    if (!offer || typeof offer !== 'object' || !offer.sdp || !offer.type) {
      console.warn("⚠️ Offer không hợp lệ, chờ offer tiếp theo...");
      return;
    }
    
    // ✅ KIỂM TRA BẬN
    if (currentCallerId || currentRecipientId || peerConnection) {
      console.log("📵 Đang bận");
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }
    
    // ✅ ĐÁNH DẤU XỬ LÝ
    isProcessingCall = true;
    currentCallerId = senderId;
    pendingOffer = offer;
    pendingIsVideo = isVideo;
    pendingICECandidates = []; // Reset ICE queue
    
    console.log("✅ Đã lưu offer hợp lệ");
    
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
        resetCallState();
      }
    }, 30000);
  });

  // ✅ NÚT ACCEPT (Gắn 1 lần duy nhất)
  if (btnAccept) {
    btnAccept.onclick = async () => {
      if (!pendingOffer || !currentCallerId) {
        alert("❌ Lỗi: Thông tin cuộc gọi bị mất.");
        resetCallState();
        return;
      }
      
      clearTimeout(callTimeout);
      stopRingtone();
      incomingModal.classList.add("hidden");
      
      try {
        console.log("🎤 Yêu cầu quyền Camera/Mic (Receiver)...");
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: pendingIsVideo ? { width: 640, height: 480 } : false, 
          audio: { 
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        await localVideo.play();
        callWindow.classList.remove("hidden");
        
        console.log("📡 Tạo PeerConnection (Receiver)...");
        peerConnection = createPeerConnection(localStream);
        
        console.log("📥 Set RemoteDescription với Offer...");
        const remoteDesc = new RTCSessionDescription({
          type: 'offer',
          sdp: pendingOffer.sdp
        });
        await peerConnection.setRemoteDescription(remoteDesc);
        
        console.log("📤 Tạo Answer...");
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log("📨 Gửi Answer về người gọi");
        window.socket.emit("callAnswer", { 
          recipientId: currentCallerId, 
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });
        
        // ✅ Xử lý các ICE candidates đã đến trước
        if (pendingICECandidates.length > 0) {
          console.log(`🧊 Xử lý ${pendingICECandidates.length} ICE candidates đã đến trước`);
          for (const candidate of pendingICECandidates) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.error("❌ Lỗi add pending ICE:", e);
            }
          }
          pendingICECandidates = [];
        }
        
        pendingOffer = null;
        isProcessingCall = false;

      } catch (e) {
        console.error("❌ Lỗi Accept Call:", e);
        handleMediaError(e);
        window.socket.emit("callReject", { callerId: currentCallerId, reason: "ERROR" });
        resetCallState();
      }
    };
  }

  // ✅ NÚT REJECT
  if (btnReject) {
    btnReject.onclick = () => {
      clearTimeout(callTimeout);
      stopRingtone();
      incomingModal.classList.add("hidden");
      if (currentCallerId) {
        window.socket.emit("callReject", { callerId: currentCallerId, reason: "REJECT" });
      }
      resetCallState();
    };
  }

  // --- XỬ LÝ ANSWER ---
  window.socket.on("callAnswer", async ({ answer }) => {
    console.log("📱 Nhận Answer:", answer);
    
    if (peerConnection && answer && answer.sdp) {
      try {
        const remoteDesc = new RTCSessionDescription({
          type: 'answer',
          sdp: answer.sdp
        });
        await peerConnection.setRemoteDescription(remoteDesc);
        console.log("✅ Đã set RemoteDescription (Answer)");
      } catch (e) { 
        console.error("❌ Lỗi setRemoteDescription Answer:", e); 
      }
    }
  });

  // --- XỬ LÝ ICE CANDIDATE (✅ FIX: Lưu ICE nếu peerConnection chưa sẵn sàng) ---
  window.socket.on("receiveICE", async ({ candidate }) => {
    console.log("🧊 Nhận ICE candidate:", candidate?.type);
    
    if (peerConnection && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ Đã thêm ICE candidate");
      } catch (e) { 
        console.error("❌ Lỗi add ICE:", e); 
      }
    } else {
      // ✅ Lưu ICE candidate nếu peerConnection chưa sẵn sàng
      console.log("⏳ PeerConnection chưa sẵn sàng, lưu ICE vào queue");
      pendingICECandidates.push(candidate);
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
    console.log("📴 Kết thúc cuộc gọi...");
    stopRingtone();
    if (callTimeout) clearTimeout(callTimeout);
    
    if (localStream) {
      localStream.getTracks().forEach((t) => {
        t.stop();
        console.log(`⏹ Dừng track: ${t.kind}`);
      });
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
      console.log("🔌 Đã đóng PeerConnection");
    }
    
    localStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callWindow.classList.add("hidden");
    incomingModal.classList.add("hidden");
    
    const targetId = currentRecipientId || currentCallerId;
    if (emitEvent && targetId) {
      window.socket.emit("callEnd", { recipientId: targetId });
    }
    
    resetCallState();
  };

  const resetCallState = () => {
    currentRecipientId = null;
    currentCallerId = null;
    pendingOffer = null;
    isProcessingCall = false;
    pendingICECandidates = [];
    console.log("🔄 Đã reset call state");
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
        console.log("🎤 Mic:", t.enabled ? "ON" : "OFF");
      }
    }
  });

  if (toggleCam) toggleCam.addEventListener("click", () => {
    if (localStream) {
      const t = localStream.getVideoTracks()[0];
      if (t) { 
        t.enabled = !t.enabled; 
        toggleCam.style.background = t.enabled ? "rgba(255,255,255,0.2)" : "#ef4444"; 
        console.log("📹 Camera:", t.enabled ? "ON" : "OFF");
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
