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
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

app.use(bodyParser.json());
app.use(cors());

// 🔧 ДОБАВЛЕНО: Диагностика Firebase при старте
console.log('=== FIREBASE DEBUG INFO ===');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'NOT SET');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT SET');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (' + process.env.FIREBASE_PRIVATE_KEY.length + ' chars)' : 'NOT SET');
console.log('db object:', db ? 'EXISTS' : 'NULL');
console.log('==========================');

// --- УЛУЧШЕННЫЙ Middleware для JWT ---
function authMiddleware(req, res, next) {
  // Проверяем токен в разных местах
  const tokenFromUrl = req.query.token;
  const authHeader = req.headers["authorization"];
  const tokenFromBody = req.body.token;
  
  const token = tokenFromUrl || (authHeader ? authHeader.split(" ")[1] : null) || tokenFromBody;
  
  if (!token) {
    // Если токена нет, показываем страницу логина
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
                        // Перенаправляем с токеном в URL
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

  // Проверяем токен
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        error: "Invalid or expired token",
        message: "Please login again at /admin/payments" 
      });
    }
    req.user = user;
    next();
  });
}

// 🔥 ДОБАВЛЕНО: УЛУЧШЕННАЯ функция сохранения платежа в Firebase
async function savePaymentToFirebase(paymentData) {
  console.log('🔄 Attempting to save to Firebase...');
  
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
    console.error('❌ Firebase environment variables are missing!');
    return { success: false, error: 'Firebase config missing' };
  }
  
  if (!db) {
    console.error('❌ Firebase db object is not initialized!');
    return { success: false, error: 'Firebase not initialized' };
  }
  
  try {
    const paymentRef = db.collection('payments').doc();
    
    // 🔥 УЛУЧШЕННАЯ СТРУКТУРА ДАННЫХ
    const firebaseData = {
      // Основная информация
      transactionId: paymentData.transactionId,
      paymentId: paymentData.paymentId,
      status: paymentData.status || 'completed',
      
      // Информация о покупателе
      buyer: {
        nickname: paymentData.nickname,
        email: paymentData.payerEmail || 'unknown@email.com'
      },
      
      // Финансовая информация
      amount: {
        total: paymentData.amount,
        currency: paymentData.currency || 'USD',
        items: paymentData.items.reduce((sum, item) => sum + (item.price * item.qty), 0)
      },
      
      // Товары в структурированном виде
      items: paymentData.items.map((item, index) => ({
        id: index + 1,
        name: item.name,
        quantity: item.qty,
        price: item.price,
        subtotal: (item.price * item.qty).toFixed(2)
      })),
      
      // Мета-данные
      timestamps: {
        createdAt: new Date(),
        updatedAt: new Date()
      },
      
      // Статус доставки
      delivery: {
        delivered: false,
        deliveredAt: null
      }
    };
    
    await paymentRef.set(firebaseData);
    
    console.log('✅ Successfully saved to Firebase, ID:', paymentRef.id);
    return { success: true, paymentId: paymentRef.id };
  } catch (error) {
    console.error('❌ Firebase save error:', error);
    console.error('❌ Error details:', error.message);
    return { success: false, error: error.message };
  }
}

// 🔥 ДОБАВЛЕНО: Корневой маршрут
app.get("/", (req, res) => {
  res.json({
    message: "PayPal Server is running!",
    endpoints: {
      test: "/api/test-firebase",
      adminPayments: "/admin/payments (requires login)",
      adminReviews: "/admin/reviews (requires login)", 
      webhook: "/webhook",
      login: "/api/login",
      testPayment: "/api/test-firebase-payment (POST)"
    },
    status: "active",
    timestamp: new Date().toISOString()
  });
});

// --- Логин админа ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
    return res.json({ 
      success: true,
      token: token,
      message: "Login successful"
    });
  }
  res.status(401).json({ 
    success: false,
    error: "Invalid credentials" 
  });
});

// --- Файлы для заказов/отзывов ---
const purchasesFile = path.join(__dirname, "purchases.json");
if (!fs.existsSync(purchasesFile)) fs.writeFileSync(purchasesFile, "[]", "utf-8");

const reviewsFile = path.join(__dirname, "reviews.json");
if (!fs.existsSync(reviewsFile)) fs.writeFileSync(reviewsFile, "[]", "utf-8");

