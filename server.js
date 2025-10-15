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

// 🔥 ОБНОВЛЕНО: Настройки CORS для фронтенда
app.use(cors({
  origin: [
    'https://poestock.net',
    'https://www.poestock.net', 
    'http://localhost:3000',
    'http://localhost:8080'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// 🔥 ДОБАВЛЕНО: Функции для работы с отзывами в Firestore
async function saveReviewToFirestore(reviewData) {
  try {
    console.log('💾 Saving review to Firestore...');
    
    const reviewRef = db.collection('reviews').doc();
    
    const firestoreReview = {
      name: reviewData.name,
      review: reviewData.review,
      transactionId: reviewData.transactionId,
      createdAt: new Date(),
      visible: true
    };
    
    await reviewRef.set(firestoreReview);
    console.log('✅ Review saved to Firestore with ID:', reviewRef.id);
    
    return { success: true, reviewId: reviewRef.id };
  } catch (error) {
    console.error('❌ Error saving review to Firestore:', error);
    return { success: false, error: error.message };
  }
}

async function getReviewsFromFirestore() {
  try {
    console.log('📖 Getting reviews from Firestore...');
    
    const reviewsRef = db.collection('reviews');
    const snapshot = await reviewsRef.where('visible', '==', true).orderBy('createdAt', 'desc').get();
    
    const reviews = [];
    snapshot.forEach(doc => {
      reviews.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`✅ Found ${reviews.length} reviews in Firestore`);
    return { success: true, reviews };
  } catch (error) {
    console.error('❌ Error getting reviews from Firestore:', error);
    return { success: false, error: error.message, reviews: [] };
  }
}

async function deleteReviewFromFirestore(reviewId) {
  try {
    console.log('🗑️ Deleting review from Firestore:', reviewId);
    
    const reviewRef = db.collection('reviews').doc(reviewId);
    await reviewRef.update({ visible: false });
    
    console.log('✅ Review marked as hidden in Firestore');
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting review from Firestore:', error);
    return { success: false, error: error.message };
  }
}

// 🔧 ДОБАВЛЕНО: Диагностика Firebase при старте
console.log('=== FIREBASE DEBUG INFO ===');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'NOT SET');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT SET');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (' + process.env.FIREBASE_PRIVATE_KEY.length + ' chars)' : 'NOT SET');
console.log('db object:', db ? 'EXISTS' : 'NULL');
console.log('==========================');

// 🔥 ОБНОВЛЕННАЯ ФУНКЦИЯ: Для бэкапа в Google Sheets
async function backupToGoogleSheets(paymentData) {
  try {
    const googleWebhookURL = 'https://script.google.com/macros/s/AKfycbxhYagfBjtQG81iwWDewT4Q4rQ1JDBnMHCRrvyyisKZ2wGe6yYEa-6YATXloLNyf96a/exec';
    
    console.log('📤 Sending to Google Sheets...');
    console.log('📋 Payment data:', JSON.stringify(paymentData, null, 2));

    const sheetsData = {
      transactionId: paymentData.transactionId || 'N/A',
      nickname: paymentData.nickname || 'No nickname',
      payerEmail: paymentData.payerEmail || 'No email',
      amount: paymentData.amount || '0',
      items: paymentData.items || [],
      gameType: paymentData.gameType || 'unknown',
      paymentMethod: paymentData.paymentMethod || 'paypal'
    };

    console.log('📨 Data for Google Sheets:', JSON.stringify(sheetsData, null, 2));

    const response = await fetch(googleWebhookURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sheetsData)
    });

    console.log('📞 Google Sheets response status:', response.status);
    
    const responseText = await response.text();
    console.log('📄 Google Sheets response text:', responseText);

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.log('⚠️ Google Sheets returned non-JSON response:', responseText);
      result = { success: false, error: 'Invalid JSON response', response: responseText };
    }

    console.log('✅ Google Sheets backup result:', result.success ? 'SUCCESS' : 'FAILED');
    
    if (!result.success) {
      console.error('❌ Google Sheets error:', result.error);
    } else {
      console.log('🎉 Google Sheets backup completed successfully');
    }

    return result;
    
  } catch (error) {
    console.error('❌ Google Sheets backup failed:', error.message);
    console.error('🔍 Error details:', error.stack);
    return { success: false, error: error.message };
  }
}

