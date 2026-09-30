const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();


const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'твой_секретный_ключ';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// База данных SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Подключено к базе данных');
});

// Создаём таблицы
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        balance REAL DEFAULT 0,
        questions_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER,
        referred_id INTEGER,
        reward REAL DEFAULT 50,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(referrer_id) REFERENCES users(id),
        FOREIGN KEY(referred_id) REFERENCES users(id)
    )`);
});

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, refCode } = req.body;

        // Проверка данных
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль минимум 6 символов' });
        }

        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);

        // Генерируем реферальный код
        const myRefCode = 'REF' + Date.now() + Math.random().toString(36).substr(2, 5);

        // Вставляем пользователя
        db.run(
            'INSERT INTO users (username, email, password, ref_code) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, myRefCode],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Пользователь уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }

                const userId = this.lastID;

                // Если есть реферер, начисляем награду
                if (refCode) {
                    db.get('SELECT id FROM users WHERE ref_code = ?', [refCode], (err, referrer) => {
                        if (referrer) {
                            db.run('UPDATE users SET balance = balance + 50 WHERE id = ?', [referrer.id]);
                            db.run('INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)', 
                                [referrer.id, userId]);
                        }
                    });
                }

                // Создаём токен
                const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });

                res.json({ 
                    success: true, 
                    token, 
                    userId,
                    refCode: myRefCode,
                    message: 'Регистрация успешна!' 
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Неверные данные' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Неверные данные' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ 
            success: true, 
            token,
            userId: user.id,
            username: user.username,
            balance: user.balance,
            refCode: user.ref_code
        });
    });
});

// Получение данных пользователя
app.get('/api/user/:userId', (req, res) => {
    const { userId } = req.params;

    db.get('SELECT id, username, email, balance, questions_count, ref_code FROM users WHERE id = ?', 
        [userId], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json(user);
        }
    );
});



// Отправка вопроса к ИИ (здесь можно подключить реальную нейросеть)
app.post('/api/ask', (req, res) => {
    const { userId, question } = req.body;

    // Проверяем пользователя
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Здесь можно добавить проверку баланса или лимит вопросов
        
        // Увеличиваем счётчик вопросов
        db.run('UPDATE users SET questions_count = questions_count + 1 WHERE id = ?', [userId]);

        // Пример ответа (здесь подключи реальную нейросеть)
        const aiResponse = generateAIResponse(question);

        res.json({ 
            success: true, 
            answer: aiResponse,
            questionsCount: user.questions_count + 1
        });
    });
});

// Простая функция для генерации ответов (замени на реальную нейросеть)
function generateAIResponse(question) {
    const responses = {
        'привет': 'Привет! Чем могу помочь?',
        'как дела': 'У меня всё отлично! А у тебя?',
        'что ты умеешь': 'Я могу отвечать на вопросы, помогать с задачами и просто общаться!',
        'спасибо': 'Всегда пожалуйста! Обращайся ещё!'
    };

    const lowerQuestion = question.toLowerCase();
    
    for (let key in responses) {
        if (lowerQuestion.includes(key)) {
            return responses[key];
        }
    }

    return 'Интересный вопрос! Давай разберёмся вместе. Расскажи подробнее, что тебя интересует?';
}

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});