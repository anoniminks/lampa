(function () {
    'use strict';

    // ============================================================
    // 1. КОНФИГ
    // ============================================================
    const CONFIG = {
        id: 'hdrezka_amnezia',
        name: 'HDRezka (Amnezia)',
        baseUrl: 'https://hdrezka.ag',
        buttonText: 'HDRezka',
    };

    // ============================================================
    // 2. ХРАНИЛИЩЕ
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
    // 3. AMNEZIA — ПОЛУЧЕНИЕ СЕРВЕРОВ
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
    // 4. ЗАПРОСЫ ЧЕРЕЗ AMNEZIA
    // ============================================================
    async function fetchViaAmnezia(url) {
        const servers = getAmneziaServers();
        if (servers.length === 0) {
            throw new Error('Нет серверов Amnezia. Добавьте конфиг в настройках.');
        }

        const server = servers[Math.floor(Math.random() * servers.length)];
        const proxy = `http://${server.ip}:${server.port}`;
        const proxyUrl = proxy + '?url=' + encodeURIComponent(url);

        const response = await fetch(proxyUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    }

    // ============================================================
    // 5. ПАРСИНГ
    // ============================================================
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
                    url: href,
                    source: CONFIG.id,
                    provider: CONFIG.id
                });
            }
        });

        return results;
    }

    function parsePlayerURL(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const iframe = doc.querySelector('iframe[src*="hdrezka"]');
        if (iframe) return iframe.getAttribute('src');

        const video = doc.querySelector('video source');
        if (video) return video.getAttribute('src');

        const scripts = doc.querySelectorAll('script');
        for (const script of scripts) {
            const content = script.textContent || '';
            const match = content.match(/player\.src\s*=\s*["']([^"']+)["']/);
            if (match) return match[1];
        }

        return null;
    }

    // ============================================================
    // 6. ПОИСК НА HDREZKA
    // ============================================================
    async function searchOnHDRezka(query) {
        const url = `${CONFIG.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
        const html = await fetchViaAmnezia(url);
        return parseSearchResults(html);
    }

    // ============================================================
    // 7. ПОКАЗ РЕЗУЛЬТАТОВ (с выбором)
    // ============================================================
    function showResults(results, movieTitle) {
        if (!results || results.length === 0) {
            Lampa.Noty.show('❌ Ничего не найдено на HDRezka');
            return;
        }

        if (results.length === 1) {
            // Сразу воспроизводим
            Lampa.Player.play({
                title: results[0].title,
                poster: results[0].poster,
                url: results[0].url,
                source: CONFIG.id,
                provider: CONFIG.id,
                id: results[0].id
            });
            return;
        }

        // Показываем список для выбора
        const items = results.map(item => ({
            title: item.title,
            image: item.poster || '',
            onClick: () => {
                Lampa.Player.play({
                    title: item.title,
                    poster: item.poster,
                    url: item.url,
                    source: CONFIG.id,
                    provider: CONFIG.id,
                    id: item.id
                });
                Lampa.Controller.toggle('content');
            }
        }));

        Lampa.Select.show({
            title: 'Результаты поиска: ' + movieTitle,
            items: items,
            onBack: () => {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============================================================
    // 8. РЕГИСТРАЦИЯ ИСТОЧНИКА В ПЛЕЕРЕ
    // ============================================================
    function registerPlayerSource() {
        if (window['hdrezka_source_registered']) return;
        window['hdrezka_source_registered'] = true;

        Lampa.Player.addSource(CONFIG.id, {
            name: CONFIG.name,
            getUrl: async (item) => {
                if (item.provider !== CONFIG.id && item.source !== CONFIG.id) return null;

                if (item.url && item.url.startsWith('http')) {
                    return item.url;
                }

                try {
                    const fullUrl = CONFIG.baseUrl + item.url;
                    const html = await fetchViaAmnezia(fullUrl);
                    const playerUrl = parsePlayerURL(html);

                    if (playerUrl) {
                        return playerUrl;
                    } else {
                        Lampa.Noty.show('❌ Не найдена ссылка. Возможно, требуется авторизация.');
                        return null;
                    }
                } catch (error) {
                    Lampa.Noty.show('❌ Ошибка: ' + error.message);
                    return null;
                }
            },
            onError: (item, error) => {
                console.error('[HDRezka] Ошибка плеера:', error);
                Lampa.Noty.show('❌ Ошибка воспроизведения');
            }
        });

        console.log('[HDRezka] Источник зарегистрирован');
    }

    // ============================================================
    // 9. КНОПКА НА КАРТОЧКЕ ФИЛЬМА
    // ============================================================
    function addButtonToCard() {
        // Проверяем, что карточка открыта
        const card = $('.full-start');
        if (!card.length) return;

        // Проверяем, есть ли уже кнопка
        if ($('.hdrezka-card-button').length) return;

        // Получаем название фильма
        const titleElement = $('.full-start__title');
        if (!titleElement.length) return;

        const movieTitle = titleElement.text().trim();
        if (!movieTitle) return;

        // Находим контейнер с кнопками
        const buttonsContainer = $('.full-start__buttons');
        if (!buttonsContainer.length) return;

        // Создаём кнопку
        const button = $(`
            <div class="full-start__button hdrezka-card-button selector">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" fill="none" stroke="currentColor" stroke-width="2"/>
                    <line x1="8" y1="2" x2="8" y2="22" stroke="currentColor" stroke-width="2"/>
                    <line x1="16" y1="2" x2="16" y2="22" stroke="currentColor" stroke-width="2"/>
                    <line x1="2" y1="8" x2="22" y2="8" stroke="currentColor" stroke-width="2"/>
                    <line x1="2" y1="16" x2="22" y2="16" stroke="currentColor" stroke-width="2"/>
                    <text x="12" y="17" text-anchor="middle" font-size="9" fill="currentColor" font-weight="bold">HD</text>
                </svg>
                <span>HDRezka</span>
            </div>
        `);

        // Обработчик клика
        button.on('hover:enter', function() {
            Lampa.Noty.show('🔍 Поиск на HDRezka...');

            searchOnHDRezka(movieTitle)
                .then(results => {
                    showResults(results, movieTitle);
                })
                .catch(err => {
                    Lampa.Noty.show('❌ Ошибка: ' + err.message);
                });
        });

        // Добавляем кнопку в контейнер
        buttonsContainer.append(button);
        console.log('[HDRezka] Кнопка добавлена на карточку');
    }

    // ============================================================
    // 10. КОМПОНЕНТ ГЛАВНОЙ
    // ============================================================
    function HDRezkaMain(object) {
        const comp = new Lampa.InteractionMain(object);

        comp.create = function() {
            this.activity.loader(true);

            fetchViaAmnezia(CONFIG.baseUrl)
                .then(html => {
                    const results = parseSearchResults(html);
                    results.forEach(item => {
                        item.source = CONFIG.id;
                        item.provider = CONFIG.id;
                    });

                    const data = {
                        results: results,
                        total_pages: 50,
                        collection: true,
                        line_type: 'none',
                        card_events: {
                            onEnter: (card, element) => {
                                Lampa.Player.play({
                                    title: element.title,
                                    poster: element.poster,
                                    url: element.url,
                                    source: CONFIG.id,
                                    provider: CONFIG.id,
                                    id: element.id
                                });
                            }
                        }
                    };

                    this.build(data);
                    this.activity.loader(false);
                })
                .catch(err => {
                    this.empty(err.message);
                });
        };

        comp.empty = function(er) {
            this.activity.loader(false);
            const empty = new Lampa.Empty({
                descr: typeof er == 'string' ? er : Lampa.Lang.translate('empty_text_two')
            });
            const container = this.activity.render().find('.activity__body > div')[0];
            if (container) {
                container.appendChild(empty.render(true));
            }
            this.start = empty.start.bind(empty);
            this.activity.toggle();
        };

        return comp;
    }

    // ============================================================
    // 11. КОМПОНЕНТ КАТЕГОРИИ
    // ============================================================
    function HDRezkaView(object) {
        const comp = new Lampa.InteractionCategory(object);

        comp.create = function() {
            this.activity.loader(true);

            const isSearch = object.url && object.url.includes('search=');
            let url;

            if (isSearch) {
                const query = decodeURIComponent(object.url.split('search=')[1]);
                url = `${CONFIG.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
            } else {
                url = `${CONFIG.baseUrl}/${object.url}/`;
                if (object.page && object.page > 1) {
                    url = `${CONFIG.baseUrl}/${object.url}/page/${object.page}/`;
                }
            }

            fetchViaAmnezia(url)
                .then(html => {
                    const results = parseSearchResults(html);
                    results.forEach(item => {
                        item.source = CONFIG.id;
                        item.provider = CONFIG.id;
                    });

                    const data = {
                        results: results,
                        total_pages: 50,
                        collection: true,
                        line_type: 'none',
                        card_events: {
                            onEnter: (card, element) => {
                                Lampa.Player.play({
                                    title: element.title,
                                    poster: element.poster,
                                    url: element.url,
                                    source: CONFIG.id,
                                    provider: CONFIG.id,
                                    id: element.id
                                });
                            }
                        }
                    };

                    this.build(data);
                    this.activity.loader(false);

                    // Кнопка поиска
                    const actions = this.render().find('.head__actions');
                    if (actions.length && !actions.find('[data-action="hdrezka_search"]').length) {
                        actions.append(`
                            <div class="head__action head__settings selector" data-action="hdrezka_search">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                                    <circle cx="11" cy="11" r="8"/>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                </svg>
                            </div>
                        `);

                        actions.find('[data-action="hdrezka_search"]').on('hover:enter', () => {
                            Lampa.Input.edit({
                                title: 'Поиск на HDRezka',
                                value: '',
                                free: true,
                                nosave: true
                            }, (value) => {
                                if (value) {
                                    Lampa.Activity.push({
                                        url: 'search=' + encodeURIComponent(value),
                                        title: 'Поиск: ' + value,
                                        component: 'hdrezka_view',
                                        page: 1
                                    });
                                }
                                Lampa.Controller.toggle('content');
                            });
                        });
                    }
                })
                .catch(err => {
                    this.empty(err.message);
                });
        };

        comp.empty = function(er) {
            this.activity.loader(false);
            const empty = new Lampa.Empty({
                descr: typeof er == 'string' ? er : Lampa.Lang.translate('empty_text_two')
            });
            const container = this.activity.render().find('.activity__body > div')[0];
            if (container) {
                container.appendChild(empty.render(true));
            }
            this.start = empty.start.bind(empty);
            this.activity.toggle();
        };

        comp.nextPageReuest = function(object, resolve, reject) {
            reject('Пагинация временно отключена');
        };

        return comp;
    }

    // ============================================================
    // 12. ЗАПУСК ПЛАГИНА
    // ============================================================
    function startPlugin() {
        if (window['plugin_hdrezka_ready']) return;
        window['plugin_hdrezka_ready'] = true;

        console.log('[HDRezka] Запуск...');

        registerPlayerSource();

        Lampa.Component.add('hdrezka', HDRezkaMain);
        Lampa.Component.add('hdrezka_view', HDRezkaView);

        // ===== ПУНКТ В МЕНЮ =====
        function addMenuItem() {
            const menuItem = $(`
                <li class="menu__item selector">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                            <rect x="2" y="2" width="20" height="20" rx="2.18"/>
                            <line x1="8" y1="2" x2="8" y2="22"/>
                            <line x1="16" y1="2" x2="16" y2="22"/>
                            <line x1="2" y1="8" x2="22" y2="8"/>
                            <line x1="2" y1="16" x2="22" y2="16"/>
                        </svg>
                    </div>
                    <div class="menu__text">HDRezka</div>
                </li>
            `);

            menuItem.on('hover:enter', function() {
                Lampa.Activity.push({
                    url: '',
                    title: 'HDRezka',
                    component: 'hdrezka',
                    page: 1
                });
            });

            const menuList = $('.menu .menu__list').eq(0);
            if (menuList.length) {
                menuList.append(menuItem);
                console.log('[HDRezka] Пункт меню добавлен');
            }
        }

        // ===== НАСТРОЙКИ =====
        function addSettings() {
            if (window.hdrezka_settings_added) return;
            window.hdrezka_settings_added = true;

            try {
                Lampa.SettingsApi.addComponent({
                    component: 'hdrezka',
                    name: 'HDRezka (Amnezia)',
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                        <rect x="2" y="2" width="20" height="20" rx="2.18"/>
                        <line x1="8" y1="2" x2="8" y2="22"/>
                        <line x1="16" y1="2" x2="16" y2="22"/>
                        <line x1="2" y1="8" x2="22" y2="8"/>
                        <line x1="2" y1="16" x2="22" y2="16"/>
                    </svg>`
                });

                Lampa.SettingsApi.addParam({
                    component: 'hdrezka',
                    param: {
                        name: 'hdrezka_config',
                        type: 'textarea',
                        default: '',
                        placeholder: 'Вставьте ваш AmneziaWG 1.5 конфиг...'
                    },
                    field: {
                        name: 'AmneziaWG Конфиг',
                        description: 'Полный конфиг для подключения к серверам Amnezia'
                    },
                    onChange: (value) => {
                        Store.set('config', value);
                        console.log('[HDRezka] Конфиг сохранён');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'hdrezka',
                    param: {
                        name: 'hdrezka_enabled',
                        type: 'trigger',
                        default: true
                    },
                    field: {
                        name: 'Включить HDRezka',
                        description: 'Показывать HDRezka в меню'
                    },
                    onChange: (value) => {
                        Store.set('enabled', value === 'true');
                    }
                });

                console.log('[HDRezka] Настройки добавлены');
            } catch (e) {
                console.warn('[HDRezka] Не удалось добавить настройки:', e);
            }
        }

        // ===== СЛЕЖЕНИЕ ЗА КАРТОЧКОЙ =====
        function observeCard() {
            // Проверяем при каждом изменении DOM
            const observer = new MutationObserver(function() {
                if ($('.full-start').length) {
                    setTimeout(addButtonToCard, 200);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Первоначальная проверка
            setTimeout(addButtonToCard, 500);

            // Также следим за событием открытия карточки
            Lampa.Listener.follow('full', function(e) {
                if (e.type === 'complite' || e.type === 'open') {
                    setTimeout(addButtonToCard, 300);
                }
            });

            console.log('[HDRezka] Наблюдение за карточкой запущено');
        }

        // ===== СТАРТ =====
        if (window.appready) {
            addMenuItem();
            addSettings();
            observeCard();
        } else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type === 'ready') {
                    addMenuItem();
                    addSettings();
                    observeCard();
                }
            });
        }

        console.log('[HDRezka] Плагин готов');
    }

    startPlugin();

})();