// 🔥 ДОБАВЛЕНО: Функция для создания платежа в NowPayments
async function createNowPaymentsPayment(paymentData) {
  try {
    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    
    if (!NOWPAYMENTS_API_KEY) {
      throw new Error('NowPayments API key not configured');
    }

    const orderData = {
      price_amount: paymentData.amount,
      price_currency: 'usd',
      pay_currency: paymentData.pay_currency || 'btc',
      order_id: paymentData.order_id,
      order_description: paymentData.order_description,
      ipn_callback_url: 'https://paypal-server-46qg.onrender.com/webhook/nowpayments',
      success_url: paymentData.success_url,
      cancel_url: paymentData.cancel_url
    };

    console.log('💰 Creating NowPayments payment:', JSON.stringify(orderData, null, 2));

    const response = await axios.post('https://api.nowpayments.io/v1/payment', orderData, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NOWPAYMENTS_API_KEY
      },
      timeout: 10000
    });

    console.log('✅ NowPayments payment created:', response.data);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ NowPayments API error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

// --- УЛУЧШЕННЫЙ Middleware для JWT ---
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

// --- Файлы для заказов/отзывов ---
const purchasesFile = path.join(__dirname, "purchases.json");
if (!fs.existsSync(purchasesFile)) fs.writeFileSync(purchasesFile, "[]", "utf-8");

// 🔥 ДОБАВЛЕНО: Функция для сохранения покупки в локальный файл
function savePaymentToLocal(paymentData) {
  try {
    const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
    
    const existingIndex = purchases.findIndex(p => p.transactionId === paymentData.transactionId);
    
    if (existingIndex !== -1) {
      purchases[existingIndex] = paymentData;
    } else {
      purchases.push(paymentData);
    }
    
    fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));
    console.log('✅ Payment saved to local file');
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving to local file:', error);
    return { success: false, error: error.message };
  }
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
        items: paymentData.items ? paymentData.items.reduce((sum, item) => sum + (item.price * item.qty), 0) : paymentData.amount
      },
      
      items: paymentData.items ? paymentData.items.map((item, index) => ({
        id: index + 1,
        name: item.name,
        quantity: item.qty,
        price: item.price,
        subtotal: (item.price * item.qty).toFixed(2)
      })) : [{
        id: 1,
        name: 'Crypto Payment',
        quantity: 1,
        price: paymentData.amount,
        subtotal: paymentData.amount
      }],
      
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

      gameType: paymentData.gameType || 'unknown',

      paymentMethod: paymentData.paymentMethod || 'paypal'
    };
    
    await paymentRef.set(firebaseData);
    
    console.log('✅ Successfully saved to Firebase, ID:', paymentRef.id);
    
    const localSaveResult = savePaymentToLocal({
      ...firebaseData,
      firebaseId: paymentRef.id
    });
    
    return { 
      success: true, 
      paymentId: paymentRef.id,
      localSaved: localSaveResult.success
    };
  } catch (error) {
    console.error('❌ Firebase save error:', error);
    console.error('❌ Error details:', error.message);
    return { success: false, error: error.message };
  }
}

// 🔥 ДОБАВЛЕНО: API для создания платежа NowPayments
app.post("/api/create-crypto-payment", async (req, res) => {
  try {
    const { amount, nickname, gameType, items, success_url, cancel_url } = req.body;
    
    if (!amount || !nickname || !gameType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, nickname, gameType'
      });
    }

    const order_id = `NP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${nickname}_${gameType}`;
    
    const paymentData = {
      amount: parseFloat(amount),
      pay_currency: 'btc',
      order_id: order_id,
      order_description: `PoE Currency - ${nickname} (${gameType})`,
      success_url: success_url || 'https://your-frontend-domain.com',
      cancel_url: cancel_url || 'https://your-frontend-domain.com',
      nickname: nickname,
      gameType: gameType,
      items: items || []
    };

    console.log('💰 Creating NowPayments payment for:', nickname, 'Amount:', amount);
    
    const nowpaymentsResult = await createNowPaymentsPayment(paymentData);
    
    if (nowpaymentsResult.success) {
      const pendingPayment = {
        transactionId: order_id,
        paymentId: nowpaymentsResult.data.payment_id,
        status: 'pending',
        nickname: nickname,
        amount: amount,
        items: items,
        gameType: gameType,
        paymentMethod: 'crypto',
        payerEmail: 'crypto@payment.com'
      };
      
      await savePaymentToFirebase(pendingPayment);
      
      res.json({
        success: true,
        payment_url: nowpaymentsResult.data.invoice_url,
        payment_id: nowpaymentsResult.data.payment_id,
        order_id: order_id
      });
    } else {
      res.status(500).json({
        success: false,
        error: nowpaymentsResult.error
      });
    }
    
  } catch (error) {
    console.error('❌ Error creating crypto payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment: ' + error.message
    });
  }
});

