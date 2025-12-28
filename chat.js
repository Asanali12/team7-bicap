// chat.js
const socket = io({ query: { userId: getUserId() } });

const messages = document.getElementById("messages");
const input = document.getElementById("inputText");
const btn = document.getElementById("sendBtn");
const conversationsList = document.getElementById("conversationsList");
const newChatBtn = document.getElementById("newChatBtn");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const mainChat = document.querySelector(".main-chat");
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.querySelector(".settings-panel");
const settingsOverlay = document.getElementById("settings-overlay");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const inputContainer = document.querySelector(".input-container");
const suggestionsContainer = document.getElementById("suggestions-container");
const emptyState = document.getElementById("empty-state");

let currentConvId = null;
let conversations = [];
let typingTimeout = null;
let deletePending = new Set();
let currentBotMessage = null;
let streamBuffer = "";

// Локальные генераторы вопросов на клиенте (для замены одного удалённого вопроса)
function getRandomQuestions_ru(count = 1) {
    const pool = [
        "Расскажи кратко о жизни Абая Кунанбаева",
        "Какие основные темы в 'Словах назидания' Абая?",
        "Что Абай говорил о настоящей дружбе?",
        "Как Абай относился к образованию и просвещению?",
        "Назови самые известные стихотворения Абая",
        "В чём актуальность идей Абая в наше время?",
        "Что Абай думал о лени и трудолюбии?",
        "Как Абай критиковал обычаи своего времени?",
        "Расскажи о переводческой деятельности Абая",
        "Какое 'Слово назидания' тебе ближе всего?",
        "Что Абай говорил о богатстве и бедности?",
        "Как Абай относился к религии?",
        "Какое влияние оказал Абай на казахскую литературу?",
        "Что бы Абай сказал современным молодым людям?",
        "Расскажи о поэтическом стиле Абая",
        "Как применить советы Абая в повседневной жизни?",
        "Что Абай думал о любви и семье?",
        "Кто были главные учителя Абая?",
        "Абай и русская литература",
        "Почему Абая называют просветителем?",
        "Расскажи о конфликте Абая с аулом",
        "Что Абай говорил о роли женщины?",
        "Как Абай относился к власти?",
        "Образы природы в поэзии Абая",
        "Что Абай думал о смысле жизни?",
        "Музыкальное наследие Абая",
        "Как Абай боролся с невежеством?",
        "Отличие Абая от других поэтов",
        "Абай о языке и культуре",
        "Идеи Абая и движение 'Алаш'"
    ];
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function getRandomQuestions_kk(count = 1) {
    const pool = [
        "Абай Құнанбаевтың өмірі туралы қысқаша айтып бер",
        "Абайдың 'Қара сөздерінің' негізгі тақырыптары қандай?",
        "Абай шынайы достық туралы не айтқан?",
        "Абай білім мен ағартуға қалай қараған?",
        "Абайдың ең танымал өлеңдерін аташы",
        "Абайдың идеялары қазіргі заманда өзекті ме?",
        "Абай жалқаулық пен еңбекқорлық туралы не деп ойлаған?",
        "Абай өз заманындағы әдет-ғұрыптарды қалай сынға алған?",
        "Абайдың аудармашылық қызметі туралы айтшы",
        "Саған қай 'Қара сөз' ең жақын?",
        "Абай байлық пен кедейлік туралы не айтқан?",
        "Абай дінге қалай қараған?",
        "Абайдың қазақ әдебиетіне ықпалы қандай?",
        "Абай бүгінгі жастарға не айтар еді?",
        "Абай поэзиясының стилі қандай?",
        "Абайдың кеңестерін күнделікті өмірде қалай қолдануға болады?",
        "Абай махаббат пен отбасы туралы не деп ойлаған?",
        "Абайдың ұстаздары кімдер болған?",
        "Абай және орыс әдебиеті",
        "Абайды ағартушы деп неге атайды?",
        "Абайдың ауылымен қақтығысы туралы",
        "Абай әйел орны туралы не айтқан?",
        "Абай билікке қалай қараған?",
        "Абай өлеңдеріндегі табиғат бейнелері",
        "Абай өмір мәні туралы не деп ойлаған?",
        "Абайдың музыкалық мұрасы",
        "Абай надандықпен қалай күрескен?",
        "Абайды басқа ақындардан ерекшелеітіні",
        "Абай тіл мен мәдениет туралы",
        "Абай идеялары және 'Алаш' қозғалысы"
    ];
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('abayTheme') || 'light';
    toggleTheme(savedTheme);
}

function toggleTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    localStorage.setItem('abayTheme', theme);
    updateThemeButtons(isDark);
}

