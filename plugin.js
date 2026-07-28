(function () {
    'use strict';

    // ============================================================
    // 1. ПРОВЕРКА, ЧТО ПЛАГИН УЖЕ ЗАГРУЖЕН
    // ============================================================
    if (window.__hdrezka_plugin_loaded) return;
    window.__hdrezka_plugin_loaded = true;

    console.log('[HDRezka] Плагин загружен');

    // ============================================================
    // 2. ХРАНИЛИЩЕ (localStorage)
    // ============================================================
    const Store = {
        get: (key, def = null) => {
            try {
                const val = localStorage.getItem('hdrezka_' + key);
                return val ? JSON.parse(val) : def;
            } catch { return def; }
        },
        set: (key, val) => {
            localStorage.setItem('hdrezka_' + key, JSON.stringify(val));
        }
    };

    // ============================================================
    // 3. ПАРСЕР AMNEZIA (из конфига)
    // ============================================================
    function getAmneziaServers() {
        const config = Store.get('config', '');
        if (!config) return [];

        const servers = [];
        const lines = config.split('\n');
        let inPeer = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            if (trimmed === '[Peer]') {
                inPeer = true;
                continue;
            }
            if (trimmed.startsWith('[')) {
                inPeer = false;
                continue;
            }

            if (inPeer && trimmed.startsWith('Endpoint = ')) {
                const endpoint = trimmed.replace('Endpoint = ', '').trim();
                const match = endpoint.match(/^([^:]+):(\d+)$/);
                if (match) {
                    servers.push({
                        ip: match[1],
                        port: parseInt(match[2])
                    });
                }
            }
        }

        return servers;
    }

    // ============================================================
    // 4. ПОИСК НА HDREZKA ЧЕРЕЗ AMNEZIA
    // ============================================================
    async function searchOnHDRezka(query) {
        const servers = getAmneziaServers();
        if (servers.length === 0) {
            Lampa.Notify.show('❌ Нет серверов Amnezia. Добавьте конфиг в localStorage.hdrezka_config');
            return [];
        }

        // Берём случайный сервер
        const server = servers[Math.floor(Math.random() * servers.length)];
        const proxy = `http://${server.ip}:${server.port}`;

        try {
            const searchUrl = `https://hdrezka.ag/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
            const response = await fetch(proxy + '?url=' + encodeURIComponent(searchUrl), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) return [];

            const html = await response.text();
            return parseSearchResults(html);

        } catch (error) {
            console.error('[HDRezka] Ошибка поиска:', error);
            return [];
        }
    }

    function parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const items = doc.querySelectorAll('.b-content__inline_item');
        items.forEach(item => {
            const link = item.querySelector('.b-content__inline_item-link a');
            const title = link?.textContent?.trim() || '';
            const href = link?.getAttribute('href') || '';
            const poster = item.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '';

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

    // ============================================================
    // 5. ПОЛУЧЕНИЕ ССЫЛКИ НА ПЛЕЕР
    // ============================================================
    async function getPlayerUrl(item) {
        const servers = getAmneziaServers();
        if (servers.length === 0) return null;

        const server = servers[Math.floor(Math.random() * servers.length)];
        const proxy = `http://${server.ip}:${server.port}`;

        try {
            const url = `https://hdrezka.ag${item.url}`;
            const response = await fetch(proxy + '?url=' + encodeURIComponent(url), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) return null;

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Ищем iframe
            const iframe = doc.querySelector('iframe[src*="hdrezka"]');
            if (iframe) return iframe.getAttribute('src');

            // Ищем video source
            const video = doc.querySelector('video source');
            if (video) return video.getAttribute('src');

            return null;

        } catch (error) {
            console.error('[HDRezka] Ошибка получения плеера:', error);
            return null;
        }
    }

    // ============================================================
    // 6. ПОКАЗ РЕЗУЛЬТАТОВ
    // ============================================================
    function showResults(results, title) {
        if (results.length === 0) {
            Lampa.Notify.show('❌ Ничего не найдено на HDRezka');
            return;
        }

        if (results.length === 1) {
            playOnHDRezka(results[0]);
            return;
        }

        // Создаём модалку с выбором
        var modal = $(`
            <div class="modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;">
                <div style="background:#1a1a1a;border-radius:12px;padding:20px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <h2 style="color:#fff;font-size:20px;margin:0;">Результаты поиска</h2>
                        <button onclick="$(this).closest('.modal').remove()" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">✕</button>
                    </div>
                    <div id="hdrezka_results"></div>
                </div>
            </div>
        `);

        $('body').append(modal);

        var container = modal.find('#hdrezka_results');
        results.forEach(item => {
            var div = $(`
                <div style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #333;cursor:pointer;" data-item='${JSON.stringify(item)}'>
                    <img src="${item.poster}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'">
                    <div style="flex:1;">
                        <div style="color:#fff;font-size:16px;">${item.title}</div>
                    </div>
                    <div style="color:#ff6b6b;">▶</div>
                </div>
            `);

            div.on('click', function() {
                const data = $(this).data('item');
                modal.remove();
                playOnHDRezka(data);
            });

            container.append(div);
        });
    }

    // ============================================================
    // 7. ВОСПРОИЗВЕДЕНИЕ
    // ============================================================
    async function playOnHDRezka(item) {
        Lampa.Notify.show('🎬 Загрузка плеера...');

        try {
            const playerUrl = await getPlayerUrl(item);

            if (playerUrl) {
                // Открываем в плеере Lampa
                if (window.Lampa && Lampa.Player) {
                    Lampa.Player.playExternal(playerUrl, {
                        title: item.title,
                        poster: item.poster
                    });
                } else {
                    window.open(playerUrl, '_blank');
                }
            } else {
                // Если не нашли плеер — открываем страницу фильма
                Lampa.Notify.show('📱 Открываем страницу фильма');
                window.open(`https://hdrezka.ag${item.url}`, '_blank');
            }

        } catch (error) {
            console.error('[HDRezka] Ошибка:', error);
            Lampa.Notify.show('❌ Ошибка воспроизведения');
        }
    }

    // ============================================================
    // 8. ДОБАВЛЕНИЕ КНОПКИ НА КАРТОЧКУ
    // ============================================================
    function addHDRezkaButton() {
        // Проверяем, есть ли уже кнопка
        if ($('.hdrezka-button').length) return;

        var container = $('.full-start__buttons');
        if (!container.length) return;

        var button = $(`
            <div class="full-start__button hdrezka-button" style="order:5;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                    <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v-2h3V8l4 4-4 4v-3z" fill="currentColor"/>
                </svg>
                <span>HDRezka</span>
            </div>
        `);

        button.on('hover:enter', function() {
            var title = $('.full-start__title').text().trim();
            if (!title) {
                Lampa.Notify.show('❌ Не удалось определить название');
                return;
            }

            Lampa.Notify.show('🔍 Поиск на HDRezka...');
            searchOnHDRezka(title).then(results => {
                showResults(results, title);
            });
        });

        container.append(button);
        console.log('[HDRezka] Кнопка добавлена');
    }

    // ============================================================
    // 9. НАСТРОЙКИ В МЕНЮ LAMPA
    // ============================================================
    function addSettings() {
        // Добавляем пункт в меню настроек (если есть Lampa.SettingsApi)
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'plugin_settings',
                param: {
                    name: 'hdrezka_config',
                    type: 'textarea',
                    default: '',
                    placeholder: 'Вставьте конфиг AmneziaWG 1.5'
                },
                field: {
                    name: 'AmneziaWG Конфиг для HDRezka',
                    description: 'Полный конфиг для подключения к серверам'
                },
                onChange: (value) => {
                    Store.set('config', value);
                    console.log('[HDRezka] Конфиг сохранён');
                }
            });
        } else {
            console.log('[HDRezka] Lampa.SettingsApi не найдена. Настройки через localStorage');
        }
    }

    // ============================================================
    // 10. ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    function init() {
        console.log('[HDRezka] Инициализация...');

        // Добавляем настройки
        addSettings();

        // Добавляем кнопку, если карточка открыта
        if ($('.full-start').length) {
            setTimeout(addHDRezkaButton, 100);
        }

        // Следим за появлением карточки
        var observer = new MutationObserver(function() {
            if ($('.full-start').length) {
                setTimeout(addHDRezkaButton, 100);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        console.log('[HDRezka] Плагин готов');
    }

    // ============================================================
    // 11. СТАРТ
    // ============================================================
    if (window.Lampa) {
        // Ждём готовности Lampa
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                init();
            }
        });
    } else {
        // Если Lampa ещё не загружена — ждём
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    }

})();
