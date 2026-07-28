(function() {
    'use strict';

    const PLUGIN_ID = 'hdrezka_amnezia';

    // Проверка на повторную загрузку
    if (window[`plugin_${PLUGIN_ID}_loaded`]) return;
    window[`plugin_${PLUGIN_ID}_loaded`] = true;

    // ============================================================
    // 1. Хранилище (через Lampa.Storage)
    // ============================================================
    const Store = {
        get: (key, def = null) => Lampa.Storage.get(`${PLUGIN_ID}_${key}`, def),
        set: (key, val) => Lampa.Storage.set(`${PLUGIN_ID}_${key}`, val)
    };

    // ============================================================
    // 2. Парсер Amnezia (вытаскивает сервер из конфига)
    // ============================================================
    class AmneziaParser {
        constructor() {
            this.servers = [];
            this.ready = false;
            this.loadConfig();
        }

        loadConfig() {
            const config = Store.get('config', '');
            if (!config) return;

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
            const server = this.servers[Math.floor(Math.random() * this.servers.length)];
            return server;
        }
    }

    // ============================================================
    // 3. Основная логика плагина
    // ============================================================
    class HDRezkaPlugin {
        constructor() {
            this.parser = new AmneziaParser();
            this.baseUrl = 'https://hdrezka.ag';
            this.initialized = false;
        }

        init() {
            if (this.initialized) return;
            
            // Добавляем настройки
            this.addSettings();
            
            // Добавляем кнопку на карточку
            this.addButton();
            
            this.initialized = true;
            console.log(`[${PLUGIN_ID}] Плагин инициализирован`);
        }

        // ============================================================
        // НАСТРОЙКИ
        // ============================================================
        addSettings() {
            // Проверяем, есть ли уже такой параметр
            if (Lampa.Storage.get(`${PLUGIN_ID}_settings_added`)) return;
            Lampa.Storage.set(`${PLUGIN_ID}_settings_added`, true);

            // Добавляем вкладку в настройки
            Lampa.SettingsApi.addParam({
                component: 'plugin_settings',
                param: {
                    name: `${PLUGIN_ID}_enabled`,
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: 'HDRezka через Amnezia',
                    description: 'Включить поиск и просмотр через HDRezka'
                },
                onChange: (value) => {
                    console.log(`[${PLUGIN_ID}] ${value === 'true' ? 'Включён' : 'Выключен'}`);
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
                    name: 'Конфиг Amnezia',
                    description: 'Полный конфиг для подключения'
                },
                onChange: (value) => {
                    this.parser.loadConfig();
                    console.log(`[${PLUGIN_ID}] Конфиг обновлён. Серверов: ${this.parser.servers.length}`);
                }
            });

            console.log(`[${PLUGIN_ID}] Настройки добавлены`);
        }

        // ============================================================
        // КНОПКА НА КАРТОЧКЕ
        // ============================================================
        addButton() {
            const self = this;

            Lampa.Listener.follow('full', function(event) {
                if (event.type !== 'complite') return;

                // Проверяем, включён ли плагин
                const enabled = Lampa.Storage.get(`${PLUGIN_ID}_enabled`, 'true') === 'true';
                if (!enabled) return;

                const movieData = event.data;
                const title = movieData.title || movieData.name || '';
                const year = movieData.year || '';

                // HTML кнопки
                const buttonHtml = `
                    <div class="full-start__button view--${PLUGIN_ID}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                            <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v-2h3V8l4 4-4 4v-3z" fill="currentColor"/>
                        </svg>
                        <span>${Lampa.Lang.translate('Смотреть на HDRezka')}</span>
                    </div>
                `;

                const button = $(buttonHtml);

                button.on('hover:enter', function() {
                    self.searchAndPlay(title, year);
                });

                // Добавляем кнопку
                const container = event.object.activity.render().find('.full-start__buttons');
                if (container.length) {
                    container.find(`.view--${PLUGIN_ID}`).remove();
                    container.append(button);
                }
            });
        }

        // ============================================================
        // ПОИСК И ВОСПРОИЗВЕДЕНИЕ
        // ============================================================
        async searchAndPlay(title, year) {
            const server = this.parser.getNextServer();
            if (!server) {
                Lampa.Notify.show('❌ Нет доступных серверов. Проверьте конфиг.');
                return;
            }

            Lampa.Notify.show('🔍 Поиск на HDRezka...');

            try {
                const proxy = `http://${server.ip}:${server.port}`;
                const searchUrl = `${this.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(title)}`;
                
                const response = await fetch(proxy + '?url=' + encodeURIComponent(searchUrl), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                const html = await response.text();
                const results = this.parseSearchResults(html, year);

                if (results.length === 0) {
                    Lampa.Notify.show('❌ Фильм не найден на HDRezka');
                    return;
                }

                if (results.length === 1) {
                    this.playVideo(results[0], server);
                    return;
                }

                // Если несколько результатов — показываем выбор
                this.showSelection(results, server);

            } catch (error) {
                console.error(`[${PLUGIN_ID}] Ошибка:`, error);
                Lampa.Notify.show('❌ Ошибка поиска: ' + error.message);
            }
        }

        parseSearchResults(html, year) {
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const items = doc.querySelectorAll('.b-content__inline_item');
            items.forEach(item => {
                const link = item.querySelector('.b-content__inline_item-link a');
                const title = link?.textContent?.trim() || '';
                const href = link?.getAttribute('href') || '';
                const poster = item.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '';

                // Фильтруем по году, если указан
                if (year && !title.includes(year)) return;

                const id = href.match(/\/(\d+)-/)?.[1] || '';
                if (id) {
                    results.push({
                        id: id,
                        title: title,
                        poster: poster,
                        url: href
                    });
                }
            });

            return results;
        }

        showSelection(results, server) {
            // Создаём список выбора через интерфейс Lampa
            const items = results.map(r => ({
                title: r.title,
                poster: r.poster,
                action: () => this.playVideo(r, server)
            }));

            // Используем Lampa.Select для отображения списка
            if (window.Lampa.Select) {
                Lampa.Select.show({
                    title: 'Выберите фильм на HDRezka',
                    items: items.map(item => ({
                        name: item.title,
                        image: item.poster,
                        onClick: item.action
                    }))
                });
            } else {
                // Fallback — открываем в браузере первый
                this.playVideo(results[0], server);
            }
        }

        async playVideo(item, server) {
            Lampa.Notify.show('🎬 Загрузка плеера...');

            try {
                const proxy = `http://${server.ip}:${server.port}`;
                const url = `${this.baseUrl}${item.url}`;
                const response = await fetch(proxy + '?url=' + encodeURIComponent(url), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Ищем ссылку на плеер
                let playerUrl = null;

                // 1. Прямая ссылка на iframe
                const iframe = doc.querySelector('iframe[src*="hdrezka"]');
                if (iframe) {
                    playerUrl = iframe.getAttribute('src');
                }

                // 2. Video source
                if (!playerUrl) {
                    const video = doc.querySelector('video source');
                    if (video) {
                        playerUrl = video.getAttribute('src');
                    }
                }

                // 3. Ссылка в скрипте
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

                if (!playerUrl) {
                    // Если не нашли — открываем страницу фильма в браузере
                    Lampa.Notify.show('📱 Открываем страницу фильма...');
                    this.openInBrowser(url);
                    return;
                }

                // Воспроизводим в Lampa
                Lampa.Player.playExternal(playerUrl, {
                    title: item.title,
                    poster: item.poster,
                    provider: PLUGIN_ID
                });

            } catch (error) {
                console.error(`[${PLUGIN_ID}] Ошибка воспроизведения:`, error);
                Lampa.Notify.show('❌ Ошибка: ' + error.message);
            }
        }

        openInBrowser(url) {
            // Открываем ссылку во внешнем браузере
            if (window.Lampa.Utils && window.Lampa.Utils.openUrl) {
                Lampa.Utils.openUrl(url);
            } else {
                window.open(url, '_blank');
            }
        }
    }

    // ============================================================
    // СТАРТ ПЛАГИНА
    // ============================================================
    const plugin = new HDRezkaPlugin();

    if (window.appready) {
        plugin.init();
    } else {
        Lampa.Listener.follow('app', function(event) {
            if (event.type === 'ready') {
                plugin.init();
            }
        });
    }

    console.log(`[${PLUGIN_ID}] Загружен`);
})();