function updateThemeButtons(isDark) {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === (isDark ? 'dark' : 'light'));
    });
}

// Language management
let currentLang = 'ru';

function initLanguage() {
    currentLang = localStorage.getItem('abayLang') || 'ru';
    applyLanguage(currentLang);
    updateLanguageButtons(currentLang);
}

function applyLanguage(lang) {
    currentLang = lang;
    const t = window.I18N[lang];

    document.getElementById('newChatBtn').textContent = t.newChat;

    const noChats = document.querySelector('.no-chats');
    if (noChats) noChats.textContent = t.noChats;

    document.querySelector('.settings-header h2').textContent = t.settings;
    document.querySelectorAll('.setting-label').forEach((label, i) => {
        label.textContent = i === 0 ? t.language : t.theme;
    });

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.textContent = t[btn.dataset.theme];
    });

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.textContent = btn.dataset.lang === 'ru' ? 'Русский' : 'Қазақша';
    });

    input.placeholder = t.inputPlaceholder;

    const emptyTitle = document.querySelector('.empty-title');
    const emptySubtitle = document.querySelector('.empty-subtitle');
    if (emptyTitle) emptyTitle.textContent = t.emptyTitle;
    if (emptySubtitle) emptySubtitle.textContent = t.emptySubtitle;

    socket.emit('set-language', lang);
}

function setLanguage(lang) {
    localStorage.setItem('abayLang', lang);
    updateLanguageButtons(lang);
    applyLanguage(lang);
}

function updateLanguageButtons(lang) {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
}

// Settings
function toggleSettings() {
    settingsPanel.classList.toggle('open');
    settingsOverlay.classList.toggle('open');
}

function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('open');
}

// Sidebar
function toggleSidebar() {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('open');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
}

// User ID
function getUserId() {
    let userId = localStorage.getItem('abayUserId');
    if (!userId) {
        userId = crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('abayUserId', userId);
    }
    return userId;
}

// Input control
function disableInput() {
    input.disabled = true;
    btn.disabled = true;
    input.style.opacity = "0.5";
    btn.style.opacity = "0.5";
}

function enableInput() {
    input.disabled = false;
    btn.disabled = false;
    input.style.opacity = "1";
    btn.style.opacity = "1";
    input.placeholder = window.I18N[currentLang].inputPlaceholder;
}

// Show/hide suggestions
function showSuggestions(questions) {
    suggestionsContainer.innerHTML = '';
    if (questions && questions.length > 0) {
        questions.forEach(q => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-btn';
            btn.textContent = q;

            btn.onclick = () => {
                input.value = q;
                send();

                btn.style.transition = 'all 0.3s ease';
                btn.style.opacity = '0';
                btn.style.transform = 'scale(0.9)';
                btn.style.pointerEvents = 'none';

                setTimeout(() => {
                    btn.remove();

                    const newQ = currentLang === 'kk' ? getRandomQuestions_kk(1)[0] : getRandomQuestions_ru(1)[0];

                    const newBtn = document.createElement('button');
                    newBtn.className = 'suggestion-btn';
                    newBtn.textContent = newQ;
                    newBtn.style.opacity = '0';
                    newBtn.style.transform = 'scale(0.9)';

                    newBtn.onclick = () => {
                        input.value = newQ;
                        send();

                        newBtn.style.transition = 'all 0.3s ease';
                        newBtn.style.opacity = '0';
                        newBtn.style.transform = 'scale(0.9)';
                        setTimeout(() => newBtn.remove(), 300);
                    };

                    suggestionsContainer.appendChild(newBtn);

                    setTimeout(() => {
                        newBtn.style.opacity = '1';
                        newBtn.style.transform = 'scale(1)';
                    }, 10);
                }, 300);
            };

            suggestionsContainer.appendChild(btn);
        });
        suggestionsContainer.classList.remove('hidden');
    } else {
        suggestionsContainer.classList.add('hidden');
    }
}