// 🔥 ДОБАВЛЕНО: Проверка статуса NowPayments
app.get("/api/payment-status/:payment_id", async (req, res) => {
  try {
    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    const payment_id = req.params.payment_id;
    
    const response = await axios.get(`https://api.nowpayments.io/v1/payment/${payment_id}`, {
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY
      }
    });
    
    res.json({
      success: true,
      status: response.data.payment_status,
      data: response.data
    });
    
  } catch (error) {
    console.error('❌ Error checking payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check payment status'
    });
  }
});

// 🔥 ОБНОВЛЕННЫЙ WEBHOOK ДЛЯ NOWPAYMENTS
app.post("/webhook/nowpayments", async (req, res) => {
  const paymentData = req.body;
  
  console.log('💰 ===== NOWPAYMENTS WEBHOOK RECEIVED =====');
  console.log('📦 Payment data:', JSON.stringify(paymentData, null, 2));

  try {
    if (paymentData.payment_status === 'finished' || paymentData.payment_status === 'confirmed') {
      console.log('✅ NowPayments payment successful');
      
      const orderId = paymentData.order_id || '';
      const { nickname, gameType } = extractFromOrderId(orderId);
      
      const processedData = {
        amount: paymentData.price_amount,
        currency: paymentData.pay_currency || 'USD',
        payerEmail: paymentData.payer_email || 'crypto@payment.com',
        paymentId: paymentData.payment_id,
        status: 'completed',
        nickname: nickname,
        items: [],
        transactionId: paymentData.payment_id,
        gameType: gameType,
        paymentMethod: 'crypto'
      };
      
      console.log('🔥 Saving NowPayments payment to Firebase...');
      const firebaseResult = await savePaymentToFirebase(processedData);
      
      if (!firebaseResult.success) {
        console.error('❌ Firebase save error:', firebaseResult.error);
      } else {
        console.log('✅ NowPayments payment saved to Firebase successfully, ID:', firebaseResult.paymentId);
      }

      try {
        console.log('📤 Sending NowPayments payment to Google Sheets...');
        const googleSheetsResult = await backupToGoogleSheets(processedData);
        
        if (!googleSheetsResult.success) {
          console.error('❌ Google Sheets save error:', googleSheetsResult.error);
        } else {
          console.log('✅ NowPayments payment saved to Google Sheets successfully');
        }
      } catch (googleSheetsError) {
        console.error('❌ Google Sheets processing error:', googleSheetsError);
      }

      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        try {
          await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              chat_id: TELEGRAM_CHAT_ID,
              text: `💰 New Crypto Payment (${gameType}):
Transaction: ${paymentData.payment_id}
Buyer: ${nickname}
Amount: $${paymentData.price_amount} ${paymentData.pay_currency}
Game: ${gameType}
Payment Method: NowPayments`
            }
          );
          console.log('✅ Telegram notification sent for NowPayments');
        } catch (err) {
          console.error("❌ Telegram error:", err.message);
        }
      }

      res.status(200).json({ success: true, message: 'Payment processed successfully' });
    } else {
      console.log('⚠️ NowPayments payment not finished:', paymentData.payment_status);
      res.status(200).json({ success: true, message: 'Webhook received, payment not finished' });
    }
  } catch (error) {
    console.error('❌ NowPayments webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔥 ДОБАВЛЕНО: Функция для извлечения данных из orderId
function extractFromOrderId(orderId) {
  const parts = orderId.split('_');
  
  let nickname = 'Unknown';
  let gameType = 'unknown';
  
  if (parts.length > 3) {
    nickname = parts[3] || 'Unknown';
  }
  
  if (parts.length > 4) {
    gameType = parts[4] || 'unknown';
  }
  
  if (gameType !== 'poe1' && gameType !== 'poe2') {
    gameType = 'unknown';
  }
  
  return { nickname, gameType };
}

// 🔥 ОБНОВЛЕННЫЙ WEBHOOK ДЛЯ PAYPAL
app.post("/webhook", async (req, res) => {
  const details = req.body;
  
  const paymentMethod = details.payer_email ? 'paypal' : 'crypto';
  
  if (paymentMethod === 'crypto') {
    return app._router.handle(req, res, () => {
      req.url = '/webhook/nowpayments';
      req.method = 'POST';
      app._router.handle(req, res);
    });
  }

  const nickname = details.nickname || "No nickname";
  const gameType = details.gameType || 'unknown';

  console.log('💰 ===== NEW PAYPAL PAYMENT WEBHOOK =====');
  console.log('🎮 Game Type:', gameType);
  console.log('👤 Nickname:', nickname);
  console.log('💳 Transaction ID:', details.transactionId);

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
      gameType: gameType,
      paymentMethod: 'paypal'
    };
    
    console.log('🔥 Saving to Firebase...');
    const firebaseResult = await savePaymentToFirebase(paymentData);
    
    if (!firebaseResult.success) {
      console.error('❌ Firebase save error:', firebaseResult.error);
    } else {
      console.log('✅ Payment saved to Firebase successfully, ID:', firebaseResult.paymentId);
    }
  } catch (firebaseError) {
    console.error('❌ Firebase processing error:', firebaseError);
  }

  try {
    console.log('📤 Sending to Google Sheets...');
    const googleSheetsResult = await backupToGoogleSheets({
      transactionId: details.transactionId,
      nickname: nickname,
      payerEmail: details.payerEmail || 'unknown@email.com',
      amount: details.amount,
      items: details.items,
      gameType: gameType,
      paymentMethod: 'paypal'
    });
    
    if (!googleSheetsResult.success) {
      console.error('❌ Google Sheets save error:', googleSheetsResult.error);
    } else {
      console.log('✅ Payment saved to Google Sheets successfully');
    }
  } catch (googleSheetsError) {
    console.error('❌ Google Sheets processing error:', googleSheetsError);
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const itemsText = details.items.map(i => `${i.name} x${i.qty} ($${i.price})`).join("\n");
      
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: `💰 New PayPal Payment (${gameType}):
Transaction: ${details.transactionId}
Buyer: ${nickname}
Amount: $${details.amount}
Items:
${itemsText}`
        }
      );
      console.log('✅ Telegram notification sent');
    } catch (err) {
      console.error("❌ Telegram error:", err.message);
    }
  }

  console.log('✅ ===== PAYPAL WEBHOOK PROCESSING COMPLETE =====');
  res.status(200).send("OK");
});

