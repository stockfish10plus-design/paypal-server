import express from "express";
import bodyParser from "body-parser";
import TelegramBot from "node-telegram-bot-api";

const TOKEN = process.env.SUPPORT_BOT_TOKEN; // Используем переменную окружения
const OWNER_ID = process.env.TELEGRAM_CHAT_ID; // Используем переменную окружения
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

// Telegram Bot API (используем webhook)
const bot = new TelegramBot(TOKEN);

// Словарь для связи "пользователь → владелец"
const userDialogs = new Map();

// Когда бот получает сообщение
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
  const userId = msg.from.id;

  // Если пишет клиент
  if (chatId !== parseInt(OWNER_ID)) {
    // Создаем новый диалог если его нет
    if (!userDialogs.has(userId)) {
      // Отправляем разделитель для нового диалога
      const separator = await bot.sendMessage(
        OWNER_ID,
        `───────────────\n💎 ДИАЛОГ С ${userName.toUpperCase()}\n🆔 ${userId}\n────────────────────`
      );
      
      userDialogs.set(userId, {
        userChatId: chatId,
        userName: userName,
        separatorMessageId: separator.message_id
      });
    }

    const dialog = userDialogs.get(userId);
    
    // Пересылаем сообщение под разделителем
    await bot.sendMessage(
      OWNER_ID,
      `<b>${userName}:</b> ${text}`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: dialog.separatorMessageId
      }
    );

    // Подтверждаем получение
    await bot.sendMessage(chatId, '✅ Ваше сообщение получено. Мы ответим вам в ближайшее время.');
  }

  // Если ты отвечаешь клиенту (в своём чате с ботом)
  if (chatId === parseInt(OWNER_ID) && msg.reply_to_message) {
    const replyText = msg.text;
    const originalMessage = msg.reply_to_message;

    // Ищем пользователя по separatorMessageId или последнему сообщению
    for (const [userId, dialog] of userDialogs.entries()) {
      if (originalMessage.message_id === dialog.separatorMessageId || 
          originalMessage.reply_to_message_id === dialog.separatorMessageId) {
        
        // Отправляем ответ пользователю
        await bot.sendMessage(
          dialog.userChatId,
          `💬 <b>Ответ поддержки:</b>\n${replyText}`,
          { parse_mode: 'HTML' }
        );

        // Отправляем ответ в диалог
        await bot.sendMessage(
          OWNER_ID,
          `<b>Поддержка:</b> ${replyText}`,
          {
            parse_mode: 'HTML',
            reply_to_message_id: dialog.separatorMessageId
          }
        );
        
        break;
      }
    }
  }
});

// Обработка вебхука
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Support Bot is running ✅");
});

// Установка вебхука при старте
const webhookUrl = `https://${req.get('host')}/webhook`;
bot.setWebHook(webhookUrl)
  .then(() => console.log(`Webhook set to: ${webhookUrl}`))
  .catch(err => console.error('Webhook error:', err));

app.listen(PORT, () => console.log(`Support Bot Server is running on port ${PORT}`));