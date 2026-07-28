// ============================================================
// Плагин HDRezka + Amnezia для Lampa
// Интеграция через модули Lampa
// ============================================================

(function() {
    'use strict';

    console.log('[HDRezka] Запуск основного скрипта');

    // ID плагина
    const PLUGIN_ID = 'hdrezka_amnezia';

    // Проверка, что API Lampa доступно
    if (typeof Lampa === 'undefined') {
        console.warn('[HDRezka] Lampa не определена. Ждем...');
        // Можно попробовать подождать или выйти
        return;
    }

    // ============================================================
    // 1. Хранилище настроек (используем Lampa.Storage)
    // ============================================================
    const Store = {
        get: (key, def = null) => Lampa.Storage.get(`${PLUGIN_ID}_${key}`, def),
        set: (key, val) => Lampa.Storage.set(`${PLUGIN_ID}_${key}`, val)
    };

    // ============================================================
    // 2. Парсер Amnezia (вытаскивает сервера из конфига)
    // ============================================================
    class AmneziaParser {
        constructor() {
            this.servers = [];
            this.ready = false;
            this.loadConfig();
        }

        loadConfig() {
            const config = Store.get('config', '');
            if (!config) {
                this.servers = [];
                this.ready = false;
                return;
            }

            const servers = [];
            const lines = config.split('\n');
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
                    const endpoint = value.match(/^([^:]+):(\d+)$/);
                    if (endpoint) {
                        servers.push({
                            ip: endpoint[1],
                            port: parseInt(endpoint[2])
                        });
                    }
                }
            }

            this.servers = servers;
            this.ready = servers.length > 0;
            return this.servers;
        }

        getNextServer() {
            if (!this.ready || this.servers.length === 0) return null;
            // Простая ротация для балансировки
            const server = this.servers[Math.floor(Math.random() * this.servers.length)];
            return server;
        }
    }

    // ============================================================
    // 3. Парсер HDRezka (для поиска и получения деталей)
    // ============================================================
    class HDRezkaParser {
        constructor() {
            this.parser = new AmneziaParser();
            this.baseUrl = 'https://hdrezka.ag';
        }

        // Поиск на HDRezka
        async search(query, page = 1) {
            if (!this.parser.ready) {
                console.warn('[HDRezka] Нет доступных серверов Amnezia');
                return [];
            }

            const server = this.parser.getNextServer();
            if (!server) return [];

            try {
                const proxy = `http://${server.ip}:${server.port}`;
                const searchUrl = `${this.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
                
                const response = await fetch(proxy + '?url=' + encodeURIComponent(searchUrl), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
                    }
                });

                if (!response.ok) {
                    console.warn('[HDRezka] Ошибка запроса:', response.status);
                    return [];
                }

                const html = await response.text();
                return this.parseSearchResults(html);

            } catch (error) {
                console.error('[HDRezka] Ошибка поиска:', error);
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

                // Извлекаем ID
                const idMatch = href.match(/\/(\d+)-/);
                const id = idMatch ? idMatch[1] : null;

                // Определяем тип (фильм или сериал)
                const type = href.includes('/series/') ? 'tv' : 'movie';

                if (id) {
                    results.push({
                        id: id,
                        title: title,
                        poster: poster,
                        type: type,
                        url: href,
                        provider: PLUGIN_ID,
                        source: 'hdrezka',
                        // Добавляем поля, которые ожидает Lampa
                        year: '2024',
                        rating: 0,
                        description: ''
                    });
                }
            });

            return results;
        }

        // Получение деталей для плеера
        async getDetails(id, type = 'movie') {
            if (!this.parser.ready) return null;

            const server = this.parser.getNextServer();
            if (!server) return null;

            try {
                const proxy = `http://${server.ip}:${server.port}`;
                const url = `${this.baseUrl}/${type === 'tv' ? 'series' : 'movie'}/${id}-...`;
                
                const response = await fetch(proxy + '?url=' + encodeURIComponent(url), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.ok) return null;

                const html = await response.text();
                return this.parseDetails(html, type);

            } catch (error) {
                console.error('[HDRezka] Ошибка получения деталей:', error);
                return null;
            }
        }

        parseDetails(html, type) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            let playerUrl = null;
            const iframe = doc.querySelector('iframe[src*="hdrezka"]');
            if (iframe) {
                playerUrl = iframe.getAttribute('src');
            }

            if (!playerUrl) {
                const video = doc.querySelector('video source');
                if (video) {
                    playerUrl = video.getAttribute('src');
                }
            }

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
                playerUrl: playerUrl
            };
        }
    }

    // ============================================================
    // 4. ИНТЕГРАЦИЯ С LAMPA
    // ============================================================

    // 4.1 Добавляем провайдера в каталог (источник в поиске)
    function registerCatalogProvider() {
        const parser = new HDRezkaParser();

        // Добавляем источник в Lampa.Parser
        if (window.Lampa.Parser) {
            Lampa.Parser.addProvider(PLUGIN_ID, {
                name: 'HDRezka (Amnezia)',
                icon: 'film',
                search: async (query, page, callback) => {
                    const enabled = Store.get('enabled', 'true') === 'true';
                    if (!enabled) {
                        callback([]);
                        return;
                    }

                    const results = await parser.search(query, page);
                    
                    // Преобразуем в формат Lampa
                    const items = results.map(item => ({
                        id: item.id,
                        title: item.title,
                        poster: item.poster,
                        type: item.type,
                        year: item.year || '',
                        rating: item.rating || 0,
                        description: item.description || '',
                        provider: PLUGIN_ID,
                        source: 'hdrezka',
                        url: item.url
                    }));

                    callback(items);
                }
            });
            console.log('[HDRezka] Провайдер зарегистрирован');
        }
    }

    // 4.2 Добавляем источник в плеер
    function registerPlayerSource() {
        const parser = new HDRezkaParser();

        if (window.Lampa.Player) {
            Lampa.Player.addSource(PLUGIN_ID, {
                name: 'HDRezka (Amnezia)',
                getUrl: async (item) => {
                    if (item.provider !== PLUGIN_ID) return null;

                    const enabled = Store.get('enabled', 'true') === 'true';
                    if (!enabled) return null;

                    const details = await parser.getDetails(item.id, item.type);
                    return details?.playerUrl || null;
                },
                onError: (item, error) => {
                    console.error('[HDRezka] Ошибка плеера:', error);
                    Lampa.Notify.show('Ошибка воспроизведения через HDRezka');
                }
            });
            console.log('[HDRezka] Источник плеера зарегистрирован');
        }
    }

    // 4.3 Добавляем настройки
    function registerSettings() {
        // Вкладка в настройках
        Lampa.SettingsApi.addParam({
            component: 'plugin_settings',
            param: {
                name: `${PLUGIN_ID}_enabled`,
                type: 'trigger',
                default: true
            },
            field: {
                name: 'HDRezka через Amnezia',
                description: 'Включить поиск и просмотр'
            },
            onChange: (value) => {
                console.log(`[HDRezka] Плагин ${value === 'true' ? 'включён' : 'выключен'}`);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'plugin_settings',
            param: {
                name: `${PLUGIN_ID}_config`,
                type: 'textarea',
                default: '',
                placeholder: 'Вставьте сюда ваш AmneziaWG 1.5 конфиг...'
            },
            field: {
                name: 'AmneziaWG Конфиг',
                description: 'Полный конфиг для подключения к серверам'
            },
            onChange: (value) => {
                // Сохраняем и перезагружаем парсер
                Store.set('config', value);
                console.log('[HDRezka] Конфиг сохранён');
            }
        });

        console.log('[HDRezka] Настройки зарегистрированы');
    }

    // ============================================================
    // 5. СТАРТ
    // ============================================================
    function initPlugin() {
        console.log('[HDRezka] Инициализация плагина');

        // Проверяем, что API Lampa доступны
        if (!window.Lampa || !window.Lampa.Parser || !window.Lampa.Player) {
            console.warn('[HDRezka] API Lampa не готовы, повторная попытка через 1 секунду');
            setTimeout(initPlugin, 1000);
            return;
        }

        // Регистрируем всё
        registerCatalogProvider();
        registerPlayerSource();
        registerSettings();

        console.log('[HDRezka] Плагин успешно инициализирован');
    }

    // Запускаем инициализацию
    initPlugin();

})();