// 🔥 ДОБАВЛЕНО: Проверка NowPayments подключения
app.get("/api/nowpayments-status", async (req, res) => {
  try {
    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    
    if (!NOWPAYMENTS_API_KEY) {
      return res.json({
        success: false,
        message: 'NowPayments API key not configured'
      });
    }

    const response = await axios.get('https://api.nowpayments.io/v1/status', {
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY
      },
      timeout: 5000
    });

    res.json({
      success: true,
      message: 'NowPayments API is working',
      status: response.data
    });
    
  } catch (error) {
    console.error('NowPayments status check error:', error.message);
    res.json({
      success: false,
      message: 'NowPayments API connection failed: ' + error.message
    });
  }
});

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
      } else {
        result.messages.push("❌ Firebase not available");
      }
    }

    console.log(`🧹 Data cleared: ${type}`);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear data: ' + error.message 
    });
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
      console.log(`✅ Firestore reviews cleared (${deletePromises.length} documents)`);
    }
    
    if (db) {
      const paymentsRef = db.collection('payments');
      const snapshot = await paymentsRef.get();
      
      const updatePromises = [];
      snapshot.forEach(doc => {
        updatePromises.push(
          doc.ref.update({
            reviewLeft: false,
            reviewName: null
          })
        );
      });
      
      await Promise.all(updatePromises);
      console.log(`✅ Reset review flags for ${updatePromises.length} payments`);
    }
    
    console.log('🧹 Reviews cleared from Firestore');
    res.json({ 
      success: true, 
      message: "All reviews cleared successfully from Firestore" 
    });
  } catch (error) {
    console.error('❌ Error clearing reviews:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear reviews: ' + error.message 
    });
  }
});

