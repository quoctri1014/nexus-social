document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "/index.html";
        return;
    }

    let currentUser = {};

    // Helper: Tạo avatar placeholder nếu thiếu ảnh
    function getAvatar(user) {
        if (user && user.avatar) return user.avatar;
        const name = user && (user.nickname || user.username) ? (user.nickname || user.username) : "User";
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=fff&size=128`;
    }

    // Helper: Format thời gian
    function timeAgo(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('vi-VN'); 
        // Bạn có thể thay bằng thư viện moment.js hoặc hàm tính "x phút trước" nếu muốn
    }

    // 1. TẢI THÔNG TIN USER
    async function loadMyProfile() {
        try {
            const res = await fetch("/api/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Lỗi tải profile");
            currentUser = await res.json();

            // Cập nhật UI
            const avatarUrl = getAvatar(currentUser);
            const displayName = currentUser.nickname || currentUser.username;

            const avatarEls = document.querySelectorAll("#nav-avatar, #sidebar-avatar, #story-my-avatar, #cp-avatar, #comment-my-avatar, #edit-avatar-preview");
            avatarEls.forEach(img => img.src = avatarUrl);

            if(document.getElementById("nav-username")) document.getElementById("nav-username").textContent = displayName;
            if(document.getElementById("sidebar-name")) document.getElementById("sidebar-name").textContent = displayName;
            if(document.getElementById("sidebar-bio")) document.getElementById("sidebar-bio").textContent = currentUser.bio || "Chưa có tiểu sử";
            
        } catch (error) {
            console.error(error);
            // window.location.href = "/index.html"; // Uncomment nếu muốn force logout khi lỗi
        }
    }

    // 2. TẢI BÀI VIẾT
    async function loadPosts() {
        try {
            const res = await fetch("/api/posts", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Lỗi tải bài viết");
            const posts = await res.json();
            renderFeed(posts);
        } catch (error) {
            console.error(error);
        }
    }

    // Render danh sách bài viết ra HTML
    const feedContainer = document.getElementById("feed-container");
    function renderFeed(posts) {
        feedContainer.innerHTML = "";
        posts.forEach(post => {
            feedContainer.insertAdjacentHTML("beforeend", createPostHTML(post));
        });
    }

    // Mapping icon cảm xúc
    const reactionMap = {
        like:  { icon: '👍', text: 'Thích',  class: 'liked' },
        love:  { icon: '❤️', text: 'Yêu thích', class: 'loved' },
        haha:  { icon: '😆', text: 'Haha',   class: 'haha' },
        wow:   { icon: '😮', text: 'Wow',    class: 'wow' },
        sad:   { icon: '😢', text: 'Buồn',   class: 'sad' },
        angry: { icon: '😡', text: 'Phẫn nộ', class: 'angry' },
        default: { icon: '<i class="far fa-thumbs-up"></i>', text: 'Thích', class: '' }
    };

    function createPostHTML(post) {
        const authorName = post.author ? (post.author.nickname || post.author.username) : "Người dùng";
        const authorAvatar = getAvatar(post.author);
        
        // Tính tổng reaction
        // Giả sử API trả về reactions là object { like: 10, love: 5 ... }
        let totalReactions = 0;
        if (post.reactions) {
            totalReactions = Object.values(post.reactions).reduce((a, b) => a + b, 0);
        }
        // Hoặc nếu API trả về con số trực tiếp thì dùng post.reactionCount
        
        const totalComments = post.comments ? post.comments.length : 0;

        // Trạng thái nút Like của User hiện tại
        let btnIcon = reactionMap.default.icon;
        let btnText = reactionMap.default.text;
        let btnClass = reactionMap.default.class;

        if (post.userReaction && reactionMap[post.userReaction]) {
            const r = reactionMap[post.userReaction];
            btnIcon = r.icon;
            btnText = r.text;
            btnClass = r.class;
        }

        // Tạo chuỗi HTML cho phần hình ảnh (nếu có)
        let mediaHtml = "";
        if (post.image) {
            mediaHtml = `<img src="${post.image}" class="post-image" loading="lazy">`;
        }

        return `
        <div class="post-card" id="post-${post.id}">
            <div class="post-header">
                <img src="${authorAvatar}" alt="${authorName}">
                <div class="post-info">
                    <h3>${authorName}</h3>
                    <span>${timeAgo(post.createdAt)}</span>
                </div>
            </div>
            <div class="post-content">${post.content || ""}</div>
            ${mediaHtml}
            
            <div class="post-stats">
                <div class="reaction-icons-display">
                    ${totalReactions > 0 ? `<span>👍❤️ ${totalReactions}</span>` : '<span></span>'}
                </div>
                <div class="stat-text" onclick="openCommentModal('${post.id}')">
                    ${totalComments} bình luận
                </div>
            </div>

            <div class="post-actions">
                <div class="reaction-wrapper">
                    <div class="reaction-popup-box">
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'like')">👍</div>
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'love')">❤️</div>
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'haha')">😆</div>
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'wow')">😮</div>
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'sad')">😢</div>
                        <div class="reaction-icon" onclick="sendReaction('${post.id}', 'angry')">😡</div>
                    </div>
                    <button class="action-btn" onclick="toggleLike('${post.id}', '${post.userReaction}')">
                        <span class="action-icon">${btnIcon}</span>
                        <span class="action-text ${btnClass}">${btnText}</span>
                    </button>
                </div>
                <button class="action-btn" onclick="openCommentModal('${post.id}')">
                    <i class="far fa-comment-alt"></i><span>Bình luận</span>
                </button>
                <button class="action-btn"><i class="fas fa-share"></i><span>Chia sẻ</span></button>
            </div>
        </div>
        `;
    }

    // 3. XỬ LÝ REACTION (Gửi API)
    window.sendReaction = async (postId, type) => {
        try {
            const res = await fetch("/api/posts/react", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}` 
                },
                body: JSON.stringify({ postId, type })
            });

            if (res.ok) {
                // Cách tốt nhất: Load lại post đó để cập nhật số liệu chính xác từ server
                // Hoặc update UI tạm thời (optimistic update)
                loadPosts(); 
            }
        } catch (e) {
            console.error("Lỗi gửi reaction", e);
        }
    };

    // Click nút Like chính (Toggle)
    window.toggleLike = (postId, currentReaction) => {
        // Nếu đã có reaction rồi thì hủy (hoặc set về null), nếu chưa thì set 'like'
        // Logic này phụ thuộc vào API của bạn xử lý toggle hay không.
        // Ở đây giả sử gửi type = null hoặc 'unlike' để hủy, hoặc gửi 'like' nếu chưa có.
        const newType = (currentReaction && currentReaction !== 'null' && currentReaction !== 'undefined') ? 'unlike' : 'like'; 
        // Lưu ý: Backend cần xử lý 'unlike' hoặc nếu gửi cùng loại reaction thì xóa.
        
        // Để đơn giản, ta gọi sendReaction với 'like' nếu chưa có, hoặc logic riêng để xóa.
        // Ở đây tôi gọi 'like' mặc định. Bạn cần điều chỉnh theo API backend.
        sendReaction(postId, 'like'); 
    };

    // 4. XỬ LÝ COMMENT MODAL
    const commentModal = document.getElementById("comment-modal");
    const closeCommentBtn = document.getElementById("close-comment-modal-x");
    const commentsListEl = document.getElementById("comments-list");
    const commentInput = document.getElementById("comment-input");
    const sendCommentBtn = document.getElementById("send-comment-btn");
    
    let currentPostId = null;

    window.openCommentModal = async (postId) => {
        currentPostId = postId;
        commentModal.classList.remove("hidden");
        commentsListEl.innerHTML = '<div class="center">Đang tải bình luận...</div>';
        
        // Gọi API lấy chi tiết bài viết (hoặc chỉ comment) để có danh sách comment mới nhất
        try {
            // Giả sử API lấy chi tiết post trả về cả comments
            // Hoặc API riêng: /api/posts/:id/comments
            const res = await fetch(`/api/posts/${postId}`, { // Điều chỉnh endpoint này
                headers: { Authorization: `Bearer ${token}` }
            });
            if(res.ok) {
                const postData = await res.json();
                const postAuthor = postData.author ? (postData.author.nickname || postData.author.username) : "";
                document.getElementById("modal-post-author").textContent = postAuthor;
                renderComments(postData.comments || []);
            }
        } catch(e) {
            commentsListEl.innerHTML = '<div class="center">Lỗi tải bình luận.</div>';
        }
    };

    function renderComments(comments) {
        if (!comments || comments.length === 0) {
            commentsListEl.innerHTML = ""; // CSS empty state sẽ hiện
            return;
        }
        
        commentsListEl.innerHTML = comments.map(c => {
            const user = c.user || {}; // c.user object populated
            const name = user.nickname || user.username || "Người dùng";
            const ava = getAvatar(user);
            return `
            <div class="comment-item">
                <img src="${ava}" alt="${name}">
                <div class="comment-content-wrapper">
                    <div class="comment-content">
                        <a href="#" class="comment-author">${name}</a>
                        <p class="comment-text">${c.content}</p>
                    </div>
                    <div class="comment-footer">
                        <span>${timeAgo(c.createdAt)}</span>
                        <button>Thích</button>
                        <button>Phản hồi</button>
                        ${(currentUser.id === user.id) ? `<button class="delete-comment-btn" onclick="deleteComment('${c._id}')">Xóa</button>` : ''}
                    </div>
                </div>
            </div>
            `;
        }).join('');
        commentsListEl.scrollTop = commentsListEl.scrollHeight;
    }

    closeCommentBtn.addEventListener("click", () => {
        commentModal.classList.add("hidden");
        currentPostId = null;
    });

    // Gửi comment
    commentInput.addEventListener("input", () => {
        sendCommentBtn.disabled = commentInput.value.trim() === "";
    });

    sendCommentBtn.addEventListener("click", async () => {
        const content = commentInput.value.trim();
        if (!content || !currentPostId) return;

        try {
            sendCommentBtn.disabled = true;
            const res = await fetch("/api/posts/comment", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}` 
                },
                body: JSON.stringify({ postId: currentPostId, content: content })
            });

            if (res.ok) {
                commentInput.value = "";
                // Reload comment của bài viết hiện tại
                openCommentModal(currentPostId); 
                // Đồng thời reload feed để cập nhật số lượng comment bên ngoài
                loadPosts();
            } else {
                alert("Gửi bình luận thất bại");
            }
        } catch (e) {
            console.error(e);
        } finally {
            sendCommentBtn.disabled = false;
        }
    });

    // 5. ĐĂNG BÀI VIẾT MỚI
    const postBtn = document.getElementById("post-btn");
    const postContentInput = document.getElementById("post-content-input");
    const postImageInput = document.getElementById("post-image-input");
    
    postBtn.addEventListener("click", async () => {
        const content = postContentInput.value.trim();
        const file = postImageInput.files[0];

        if (!content && !file) return;

        postBtn.textContent = "Đang đăng...";
        postBtn.disabled = true;

        try {
            // Upload ảnh trước nếu có (Logic này tùy backend của bạn)
            let imageUrl = "";
            if (file) {
                const fd = new FormData();
                fd.append("files", file);
                const upRes = await fetch("/api/upload", { // Endpoint upload
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: fd
                });
                const data = await upRes.json();
                imageUrl = data[0]?.url || ""; 
            }

            // Tạo post
            const res = await fetch("/api/posts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ content, image: imageUrl })
            });

            if (res.ok) {
                postContentInput.value = "";
                postImageInput.value = "";
                document.getElementById("post-preview-area").classList.add("hidden");
                loadPosts(); // Reload lại feed
            }
        } catch (e) {
            alert("Lỗi đăng bài");
        } finally {
            postBtn.textContent = "Đăng";
            postBtn.disabled = false;
        }
    });
    
    // Preview ảnh khi chọn file
    postImageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            document.getElementById("post-preview-img").src = url;
            document.getElementById("post-preview-area").classList.remove("hidden");
        }
    });
    document.getElementById("remove-preview").addEventListener("click", () => {
        postImageInput.value = "";
        document.getElementById("post-preview-area").classList.add("hidden");
    });

    // INIT
    await loadMyProfile();
    await loadPosts();
    
    // Auto refresh feed every 30s (optional)
    setInterval(loadPosts, 30000);
});

function logout() {
    localStorage.removeItem("token");
    window.location.href = "/index.html";
}
