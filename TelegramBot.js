import express from "express";
import bodyParser from "body-parser";
import TelegramBot from "node-telegram-bot-api";

const TOKEN = "ТВОЙ_ТОКЕН_БОТА"; // токен из @BotFather
const OWNER_ID = ТВОЙ_TELEGRAM_ID; // свой ID — узнай у @userinfobot
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

// Telegram Bot API (используем webhook)
const bot = new TelegramBot(TOKEN);
bot.setWebHook(`https://твоя-ссылка-на-render.onrender.com/webhook`);

// Когда Telegram отправляет сообщение на webhook
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Словарь для связи "пользователь → владелец"
const userMap = new Map();

// Когда бот получает сообщение
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Если пишет клиент
  if (chatId !== OWNER_ID) {
    userMap.set(OWNER_ID, chatId); // сохраняем ID клиента
    bot.sendMessage(OWNER_ID, `💬 От @${msg.from.username || msg.from.first_name}:\n${text}`);
  }

  // Если ты отвечаешь клиенту (в своём чате с ботом)
  if (chatId === OWNER_ID && msg.reply_to_message) {
    const replyText = msg.text;
    const originalText = msg.reply_to_message.text;

    // Ищем ID пользователя, которому нужно отправить ответ
    for (const [owner, userChatId] of userMap.entries()) {
      if (owner === OWNER_ID) {
        await bot.sendMessage(userChatId, replyText);
      }
    }
  }
});

app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
