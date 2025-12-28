// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { ABAY_SYSTEM_PROMPT, getRandomQuestions_ru, getRandomQuestions_kk } from "./consts.js";
import sqlite3 from 'sqlite3';
import path from 'path';
import { promisify } from 'util';
import { Ollama } from 'ollama';
import fs from 'fs';
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

// ==================== SQLite Setup ====================
const dbPath = path.join(process.cwd(), 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('БД подключена: db.sqlite');
        initDB();
    }
});

const dbGetAsync = promisify(db.get.bind(db));
const dbAllAsync = promisify(db.all.bind(db));

function dbRunAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            title TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS conversation_suggestions (
            conversation_id INTEGER PRIMARY KEY,
            questions TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_user_conv ON conversations(user_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_conv_msg ON messages(conversation_id)');
    });
}

// Сохранение и загрузка suggested questions
async function saveSuggestedQuestions(convId, questions) {
    const questionsJson = JSON.stringify(questions);
    await dbRunAsync(
        `INSERT INTO conversation_suggestions (conversation_id, questions) 
         VALUES (?, ?) 
         ON CONFLICT(conversation_id) DO UPDATE SET 
         questions = excluded.questions, updated_at = CURRENT_TIMESTAMP`,
        [convId, questionsJson]
    );
}

async function loadSuggestedQuestions(convId) {
    try {
        const row = await dbGetAsync(
            "SELECT questions FROM conversation_suggestions WHERE conversation_id = ?",
            [convId]
        );
        return row ? JSON.parse(row.questions) : null;
    } catch (err) {
        console.error("Ошибка загрузки suggestions:", err);
        return null;
    }
}

const ollama = new Ollama({ host: 'http://localhost:11434' });

