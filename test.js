(function () {
    'use strict';

    const STORE_KEY = 'hdrezka_amnezia_config';
    const Store = {
        get: function(key, def = null) {
            try {
                const val = localStorage.getItem('plugin_' + STORE_KEY + '_' + key);
                return val ? JSON.parse(val) : def;
            } catch { return def; }
        },
        set: function(key, val) {
            localStorage.setItem('plugin_' + STORE_KEY + '_' + key, JSON.stringify(val));
        }
    };

    // ============================================================
    // 0. Менеджер авторизации HDRezka
    // ============================================================
    class HDRezkaAuth {
        constructor() {
            this.isLoggedIn = false;
            this.sessionCookie = Store.get('session_cookie', '');
            this.username = Store.get('username', '');
            this.password = Store.get('password', '');
        }

        async login(username, password) {
            this.username = username;
            this.password = password;
            Store.set('username', username);
            Store.set('password', password);

            try {
                // 1. Получаем CSRF-токен
                const token = await this.getCsrfToken();
                if (!token) {
                    console.warn('[Auth] Не удалось получить CSRF-токен');
                    return false;
                }

                // 2. Отправляем запрос на логин
                const formData = new URLSearchParams();
                formData.append('login', username);
                formData.append('password', password);
                formData.append('submit', 'submit');
                formData.append('token', token);

                const response = await fetch('https://hdrezka.ag/ajax/login/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    // Сохраняем куки сессии (из заголовков)
                    const cookies = response.headers.get('set-cookie');
                    if (cookies) {
                        const sessionMatch = cookies.match(/PHPSESSID=([^;]+)/);
                        if (sessionMatch) {
                            this.sessionCookie = sessionMatch[1];
                            Store.set('session_cookie', this.sessionCookie);
                        }
                    }
                    this.isLoggedIn = true;
                    console.log('[Auth] Успешный вход');
                    return true;
                } else {
                    console.warn('[Auth] Ошибка входа:', result.message || 'Неизвестная ошибка');
                    this.isLoggedIn = false;
                    return false;
                }
            } catch (error) {
                console.error('[Auth] Ошибка:', error);
                this.isLoggedIn = false;
                return false;
            }
        }

        async getCsrfToken() {
            try {
                const response = await fetch('https://hdrezka.ag', {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const html = await response.text();
                const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);
                return match ? match[1] : null;
            } catch {
                return null;
            }
        }

        async checkAuth() {
            if (!this.sessionCookie) {
                this.isLoggedIn = false;
                return false;
            }

            try {
                const response = await fetch('https://hdrezka.ag/profile', {
                    headers: {
                        'Cookie': `PHPSESSID=${this.sessionCookie}`,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const html = await response.text();
                this.isLoggedIn = !html.includes('Вход на сайт');
                return this.isLoggedIn;
            } catch {
                this.isLoggedIn = false;
                return false;
            }
        }

        getCookies() {
            return this.sessionCookie ? `PHPSESSID=${this.sessionCookie}` : '';
        }

        logout() {
            this.isLoggedIn = false;
            this.sessionCookie = '';
            Store.set('session_cookie', '');
            Store.set('username', '');
            Store.set('password', '');
        }
    }

    // ============================================================
    // 1. Парсер AmneziaWG 1.5
    // ============================================================
    class AmneziaParser {
        constructor() {
            this.servers = [];
            this.rawConfig = Store.get('config_text', '');
            this.ready = false;
        }

        parse(text) {
            const servers = [];
            const lines = text.split('\n');
            let currentPeer = null;

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;

                if (trimmed === '[Peer]') {
                    currentPeer = {};
                    continue;
                }

                const match = trimmed.match(/^([^=]+)\s*=\s*(.+)$/);
                if (!match) continue;

                const key = match[1].trim();
                const value = match[2].trim();

                if (currentPeer && key === 'Endpoint') {
                    const server = this.extractServer(value);
                    if (server) {
                        servers.push(server);
                        currentPeer._server = server;
                    }
                }
            }

            if (servers.length === 0) {
                for (const line of lines) {
                    if (line.includes('Endpoint')) {
                        const match = line.match(/Endpoint\s*=\s*(.+)/);
                        if (match) {
                            const server = this.extractServer(match[1].trim());
                            if (server) servers.push(server);
                        }
                    }
                }
            }

            return servers;
        }

        extractServer(endpoint) {
            const match = endpoint.match(/^([^:]+):(\d+)$/);
            if (match) {
                return {
                    ip: match[1],
                    port: parseInt(match[2]),
                    full: endpoint
                };
            }
            return null;
        }

        load(text) {
            this.rawConfig = text;
            Store.set('config_text', text);
            this.servers = this.parse(text);
            this.ready = this.servers.length > 0;
            return this.servers;
        }

        getStats() {
            return {
                count: this.servers.length,
                ready: this.ready
            };
        }
    }

    // ============================================================
    // 2. Менеджер прокси (с поддержкой кук авторизации)
    // ============================================================
    class AmneziaProxyManager {
        constructor(parser, auth) {
            this.parser = parser;
            this.auth = auth;
            this.currentIndex = 0;
        }

        getNextProxy() {
            const servers = this.parser.servers;
            if (servers.length === 0) return null;

            const server = servers[this.currentIndex % servers.length];
            this.currentIndex = (this.currentIndex + 1) % servers.length;
            return server;
        }

        async fetch(url, options = {}) {
            const maxRetries = 5;
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const proxy = this.getNextProxy();
                if (!proxy) break;

                try {
                    const proxyUrl = `http://${proxy.ip}:${proxy.port}`;

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 15000);

                    // Добавляем куки авторизации, если есть
                    const headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
                        ...options.headers
                    };

                    const cookies = this.auth.getCookies();
                    if (cookies) {
                        headers['Cookie'] = cookies;
                    }

                    const response = await fetch(url, {
                        ...options,
                        headers: headers,
                        signal: controller.signal
                    });

                    clearTimeout(timeout);

                    if (response.ok) {
                        console.log(`[Amnezia] Успешно через ${proxy.full}`);
                        return response;
                    }
                } catch (error) {
                    lastError = error;
                    console.warn(`[Amnezia] Попытка ${attempt + 1} не удалась:`, error.message);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            throw lastError || new Error('Все попытки через Amnezia не удались');
        }
    }

    // ============================================================
    // 3. Парсер HDRezka (с поддержкой авторизации)
    // ============================================================
    class HDRezkaAmneziaParser {
        constructor() {
            this.name = 'HDRezka (Amnezia)';
            this.type = 'movie';
            this.baseUrl = 'https://hdrezka.ag';
            this.auth = new HDRezkaAuth();
            this.amneziaParser = new AmneziaParser();
            this.proxy = new AmneziaProxyManager(this.amneziaParser, this.auth);
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            const savedConfig = Store.get('config_text', '');
            if (savedConfig) this.amneziaParser.load(savedConfig);
            
            // Проверяем авторизацию
            await this.auth.checkAuth();
            
            this.initialized = true;
            console.log('[HDRezka] Инициализирован. Авторизация:', this.auth.isLoggedIn);
        }

        loadConfig(text) {
            return this.amneziaParser.load(text);
        }

        async search(query, page = 1) {
            await this.init();
            if (!this.amneziaParser.ready) return [];

            try {
                const url = `${this.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
                const response = await this.proxy.fetch(url);
                const html = await response.text();
                return this.parseSearchResults(html);
            } catch (error) {
                console.error('[HDRezka] Search error:', error);
                return [];
            }
        }

        parseSearchResults(html) {
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const items = doc.querySelectorAll('.b-content__inline_item');
            items.forEach(item => {
                const link = item.querySelector('.b-content__inline_item-link a');
                const title = link?.textContent?.trim() || '';
                const href = link?.getAttribute('href') || '';
                const poster = item.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '';

                const isSeries = href.includes('/series/');
                const type = isSeries ? 'tv' : 'movie';
                const id = href.match(/\/(\d+)-/)?.[1] || '';

                if (id) {
                    results.push({
                        id: id,
                        title: title,
                        poster: poster,
                        type: type,
                        url: href,
                        source: 'hdrezka_amnezia'
                    });
                }
            });

            return results;
        }

        async getDetails(id, type = 'movie') {
            await this.init();
            if (!this.amneziaParser.ready) return null;

            try {
                const url = `${this.baseUrl}/${type === 'tv' ? 'series' : 'movie'}/${id}-...`;
                const response = await this.proxy.fetch(url);
                const html = await response.text();
                return this.parseDetails(html, type);
            } catch (error) {
                console.error('[HDRezka] Details error:', error);
                return null;
            }
        }

        parseDetails(html, type) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Пытаемся найти плеер
            let playerUrl = null;
            
            // 1. Ищем iframe плеера (обычно для фильмов)
            const iframe = doc.querySelector('iframe[src*="hdrezka"]');
            if (iframe) {
                playerUrl = iframe.getAttribute('src');
            }
            
            // 2. Ищем video source (для сериалов)
            if (!playerUrl) {
                const video = doc.querySelector('video source');
                if (video) {
                    playerUrl = video.getAttribute('src');
                }
            }

            // 3. Ищем ссылку на плеер в скриптах (для зарегистрированных пользователей)
            if (!playerUrl) {
                const scripts = doc.querySelectorAll('script');
                for (const script of scripts) {
                    const content = script.textContent || '';
                    const match = content.match(/player\.src\s*=\s*["']([^"']+)["']/);
                    if (match) {
                        playerUrl = match[1];
                        break;
                    }
                }
            }

            return {
                title: doc.querySelector('.b-post__title h1')?.textContent?.trim() || '',
                description: doc.querySelector('.b-post__description_text')?.textContent?.trim() || '',
                year: doc.querySelector('.b-post__info .year')?.textContent?.trim() || '',
                rating: doc.querySelector('.b-post__rating .rating_imdb')?.textContent?.trim() || '',
                poster: doc.querySelector('.b-post__cover img')?.getAttribute('src') || '',
                playerUrl: playerUrl,
                type: type,
                isLoggedIn: this.auth.isLoggedIn
            };
        }

        // Метод для авторизации (вызывается из меню)
        async login(username, password) {
            return await this.auth.login(username, password);
        }

        async logout() {
            this.auth.logout();
        }

        isLoggedIn() {
            return this.auth.isLoggedIn;
        }
    }

    // ============================================================
    // 4. Плагин Lampa
    // ============================================================
    function Plugin() {
        this.parser = new HDRezkaAmneziaParser();
        this.initialized = false;

        this.init = async function () {
            if (this.initialized) return;
            console.log('[Плагин] Запущен');

            await this.parser.init();
            this.registerSource();
            this.addSettingsTab();
            this.initialized = true;
        };

        this.registerSource = function() {
            const MovieDB = window.Lampa.MovieDB;
            if (!MovieDB) {
                setTimeout(() => this.registerSource(), 1000);
                return;
            }

            const originalSearch = MovieDB.search;
            const self = this;

            MovieDB.search = async function(query, page, callback) {
                const config = Store.get('config', {});
                if (config.enabled !== false && self.parser.amneziaParser.ready) {
                    try {
                        const results = await self.parser.search(query, page);
                        if (results.length > 0) {
                            // Добавляем источник для каждого результата
                            results.forEach(item => {
                                item.source = 'hdrezka_amnezia';
                            });
                            callback(results);
                            return;
                        }
                    } catch (error) {
                        console.error('[Плагин] Ошибка поиска:', error);
                    }
                }
                originalSearch.call(MovieDB, query, page, callback);
            };

            const Player = window.Lampa.Player;
            if (Player) {
                Player.addSource('hdrezka_amnezia', {
                    name: 'HDRezka (Amnezia)',
                    getUrl: async (item) => {
                        if (item.source === 'hdrezka_amnezia') {
                            const details = await self.parser.getDetails(item.id, item.type);
                            if (details && details.playerUrl) {
                                // Если нет ссылки, но пользователь не залогинен — возвращаем специальный статус
                                if (!details.playerUrl && !details.isLoggedIn) {
                                    console.warn('[Плеер] Требуется авторизация');
                                    return null;
                                }
                                return details.playerUrl;
                            }
                            return null;
                        }
                        return null;
                    },
                    onError: async (item, error) => {
                        // Если ошибка связана с авторизацией — показываем сообщение
                        if (error && error.includes('авторизация')) {
                            window.Lampa.Notify && window.Lampa.Notify.show('Для просмотра войдите в HDRezka в настройках плагина');
                        }
                    }
                });
            }
        };

        this.addSettingsTab = function() {
            const Settings = window.Lampa.Settings;
            if (!Settings) {
                setTimeout(() => this.addSettingsTab(), 1000);
                return;
            }

            const self = this;

            Settings.addTab('hdrezka_amnezia', {
                name: 'HDRezka + Amnezia',
                icon: 'shield',
                template: this.buildHTML(),
                onOpen: () => this.updateStatus()
            });

            this.setupEvents();
        };

        this.buildHTML = function() {
            const savedConfig = Store.get('config_text', '');
            const stats = this.parser.amneziaParser.getStats();
            const isLoggedIn = this.parser.isLoggedIn();
            const username = Store.get('username', '');

            return `
                <style>
                    .am-settings .section { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
                    .am-settings .section-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 8px; }
                    .am-settings .input-field { width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-size: 14px; font-family: monospace; min-height: 120px; resize: vertical; }
                    .am-settings .input-field-small { width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-size: 14px; }
                    .am-settings .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
                    .am-settings .btn-success { background: #51cf66; color: #fff; }
                    .am-settings .btn-danger { background: #e74c3c; color: #fff; }
                    .am-settings .btn-primary { background: #ff6b6b; color: #fff; }
                    .am-settings .btn-secondary { background: rgba(255,255,255,0.1); color: #fff; }
                    .am-settings .btn-secondary:hover { background: rgba(255,255,255,0.2); }
                    .am-settings .status-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
                    .am-settings .status-badge.success { background: #51cf66; color: #fff; }
                    .am-settings .status-badge.danger { background: #e74c3c; color: #fff; }
                    .am-settings .status-badge.warning { background: #fcc419; color: #000; }
                    .am-settings .flex-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
                    .am-settings .flex-col { display: flex; flex-direction: column; gap: 8px; }
                    .am-settings .mt-8 { margin-top: 8px; }
                    .am-settings .mb-8 { margin-bottom: 8px; }
                    .am-settings .text-muted { color: rgba(255,255,255,0.4); font-size: 12px; }
                    .am-settings .text-success { color: #51cf66; }
                    .am-settings .text-danger { color: #e74c3c; }
                    .am-settings .toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
                    .am-settings .toggle-label input { width: 18px; height: 18px; accent-color: #ff6b6b; }
                    .am-settings .log-output { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px 12px; font-family: monospace; font-size: 12px; max-height: 100px; overflow-y: auto; color: rgba(255,255,255,0.7); white-space: pre-wrap; }
                    .am-settings .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                </style>
                <div class="am-settings">
                    <div class="section">
                        <div class="flex-row">
                            <label class="toggle-label">
                                <input type="checkbox" id="am_enabled" ${Store.get('config', {}).enabled !== false ? 'checked' : ''}>
                                <span>Включить HDRezka через Amnezia</span>
                            </label>
                            <span class="status-badge ${this.parser.amneziaParser.ready ? 'success' : 'danger'}" id="am_status">
                                ${this.parser.amneziaParser.ready ? '✅ Активен' : '❌ Нет серверов'}
                            </span>
                        </div>
                        <div class="text-muted mt-8">
                            Серверов: <span id="am_count">${stats.count}</span>
                        </div>
                    </div>

                    <!-- ========== БЛОК АВТОРИЗАЦИИ ========== -->
                    <div class="section">
                        <div class="section-title">🔐 Авторизация на HDRezka</div>
                        <div class="text-muted mb-8">Обязательна для просмотра фильмов и сериалов</div>
                        
                        <div class="flex-row">
                            <input type="text" class="input-field-small" id="auth_username" placeholder="Логин" value="${Store.get('username', '')}">
                            <input type="password" class="input-field-small" id="auth_password" placeholder="Пароль" value="${Store.get('password', '')}">
                        </div>

                        <div class="flex-row mt-8">
                            <button class="btn btn-primary" id="auth_login">🔑 Войти</button>
                            <button class="btn btn-danger" id="auth_logout">🚪 Выйти</button>
                            <span class="status-badge ${isLoggedIn ? 'success' : 'warning'}" id="auth_status">
                                ${isLoggedIn ? '✅ В сети' : '⏳ Не авторизован'}
                            </span>
                        </div>

                        ${isLoggedIn ? `<div class="text-muted mt-8">👤 ${username}</div>` : ''}
                    </div>

                    <div class="section">
                        <div class="section-title">🔑 AmneziaWG 1.5 — конфиг</div>
                        <textarea class="input-field" id="am_config_input" placeholder="Вставьте сюда ваш полный конфиг...">${savedConfig}</textarea>
                        <div class="flex-row mt-8">
                            <button class="btn btn-success" id="am_apply">📥 Применить</button>
                            <button class="btn btn-danger" id="am_clear">🗑️ Очистить</button>
                        </div>
                    </div>

                    <div class="section">
                        <div class="section-title">📋 Лог</div>
                        <div class="log-output" id="am_log">Готов к работе...</div>
                    </div>
                </div>
            `;
        };

        this.setupEvents = function() {
            const self = this;

            // Включение плагина
            document.addEventListener('change', (e) => {
                if (e.target.id === 'am_enabled') {
                    const config = Store.get('config', {});
                    config.enabled = e.target.checked;
                    Store.set('config', config);
                    self.log('Плагин ' + (config.enabled ? 'включён' : 'выключен'));
                }
            });

            // Авторизация
            document.addEventListener('click', async (e) => {
                if (e.target.id === 'auth_login') {
                    const username = document.getElementById('auth_username')?.value || '';
                    const password = document.getElementById('auth_password')?.value || '';

                    if (!username || !password) {
                        self.log('❌ Введите логин и пароль');
                        window.Lampa.Notify && window.Lampa.Notify.show('Введите логин и пароль');
                        return;
                    }

                    self.log('🔐 Попытка входа...');
                    const success = await self.parser.login(username, password);
                    
                    if (success) {
                        self.updateStatus();
                        self.log('✅ Авторизация успешна');
                        window.Lampa.Notify && window.Lampa.Notify.show('✅ Вход в HDRezka выполнен');
                    } else {
                        self.log('❌ Ошибка входа. Проверьте логин и пароль.');
                        window.Lampa.Notify && window.Lampa.Notify.show('❌ Ошибка входа. Проверьте данные.');
                    }
                }

                if (e.target.id === 'auth_logout') {
                    await self.parser.logout();
                    self.updateStatus();
                    self.log('🚪 Выполнен выход');
                    window.Lampa.Notify && window.Lampa.Notify.show('🚪 Вы вышли из аккаунта');
                }
            });

            // Применить конфиг
            document.addEventListener('click', async (e) => {
                if (e.target.id === 'am_apply') {
                    const text = document.getElementById('am_config_input')?.value || '';
                    if (!text.trim()) {
                        self.log('❌ Конфиг пуст');
                        return;
                    }
                    const servers = self.parser.loadConfig(text);
                    self.updateStatus();
                    self.log(`✅ Конфиг загружен. Найдено серверов: ${servers.length}`);
                    window.Lampa.Notify && window.Lampa.Notify.show(`✅ Загружено ${servers.length} серверов`);
                }

                if (e.target.id === 'am_clear') {
                    Store.set('config_text', '');
                    self.parser.amneziaParser.rawConfig = '';
                    self.parser.amneziaParser.servers = [];
                    self.parser.amneziaParser.ready = false;
                    document.getElementById('am_config_input').value = '';
                    self.updateStatus();
                    self.log('🗑️ Конфиг очищен');
                    window.Lampa.Notify && window.Lampa.Notify.show('🗑️ Конфиг удалён');
                }
            });
        };

        this.updateStatus = function() {
            const status = document.getElementById('am_status');
            const count = document.getElementById('am_count');
            const authStatus = document.getElementById('auth_status');
            const ready = this.parser.amneziaParser.ready;
            const isLoggedIn = this.parser.isLoggedIn();

            if (status) {
                status.textContent = ready ? '✅ Активен' : '❌ Нет серверов';
                status.className = `status-badge ${ready ? 'success' : 'danger'}`;
            }
            if (count) {
                count.textContent = this.parser.amneziaParser.servers.length;
            }
            if (authStatus) {
                authStatus.textContent = isLoggedIn ? '✅ В сети' : '⏳ Не авторизован';
                authStatus.className = `status-badge ${isLoggedIn ? 'success' : 'warning'}`;
            }
        };

        this.log = function(msg) {
            const el = document.getElementById('am_log');
            if (el) {
                const time = new Date().toLocaleTimeString();
                el.textContent = `[${time}] ${msg}\n` + el.textContent.split('\n').slice(0, 49).join('\n');
            }
            console.log(`[Плагин] ${msg}`);
        };
    }

    // ============================================================
    // 5. Старт
    // ============================================================
    if (window.Lampa) {
        new Plugin().init();
    } else {
        Listeners.follow('app', function (e) {
            if (e.type === 'ready') new Plugin().init();
        });
    }
})();
