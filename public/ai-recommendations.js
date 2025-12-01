// ===== AI FRIEND RECOMMENDATIONS CLIENT =====
// File: ai-recommendations.js
// Đặt trong thư mục public/ cùng cấp với ai-recommendations.html

const API_BASE = '/api';
const AI_BOT_ID = 1;

// ===== 1. GỌI API GỢI Ý BẠN BÈ TỪ AI =====
async function getAIRecommendations(criteria = '') {
  const token = localStorage.getItem('token');
  
  if (!token) {
    alert('⚠️ Bạn cần đăng nhập để sử dụng tính năng này!');
    window.location.href = '/login.html';
    return { recommendations: [], reasons: [] };
  }

  try {
    const response = await fetch(`${API_BASE}/ai/recommend-friends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ criteria })
    });
    
    if (response.status === 401 || response.status === 403) {
      alert('⚠️ Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại!');
      window.location.href = '/login.html';
      return { recommendations: [], reasons: [] };
    }
    
    if (!response.ok) {
      throw new Error('Failed to fetch recommendations');
    }
    
    const data = await response.json();
    console.log('✅ Nhận được gợi ý từ AI:', data);
    return data;
  } catch (error) {
    console.error('❌ Lỗi gợi ý:', error);
    alert('❌ Không thể lấy gợi ý từ AI. Vui lòng thử lại!');
    return { recommendations: [], reasons: [] };
  }
}

// ===== 2. HIỂN THỊ GỢI Ý BẠN BÈ TRONG UI =====
function displayRecommendations(recommendations, reasons) {
  const container = document.getElementById('ai-recommendations');
  
  if (!container) {
    console.warn('⚠️ Không tìm thấy container #ai-recommendations');
    return;
  }

  // Xóa nội dung cũ
  container.innerHTML = '';

  if (!recommendations || recommendations.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-12 text-gray-500">
        <i class="fas fa-user-friends text-4xl mb-4"></i>
        <p class="text-lg">Không tìm thấy gợi ý phù hợp</p>
        <p class="text-sm mt-2">Hãy thử với tiêu chí khác hoặc để trống để nhận gợi ý chung</p>
      </div>
    `;
    return;
  }

  recommendations.forEach((user, index) => {
    const reason = reasons[index]?.reason || 'Có thể phù hợp với bạn';
    const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
    
    const userCard = document.createElement('div');
    userCard.className = 'bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow card-hover';
    
    userCard.innerHTML = `
      <img src="${user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`}" 
           alt="${user.nickname || user.username}" 
           class="w-full h-40 object-cover rounded-lg mb-3"
           onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random'">
      <h3 class="font-bold text-lg text-gray-800">${user.nickname || user.username}</h3>
      <p class="text-gray-600 text-sm">@${user.username}</p>
      <p class="text-gray-700 text-sm mt-2 mb-3">
        <i class="fas fa-lightbulb text-yellow-500 mr-1"></i>
        ${reasonText}
      </p>
      <button class="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition font-semibold"
              onclick="addFriend(${user.id})">
        <i class="fas fa-user-plus mr-2"></i>Kết bạn
      </button>
    `;
    
    container.appendChild(userCard);
  });

  console.log(`✅ Đã hiển thị ${recommendations.length} gợi ý`);
}

// ===== 3. GỌI GỢI Ý THEO TIÊU CHÍ =====
async function searchFriendsWithAI() {
  const criteria = document.getElementById('ai-search-criteria')?.value || '';
  const button = document.getElementById('btn-get-recommendations');
  
  // Show loading state
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Đang tìm kiếm...';
  }

  // Show loading in results
  const container = document.getElementById('ai-recommendations');
  if (container) {
    container.innerHTML = `
      <div class="col-span-full text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
        <p class="text-gray-600">AI đang phân tích và tìm kiếm người phù hợp...</p>
      </div>
    `;
  }

  console.log('🤖 Đang tìm kiếm với tiêu chí:', criteria || '(Gợi ý chung)');
  
  const data = await getAIRecommendations(criteria);
  displayRecommendations(data.recommendations, data.reasons);

  // Reset button
  if (button) {
    button.disabled = false;
    button.innerHTML = '🚀 Tìm Gợi Ý';
  }
}

// ===== 4. THÊM BẠN =====
async function addFriend(friendId) {
  const token = localStorage.getItem('token');
  
  if (!token) {
    alert('⚠️ Bạn cần đăng nhập để kết bạn!');
    window.location.href = '/login.html';
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ receiverId: friendId })
    });
    
    if (response.ok) {
      alert('✅ Đã gửi lời mời kết bạn!');
    } else if (response.status === 500) {
      alert('⚠️ Bạn đã gửi lời mời cho người này rồi!');
    } else {
      alert('❌ Không thể gửi lời mời kết bạn');
    }
  } catch (error) {
    console.error('❌ Lỗi:', error);
    alert('❌ Có lỗi xảy ra khi gửi lời mời kết bạn');
  }
}

// ===== 5. TƯƠNG TÁC VỚI AI CHATBOT =====
class AIChat {
  constructor(socketIO) {
    this.socket = socketIO;
    this.chatContainer = document.getElementById('ai-chat-messages');
    this.inputField = document.getElementById('ai-chat-input');
    this.sendButton = document.getElementById('ai-chat-send');
    
    if (this.sendButton) {
      this.sendButton.onclick = () => this.sendMessage();
    }
    
    if (this.inputField) {
      this.inputField.onkeypress = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.sendMessage();
        }
      };
    }
    
    this.setupSocketListeners();
    console.log('✅ AI Chat initialized');
  }

  setupSocketListeners() {
    // Xóa listener cũ để tránh duplicate
    this.socket.off('newMessage');
    
    this.socket.on('newMessage', (msg) => {
      console.log('📨 Received message:', msg);
      
      // Chỉ hiển thị tin nhắn từ AI, không hiển thị tin của chính mình
      if (msg.senderId === AI_BOT_ID || msg.senderId === 1) {
        this.displayMessage(msg);
      }
    });
  }

  sendMessage() {
    const content = this.inputField?.value.trim();
    if (!content) return;

    console.log('📤 Sending message to AI:', content);

    // Hiển thị tin nhắn người dùng ngay lập tức
    this.displayMessage({
      senderId: 'user',
      content: content,
      createdAt: new Date(),
      senderName: 'Bạn'
    });

    // Gửi đến AI bot
    this.socket.emit('privateMessage', {
      recipientId: AI_BOT_ID,
      content: content,
      ttl: null
    });

    if (this.inputField) this.inputField.value = '';
  }

  displayMessage(msg) {
    if (!this.chatContainer) return;

    const isAI = msg.senderId === AI_BOT_ID || msg.senderId === 1 || msg.senderId === 'AI';
    const isUser = !isAI;

    const messageDiv = document.createElement('div');
    messageDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;

    const msgContent = document.createElement('div');
    msgContent.className = `px-4 py-2 rounded-lg max-w-xs ${
      isUser 
        ? 'bg-blue-500 text-white' 
        : 'bg-gray-300 text-black'
    }`;
    
    msgContent.textContent = msg.content;

    messageDiv.appendChild(msgContent);
    this.chatContainer.appendChild(messageDiv);
    
    // Auto scroll to bottom
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
}

// ===== 6. HỎI AI VỀ GỢI Ý =====
function askAIForRecommendation() {
  const question = `Gợi ý cho tôi những người bạn mới phù hợp với tôi nhất`;
  
  if (window.aiChat && window.aiChat.inputField) {
    window.aiChat.inputField.value = question;
    window.aiChat.sendMessage();
  } else {
    console.warn('⚠️ AI Chat chưa được khởi tạo');
    alert('⚠️ Chức năng chat chưa sẵn sàng. Vui lòng thử lại sau!');
  }
}

// ===== 7. HỎI CÂU HỎI CHUNG =====
function askGeneralQuestion() {
  if (window.aiChat && window.aiChat.inputField) {
    window.aiChat.inputField.focus();
    alert('💬 Bạn có thể hỏi AI bất cứ điều gì! Ví dụ: "Làm sao để kết bạn nhiều hơn?"');
  } else {
    console.warn('⚠️ AI Chat chưa được khởi tạo');
  }
}

// ===== 8. TÌM KIẾM NÂNG CAO =====
async function advancedFriendSearch() {
  const location = document.getElementById('location-filter')?.value || '';
  const work = document.getElementById('work-filter')?.value || '';
  const interests = document.getElementById('interests-filter')?.value || '';

  const criteria = `Tìm bạn ở ${location || 'mọi nơi'}, công việc ${work || 'bất kỳ'}, sở thích ${interests || 'tương đồng'}`;

  console.log('🔍 Tìm kiếm nâng cao:', criteria);

  // Show loading in search results
  const searchResults = document.getElementById('search-results');
  if (searchResults) {
    searchResults.innerHTML = `
      <div class="col-span-full text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-green-500 mb-4"></i>
        <p class="text-gray-600">Đang tìm kiếm theo tiêu chí của bạn...</p>
      </div>
    `;
  }

  const data = await getAIRecommendations(criteria);
  
  if (searchResults) {
    searchResults.innerHTML = '';
    
    if (!data.recommendations || data.recommendations.length === 0) {
      searchResults.innerHTML = `
        <div class="col-span-full text-center py-8 text-gray-500">
          <i class="fas fa-search text-4xl mb-4"></i>
          <p class="text-lg">Không tìm thấy kết quả phù hợp</p>
          <p class="text-sm mt-2">Hãy thử điều chỉnh tiêu chí tìm kiếm</p>
        </div>
      `;
      return;
    }

    data.recommendations.forEach((user, index) => {
      const reason = data.reasons[index]?.reason || 'Phù hợp với tiêu chí tìm kiếm';
      
      const userCard = document.createElement('div');
      userCard.className = 'bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow card-hover';
      
      userCard.innerHTML = `
        <img src="${user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`}" 
             alt="${user.nickname || user.username}" 
             class="w-full h-40 object-cover rounded-lg mb-3"
             onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random'">
        <h3 class="font-bold text-lg text-gray-800">${user.nickname || user.username}</h3>
        <p class="text-gray-600 text-sm">@${user.username}</p>
        <p class="text-gray-700 text-sm mt-2 mb-3">
          <i class="fas fa-check-circle text-green-500 mr-1"></i>
          ${reason}
        </p>
        <button class="w-full bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 transition font-semibold"
                onclick="addFriend(${user.id})">
          <i class="fas fa-user-plus mr-2"></i>Kết bạn
        </button>
      `;
      
      searchResults.appendChild(userCard);
    });

    console.log(`✅ Đã hiển thị ${data.recommendations.length} kết quả tìm kiếm`);
  }
}

// ===== 9. KHỞI TẠO KHI TRANG TẢI =====
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Initializing AI Recommendations...');

  // Kiểm tra token
  const token = localStorage.getItem('token');
  if (!token) {
    console.warn('⚠️ No token found');
    // Không redirect ngay, cho phép người dùng xem UI
  }

  // Gắn sự kiện cho nút tìm kiếm
  const recommendBtn = document.getElementById('btn-get-recommendations');
  if (recommendBtn) {
    recommendBtn.onclick = searchFriendsWithAI;
  }

  // Cho phép Enter trong ô tìm kiếm
  const searchInput = document.getElementById('ai-search-criteria');
  if (searchInput) {
    searchInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        searchFriendsWithAI();
      }
    };
  }

  // Khởi tạo AI Chat nếu có Socket.IO
  if (typeof io !== 'undefined' && token) {
    try {
      const socket = io({
        auth: { token: token }
      });
      
      socket.on('connect', () => {
        console.log('✅ Socket connected');
        window.aiChat = new AIChat(socket);
      });

      socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
      });
    } catch (error) {
      console.error('❌ Error initializing Socket.IO:', error);
    }
  } else if (!token) {
    console.warn('⚠️ No token - Socket.IO not initialized');
  } else {
    console.warn('⚠️ Socket.IO not loaded');
  }

  console.log('✅ AI Recommendations initialized');
});
