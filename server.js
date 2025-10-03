const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(cors()); // 🔹 Разрешаем запросы с Tilda

// --- Файлы для хранения отзывов и покупок ---
const reviewsFile = path.join(__dirname, "reviews.json");
const purchasesFile = path.join(__dirname, "purchases.json");

if (!fs.existsSync(reviewsFile)) fs.writeFileSync(reviewsFile, "[]", "utf-8");
if (!fs.existsSync(purchasesFile)) fs.writeFileSync(purchasesFile, "[]", "utf-8");

// --- PayPal Webhook ---
app.post("/webhook", async (req, res) => {
  console.log("Webhook получил событие:", JSON.stringify(req.body, null, 2));

  const details = req.body;
  const nickname = details.nickname || "Без ника";

  // Сохраняем покупку
  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  purchases.push({
    nickname,
    transactionId: details.transactionId,
    items: details.items,
    amount: details.amount,
    date: new Date().toISOString()
  });
  fs.writeFileSync(purchasesFile, JSON.stringify(purchases, null, 2));

  // Отправляем уведомление в Telegram (если настроен)
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: `💰 Новая покупка PayPal от ${nickname}:\n${JSON.stringify(details, null, 2)}`
        }
      );
    } catch (err) {
      console.error("Ошибка отправки Telegram уведомления:", err.message);
    }
  }

  res.status(200).send("OK");
});

// --- API отзывов ---
app.get("/api/reviews", (req, res) => {
  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
  res.json(reviews);
});

app.post("/api/reviews", (req, res) => {
  const { nickname, review } = req.body;

  if (!nickname || !review) {
    return res.status(400).json({ error: "Заполните все поля" });
  }

  const purchases = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  const hasPurchase = purchases.some(p => p.nickname === nickname);

  if (!hasPurchase) {
    return res.status(403).json({ error: "Вы не совершили покупку, отзыв оставить нельзя" });
  }

  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf-8"));
  reviews.push({ nickname, review, date: new Date().toISOString() });
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2));

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