// 🔥 ДОБАВЛЕНО: Получить статистику данных
app.get("/api/stats", authMiddleware, async (req, res) => {
  try {
    const stats = {
      localPurchases: 0,
      firebasePurchases: 0,
      reviews: 0,
      gameStats: {
        poe2: 0,
        poe1: 0,
        unknown: 0
      },
      paymentMethods: {
        paypal: 0,
        crypto: 0
      }
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
          const paymentMethod = data.paymentMethod || 'paypal';
          
          if (stats.gameStats[gameType] !== undefined) {
            stats.gameStats[gameType]++;
          } else {
            stats.gameStats.unknown++;
          }
          
          if (stats.paymentMethods[paymentMethod] !== undefined) {
            stats.paymentMethods[paymentMethod]++;
          }
        });
      } catch (e) {
        stats.firebasePurchases = 0;
      }
    }

    if (db) {
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

// 🔥 ДОБАВЛЕНО: Корневой маршрут
app.get("/", (req, res) => {
  res.json({
    message: "PayPal Server is running!",
    endpoints: {
      test: "/api/test-firebase",
      nowpaymentsStatus: "/api/nowpayments-status",
      createCryptoPayment: "/api/create-crypto-payment (POST)",
      paymentStatus: "/api/payment-status/:payment_id",
      adminPayments: "/admin/payments (requires login)",
      adminReviews: "/admin/reviews (requires login)", 
      localPayments: "/local/payments (backup view)",
      webhook: "/webhook",
      nowpaymentsWebhook: "/webhook/nowpayments",
      login: "/api/login",
      testPayment: "/api/test-firebase-payment (POST)",
      testGoogleSheets: "/api/test-google-sheets (POST)"
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
      transactionId: 'test-txn-' + Date.now(),
      gameType: 'poe2',
      paymentMethod: 'paypal'
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

// 🔥 ТЕСТОВЫЙ МАРШРУТ ДЛЯ ПРОВЕРКИ GOOGLE SHEETS
app.post("/api/test-google-sheets", async (req, res) => {
  try {
    console.log('🧪 Testing Google Sheets integration...');
    
    const testData = {
      transactionId: 'test-' + Date.now(),
      nickname: 'Test User',
      payerEmail: 'test@example.com',
      amount: '25.50',
      items: [
        { name: 'Exalted Orb', qty: 2, price: 5.00 },
        { name: 'Divine Orb', qty: 1, price: 1.50 }
      ],
      gameType: 'poe2',
      paymentMethod: 'paypal'
    };

    console.log('📤 Sending test data to Google Sheets...');
    const result = await backupToGoogleSheets(testData);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: '✅ Test data sent to Google Sheets successfully',
        testData: testData,
        sheetsResponse: result
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: '❌ Failed to send test data to Google Sheets: ' + (result.error || 'Unknown error'),
        testData: testData,
        sheetsResponse: result
      });
    }
  } catch (error) {
    console.error('❌ Google Sheets test error:', error);
    res.status(500).json({ 
      success: false, 
      error: '❌ Test error: ' + error.message 
    });
  }
});

// 🔥 ОБНОВЛЕННАЯ СИСТЕМА ОТЗЫВОВ
app.post("/api/reviews", async (req, res) => {
  const { name, review, transactionId } = req.body;
  
  if (!name || !review) {
    return res.status(400).json({ error: "Please fill in name and review" });
  }

  try {
    console.log(`📝 New review attempt from: ${name}`);
    
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
            console.log(`❌ Transaction ${transactionId} already has a review`);
          }
        } else {
          console.log(`❌ No purchase found for transaction: ${transactionId}`);
        }
      } catch (firebaseError) {
        console.error('Firebase check error:', firebaseError);
      }
    }

    if (!hasValidPurchase) {
      console.log(`❌ No valid purchase found for review - rejected`);
      return res.status(403).json({ 
        error: "You can only leave a review after making a purchase" 
      });
    }

    if (alreadyReviewed) {
      console.log(`❌ Review already exists for this purchase - rejected`);
      return res.status(403).json({ 
        error: "You have already left a review for this purchase. Thank you!" 
      });
    }

    const reviewData = { 
      name,
      review, 
      transactionId: foundTransactionId || transactionId
    };
    
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
          console.log(`✅ Review flag updated in Firebase for transaction: ${foundTransactionId}`);
        }
      } catch (firebaseError) {
        console.error('Error updating review flag in Firebase:', firebaseError);
      }
    }

    console.log(`✅ Review submitted successfully by: ${name} for transaction: ${foundTransactionId}`);
    res.json({ 
      success: true, 
      message: "Thank you for your review!" 
    });
  } catch (error) {
    console.error('❌ Error in review submission:', error);
    res.status(500).json({ error: "Server error while processing review" });
  }
});

