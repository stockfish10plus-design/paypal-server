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

// 🔥 ДОБАВЛЕНО: Мультиязычные сообщения
const messages = {
  ru: {
    welcome: "👋 Добро пожаловать в поддержку! Просто напишите ваш вопрос, и мы ответим вам в ближайшее время.",
    help: `ℹ️ Помощь

• Просто напишите ваш вопрос
• Поддержка ответит вам в этом чате  
• Для вопросов по оплате укажите ID транзакции
• Используйте /english для английской версии`,
    messageReceived: "✅ Ваше сообщение получено. Мы ответим вам в ближайшее время.",
    supportResponse: "💬 Ответ поддержки",
    languageChanged: "🌐 Язык изменен на английский. Используйте /russian для переключения обратно.",
    languageChangedRU: "🌐 Язык изменен на русский. Используйте /english для переключения на английский.",
    unknownCommand: "❌ Неизвестная команда. Используйте /help для списка команд."
  },
  en: {
    welcome: "👋 Welcome to support! Just write your question and we will answer you as soon as possible.",
    help: `ℹ️ Help

• Just write your question
• Support will answer you in this chat
• For payment issues include your transaction ID
• Use /russian for Russian version`,
    messageReceived: "✅ Your message has been received. We will respond to you shortly.",
    supportResponse: "💬 Support response",
    languageChanged: "🌐 Language changed to English. Use /russian to switch back.",
    languageChangedRU: "🌐 Language changed to Russian. Use /english to switch to English.",
    unknownCommand: "❌ Unknown command. Use /help for command list."
  }
};

// 🔥 ПЕРЕДЕЛАНО: Хранилище для диалогов с языковыми настройками
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

      // 🔥 ПРОВЕРЯЕМ ЯЗЫК ПОЛЬЗОВАТЕЛЯ
      const userLang = getUserLanguage(userId);

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
          lastUserMessageId: null,
          language: 'ru' // 🔥 Язык по умолчанию
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

      // 🔥 ОТВЕТ НА ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages[userLang].messageReceived
      });
      
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
        const userLang = getUserLanguage(targetUserId);
        
        // 🔥 ОТПРАВЛЯЕМ ОТВЕТ НА ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ
        await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
          chat_id: targetDialog.userChatId,
          text: `${messages[userLang].supportResponse}:\n\n${adminReplyText}`
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

// 🔥 ДОБАВЛЕНО: Функция получения языка пользователя
function getUserLanguage(userId) {
  const dialog = userDialogs.get(userId);
  return dialog?.language || 'ru'; // Русский по умолчанию
}

// 🔥 ПЕРЕДЕЛАНО: Обработка команд для бота поддержки с мультиязычностью
async function handleSupportBotCommand(message) {
  const chatId = message.chat.id;
  const text = message.text;
  const userId = message.from.id;
  
  const userLang = getUserLanguage(userId);
  
  try {
    if (text === '/start' || text === '/start@' + (await getBotUsername())) {
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages[userLang].welcome
      });
      
    } else if (text === '/help' || text === '/help@' + (await getBotUsername())) {
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages[userLang].help
      });
      
    } else if (text === '/english' || text === '/en') {
      // 🔥 ПЕРЕКЛЮЧЕНИЕ НА АНГЛИЙСКИЙ
      if (userDialogs.has(userId)) {
        userDialogs.get(userId).language = 'en';
      } else {
        userDialogs.set(userId, { language: 'en', userChatId: chatId });
      }
      
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages.en.languageChanged
      });
      
    } else if (text === '/russian' || text === '/ru') {
      // 🔥 ПЕРЕКЛЮЧЕНИЕ НА РУССКИЙ
      if (userDialogs.has(userId)) {
        userDialogs.get(userId).language = 'ru';
      } else {
        userDialogs.set(userId, { language: 'ru', userChatId: chatId });
      }
      
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages.ru.languageChangedRU
      });
      
    } else if (text === '/language' || text === '/lang') {
      // 🔥 ТЕКУЩИЙ ЯЗЫК
      const currentLang = getUserLanguage(userId);
      const langText = currentLang === 'ru' ? 'Русский' : 'English';
      
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: `🌐 Текущий язык / Current language: ${langText}\n\nUse /english for English\nИспользуйте /russian для русского`
      });
      
    } else {
      // 🔥 НЕИЗВЕСТНАЯ КОМАНДА
      await axios.post(`${TELEGRAM_API_SUPPORT}/sendMessage`, {
        chat_id: chatId,
        text: messages[userLang].unknownCommand
      });
    }
  } catch (error) {
    console.error('Error handling command:', error);
  }
}

// 🔥 ДОБАВЛЕНО: Функция для получения username бота
async function getBotUsername() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/getMe`);
    return response.data.result.username;
  } catch (error) {
    return 'support_bot';
  }
}

// 🔥 ДОБАВЛЕНО: Установка вебхука для бота поддержки
app.post("/api/setup-support-webhook", authMiddleware, async (req, res) => {
  try {
    if (!SUPPORT_BOT_TOKEN) {
      return res.status(400).json({
        success: false,
        error: 'SUPPORT_BOT_TOKEN not configured'
      });
    }
    
    const webhookUrl = `https://${req.get('host')}/webhook-support`;
    
    const response = await axios.get(
      `https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/setWebhook?url=${webhookUrl}`
    );
    
    res.json({
      success: true,
      webhookUrl: webhookUrl,
      telegramResponse: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔥 ОБНОВЛЕННЫЙ корневой маршрут
app.get("/", (req, res) => {
  res.json({
    message: "PayPal Server is running!",
    features: {
      multiLanguage: "✅ Enabled (Russian/English)",
      supportBot: SUPPORT_BOT_TOKEN ? "✅ Configured" : "❌ Not configured",
      paypalBot: PAYPAL_BOT_TOKEN ? "✅ Configured" : "❌ Not configured"
    },
    commands: {
      start: "/start - Welcome message",
      help: "/help - Help information", 
      english: "/english - Switch to English",
      russian: "/russian - Switch to Russian",
      language: "/language - Current language"
    }
  });
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

// --- Файлы для заказов ---
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
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 🔥 ДОБАВЛЕНО: УЛУЧШЕННАЯ функция сохранения платежа в Firebase
async function savePaymentToFirebase(paymentData) {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !db) {
    return { success: false, error: 'Firebase config missing' };
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
        items: paymentData.items.reduce((sum, item) => sum + (item.price * item.qty), 0) 
      },
      items: paymentData.items.map((item, index) => ({ 
        id: index + 1, 
        name: item.name, 
        quantity: item.qty, 
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
    const localSaveResult = savePaymentToLocal({ ...firebaseData, firebaseId: paymentRef.id });
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
  console.log(`🤖 Multi-language support: ✅ ENABLED`);
  console.log(`💬 Support Bot: ${SUPPORT_BOT_TOKEN ? '✅ READY' : '❌ NOT CONFIGURED'}`);
  console.log(`💳 PayPal Bot: ${PAYPAL_BOT_TOKEN ? '✅ READY' : '❌ NOT CONFIGURED'}`);
  console.log(`🌐 Available commands: /start, /help, /english, /russian, /language`);
});