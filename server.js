const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

// Тестовый GET-роут для проверки сервера
app.get("/", (req, res) => {
  res.send("✅ Сервер работает! Webhook ждёт события от PayPal.");
});

// Webhook PayPal
app.post("/webhook", async (req, res) => {
  console.log("Webhook получил событие:");
  console.log(JSON.stringify(req.body, null, 2));

  // Отправка уведомления в Telegram (если настроен)
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: `💰 Новое событие PayPal:\n${JSON.stringify(req.body, null, 2)}`,
        }
      );
    } catch (err) {
      console.error("Ошибка отправки Telegram уведомления:", err.message);
    }
  }

  // Отвечаем PayPal, что webhook обработан
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
