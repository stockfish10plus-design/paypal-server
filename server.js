const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken"); 
require("dotenv").config();

// 🔥 ДОБАВЛЕНО: Подключаем Firebase
const { db } = require('./firebase-config');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Админские креды и JWT ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "avesatana";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// 🔥 ИСПРАВЛЕНО: Используем TELEGRAM_CHAT_ID вместо ADMIN_CHAT_ID
const PAYPAL_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_API_PAYPAL = `https://api.telegram.org/bot${PAYPAL_BOT_TOKEN}`;
const TELEGRAM_API_SUPPORT = `https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}`;

app.use(bodyParser.json());
app.use(cors());

// 🔥 ПЕРЕДЕЛАНО: Хранилище для диалогов
let userDialogs = new Map();

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

app.get("/api/check-support-config", (req, res) => {
  const config = {
    SUPPORT_BOT_TOKEN: SUPPORT_BOT_TOKEN ? `✅ SET` : '❌ NOT SET',
    TELEGRAM_CHAT_ID: TELEGRAM_CHAT_ID ? `✅ SET` : '❌ NOT SET',
    userDialogsSize: userDialogs.size
  };
  res.json(config);
});

app.get("/api/test-support-bot-message", async (req, res) => {
  try {
    if (!SUPPORT_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.json({ success: false, error: "Tokens not set" });
    }

    const testMessage = {
      chat_id: TELEGRAM_CHAT_ID,
      text: '🧪 Test message from Support Bot',
    };

    const response = await axios.post(
      `https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`,
      testMessage
    );

    res.json({ success: true, message: 'Test message sent!' });
  } catch (error) {
    res.json({ success: false, error: error.response?.data || error.message });
  }
});

// ==================== ПЕРЕДЕЛАННЫЙ ВЕБХУК ПОДДЕРЖКИ ====================

app.post("/webhook-support", async (req, res) => {
  console.log('💬 SUPPORT BOT WEBHOOK CALLED');
  
  const update = req.body;
  res.send('OK');

  if (!SUPPORT_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ Tokens not configured!');
    return;
  }

  // Обработка сообщений от пользователей
  if (update.message && !update.message.reply_to_message) {
    const chatId = update.message.chat.id;
    const text = update.message.text || '(media message)';
    const userName = update.message.from.first_name + (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
    const userId = update.message.from.id;
    
    console.log(`💬 Message from ${userName} (${userId}): "${text}"`);
    
    try {
      // 🔥 ОБРАБОТКА КОМАНД
      if (text.startsWith('/')) {
        await handleSupportBotCommand(update.message);
        return;
      }

      // Новый пользователь
      if (!userDialogs.has(userId)) {
        const separatorMessage = await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
          chat_id: TELEGRAM_CHAT_ID,
          text: `───────────────\n💎 ДИАЛОГ С ${userName.toUpperCase()}\n🆔 ${userId}\n────────────────────`,
        });

        userDialogs.set(userId, {
          userChatId: chatId,
          userName: userName,
          started: new Date(),
          separatorMessageId: separatorMessage.data.result.message_id,
          lastUserMessageId: null
        });

        // 🔥 ПРИВЕТСТВЕННОЕ СООБЩЕНИЕ ТОЛЬКО ПРИ ПЕРВОМ КОНТАКТЕ
        await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
          chat_id: chatId,
          text: `👋 Добро пожаловать в поддержку! Просто напишите ваш вопрос, и мы ответим вам в ближайшее время.\n\n👋 Welcome to support! Just write your question and we will answer you as soon as possible.`
        });
      }

      const dialog = userDialogs.get(userId);
      
      // Отправляем сообщение пользователя
      const userMessage = await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: `<b>${userName}:</b> ${text}`,
        parse_mode: 'HTML',
        reply_to_message_id: dialog.separatorMessageId
      });

      dialog.lastUserMessageId = userMessage.data.result.message_id;
      userDialogs.set(userId, dialog);
      
      // 🔥 УБРАНО: Подтверждение получения сообщения
      
    } catch (error) {
      console.error('❌ Error:', error.response?.data || error.message);
    }
  }
  
  // 🔥 ОБРАБОТКА ОТВЕТОВ АДМИНА
  if (update.message && update.message.reply_to_message && update.message.chat.id.toString() === TELEGRAM_CHAT_ID.toString()) {
    const adminReplyText = update.message.text;
    const repliedMessageId = update.message.reply_to_message.message_id;
    
    // Ищем пользователя
    let targetUserId = null;
    let targetDialog = null;
    
    for (let [userId, dialog] of userDialogs.entries()) {
      if (dialog.lastUserMessageId === repliedMessageId || dialog.separatorMessageId === repliedMessageId) {
        targetUserId = userId;
        targetDialog = dialog;
        break;
      }
    }
    
    if (targetUserId && targetDialog && adminReplyText) {
      try {
        // 🔥 ПЕРЕДЕЛАНО: Отправляем только чистый ответ без заголовков
        await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
          chat_id: targetDialog.userChatId,
          text: adminReplyText // 🔥 ТОЛЬКО ТЕКСТ ОТВЕТА
        });

        // Отправляем ответ в диалог
        await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
          chat_id: TELEGRAM_CHAT_ID,
          text: `<b>Поддержка:</b> ${adminReplyText}`,
          parse_mode: 'HTML',
          reply_to_message_id: targetDialog.separatorMessageId
        });
        
      } catch (error) {
        console.error('❌ Error sending reply:', error.response?.data || error.message);
      }
    }
  }
});

