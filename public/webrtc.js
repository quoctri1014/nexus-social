/**
 * public/webrtc.js - PHIÊN BẢN CÓ NHẠC CHUÔNG & UI ĐẸP
 */

document.addEventListener("DOMContentLoaded", () => {
  if (!window.socket || !window.location.pathname.endsWith("/chat.html")) return;

  // DOM Elements
  const callButton = document.getElementById("call-button");
  const videoCallButton = document.getElementById("video-call-button");
  const endCallButton = document.getElementById("end-call-button");
  
  const callWindow = document.getElementById("call-window"); // Màn hình gọi video
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  
  // Modal cuộc gọi đến
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
  let currentCallerId = null; // ID người đang gọi mình
  let currentRecipientId = null; // ID người mình đang gọi

  // --- HÀM HELPER ---
  const playRingtone = () => {
      ringtone.currentTime = 0;
      ringtone.play().catch(e => console.log("Cần tương tác để phát nhạc"));
  };
  const stopRingtone = () => {
      ringtone.pause();
      ringtone.currentTime = 0;
  };

  // --- WEBRTC CONFIG ---
  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate && (currentRecipientId || currentCallerId)) {
        window.socket.emit("sendICE", { 
            recipientId: currentRecipientId || currentCallerId, 
            candidate: e.candidate 
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideo.srcObject !== e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      }
    };
    return pc;
  };

  // --- NGƯỜI GỌI (CALLER) ---
  const startCall = async (isVideo) => {
    if (!window.currentChatContext.id) return alert("Chọn người để gọi.");
    currentRecipientId = window.currentChatContext.id;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      localVideo.srcObject = localStream;
      callWindow.classList.remove("hidden"); // Hiện màn hình gọi

      peerConnection = createPeerConnection(localStream);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      window.socket.emit("callOffer", {
        recipientId: currentRecipientId,
        offer: peerConnection.localDescription,
        isVideo,
      });
    } catch (err) {
      alert("Lỗi truy cập Camera/Mic: " + err.message);
      hangUp();
    }
  };

  // --- NGƯỜI NHẬN (RECEIVER) ---
  window.socket.on("callOffer", ({ senderId, senderName, senderAvatar, offer, isVideo }) => {
    // Nếu đang có cuộc gọi khác -> Bận
    if (currentCallerId || currentRecipientId) {
      window.socket.emit("callReject", { callerId: senderId, reason: "BUSY" });
      return;
    }

    // HIỆN MODAL CUỘC GỌI ĐẾN
    currentCallerId = senderId;
    incomingName.textContent = senderName || "Người dùng Nexus";
    incomingAvatar.src = senderAvatar || "https://ui-avatars.com/api/?name=User";
    incomingModal.classList.remove("hidden");
    playRingtone();

    // Xử lý nút Chấp nhận
    btnAccept.onclick = async () => {
        stopRingtone();
        incomingModal.classList.add("hidden");
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
            localVideo.srcObject = localStream;
            callWindow.classList.remove("hidden");

            peerConnection = createPeerConnection(localStream);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            window.socket.emit("callAnswer", {
                recipientId: senderId,
                answer: peerConnection.localDescription
            });
        } catch (e) {
            alert("Lỗi kết nối: " + e.message);
            hangUp();
        }
    };

    // Xử lý nút Từ chối
    btnReject.onclick = () => {
        stopRingtone();
        incomingModal.classList.add("hidden");
        window.socket.emit("callReject", { callerId: senderId, reason: "REJECT" });
        currentCallerId = null;
        
        // Thêm tin nhắn thông báo (Local only)
        if(window.appendMessage) {
            window.appendMessage({
                senderId: 0, // System
                content: JSON.stringify({type:'text', text: `📞 Bạn đã từ chối cuộc gọi từ ${senderName}`}),
                createdAt: new Date()
            });
        }
    };
  });

  // --- XỬ LÝ CÁC SỰ KIỆN KHÁC ---
  window.socket.on("callAnswer", async ({ answer }) => {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  window.socket.on("receiveICE", async ({ candidate }) => {
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  window.socket.on("callEnd", () => {
    alert("Cuộc gọi đã kết thúc.");
    hangUp();
  });

  window.socket.on("callReject", ({ reason }) => {
    stopRingtone(); // Dừng nhạc nếu đang đợi
    alert(reason === "BUSY" ? "Người dùng đang bận." : "Người dùng đã từ chối cuộc gọi.");
    hangUp();
  });
  
  // Sự kiện khi đối phương Offline
  window.socket.on("userOffline", () => {
      alert("Người dùng hiện không trực tuyến. Đã gửi thông báo cuộc gọi nhỡ.");
      hangUp();
  });

  // --- KẾT THÚC CUỘC GỌI ---
  const hangUp = () => {
    stopRingtone();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peerConnection) peerConnection.close();
    
    peerConnection = null;
    localStream = null;
    
    callWindow.classList.add("hidden");
    incomingModal.classList.add("hidden");

    // Gửi tín hiệu kết thúc cho đối phương
    const targetId = currentRecipientId || currentCallerId;
    if (targetId) {
      window.socket.emit("callEnd", { recipientId: targetId });
    }
    
    currentRecipientId = null;
    currentCallerId = null;
  };

  // --- DOM EVENTS ---
  callButton.addEventListener("click", () => startCall(false));
  videoCallButton.addEventListener("click", () => startCall(true));
  endCallButton.addEventListener("click", () => hangUp());

  toggleMic.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      toggleMic.style.background = track.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
    }
  });

  toggleCam.addEventListener("click", () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      toggleCam.style.background = track.enabled ? "rgba(255,255,255,0.2)" : "#ef4444";
    }
  });
  
  // Context check: Ẩn nút gọi khi chat với AI
  window.addEventListener("contextChanged", () => {
    const canCall = window.currentChatContext.type === "user" && window.currentChatContext.id !== 0;
    callButton.style.display = canCall ? "inline-block" : "none";
    videoCallButton.style.display = canCall ? "inline-block" : "none";
  });
});
