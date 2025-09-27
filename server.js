require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

// Отдаём public.html и все статические файлы из текущей папки
app.use(express.static(path.join(__dirname)));

// Вебхук для PayPal кнопки
app.post("/paypal-webhook", async (req, res) => {
  const { nickname, product, amount, transactionId } = req.body;

  if (!nickname) {
    return res.status(400).send("Ник не передан!");
  }

  // Формируем сообщение для Telegram
  const message = `
💸 Новая покупка!
👤 Ник: ${nickname}
📦 Товар: ${product}
💵 Сумма: ${amount} USD
🆔 Транзакция: ${transactionId}
`;

  try {
    // Отправка сообщения в Telegram
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message,
        }),
      }
    );

    const result = await response.json();

    if (!result.ok) {
      console.error("Ошибка Telegram:", result);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Ошибка отправки:", err);
    res.sendStatus(500);
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