// 🔥 ПЕРЕДЕЛАНО: Обработка команд для бота поддержки
async function handleSupportBotCommand(message) {
  const chatId = message.chat.id;
  const text = message.text;
  const userId = message.from.id;
  
  try {
    if (text === '/start') {
      // 🔥 ПРИВЕТСТВЕННОЕ СООБЩЕНИЕ ТОЛЬКО ПРИ КОМАНДЕ /start
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: `👋 Добро пожаловать в поддержку! Просто напишите ваш вопрос, и мы ответим вам в ближайшее время.\n\n👋 Welcome to support! Just write your question and we will answer you as soon as possible.`
      });
      
    } else if (text === '/help') {
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: `ℹ️ Помощь / Help

• Просто напишите ваш вопрос / Just write your question
• Поддержка ответит вам в этом чате / Support will answer you in this chat
• Для вопросов по оплате укажите ID транзакции / For payment issues include your transaction ID`
      });
    }
  } catch (error) {
    console.error('Error handling command:', error);
  }
}

// 🔥 ОБНОВЛЕННЫЙ корневой маршрут
app.get("/", (req, res) => {
  res.json({
    message: "PayPal Server is running!",
    features: {
      multiLanguage: "✅ Enabled (Russian/English)",
      supportBot: SUPPORT_BOT_TOKEN ? "✅ Configured" : "❌ Not configured",
      paypalBot: PAYPAL_BOT_TOKEN ? "✅ Configured" : "❌ Not configured"
    },
    endpoints: {
      adminPayments: "/admin/payments",
      adminReviews: "/admin/reviews", 
      localPayments: "/local/payments",
      webhook: "/webhook",
      webhookSupport: "/webhook-support"
    }
  });
});

// ========== ВОССТАНОВЛЕННЫЕ МАРШРУТЫ АДМИНКИ ==========

