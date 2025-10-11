// firebase-config.js
const admin = require('firebase-admin');
require('dotenv').config(); // Загружаем переменные из .env

// Берем данные из .env файла
const serviceAccount = {
  type: "service_account",
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

// Подключаемся к Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/`
  });
  console.log('✅ Firebase подключен успешно!');
} catch (error) {
  console.error('❌ Ошибка подключения Firebase:', error);
}

// Получаем доступ к базе данных
const db = admin.firestore();

// Даем доступ к базе данных из других файлов
module.exports = { admin, db };