// ==================== Генерация заголовка чата ====================
async function generateChatTitle(firstQuestion, lang = 'ru') {
    try {
        const isKazakh = lang === 'kk';
        const prompt = isKazakh
            ? `Создай краткое название чата для этого вопроса, ИСКЛЮЧИТЕЛЬНО НА КАЗАХСКОМ ЯЗЫКЕ ДАЖЕ ЕСЛИ ДИАЛОГ РУССКИЙ, БЕЗ ИЕРОГЛИФОВ И ПРОЧЕГО (4-6 слов): "${firstQuestion}"`
            : `Создай краткое название чата для этого вопроса, ИСКЛЮЧИТЕЛЬНО НА РУССКОМ ЯЗЫКЕ ДАЖЕ ЕСЛИ ДИАЛОГ КАЗАХСКИЙ, БЕЗ ИЕРОГЛИФОВ И ПРОЧЕГО (4-6 слов): "${firstQuestion}"`;

        const response = await ollama.chat({
            model: 'gemma2:2b',
            messages: [
                {
                    role: 'system',
                    content: 'Ты генеришь короткие названия для чатов. Отвечай ТОЛЬКО названием, без кавычек, точек, объяснений и лишнего текста. НЕ ИСПОЛЬЗУЙ ИЕРОГЛИФЫ И ИНОСТРАННЫЕ ЯЗЫКИ ТИПА АНГЛИЙСКОГО ЛИБО ДРУГОГО ЛАТИНСКОГО'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            options: {
                temperature: 0.7,
                num_predict: 30
            }
        });

        let title = response.message.content.trim();
        title = title.replace(/^["«»'"]+|["«»'"]+$/g, '').replace(/\.$/, '');

        console.log('✅ Название чата сгенерировано успешно:', `"${title}"`);

        return title || (isKazakh ? 'Жаңа чат' : 'Новый чат');
    } catch (err) {
        console.error("Ошибка генерации названия через Ollama:", err.message);
        return lang === 'kk' ? 'Жаңа чат' : 'Новый чат';
    }
}

// ==================== Генерация предложенных вопросов ====================
async function generateSuggestedQuestions(conversationId, userLang = 'ru') {
    try {
        const rows = await dbAllAsync(
            "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 8",
            [conversationId]
        );

        if (rows.length === 0) {
            const fallback = userLang === 'kk' ? getRandomQuestions_kk(4) : getRandomQuestions_ru(4);
            await saveSuggestedQuestions(conversationId, fallback);
            return fallback;
        }

        const context = rows.reverse()
            .map(r => `${r.role === 'user' ? 'Пользователь' : 'Абай'}: ${r.content}`)
            .join("\n");

        const isKazakh = userLang === 'kk';

        const languageBlock = isKazakh
            ? "ОТВЕЧАЙ ТОЛЬКО НА КАЗАХСКОМ ЯЗЫКЕ. БЕЗ ЛАТИНИЦЫ И ДРУГИХ ЯЗЫКОВ."
            : "ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. БЕЗ АНГЛИЙСКИХ СЛОВ И ЛАТИНИЦЫ.";

        try {
            const response = await ollama.chat({
                model: 'qwen2.5:3b',
                messages: [
                    {
                        role: 'system',
                        content: `Ты — эксперт по Абаю Кунанбаеву.
${languageBlock}

Твоя задача: придумать ровно 4 коротких, реальных и интересных вопроса для продолжения чата.
Правила формата (строго соблюдай):
- Ровно 4 строки
- Каждая строка — один вопрос
- Вопрос начинается сразу, без цифр, без "1." "2." и т.п.
- Длина вопроса: 3–8 слов
- Обязательно заканчивается на "?"
- Никакого лишнего текста, номеров, тире, кавычек`
                    },
                    {
                        role: 'user',
                        content: `Контекст чата:\n${context}\n\nПридумай 4 вопроса про Абая Кунанбаева:`
                    }
                ],
                options: {
                    temperature: 0.75,
                    num_predict: 140
                }
            });

            let text = response.message.content.trim();
            text = text.replace(/[\u4e00-\u9fff]/g, '');
            text = text.replace(/^\d+\.\s*/gm, '');

            let questions = text
                .split('\n')
                .map(q => q.trim())
                .filter(q => q.length > 15 && q.length < 100 && q.endsWith('?') && !/^\d/.test(q))
                .slice(0, 4);

            if (questions.length < 4) {
                const fallback = isKazakh ? getRandomQuestions_kk(4) : getRandomQuestions_ru(4);
                questions = [...questions, ...fallback.slice(questions.length)].slice(0, 4);
            }

            console.log('✅ Предложенные вопросы сгенерированы');
            await saveSuggestedQuestions(conversationId, questions);
            return questions;

        } catch (err) {
            console.warn("❌ Ollama ошибка в generateSuggestedQuestions:", err.message);
        }

    } catch (err) {
        console.warn("Общая ошибка в generateSuggestedQuestions:", err);
    }

    const fallback = userLang === 'kk' ? getRandomQuestions_kk(4) : getRandomQuestions_ru(4);
    await saveSuggestedQuestions(conversationId, fallback);
    return fallback;
}

async function askAbay(question, conversationId, lang = "ru", socket) {
    const q = question.trim();
    if (!q) return "";

    let fullResponse = "";

    try {
        const stream = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            stream: true,
            temperature: 0.7,
            messages: [
                {
                    role: "system",
                    content: lang === 'kk' ? ABAY_SYSTEM_PROMPT.replaceAll("ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО НА РУССКОМ ЯЗЫКЕ", "ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО НА КАЗАХСКОМ ЯЗЫКЕ") : ABAY_SYSTEM_PROMPT
                },
                {
                    role: "user",
                    content: q
                }
            ]
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                fullResponse += delta;
                socket.emit("bot-stream-chunk", {
                    content: delta,
                    convId: conversationId
                });
            }
        }
        return fullResponse;

    } catch (err) {
        console.error("GPT-4o-mini error:", err.message || err);

        const fallback =
            lang === "kk"
                ? "Кешір, ойым шашырап тұр..."
                : `Техническая ошибка: ${err.message || err}`;

        socket.emit("bot-stream-start", { convId: conversationId });
        socket.emit("bot-stream-chunk", {
            content: fallback,
            convId: conversationId
        });
        socket.emit("bot-stream-end", { convId: conversationId });

        return fallback;
    }
}