function hideSuggestions() {
    suggestionsContainer.classList.add('hidden');
}

// Show/hide empty state
function showEmptyState() {
    emptyState.classList.remove('hidden');
}

function hideEmptyState() {
    emptyState.classList.add('hidden');
}

// Add message + auto scroll + Markdown support
function addMessage(text, who, animate = true) {
    const div = document.createElement("div");
    div.className = `msg ${who}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${who}`;
    avatar.innerHTML = who === "user" ? "👤" : "🤖";

    const content = document.createElement("div");
    content.className = "content";
    
    if (who === "bot" && typeof marked !== 'undefined') {
        content.innerHTML = marked.parse(text);
    } else {
        content.innerText = text;
    }

    div.appendChild(avatar);
    div.appendChild(content);
    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;

    if (animate) {
        div.style.opacity = "0";
        div.style.transform = "translateY(10px)";
        setTimeout(() => {
            div.style.transition = "all 0.3s ease";
            div.style.opacity = "1";
            div.style.transform = "translateY(0)";
        }, 10);
    }

    return div;
}

// Load chat
function loadChat(convId, msgs, isNew = false) {
    const allMessages = messages.querySelectorAll('.msg');
    allMessages.forEach(msg => msg.remove());
    
    currentConvId = convId;
    hideSuggestions();

    if (msgs.length === 0) {
        showEmptyState();
    } else {
        hideEmptyState();
        msgs.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot', false);
        });
    }

    document.querySelectorAll('.conversations-list li').forEach(li => li.classList.remove('active'));
    const activeLi = conversationsList.querySelector(`[data-id="${convId}"]`)?.closest('li');
    if (activeLi) activeLi.classList.add('active');
}