// 🔥 ИСПРАВЛЕННЫЙ МАРШРУТ: Получить все отзывы из Firestore
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
        
        const formattedDate = date.toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: 'long', 
          day: 'numeric'
        });
        
        return {
          name: review.name,
          review: review.review,
          date: formattedDate
        };
      });
      
      res.json(formattedReviews);
    } else {
      console.log('⚠️ Using fallback empty reviews due to error');
      res.json([]);
    }
  } catch (error) {
    console.error('❌ Error reading reviews from Firestore:', error);
    res.json([]);
  }
});

// 🔥 ОБНОВЛЕННЫЙ МАРШРУТ: Удалить отзыв из Firestore
app.delete("/api/reviews/:id", authMiddleware, async (req, res) => {
  const reviewId = req.params.id;
  
  try {
    const deleteResult = await deleteReviewFromFirestore(reviewId);
    
    if (!deleteResult.success) {
      throw new Error(deleteResult.error);
    }
    
    if (db) {
      try {
        const reviewRef = db.collection('reviews').doc(reviewId);
        const reviewDoc = await reviewRef.get();
        
        if (reviewDoc.exists) {
          const reviewData = reviewDoc.data();
          const transactionId = reviewData.transactionId;
          
          if (transactionId) {
            const paymentsRef = db.collection('payments');
            const snapshot = await paymentsRef.where('transactionId', '==', transactionId).get();
            
            if (!snapshot.empty) {
              const paymentDoc = snapshot.docs[0];
              await paymentDoc.ref.update({
                reviewLeft: false,
                reviewName: null,
                'timestamps.updatedAt': new Date()
              });
              console.log(`✅ Review flag reset in Firebase for transaction: ${transactionId}`);
            }
          }
        }
      } catch (firebaseError) {
        console.error('Error resetting review flag in Firebase:', firebaseError);
      }
    }
    
    res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting review from Firestore:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete review: ' + error.message 
    });
  }
});

// 🔥 ОБНОВЛЕННАЯ АДМИНКА ДЛЯ ОТЗЫВОВ
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
            
            <h1>⭐ Reviews Management (Firestore)</h1>
            <p>Total reviews: ${reviewsWithId.length}</p>
            
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
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
                      date.setHours(date.getHours() + 3);
                      const formattedDate = date.toLocaleString('ru-RU');
                      
                      return `
                    <tr id="review-${review.id}">
                        <td>${review.id}</td>
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
                    ${reviewsWithId.length === 0 ? `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 40px;">
                            No reviews found in Firestore.
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
                        document.getElementById('review-' + reviewId).remove();
                        alert('Review deleted successfully!');
                        setTimeout(() => window.location.reload(), 1000);
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
      error: 'Ошибка получения отзывов из Firestore: ' + error.message 
    });
  }
});

