// ===== AI FRIEND RECOMMENDATIONS CLIENT =====
// File này cần được import trong ứng dụng React/Vue/HTML của bạn

const API_BASE = '/api';
const token = localStorage.getItem('token');

// ===== 1. GỌI API GỢI Ý BẠN BÈ TỪ AI =====
async function getAIRecommendations(criteria = '') {
  try {
    const response = await fetch(`${API_BASE}/ai/recommend-friends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ criteria })
    });
    
    if (!response.ok) throw new Error('Failed to fetch recommendations');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Lỗi gợi ý:', error);
    return { recommendations: [], reasons: [] };
  }
}

// ===== 2. HIỂN THỊ GỢI Ý BẠN BÈ TRONG UI =====
function displayRecommendations(recommendations, reasons) {
  const container = document.getElementById('ai-recommendations');
  
  if (!container) {
    console.warn('Không tìm thấy container #ai-recommendations');
    return;
  }

  if (recommendations.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-500">Không có gợi ý nào lúc này.</p>';
    return;
  }

  container.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">';
  
  recommendations.forEach((user, index) => {
    const reason = reasons[index]?.reason || 'Bạn có thể là bạn tốt';
    const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
    
    const userCard = `
      <div class="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow">
        <img src="${user.avatar || 'https://ui-avatars.com/api/?name=' + user.username}" 
             alt="${user.nickname}" 
             class="w-full h-40 object-cover rounded-lg mb-3">
        <h3 class="font-bold text-lg">${user.nickname || user.username}</h3>
        <p class="text-gray-600 text-sm">@${user.username}</p>
        <p class="text-gray-700 text-sm mt-2">${reasonText}</p>
        <button class="mt-3 w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition"
                onclick="addFriend(${user.id})">
          ➕ Kết bạn
        </button>
      </div>
    `;
    
    container.innerHTML += userCard;
  });
  
  container.innerHTML += '</div>';
}

// ===== 3. GỌI GỢI Ý THEO TIÊU CHÍ =====
async function searchFriendsWithAI() {
  const criteria = document.getElementById('ai-search-criteria')?.value || '';
  
  console.log('🤖 Đang tìm kiếm với tiêu chí:', criteria);
  const data = await getAIRecommendations(criteria);
  displayRecommendations(data.recommendations, data.reasons);
}

// ===== 4. THÊM BẠN =====
async function addFriend(friendId) {
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
      location.reload();
    } else {
      alert('❌ Không thể gửi lời mời kết bạn');
    }
  } catch (error) {
    console.error('Lỗi:', error);
    alert('❌ Có lỗi xảy ra');
  }
}

// ===== 5. TƯƠNG TÁC VỚI AI CHATBOT TIẾNG VIỆT =====
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
        if (e.key === 'Enter') this.sendMessage();
      };
    }
    
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('newMessage', (msg) => this.displayMessage(msg));
  }

  sendMessage() {
    const content = this.inputField?.value.trim();
    if (!content) return;

    // Hiển thị tin nhắn người dùng
    this.displayMessage({
      senderId: 'user',
      content: content,
      createdAt: new Date(),
      senderName: 'Bạn'
    });

    // Gửi đến AI bot (ID = 1)
    this.socket.emit('privateMessage', {
      recipientId: 1,
      content: content,
      ttl: null
    });

    if (this.inputField) this.inputField.value = '';
  }

  displayMessage(msg) {
    if (!this.chatContainer) return;

    const isAI = msg.senderId === 1 || msg.senderId === 'AI';
    const isUser = msg.senderId !== 1 && msg.senderId !== 'AI';

    const messageDiv = document.createElement('div');
    messageDiv.className = `mb-4 ${isUser ? 'text-right' : 'text-left'}`;

    const msgContent = document.createElement('div');
    msgContent.className = `inline-block max-w-xs px-4 py-2 rounded-lg ${
      isUser ? 'bg-blue-500 text-white' : 'bg-gray-300 text-black'
    }`;
    msgContent.textContent = msg.content;

    messageDiv.appendChild(msgContent);
    this.chatContainer.appendChild(messageDiv);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
}

// ===== 6. KHỞI TẠO KHI TRANG TẢI =====
document.addEventListener('DOMContentLoaded', () => {
  // Tự động tải gợi ý khi trang load
  const recommendBtn = document.getElementById('btn-get-recommendations');
  if (recommendBtn) {
    recommendBtn.onclick = searchFriendsWithAI;
  }

  // Khởi tạo AI Chat nếu có Socket.IO
  if (typeof io !== 'undefined') {
    const token = localStorage.getItem('token');
    const socket = io({
      auth: { token: token }
    });
    
    window.aiChat = new AIChat(socket);
  }
});

// ===== 7. HỎI AI VỀ GỢI Ý (SỬ DỤNG SOCKET) =====
function askAIForRecommendation() {
  const location = document.getElementById('location-filter')?.value || '';
  const interest = document.getElementById('interest-filter')?.value || '';
  
  const question = `Gợi ý cho tôi những người bạn mới từ ${location || 'bất kỳ nơi đâu'} 
                   có cùng sở thích ${interest || 'như tôi'}`;
  
  if (window.aiChat) {
    window.aiChat.inputField.value = question;
    window.aiChat.sendMessage();
  }
}

// ===== 8. TÌM KIẾM VỚI ĐỘ CHÍNH XÁC CAO =====
async function advancedFriendSearch() {
  const searchParams = {
    location: document.getElementById('location-filter')?.value || '',
    work: document.getElementById('work-filter')?.value || '',
    interests: document.getElementById('interests-filter')?.value || '',
    language: 'tiếng Việt'
  };

  const criteria = `Tìm bạn ở ${searchParams.location || 'mọi nơi'}, 
                   công việc ${searchParams.work || 'bất kỳ'}, 
                   sở thích ${searchParams.interests || 'tương đồng'}`;

  console.log('🔍 Tìm kiếm nâng cao:', searchParams);
  const data = await getAIRecommendations(criteria);
  displayRecommendations(data.recommendations, data.reasons);
}

// ===== 9. PHÂN TÍCH HÀNH VI NGƯỜI DÙNG =====
async function logUserInteraction(userId, type) {
  try {
    await fetch(`${API_BASE}/user/log-interaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        interactedUserId: userId,
        interactionType: type
      })
    });
  } catch (error) {
    console.error('Lỗi ghi log:', error);
  }
}

// ===== 10. EXPORT CÁC HÀM =====
export {
  getAIRecommendations,
  displayRecommendations,
  searchFriendsWithAI,
  addFriend,
  AIChat,
  askAIForRecommendation,
  advancedFriendSearch,
  logUserInteraction
};