// ==================== Socket.IO ====================
io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;
    let userLang = 'ru';

    socket.on('set-language', (lang) => {
        if (['ru', 'kk'].includes(lang)) {
            userLang = lang;
            console.log(`Язык пользователя ${userId}: ${lang}`);
        }
    });

    console.log("Подключение:", socket.id, "User:", userId);

    db.get("SELECT id FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) console.error(err);
        if (!row) db.run("INSERT INTO users (id) VALUES (?)", [userId]);
    });

    async function loadConversations() {
        try {
            const rows = await dbAllAsync("SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
            socket.emit("load-conversations", rows || []);
        } catch (err) {
            console.error(err);
        }
    }

    let currentConvId = null;

    async function loadCurrentConversation() {
        try {
            const conv = await dbGetAsync("SELECT id FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", [userId]);
            currentConvId = conv ? conv.id : null;
            if (currentConvId) {
                await loadConversationById(currentConvId);
            } else {
                await createNewConversation(userLang === 'kk' ? "Жаңа чат" : "Новый чат");
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function loadConversationById(convId) {
        try {
            const msgs = await dbAllAsync("SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC", [convId]);
            socket.emit("load-chat", { convId, messages: msgs || [], isNew: false });

            if (msgs && msgs.length > 0) {
                let suggestions = await loadSuggestedQuestions(convId);

                if (!suggestions || suggestions.length === 0) {
                    suggestions = await generateSuggestedQuestions(convId, userLang);
                }

                if (suggestions && suggestions.length > 0) {
                    socket.emit("suggested-questions", { questions: suggestions, convId });
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function createNewConversation(title = "Новый чат") {
        try {
            const result = await dbRunAsync("INSERT INTO conversations (user_id, title) VALUES (?, ?)", [userId, title]);
            const newConvId = result.lastID;
            socket.emit("new-conversation", { convId: newConvId, isNew: true });
            await loadConversations();
            await loadConversationById(newConvId);
        } catch (err) {
            console.error(err);
        }
    }

    loadCurrentConversation();
    loadConversations();

    socket.on("new-conversation", async () => {
        const newTitle = userLang === 'kk' ? "Жаңа чат" : "Новый чат";
        await createNewConversation(newTitle);
    });

    socket.on("message", async (data) => {
        const { text, convId } = data;
        if (!text.trim() || !convId) return;

        try {
            const row = await dbGetAsync("SELECT id FROM conversations WHERE id = ?", [convId]);
            if (!row) {
                socket.emit("chat-invalid", { message: "Чат удалён. Переключаемся..." });
                await loadCurrentConversation();
                return;
            }

            await dbRunAsync("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)", [convId, text]);

            const msgCount = await dbGetAsync("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?", [convId]);
            const isFirstMessage = msgCount.count === 1;

            // Один раз — начало анимации "думает"
            socket.emit("bot-stream-start", { convId });

            const reply = await askAbay(text, convId, userLang, socket);

            // Один раз — конец анимации
            socket.emit("bot-stream-end", { convId });

            await dbRunAsync("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'bot', ?)", [convId, reply]);
            await dbRunAsync("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [convId]);

            if (isFirstMessage) {
                const newTitle = await generateChatTitle(text, userLang);
                await dbRunAsync("UPDATE conversations SET title = ? WHERE id = ?", [newTitle, convId]);
                socket.emit("title-updated", { convId, title: newTitle });
                await loadConversations();
            }

            const suggestions = await generateSuggestedQuestions(convId, userLang);
            if (suggestions.length > 0) {
                socket.emit("suggested-questions", { questions: suggestions, convId });
            }

        } catch (err) {
            console.error(err);
            socket.emit("bot-stream-end", { convId });
            socket.emit("bot-message", { from: "abay", text: "Ошибка. Попробуй ещё.", convId });
        }
    });

    socket.on("switch-conversation", async (convId) => {
        const row = await dbGetAsync("SELECT id FROM conversations WHERE id = ?", [convId]);
        if (row) {
            currentConvId = convId;
            await loadConversationById(convId);
        } else {
            socket.emit("chat-invalid", { message: "Чат не найден." });
            await loadCurrentConversation();
        }
    });

    socket.on("rename-conversation", async ({ convId, newTitle }) => {
        try {
            await dbRunAsync("UPDATE conversations SET title = ? WHERE id = ?", [newTitle, convId]);
            await loadConversations();
        } catch (err) {
            console.error(err);
        }
    });

    socket.on("delete-conversation", async (convId) => {
        try {
            const countRow = await dbGetAsync("SELECT COUNT(*) as count FROM conversations WHERE user_id = ?", [userId]);
            if (countRow && countRow.count > 1) {
                await dbRunAsync("DELETE FROM conversations WHERE id = ?", [convId]);
                await loadConversations();
                socket.emit("chat-deleted", { convId });
                if (currentConvId === convId) {
                    await loadCurrentConversation();
                }
            } else {
                socket.emit("delete-failed", { reason: "Нельзя удалить единственный чат." });
            }
        } catch (err) {
            console.error(err);
        }
    });

    socket.on("disconnect", () => console.log("Отключился:", socket.id));
});

server.listen(3000, () => {
    console.log("Абай-бот запущен → http://localhost:3000");
});