// --- PayPal Webhook ---
app.post("/webhook", async (req, res) => {
  const details = req.body;
  const nickname = details.nickname || "No nickname";

  // Сохраняем покупку в локальный файл
  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  purchases.push({
    nickname,
    transactionId: details.transactionId,
    items: details.items,
    amount: details.amount,
    date: new Date().toISOString()
  });
  fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));

  // 🔥 ДОБАВЛЕНО: Сохраняем платеж в Firebase с улучшенной структурой
  try {
    const paymentData = {
      amount: details.amount,
      currency: 'USD',
      payerEmail: details.payerEmail || 'unknown@email.com',
      paymentId: details.paymentId || details.transactionId,
      status: 'completed',
      nickname: nickname,
      items: details.items,
      transactionId: details.transactionId
    };
    
    console.log('💰 Processing payment for Firebase...');
    const firebaseResult = await savePaymentToFirebase(paymentData);
    
    if (!firebaseResult.success) {
      console.error('❌ Ошибка сохранения в Firebase:', firebaseResult.error);
    } else {
      console.log('✅ Payment saved to Firebase successfully');
    }
  } catch (firebaseError) {
    console.error('❌ Ошибка при работе с Firebase:', firebaseError);
  }

  // Форматируем товары красиво
  const itemsText = details.items.map(i => `${i.name} x${i.qty} ($${i.price})`).join("\n");

  // Отправляем уведомление в Telegram
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: `💰 New purchase:
Transaction: ${details.transactionId}
Buyer: ${nickname}
Amount: $${details.amount}
Items:
${itemsText}`
        }
      );
    } catch (err) {
      console.error("Telegram error:", err.message);
    }
  }

  res.status(200).send("OK");
});

// 🔧 ДОБАВЛЕНО: Тестовый маршрут для проверки Firebase
app.get("/api/test-firebase", async (req, res) => {
  try {
    console.log('🧪 Testing Firebase connection...');
    
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: '❌ Firebase db object is not initialized' 
      });
    }
    
    const testRef = db.collection('test').doc('connection-test');
    await testRef.set({ 
      message: 'Тест соединения с Firebase',
      timestamp: new Date(),
      server: 'PayPal Server'
    });
    
    console.log('✅ Firebase test document created');
    res.json({ 
      success: true, 
      message: '✅ Firebase подключен и работает! Проверьте базу данных.' 
    });
  } catch (error) {
    console.error('❌ Firebase test error:', error);
    res.status(500).json({ 
      success: false, 
      error: '❌ Ошибка Firebase: ' + error.message 
    });
  }
});

// 🔧 ДОБАВЛЕНО: Тестовый маршрут для создания платежа
app.post("/api/test-firebase-payment", async (req, res) => {
  try {
    console.log('🧪 Testing Firebase payment creation...');
    
    const testPaymentData = {
      amount: 10.99,
      currency: 'USD',
      payerEmail: 'test@example.com',
      paymentId: 'test-payment-' + Date.now(),
      status: 'completed',
      nickname: 'Test User',
      items: [{ name: 'Test Product', qty: 1, price: 10.99 }],
      transactionId: 'test-txn-' + Date.now()
    };
    
    const result = await savePaymentToFirebase(testPaymentData);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: '✅ Test payment created in Firebase',
        paymentId: result.paymentId 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: '❌ Failed to create test payment: ' + result.error 
      });
    }
  } catch (error) {
    console.error('❌ Test payment error:', error);
    res.status(500).json({ 
      success: false, 
      error: '❌ Test error: ' + error.message 
    });
  }
});

