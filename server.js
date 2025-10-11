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

// --- Middleware для JWT ---
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// 🔥 ДОБАВЛЕНО: Функция сохранения платежа в Firebase с диагностикой
async function savePaymentToFirebase(paymentData) {
  console.log('🔄 Attempting to save to Firebase...');
  
  // 🔧 ДОБАВЛЕНО: Проверка переменных
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
    console.log('📝 Creating document with ID:', paymentRef.id);
    
    await paymentRef.set({
      amount: paymentData.amount,
      currency: paymentData.currency || 'USD',
      payerEmail: paymentData.payerEmail,
      paymentId: paymentData.paymentId,
      status: paymentData.status || 'completed',
      nickname: paymentData.nickname,
      items: paymentData.items || [],
      transactionId: paymentData.transactionId,
      createdAt: new Date()
    });
    
    console.log('✅ Successfully saved to Firebase, ID:', paymentRef.id);
    return { success: true, paymentId: paymentRef.id };
  } catch (error) {
    console.error('❌ Firebase save error:', error);
    console.error('❌ Error details:', error.message);
    return { success: false, error: error.message };
  }
}

// --- Логин админа ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
    return res.json({ token });
  }
  res.status(401).json({ error: "Invalid credentials" });
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

  // 🔥 ДОБАВЛЕНО: Сохраняем платеж в Firebase
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
    const snapshot = await paymentsRef.orderBy('createdAt', 'desc').get();
    
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

// --- Пометить заказ как выданный ---
app.post("/api/mark-delivered", authMiddleware, (req, res) => {
  const { transactionId } = req.body;
  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  const order = purchases.find(p => p.transactionId === transactionId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  order.delivered = true;
  fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));
  res.json({ success: true });
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
  console.log(`🔧 Test Firebase: https://your-server.onrender.com/api/test-firebase`);
  console.log(`🔧 Test Payment: POST https://your-server.onrender.com/api/test-firebase-payment`);
});