// 🔥 ДОБАВЛЕНО: Красивый локальный просмотр покупок
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
            tr:hover { background-color: #f5f5f5; }
            .delivered { background-color: #d4edda; }
            .pending { background-color: #fff3cd; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat-card { background: #e3f2fd; padding: 15px; border-radius: 5px; flex: 1; text-align: center; }
            .last-update { text-align: center; color: #666; margin-top: 20px; }
            .nav-links { margin-bottom: 20px; text-align: center; }
            .nav-links a { 
                background: #6c757d; 
                color: white; 
                padding: 10px 15px; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 0 5px;
            }
            .nav-links a:hover { background: #5a6268; }
            .nav-links a.active { background: #4CAF50; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="nav-links">
                <a href="/local/payments" class="active">📁 Local Backup</a>
                <a href="/admin/payments">👑 Admin Panel</a>
                <a href="/">🏠 Home</a>
            </div>
            
            <div class="header">
                <h1>💳 Local Payments Backup</h1>
                <div>
                    <span style="margin-right: 15px;">Total: ${purchases.length} payments</span>
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <h3>💰 Total Revenue</h3>
                    <p>$${purchases.reduce((sum, payment) => sum + parseFloat(payment.amount.total), 0).toFixed(2)}</p>
                </div>
                <div class="stat-card">
                    <h3>✅ Delivered</h3>
                    <p>${purchases.filter(p => p.delivery.delivered).length}</p>
                </div>
                <div class="stat-card">
                    <h3>📦 Pending</h3>
                    <p>${purchases.filter(p => !p.delivery.delivered).length}</p>
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Game</th>
                        <th>Payment Method</th>
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
                      
                      return `
                    <tr class="${payment.delivery.delivered ? 'delivered' : 'pending'}">
                        <td><strong>${payment.gameType || 'unknown'}</strong></td>
                        <td><span style="background: ${payment.paymentMethod === 'crypto' ? '#764ba2' : '#0070ba'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px;">${payment.paymentMethod || 'paypal'}</span></td>
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
                            <div>${item.name} x${item.quantity} ($${item.subtotal || (item.price * item.quantity).toFixed(2)})</div>
                            `).join('')}
                            <small>Total items: ${payment.items.length}</small>
                        </td>
                        <td>${formattedDate}</td>
                        <td>${payment.delivery.delivered ? '✅ Delivered' : '🕐 Pending'}</td>
                    </tr>
                    `}).join('')}
                    ${purchases.length === 0 ? `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 40px;">
                            No payments found in local backup.
                        </td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>
            
            <div class="last-update">
                <p>Last updated: ${new Date().toLocaleString('ru-RU')}</p>
                <p><small>This is a local backup view. For full management use <a href="/admin/payments">Admin Panel</a></small></p>
            </div>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка чтения локальных данных: ' + error.message 
    });
  }
});