// 🔥 ДОБАВЛЕНО: Красивый админский интерфейс для платежей
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
    
    // 🔥 Генерируем HTML таблицу
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
            tr:hover { background-color: #f5f5f5; }
            .delivered { background-color: #d4edda; }
            .pending { background-color: #fff3cd; }
            .status-delivered { color: #155724; font-weight: bold; }
            .status-pending { color: #856404; font-weight: bold; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat-card { background: #e3f2fd; padding: 15px; border-radius: 5px; flex: 1; text-align: center; }
            .logout { background: #dc3545; color: white; padding: 8px 15px; border: none; border-radius: 5px; cursor: pointer; }
            .logout:hover { background: #c82333; }
            .deliver-btn { 
                background: #28a745; 
                color: white; 
                padding: 6px 12px; 
                border: none; 
                border-radius: 4px; 
                cursor: pointer; 
                font-size: 12px;
            }
            .deliver-btn:hover { background: #218838; }
            .deliver-btn:disabled { 
                background: #6c757d; 
                cursor: not-allowed; 
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
            .nav a:hover { background: #5a6268; }
            .nav a.active { background: #4CAF50; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="nav">
                <a href="/admin/payments?token=${req.query.token}" class="active">💳 Payments</a>
                <a href="/admin/reviews?token=${req.query.token}">⭐ Reviews</a>
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
                    <h3>🕐 Pending</h3>
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
                      // Форматируем дату правильно
                      const createdAt = payment.timestamps.createdAt;
                      let formattedDate = 'Invalid Date';
                      
                      if (createdAt && createdAt.toDate) {
                        // Если это Firebase Timestamp
                        formattedDate = createdAt.toDate().toLocaleString('ru-RU');
                      } else if (createdAt) {
                        // Если это обычная дата
                        formattedDate = new Date(createdAt).toLocaleString('ru-RU');
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
                            <div><small>${payment.amount.currency}</small></div>
                        </td>
                        <td>
                            ${payment.items.map(item => `
                            <div>${item.name} x${item.quantity} ($${item.subtotal})</div>
                            `).join('')}
                            <small>Total items: ${payment.items.length}</small>
                        </td>
                        <td>${formattedDate}</td>
                        <td class="${payment.delivery.delivered ? 'status-delivered' : 'status-pending'}" id="status-${payment.id}">
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
                    ${payments.length === 0 ? `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 40px;">
                            No payments found. Payments will appear here after successful transactions.
                        </td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>
        </div>

        <script>
            async function markAsDelivered(paymentId, transactionId) {
                const btn = document.getElementById('btn-' + paymentId);
                const statusCell = document.getElementById('status-' + paymentId);
                const row = document.getElementById('row-' + paymentId);
                
                // Блокируем кнопку
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
                        // Обновляем UI
                        statusCell.innerHTML = '✅ Delivered';
                        statusCell.className = 'status-delivered';
                        row.className = 'delivered';
                        btn.outerHTML = '<span style="color: #28a745;">✅ Done</span>';
                        
                        // Показываем уведомление
                        showNotification('Order marked as delivered!', 'success');
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    // Восстанавливаем кнопку при ошибке
                    btn.disabled = false;
                    btn.textContent = 'Mark Delivered';
                    showNotification('Error: ' + error.message, 'error');
                }
            }
            
            function getTokenFromUrl() {
                const urlParams = new URLSearchParams(window.location.search);
                return urlParams.get('token');
            }
            
            function showNotification(message, type) {
                // Создаем уведомление
                const notification = document.createElement('div');
                notification.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 15px 20px;
                    border-radius: 5px;
                    color: white;
                    font-weight: bold;
                    z-index: 1000;
                    opacity: 0;
                    transition: opacity 0.3s;
                    background-color: \${type === 'success' ? '#28a745' : '#dc3545'};
                \`;
                notification.textContent = message;
                
                document.body.appendChild(notification);
                
                // Показываем
                setTimeout(() => notification.style.opacity = '1', 100);
                
                // Скрываем через 3 секунды
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 300);
                }, 3000);
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка получения платежей: ' + error.message 
    });
  }
});

// 🔥 ДОБАВЛЕНО: Админка для управления отзывами
app.get("/admin/reviews", authMiddleware, async (req, res) => {
  try {
    const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
    const reviewsWithId = reviews.map((review, index) => ({
      id: index,
      ...review
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
            .delete-btn:hover { background: #c82333; }
            .nav { margin-bottom: 20px; }
            .nav a { 
                background: #6c757d; 
                color: white; 
                padding: 10px 15px; 
                text-decoration: none; 
                border-radius: 5px; 
                margin-right: 10px;
            }
            .nav a:hover { background: #5a6268; }
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
                        <th>ID</th>
                        <th>User</th>
                        <th>Review</th>
                        <th>Date</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${reviewsWithId.map(review => `
                    <tr id="review-${review.id}">
                        <td>${review.id}</td>
                        <td><strong>${review.nickname}</strong></td>
                        <td>${review.review}</td>
                        <td>${new Date(review.date).toLocaleString('ru-RU')}</td>
                        <td>
                            <button class="delete-btn" onclick="deleteReview(${review.id})">
                                Delete
                            </button>
                        </td>
                    </tr>
                    `).join('')}
                    ${reviewsWithId.length === 0 ? `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px;">
                            No reviews found.
                        </td>
                    </tr>
                    ` : ''}
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
                        // Удаляем строку из таблицы
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
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка получения отзывов: ' + error.message 
    });
  }
});

// --- Пометить заказ как выданный (обновленная версия) ---
app.post("/api/mark-delivered", authMiddleware, async (req, res) => {
  const { transactionId, paymentId } = req.body;
  
  try {
    // Обновляем в Firebase
    const paymentRef = db.collection('payments').doc(paymentId);
    await paymentRef.update({
      'delivery.delivered': true,
      'delivery.deliveredAt': new Date(),
      'timestamps.updatedAt': new Date()
    });
    
    // Также обновляем в локальном файле (для совместимости)
    const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
    const order = purchases.find(p => p.transactionId === transactionId);
    if (order) {
      order.delivered = true;
      fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));
    }
    
    console.log(`✅ Order ${transactionId} marked as delivered`);
    res.json({ 
      success: true, 
      message: 'Order marked as delivered successfully' 
    });
  } catch (error) {
    console.error('❌ Error marking order as delivered:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to mark order as delivered: ' + error.message 
    });
  }
});

// --- Удалить отзыв (админ) ---
app.delete("/api/reviews/:id", authMiddleware, (req, res) => {
  const reviewId = parseInt(req.params.id);
  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
  
  if (reviewId < 0 || reviewId >= reviews.length) {
    return res.status(404).json({ error: "Review not found" });
  }
  
  // Удаляем отзыв
  reviews.splice(reviewId, 1);
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2));
  
  res.json({ success: true, message: "Review deleted successfully" });
});

// 🔥 ДОБАВЛЕНО: Получить все платежи из Firebase
app.get("/api/firebase-payments", authMiddleware, async (req, res) => {
  try {
    console.log('📊 Fetching payments from Firebase...');
    
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Firebase not initialized' 
      });
    }
    
    const paymentsRef = db.collection('payments');
    const snapshot = await paymentsRef.orderBy('timestamps.createdAt', 'desc').get();
    
    const payments = [];
    snapshot.forEach(doc => {
      payments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`📊 Found ${payments.length} payments in Firebase`);
    res.json({ success: true, payments });
  } catch (error) {
    console.error('❌ Error fetching payments:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка получения платежей: ' + error.message 
    });
  }
});

// --- Получить все заказы ---
app.get("/api/purchases", authMiddleware, (req, res) => {
  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  res.json(purchases);
});

// --- Повторная отправка уведомления в Telegram ---
app.post("/api/resend-telegram", authMiddleware, async (req, res) => {
  const { transactionId } = req.body;
  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  const order = purchases.find(p => p.transactionId === transactionId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const itemsText = order.items.map(i => `${i.name} x${i.qty} ($${i.price})`).join("\n");
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: `♻️ Resent order:
Transaction: ${order.transactionId}
Buyer: ${order.nickname}
Amount: $${order.amount}
Items:
${itemsText}`
      }
    );
  }

  res.json({ success: true });
});

// --- Отзывы ---
app.get("/api/reviews", (req, res) => {
  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
  res.json(reviews);
});

app.post("/api/reviews", (req, res) => {
  const { nickname, review } = req.body;
  if (!nickname || !review) return res.status(400).json({ error: "Fill all fields" });

  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  const hasPurchase = purchases.some(p => p.nickname === nickname);
  if (!hasPurchase) return res.status(403).json({ error: "You have not made a purchase" });

  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
  reviews.push({ nickname, review, date: new Date().toISOString() });
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2));

  res.json({ success: true });
});

// --- Старт сервера ---
app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🔥 Firebase integration: ${db ? 'READY' : 'NOT READY'}`);
  console.log(`🔧 Test Firebase: https://paypal-server-46qg.onrender.com/api/test-firebase`);
  console.log(`🔧 Test Payment: POST https://paypal-server-46qg.onrender.com/api/test-firebase-payment`);
  console.log(`👑 Admin Payments: https://paypal-server-46qg.onrender.com/admin/payments`);
  console.log(`⭐ Admin Reviews: https://paypal-server-46qg.onrender.com/admin/reviews`);
  console.log(`🏠 Home: https://paypal-server-46qg.onrender.com/`);
});