// Render conversations
function renderConversations(convs) {
    conversations = convs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    conversationsList.innerHTML = '';

    if (convs.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-chats';
        li.textContent = window.I18N[currentLang]?.noChats || 'Нет чатов. Создайте первый!';
        conversationsList.appendChild(li);
        return;
    }

    const isOnlyOne = convs.length === 1;

    convs.forEach(conv => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="conv-header">
                <div class="conv-title">${conv.title}</div>
                <div class="conv-actions">
                    <button class="action-btn rename-btn" data-id="${conv.id}" title="Переименовать">✏️</button>
                    <button class="action-btn delete-btn" data-id="${conv.id}" ${isOnlyOne ? 'disabled' : ''} title="Удалить">🗑️</button>
                </div>
            </div>
            <div class="conv-date">${new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
        `;

        if (conv.id === currentConvId) li.classList.add('active');

        li.addEventListener('click', (e) => {
            if (!e.target.closest('.action-btn')) {
                switchConversation(conv.id);
                closeSidebar();
            }
        });

        conversationsList.appendChild(li);
    });
}

// Switch conversation
function switchConversation(convId) {
    socket.emit("switch-conversation", convId);
}

// Events
btn.onclick = send;
input.onkeydown = (e) => {
    if (e.key === "Enter" && !input.disabled && currentConvId) send();
};

newChatBtn.onclick = () => {
    socket.emit("new-conversation");
    closeSidebar();
};

hamburgerBtn.onclick = toggleSidebar;
sidebarOverlay.onclick = closeSidebar;

settingsBtn.onclick = toggleSettings;
closeSettingsBtn.onclick = closeSettings;
settingsOverlay.onclick = closeSettings;

document.querySelectorAll('.lang-btn').forEach(btn => btn.addEventListener('click', () => setLanguage(btn.dataset.lang)));
document.querySelectorAll('.theme-btn').forEach(btn => btn.addEventListener('click', () => toggleTheme(btn.dataset.theme)));

function send() {
    if (input.disabled || !currentConvId) return;

    const text = input.value.trim();
    if (!text) return;

    hideEmptyState();
    hideSuggestions();
    
    addMessage(text, "user");
    socket.emit("message", { text, convId: currentConvId });

    input.value = "";
    disableInput();
}

// Actions in list
conversationsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('rename-btn')) {
        const convId = e.target.dataset.id;
        const conv = conversations.find(c => c.id == convId);
        const newTitle = prompt('Новое название:', conv?.title || '');
        if (newTitle && newTitle.trim()) {
            socket.emit("rename-conversation", { convId, newTitle: newTitle.trim() });
        }
    } else if (e.target.classList.contains('delete-btn') && !e.target.disabled) {
        const convId = e.target.dataset.id;
        if (confirm('Удалить чат? Все сообщения потеряются.')) {
            socket.emit("delete-conversation", convId);
        }
    }
});

// Socket events - STREAMING
socket.on("bot-stream-start", () => {
    streamBuffer = "";
    currentBotMessage = addMessage("", "bot");
    const content = currentBotMessage.querySelector('.content');
    content.innerHTML = '<span class="cursor-blink">▋</span>';
});

socket.on("bot-stream-chunk", (data) => {
    if (!currentBotMessage) return;
    
    streamBuffer += data.content;
    const content = currentBotMessage.querySelector('.content');
    
    if (typeof marked !== 'undefined') {
        content.innerHTML = marked.parse(streamBuffer) + '<span class="cursor-blink">▋</span>';
    } else {
        content.textContent = streamBuffer;
        content.innerHTML += '<span class="cursor-blink">▋</span>';
    }
    
    messages.scrollTop = messages.scrollHeight;
});

socket.on("bot-stream-end", () => {
    if (currentBotMessage) {
        const content = currentBotMessage.querySelector('.content');
        const cursor = content.querySelector('.cursor-blink');
        if (cursor) cursor.remove();
        
        if (typeof marked !== 'undefined') {
            content.innerHTML = marked.parse(streamBuffer);
        } else {
            content.textContent = streamBuffer;
        }
    }
    currentBotMessage = null;
    streamBuffer = "";
    enableInput();
    if (typingTimeout) clearTimeout(typingTimeout);
});

socket.on("bot-message", (data) => {
    addMessage(data.text, "bot");
    enableInput();
    if (typingTimeout) clearTimeout(typingTimeout);
});

socket.on("suggested-questions", ({ questions }) => {
    const msgElements = messages.querySelectorAll('.msg');
    if (msgElements.length > 0) {
        showSuggestions(questions);
    }
});

socket.on("load-conversations", renderConversations);

socket.on("load-chat", ({ convId, messages: msgs, isNew }) => {
    loadChat(convId, msgs, isNew);
});

socket.on("new-conversation", ({ convId }) => {
    switchConversation(convId);
});

socket.on("chat-deleted", ({ convId }) => {
    if (currentConvId == convId) {
        const allMessages = messages.querySelectorAll('.msg');
        allMessages.forEach(msg => msg.remove());
        currentConvId = null;
        hideSuggestions();

        const remaining = conversations.filter(c => c.id != convId);
        if (remaining.length > 0) {
            const latest = remaining.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
            switchConversation(latest.id);
        } else {
            showEmptyState();
        }
    }
    deletePending.delete(convId);
});

socket.on("delete-failed", ({ reason }) => {
    alert(reason);
});

socket.on("chat-invalid", () => {
    if (conversations.length > 0) {
        const latest = conversations[0];
        switchConversation(latest.id);
    }
});

socket.on("title-updated", ({ convId, title }) => {
    const conv = conversations.find(c => c.id === convId);
    if (conv) {
        conv.title = title;
        renderConversations(conversations);
    }
});

// Input focus
input.addEventListener('focus', () => {
    setTimeout(() => {
        messages.scrollTop = messages.scrollHeight;
    }, 300);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initLanguage();
});

socket.on('connect', () => {
    console.log("Подключен к Абай-боту");
});