// 🔥 ОБНОВЛЕННАЯ АДМИНКА
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
    
    try {
      const localPurchases = payments.map(payment => ({
        ...payment,
        firebaseId: payment.id
      }));
      fs.writeFileSync(purchasesFile, JSON.stringify(localPurchases, null, 2));
      console.log('✅ Local backup updated from Firebase');
    } catch (localError) {
      console.error('❌ Error updating local backup:', localError);
    }
    
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
            .backup-link { 
                background: #17a2b8; 
                color: white; 
                padding: 8px 12px; 
                text-decoration: none; 
                border-radius: 4px; 
                font-size: 12px;
                margin-left: 10px;
            }
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
                transition: all 0.2s;
            }
            .clear-btn:hover { transform: scale(1.05); }
            .game-badge { 
                padding: 2px 6px; 
                border-radius: 3px; 
                font-size: 10px; 
                font-weight: bold;
            }
            .poe2 { background: #0070ba; color: white; }
            .poe1 { background: #28a745; color: white; }
            .unknown { background: #6c757d; color: white; }
            .payment-badge { 
                padding: 2px 6px; 
                border-radius: 3px; 
                font-size: 10px; 
                font-weight: bold;
                margin-left: 5px;
            }
            .paypal-badge { background: #0070ba; color: white; }
            .crypto-badge { background: #764ba2; color: white; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="nav">
                <a href="/admin/payments?token=${req.query.token}" class="active">💳 Payments</a>
                <a href="/admin/reviews?token=${req.query.token}">⭐ Reviews</a>
                <a href="/local/payments" class="backup-link">📁 Local Backup</a>
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
                    <h3>🎮 Games</h3>
                    <p>PoE2: ${payments.filter(p => p.gameType === 'poe2').length}<br>PoE1: ${payments.filter(p => p.gameType === 'poe1').length}</p>
                </div>
                <div class="stat-card">
                    <h3>💳 Payment Methods</h3>
                    <p>PayPal: ${payments.filter(p => p.paymentMethod === 'paypal').length}<br>Crypto: ${payments.filter(p => p.paymentMethod === 'crypto').length}</p>
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Game</th>
                        <th>Payment Method</th>
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
                      } else if (createdAt) {
                        const date = new Date(createdAt);
                        date.setHours(date.getHours() + 3);
                        formattedDate = date.toLocaleString('ru-RU');
                      }
                      
                      const gameType = payment.gameType || 'unknown';
                      const gameBadgeClass = gameType === 'poe2' ? 'poe2' : gameType === 'poe1' ? 'poe1' : 'unknown';
                      const gameDisplayName = gameType === 'poe2' ? 'PoE2' : gameType === 'poe1' ? 'PoE1' : 'Unknown';
                      
                      const paymentMethod = payment.paymentMethod || 'paypal';
                      const paymentBadgeClass = paymentMethod === 'crypto' ? 'crypto-badge' : 'paypal-badge';
                      const paymentDisplayName = paymentMethod === 'crypto' ? 'Crypto' : 'PayPal';
                      
                      return `
                    <tr class="${payment.delivery.delivered ? 'delivered' : 'pending'}" id="row-${payment.id}">
                        <td><span class="game-badge ${gameBadgeClass}">${gameDisplayName}</span></td>
                        <td><span class="payment-badge ${paymentBadgeClass}">${paymentDisplayName}</span></td>
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
                        <td colspan="9" style="text-align: center; padding: 40px;">
                            No payments found. Payments will appear here after successful transactions.
                        </td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>

            <div class="danger-zone">
                <h3>⚠️ Danger Zone</h3>
                
                <div class="stats" style="margin-bottom: 15px;">
                    <div class="stat-card" style="background: #fff3cd;">
                        <h4>📊 Data Statistics</h4>
                        <p>Local: <span id="local-count">0</span> | Firebase: <span id="firebase-count">0</span> | Reviews: <span id="reviews-count">0</span></p>
                        <p>Games: PoE2: <span id="poe2-count">0</span> | PoE1: <span id="poe1-count">0</span></p>
                        <p>Payments: PayPal: <span id="paypal-count">0</span> | Crypto: <span id="crypto-count">0</span></p>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
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
                        statusCell.className = 'status-delivered';
                        row.className = 'delivered';
                        btn.outerHTML = '<span style="color: #28a745;">✅ Done</span>';
                        showNotification('Order marked as delivered!', 'success');
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
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
                
                setTimeout(() => notification.style.opacity = '1', 100);
                
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 300);
                }, 3000);
            }

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
                        document.getElementById('poe2-count').textContent = result.stats.gameStats.poe2;
                        document.getElementById('poe1-count').textContent = result.stats.gameStats.poe1;
                        document.getElementById('paypal-count').textContent = result.stats.paymentMethods.paypal;
                        document.getElementById('crypto-count').textContent = result.stats.paymentMethods.crypto;
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
                        showNotification('✅ ' + result.messages.join(', '), 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    showNotification('❌ Error: ' + error.message, 'error');
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
                        showNotification('✅ ' + result.message, 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    showNotification('❌ Error: ' + error.message, 'error');
                }
            }

            loadStats();
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

// --- Пометить заказ как выданный (обновленная версия) ---
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
        console.log('✅ Local backup updated for delivery status');
      }
    } catch (localError) {
      console.error('❌ Error updating local backup:', localError);
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

// --- Старт сервера ---
app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🔥 Firebase integration: ${db ? 'READY' : 'NOT READY'}`);
  console.log(`💰 NowPayments integration: ${process.env.NOWPAYMENTS_API_KEY ? 'READY' : 'NOT CONFIGURED'}`);
  console.log(`🎮 Game types support: PoE2, PoE1`);
  console.log(`💳 Payment methods: PayPal, NowPayments (Crypto)`);
  console.log(`📝 Reviews stored in Firestore collection 'reviews'`);
  console.log(`🔧 Test NowPayments: https://paypal-server-46qg.onrender.com/api/nowpayments-status`);
  console.log(`🔧 Create Crypto Payment: POST https://paypal-server-46qg.onrender.com/api/create-crypto-payment`);
  console.log(`👑 Admin Payments: https://paypal-server-46qg.onrender.com/admin/payments`);
  console.log(`⭐ Admin Reviews: https://paypal-server-46qg.onrender.com/admin/reviews`);
  console.log(`📁 Local Backup: https://paypal-server-46qg.onrender.com/local/payments`);
  console.log(`🏠 Home: https://paypal-server-46qg.onrender.com/`);
  console.log(`💰 NowPayments Webhook: https://paypal-server-46qg.onrender.com/webhook/nowpayments`);
});