// 🔥 ВОССТАНОВЛЕНО: Админка для платежей
app.get("/admin/payments", authMiddleware, async (req, res) => {
  try {
    const paymentsRef = db.collection('payments');
    const snapshot = await paymentsRef.orderBy('timestamps.createdAt', 'desc').get();
    
    const payments = [];
    snapshot.forEach(doc => {
      payments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payments Admin</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
            .container { max-width: 1400px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #4CAF50; color: white; }
            .delivered { background-color: #d4edda; }
            .pending { background-color: #fff3cd; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat-card { background: #e3f2fd; padding: 15px; border-radius: 5px; flex: 1; text-align: center; }
            .logout { background: #dc3545; color: white; padding: 8px 15px; border: none; border-radius: 5px; cursor: pointer; }
            .deliver-btn { 
                background: #28a745; 
                color: white; 
                padding: 6px 12px; 
                border: none; 
                border-radius: 4px; 
                cursor: pointer; 
            }
            .nav { margin-bottom: 20px; }
            .nav a { 
                background: #6c757d; 
                color: white; 
                padding: 10px 15px; 
                text-decoration: none; 
                border-radius: 5px; 
                margin-right: 10px;
            }
            .nav a.active { background: #4CAF50; }
            .danger-zone { 
                margin-top: 30px; 
                padding: 20px; 
                background: #f8d7da; 
                border: 1px solid #f5c6cb; 
                border-radius: 8px; 
            }
            .danger-zone h3 { color: #721c24; margin-top: 0; }
            .clear-btn { 
                padding: 8px 15px; 
                border: none; 
                border-radius: 5px; 
                cursor: pointer; 
                font-weight: bold;
                margin-right: 10px;
                margin-bottom: 10px;
            }
            .clear-btn:hover { transform: scale(1.05); }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="nav">
                <a href="/admin/payments?token=${req.query.token}" class="active">💳 Payments</a>
                <a href="/admin/reviews?token=${req.query.token}">⭐ Reviews</a>
                <a href="/local/payments">📁 Local Backup</a>
            </div>
            
            <div class="header">
                <h1>💳 Payments Management</h1>
                <div>
                    <span style="margin-right: 15px;">Total: ${payments.length} payments</span>
                    <button class="logout" onclick="window.location.href='/admin/payments'">Logout</button>
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <h3>💰 Total Revenue</h3>
                    <p>$${payments.reduce((sum, payment) => sum + parseFloat(payment.amount.total), 0).toFixed(2)}</p>
                </div>
                <div class="stat-card">
                    <h3>✅ Delivered</h3>
                    <p>${payments.filter(p => p.delivery.delivered).length}</p>
                </div>
                <div class="stat-card">
                    <h3>📦 Pending</h3>
                    <p>${payments.filter(p => !p.delivery.delivered).length}</p>
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Transaction ID</th>
                        <th>Buyer</th>
                        <th>Amount</th>
                        <th>Items</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map(payment => {
                      const createdAt = payment.timestamps.createdAt;
                      let formattedDate = 'Invalid Date';
                      
                      if (createdAt && createdAt.toDate) {
                        const date = createdAt.toDate();
                        date.setHours(date.getHours() + 3);
                        formattedDate = date.toLocaleString('ru-RU');
                      }
                      
                      return `
                    <tr class="${payment.delivery.delivered ? 'delivered' : 'pending'}" id="row-${payment.id}">
                        <td><strong>${payment.transactionId}</strong></td>
                        <td>
                            <div><strong>${payment.buyer.nickname}</strong></div>
                            <small>${payment.buyer.email}</small>
                        </td>
                        <td>
                            <strong>$${payment.amount.total}</strong>
                        </td>
                        <td>
                            ${payment.items.map(item => `
                            <div>${item.name} x${item.quantity}</div>
                            `).join('')}
                        </td>
                        <td>${formattedDate}</td>
                        <td id="status-${payment.id}">
                            ${payment.delivery.delivered ? '✅ Delivered' : '🕐 Pending'}
                        </td>
                        <td>
                            ${!payment.delivery.delivered ? 
                              `<button class="deliver-btn" onclick="markAsDelivered('${payment.id}', '${payment.transactionId}')" id="btn-${payment.id}">
                                Mark Delivered
                              </button>` : 
                              '<span style="color: #28a745;">✅ Done</span>'
                            }
                        </td>
                    </tr>
                    `}).join('')}
                </tbody>
            </table>

            <!-- 🔥 ВОССТАНОВЛЕНО: Зона опасности с кнопками очистки -->
            <div class="danger-zone">
                <h3>⚠️ Danger Zone</h3>
                
                <div class="stats" style="margin-bottom: 15px;">
                    <div class="stat-card" style="background: #fff3cd;">
                        <h4>📊 Data Statistics</h4>
                        <p>Local: <span id="local-count">0</span> | Firebase: <span id="firebase-count">0</span> | Reviews: <span id="reviews-count">0</span></p>
                    </div>
                </div>

                <div>
                    <button class="clear-btn" onclick="clearData('local')" style="background: #ffc107; color: #000;">🗑️ Clear Local</button>
                    <button class="clear-btn" onclick="clearData('firebase')" style="background: #fd7e14; color: #000;">🔥 Clear Firebase</button>
                    <button class="clear-btn" onclick="clearData('all')" style="background: #dc3545; color: white;">💥 Clear All</button>
                    <button class="clear-btn" onclick="clearReviews()" style="background: #e83e8c; color: white;">⭐ Clear Reviews</button>
                </div>
                
                <p style="color: #856404; font-size: 12px; margin-top: 10px; margin-bottom: 0;">
                    ⚠️ This action cannot be undone!
                </p>
            </div>
        </div>

        <script>
            async function markAsDelivered(paymentId, transactionId) {
                const btn = document.getElementById('btn-' + paymentId);
                const statusCell = document.getElementById('status-' + paymentId);
                const row = document.getElementById('row-' + paymentId);
                
                btn.disabled = true;
                btn.textContent = 'Updating...';
                
                try {
                    const response = await fetch('/api/mark-delivered', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + getTokenFromUrl()
                        },
                        body: JSON.stringify({
                            transactionId: transactionId,
                            paymentId: paymentId
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        statusCell.innerHTML = '✅ Delivered';
                        row.className = 'delivered';
                        btn.outerHTML = '<span style="color: #28a745;">✅ Done</span>';
                        alert('Order marked as delivered!');
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    btn.disabled = false;
                    btn.textContent = 'Mark Delivered';
                    alert('Error: ' + error.message);
                }
            }
            
            function getTokenFromUrl() {
                const urlParams = new URLSearchParams(window.location.search);
                return urlParams.get('token');
            }

            // 🔥 ВОССТАНОВЛЕНО: Функции очистки данных
            async function loadStats() {
                try {
                    const response = await fetch('/api/stats', {
                        headers: { 'Authorization': 'Bearer ' + getTokenFromUrl() }
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        document.getElementById('local-count').textContent = result.stats.localPurchases;
                        document.getElementById('firebase-count').textContent = result.stats.firebasePurchases;
                        document.getElementById('reviews-count').textContent = result.stats.reviews;
                    }
                } catch (error) {
                    console.error('Error loading stats:', error);
                }
            }

            async function clearData(type) {
                const typeNames = {
                    'local': 'local purchases',
                    'firebase': 'Firebase data', 
                    'all': 'ALL data'
                };
                
                if (!confirm(\`ARE YOU SURE? This will delete \${typeNames[type]}. This action cannot be undone!\`)) {
                    return;
                }

                try {
                    const response = await fetch('/api/clear-purchases', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + getTokenFromUrl()
                        },
                        body: JSON.stringify({ type })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        alert('✅ ' + result.messages.join(', '));
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    alert('❌ Error: ' + error.message);
                }
            }

            async function clearReviews() {
                if (!confirm('ARE YOU SURE? This will delete ALL reviews. This action cannot be undone!')) {
                    return;
                }

                try {
                    const response = await fetch('/api/clear-reviews', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + getTokenFromUrl()
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        alert('✅ ' + result.message);
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    alert('❌ Error: ' + error.message);
                }
            }

            // Загружаем статистику при старте
            loadStats();
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error loading payments' });
  }
});

// 🔥 ВОССТАНОВЛЕНО: Админка для отзывов
app.get("/admin/reviews", authMiddleware, async (req, res) => {
  try {
    const result = await getReviewsFromFirestore();
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    const reviewsWithId = result.reviews.map(review => ({
      id: review.id,
      name: review.name,
      review: review.review,
      date: review.createdAt,
      transactionId: review.transactionId
    }));
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Reviews Management</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
            .container { max-width: 1000px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #0070ba; color: white; }
            .delete-btn { 
                background: #dc3545; 
                color: white; 
                padding: 6px 12px; 
                border: none; 
                border-radius: 4px; 
                cursor: pointer; 
            }
            .nav { margin-bottom: 20px; }
            .nav a { 
                background: #6c757d; 
                color: white; 
                padding: 10px 15px; 
                text-decoration: none; 
                border-radius: 5px; 
                margin-right: 10px;
            }
            .nav a.active { background: #0070ba; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="nav">
                <a href="/admin/payments?token=${req.query.token}">💳 Payments</a>
                <a href="/admin/reviews?token=${req.query.token}" class="active">⭐ Reviews</a>
            </div>
            
            <h1>⭐ Reviews Management</h1>
            <p>Total reviews: ${reviewsWithId.length}</p>
            
            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Review</th>
                        <th>Date</th>
                        <th>Transaction ID</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${reviewsWithId.map(review => {
                      let date;
                      if (review.date && review.date.toDate) {
                        date = review.date.toDate();
                      } else if (review.date) {
                        date = new Date(review.date);
                      } else {
                        date = new Date();
                      }
                      const formattedDate = date.toLocaleString('ru-RU');
                      
                      return `
                    <tr id="review-${review.id}">
                        <td><strong>${review.name}</strong></td>
                        <td>${review.review}</td>
                        <td>${formattedDate}</td>
                        <td><small>${review.transactionId}</small></td>
                        <td>
                            <button class="delete-btn" onclick="deleteReview('${review.id}')">
                                Delete
                            </button>
                        </td>
                    </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>

        <script>
            async function deleteReview(reviewId) {
                if (!confirm('Are you sure you want to delete this review?')) {
                    return;
                }
                
                try {
                    const response = await fetch('/api/reviews/' + reviewId, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': 'Bearer ' + getTokenFromUrl()
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        document.getElementById('review-' + reviewId).remove();
                        alert('Review deleted successfully!');
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
            
            function getTokenFromUrl() {
                const urlParams = new URLSearchParams(window.location.search);
                return urlParams.get('token');
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error loading reviews' });
  }
});

// --- Файлы для заказов ---
const purchasesFile = path.join(__dirname, "purchases.json");
if (!fs.existsSync(purchasesFile)) fs.writeFileSync(purchasesFile, "[]", "utf-8");

// 🔥 ИСПРАВЛЕННАЯ ФУНКЦИЯ: Для сохранения покупки в локальный файл
function savePaymentToLocal(paymentData) {
  try {
    const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
    const existingIndex = purchases.findIndex(p => p.transactionId === paymentData.transactionId);
    
    if (existingIndex !== -1) {
      // Обновляем существующую запись
      purchases[existingIndex] = {
        ...purchases[existingIndex],
        ...paymentData,
        timestamps: {
          ...purchases[existingIndex].timestamps,
          updatedAt: new Date()
        }
      };
    } else {
      // 🔥 ИСПРАВЛЕНО: Правильно обрабатываем items с количеством
      const processedItems = (paymentData.items || []).map(item => ({
        name: item.name,
        // 🔥 ВАЖНО: Используем quantity если есть, иначе используем qty
        quantity: item.quantity || item.qty || 1,
        price: item.price,
        subtotal: (item.price * (item.quantity || item.qty || 1)).toFixed(2)
      }));

      // Добавляем новую запись с ВСЕМИ данными
      const localPaymentData = {
        transactionId: paymentData.transactionId,
        paymentId: paymentData.paymentId,
        status: paymentData.status || 'completed',
        buyer: {
          nickname: paymentData.buyer?.nickname || paymentData.nickname,
          email: paymentData.buyer?.email || paymentData.payerEmail || 'unknown@email.com'
        },
        amount: {
          total: paymentData.amount?.total || paymentData.amount,
          currency: paymentData.amount?.currency || 'USD',
          items: paymentData.amount?.items || processedItems.reduce((sum, item) => sum + parseFloat(item.subtotal), 0)
        },
        // 🔥 ВАЖНО: Сохраняем items с правильным количеством
        items: processedItems,
        timestamps: {
          createdAt: paymentData.timestamps?.createdAt || new Date(),
          updatedAt: new Date()
        },
        delivery: {
          delivered: paymentData.delivery?.delivered || false,
          deliveredAt: paymentData.delivery?.deliveredAt || null
        },
        reviewLeft: paymentData.reviewLeft || false,
        reviewName: paymentData.reviewName || null,
        gameType: paymentData.gameType || 'unknown',
        firebaseId: paymentData.firebaseId || null
      };
      purchases.push(localPaymentData);
    }
    
    fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));
    console.log('✅ Payment saved to local file with items');
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving to local file:', error);
    return { success: false, error: error.message };
  }
}

// 🔥 ОБНОВЛЕННЫЙ: Локальный просмотр платежей с правильным отображением количества
app.get("/local/payments", (req, res) => {
  try {
    const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Local Payments Backup</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
            .container { max-width: 1400px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #4CAF50; color: white; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .items-list { font-size: 12px; margin-top: 5px; }
            .item { padding: 2px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>💳 Local Payments Backup</h1>
                <div>Total: ${purchases.length} payments</div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Transaction ID</th>
                        <th>Buyer</th>
                        <th>Amount</th>
                        <th>Items</th>
                        <th>Date</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${purchases.map(payment => {
                      const createdAt = payment.timestamps?.createdAt;
                      let formattedDate = 'Invalid Date';
                      
                      if (createdAt) {
                        const date = new Date(createdAt);
                        date.setHours(date.getHours() + 3);
                        formattedDate = date.toLocaleString('ru-RU');
                      }
                      
                      // 🔥 ИСПРАВЛЕНО: Правильно отображаем количество
                      const itemsHtml = payment.items && payment.items.length > 0 
                        ? payment.items.map(item => `
                            <div class="item">
                                ${item.name} x${item.quantity} 
                                ${item.price ? `($${item.price})` : ''}
                                ${item.subtotal ? `= $${item.subtotal}` : ''}
                            </div>
                        `).join('')
                        : '<div class="item">No items data</div>';
                      
                      return `
                    <tr>
                        <td><strong>${payment.transactionId}</strong></td>
                        <td>
                            <div><strong>${payment.buyer?.nickname || 'No name'}</strong></div>
                            <small>${payment.buyer?.email || 'No email'}</small>
                        </td>
                        <td>
                            <strong>$${payment.amount?.total || payment.amount || '0'}</strong>
                        </td>
                        <td>
                            <div class="items-list">
                                ${itemsHtml}
                            </div>
                        </td>
                        <td>${formattedDate}</td>
                        <td>${payment.delivery?.delivered ? '✅ Delivered' : '🕐 Pending'}</td>
                    </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error reading local data' });
  }
});

// ========== ОСТАЛЬНОЙ КОД ==========

// 🔥 ДОБАВЛЕНО: Функции для работы с отзывами в Firestore
async function saveReviewToFirestore(reviewData) {
  try {
    const reviewRef = db.collection('reviews').doc();
    const firestoreReview = {
      name: reviewData.name,
      review: reviewData.review,
      transactionId: reviewData.transactionId,
      createdAt: new Date(),
      visible: true
    };
    await reviewRef.set(firestoreReview);
    return { success: true, reviewId: reviewRef.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getReviewsFromFirestore() {
  try {
    const reviewsRef = db.collection('reviews');
    const snapshot = await reviewsRef.where('visible', '==', true).orderBy('createdAt', 'desc').get();
    const reviews = [];
    snapshot.forEach(doc => {
      reviews.push({ id: doc.id, ...doc.data() });
    });
    return { success: true, reviews };
  } catch (error) {
    return { success: false, error: error.message, reviews: [] };
  }
}

async function deleteReviewFromFirestore(reviewId) {
  try {
    const reviewRef = db.collection('reviews').doc(reviewId);
    await reviewRef.update({ visible: false });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 🔥 ОБНОВЛЕННАЯ ФУНКЦИЯ: Для бэкапа в Google Sheets
async function backupToGoogleSheets(paymentData) {
  try {
    const googleWebhookURL = 'https://script.google.com/macros/s/AKfycbxhYagfBjtQG81iwWDewT4Q4rQ1JDBnMHCRrvyyisKZ2wGe6yYEa-6YATXloLNyf96a/exec';
    
    const sheetsData = {
      transactionId: paymentData.transactionId || 'N/A',
      nickname: paymentData.nickname || 'No nickname',
      payerEmail: paymentData.payerEmail || 'No email',
      amount: paymentData.amount || '0',
      items: paymentData.items || [],
      gameType: paymentData.gameType || 'unknown'
    };

    const response = await fetch(googleWebhookURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetsData)
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      result = { success: false, error: 'Invalid JSON response' };
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Middleware для JWT ---
function authMiddleware(req, res, next) {
  const tokenFromUrl = req.query.token;
  const authHeader = req.headers["authorization"];
  const tokenFromBody = req.body.token;
  
  const token = tokenFromUrl || (authHeader ? authHeader.split(" ")[1] : null) || tokenFromBody;
  
  if (!token) {
    const loginHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Admin Login</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .login-container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            input, button { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #ddd; border-radius: 5px; }
            button { background: #0070ba; color: white; border: none; cursor: pointer; }
            button:hover { background: #005c99; }
            .error { color: red; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="login-container">
            <h2>🔐 Admin Login</h2>
            <form id="loginForm">
                <input type="text" name="username" placeholder="Username" value="admin" required>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Login</button>
            </form>
            <div id="error" class="error"></div>
        </div>
        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = {
                    username: formData.get('username'),
                    password: formData.get('password')
                };
                
                try {
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        window.location.href = '/admin/payments?token=' + result.token;
                    } else {
                        document.getElementById('error').textContent = result.error || 'Login failed';
                    }
                } catch (error) {
                    document.getElementById('error').textContent = 'Network error: ' + error.message;
                }
            });
        </script>
    </body>
    </html>
    `;
    return res.send(loginHtml);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

// 🔥 ОБНОВЛЕННАЯ ФУНКЦИЯ: сохранения платежа в Firebase
async function savePaymentToFirebase(paymentData) {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !db) {
    return { success: false, error: 'Firebase config missing' };
  }
  
  try {
    const paymentRef = db.collection('payments').doc();
    
    // 🔥 ИСПРАВЛЕНО: Правильно обрабатываем количество (используем qty)
    const firebaseData = {
      transactionId: paymentData.transactionId,
      paymentId: paymentData.paymentId,
      status: paymentData.status || 'completed',
      buyer: { 
        nickname: paymentData.nickname, 
        email: paymentData.payerEmail || 'unknown@email.com' 
      },
      amount: { 
        total: paymentData.amount, 
        currency: paymentData.currency || 'USD', 
        items: paymentData.items.reduce((sum, item) => sum + (item.price * item.qty), 0) 
      },
      items: paymentData.items.map((item, index) => ({ 
        id: index + 1, 
        name: item.name, 
        quantity: item.qty, // 🔥 ИСПРАВЛЕНО: используем qty из входящих данных
        price: item.price, 
        subtotal: (item.price * item.qty).toFixed(2) 
      })),
      timestamps: { 
        createdAt: new Date(), 
        updatedAt: new Date() 
      },
      delivery: { 
        delivered: false, 
        deliveredAt: null 
      },
      reviewLeft: false, 
      reviewName: null,
      gameType: paymentData.gameType || 'unknown'
    };
    
    await paymentRef.set(firebaseData);
    
    // 🔥 ПЕРЕДАЕМ ПОЛНЫЕ ДАННЫЕ В ЛОКАЛЬНОЕ СОХРАНЕНИЕ
    const localSaveResult = savePaymentToLocal({
      ...firebaseData,
      firebaseId: paymentRef.id,
      // 🔥 ДОБАВЛЯЕМ ОРИГИНАЛЬНЫЕ ITEMS ДЛЯ СОВМЕСТИМОСТИ
      items: paymentData.items
    });
    
    return { success: true, paymentId: paymentRef.id, localSaved: localSaveResult.success };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 🔥 ДОБАВЛЕНО: Функции очистки данных
app.post("/api/clear-purchases", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body;
    
    let result = { success: true, messages: [] };

    if (type === 'local' || type === 'all') {
      fs.writeFileSync(purchasesFile, "[]", "utf-8");
      result.messages.push("✅ Local purchases cleared");
    }

    if (type === 'firebase' || type === 'all') {
      if (db) {
        const paymentsRef = db.collection('payments');
        const snapshot = await paymentsRef.get();
        const deletePromises = [];
        snapshot.forEach(doc => {
          deletePromises.push(doc.ref.delete());
        });
        await Promise.all(deletePromises);
        result.messages.push(`✅ Firebase cleared (${deletePromises.length} documents)`);
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to clear data' });
  }
});

app.post("/api/clear-reviews", authMiddleware, async (req, res) => {
  try {
    if (db) {
      const reviewsRef = db.collection('reviews');
      const snapshot = await reviewsRef.get();
      const deletePromises = [];
      snapshot.forEach(doc => {
        deletePromises.push(doc.ref.delete());
      });
      await Promise.all(deletePromises);
    }
    
    res.json({ success: true, message: "All reviews cleared successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to clear reviews' });
  }
});

// 🔥 ДОБАВЛЕНО: Получить статистику данных
app.get("/api/stats", authMiddleware, async (req, res) => {
  try {
    const stats = {
      localPurchases: 0,
      firebasePurchases: 0,
      reviews: 0,
      gameStats: { poe2: 0, poe1: 0, unknown: 0 }
    };

    try {
      const localData = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
      stats.localPurchases = localData.length;
    } catch (e) {
      stats.localPurchases = 0;
    }

    if (db) {
      try {
        const paymentsRef = db.collection('payments');
        const snapshot = await paymentsRef.get();
        stats.firebasePurchases = snapshot.size;
        
        snapshot.forEach(doc => {
          const data = doc.data();
          const gameType = data.gameType || 'unknown';
          if (stats.gameStats[gameType] !== undefined) {
            stats.gameStats[gameType]++;
          }
        });
      } catch (e) {
        stats.firebasePurchases = 0;
      }

      try {
        const reviewsRef = db.collection('reviews');
        const snapshot = await reviewsRef.where('visible', '==', true).get();
        stats.reviews = snapshot.size;
      } catch (e) {
        stats.reviews = 0;
      }
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Логин админа ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
    return res.json({ success: true, token: token, message: "Login successful" });
  }
  res.status(401).json({ success: false, error: "Invalid credentials" });
});

// 🔥 ОБНОВЛЕННЫЙ WEBHOOK
app.post("/webhook", async (req, res) => {
  const details = req.body;
  const nickname = details.nickname || "No nickname";
  const gameType = details.gameType || 'unknown';

  console.log('💰 NEW PAYMENT WEBHOOK');
  console.log('🎮 Game Type:', gameType);
  console.log('👤 Nickname:', nickname);

  // Сохраняем платеж в Firebase
  try {
    const paymentData = {
      amount: details.amount,
      currency: 'USD',
      payerEmail: details.payerEmail || 'unknown@email.com',
      paymentId: details.paymentId || details.transactionId,
      status: 'completed',
      nickname: nickname,
      items: details.items,
      transactionId: details.transactionId,
      gameType: gameType
    };
    
    const firebaseResult = await savePaymentToFirebase(paymentData);
    if (!firebaseResult.success) {
      console.error('❌ Firebase save error:', firebaseResult.error);
    }
  } catch (firebaseError) {
    console.error('❌ Firebase processing error:', firebaseError);
  }

  // Отправляем в Google Sheets
  try {
    const googleSheetsResult = await backupToGoogleSheets({
      transactionId: details.transactionId,
      nickname: nickname,
      payerEmail: details.payerEmail || 'unknown@email.com',
      amount: details.amount,
      items: details.items,
      gameType: gameType
    });
    
    if (!googleSheetsResult.success) {
      console.error('❌ Google Sheets save error:', googleSheetsResult.error);
    }
  } catch (googleSheetsError) {
    console.error('❌ Google Sheets processing error:', googleSheetsError);
  }

  // TELEGRAM УВЕДОМЛЕНИЕ
  if (PAYPAL_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const itemsText = details.items.map(i => `${i.name} x${i.qty} ($${i.price})`).join("\n");
      await axios.post(`${TELEGRAM_API_PAYPAL}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: `💰 New purchase (${gameType}):\nTransaction: ${details.transactionId}\nBuyer: ${nickname}\nAmount: $${details.amount}\nItems:\n${itemsText}`
      });
    } catch (err) {
      console.error("❌ Telegram error:", err.message);
    }
  }

  res.status(200).send("OK");
});

// 🔥 ОБНОВЛЕННАЯ СИСТЕМА ОТЗЫВОВ
app.post("/api/reviews", async (req, res) => {
  const { name, review, transactionId } = req.body;
  
  if (!name || !review) {
    return res.status(400).json({ error: "Please fill in name and review" });
  }

  try {
    let hasValidPurchase = false;
    let alreadyReviewed = false;
    let foundTransactionId = null;

    if (db && transactionId) {
      try {
        const paymentsRef = db.collection('payments');
        const snapshot = await paymentsRef.where('transactionId', '==', transactionId).get();
        if (!snapshot.empty) {
          hasValidPurchase = true;
          const paymentData = snapshot.docs[0].data();
          foundTransactionId = paymentData.transactionId;
          if (paymentData.reviewLeft) {
            alreadyReviewed = true;
          }
        }
      } catch (firebaseError) {
        console.error('Firebase check error:', firebaseError);
      }
    }

    if (!hasValidPurchase) {
      return res.status(403).json({ error: "You can only leave a review after making a purchase" });
    }

    if (alreadyReviewed) {
      return res.status(403).json({ error: "You have already left a review for this purchase. Thank you!" });
    }

    const reviewData = { name, review, transactionId: foundTransactionId || transactionId };
    const firestoreResult = await saveReviewToFirestore(reviewData);
    
    if (!firestoreResult.success) {
      throw new Error('Failed to save review to database');
    }

    if (db && foundTransactionId) {
      try {
        const paymentsRef = db.collection('payments');
        const snapshot = await paymentsRef.where('transactionId', '==', foundTransactionId).get();
        if (!snapshot.empty) {
          const paymentDoc = snapshot.docs[0];
          await paymentDoc.ref.update({
            reviewLeft: true,
            reviewName: name,
            'timestamps.updatedAt': new Date()
          });
        }
      } catch (firebaseError) {
        console.error('Error updating review flag:', firebaseError);
      }
    }

    res.json({ success: true, message: "Thank you for your review!" });
  } catch (error) {
    res.status(500).json({ error: "Server error while processing review" });
  }
});

// 🔥 ИСПРАВЛЕННЫЙ МАРШРУТ: Получить все отзывы
app.get("/api/reviews", async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  try {
    const result = await getReviewsFromFirestore();
    if (result.success) {
      const formattedReviews = result.reviews.map(review => {
        let date;
        if (review.createdAt && review.createdAt.toDate) {
          date = review.createdAt.toDate();
        } else if (review.createdAt) {
          date = new Date(review.createdAt);
        } else {
          date = new Date();
        }
        const formattedDate = date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        return { name: review.name, review: review.review, date: formattedDate };
      });
      res.json(formattedReviews);
    } else {
      res.json([]);
    }
  } catch (error) {
    res.json([]);
  }
});

// 🔥 ОБНОВЛЕННЫЙ МАРШРУТ: Удалить отзыв
app.delete("/api/reviews/:id", authMiddleware, async (req, res) => {
  const reviewId = req.params.id;
  
  try {
    const deleteResult = await deleteReviewFromFirestore(reviewId);
    if (!deleteResult.success) {
      throw new Error(deleteResult.error);
    }
    
    res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete review' });
  }
});

// --- Пометить заказ как выданный ---
app.post("/api/mark-delivered", authMiddleware, async (req, res) => {
  const { transactionId, paymentId } = req.body;
  
  try {
    const paymentRef = db.collection('payments').doc(paymentId);
    await paymentRef.update({
      'delivery.delivered': true,
      'delivery.deliveredAt': new Date(),
      'timestamps.updatedAt': new Date()
    });
    
    try {
      const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
      const localPayment = purchases.find(p => p.firebaseId === paymentId || p.transactionId === transactionId);
      if (localPayment) {
        localPayment.delivery.delivered = true;
        localPayment.delivery.deliveredAt = new Date();
        localPayment.timestamps.updatedAt = new Date();
        fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));
      }
    } catch (localError) {
      console.error('Error updating local backup:', localError);
    }
    
    res.json({ success: true, message: 'Order marked as delivered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to mark order as delivered' });
  }
});

// --- Старт сервера ---
app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🤖 Clean messaging: ✅ ENABLED (No confirmations, only welcome)`);
  console.log(`💬 Support Bot: ${SUPPORT_BOT_TOKEN ? '✅ READY' : '❌ NOT CONFIGURED'}`);
  console.log(`💳 PayPal Bot: ${PAYPAL_BOT_TOKEN ? '✅ READY' : '❌ NOT CONFIGURED'}`);
  console.log(`👑 Admin Panel: http://localhost:${PORT}/admin/payments`);
});