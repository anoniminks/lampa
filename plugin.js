(function () {
    'use strict';

    // ============================================================
    // 1. КОНФИГУРАЦИЯ
    // ============================================================
    const CONFIG = {
        id: 'hdrezka_amnezia',
        name: 'HDRezka (Amnezia)',
        baseUrl: 'https://hdrezka.ag',
        // Конфиг Amnezia хранится в localStorage под ключом 'amnezia_config'
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
    // 4. API ДЛЯ РАБОТЫ С HDREZKA
    // ============================================================
    class HDRezkaApi {
        constructor() {
            this.network = new Lampa.Reguest();
            this.servers = getAmneziaServers();
            this.serverIndex = 0;
        }

        // Получить следующий сервер (ротация)
        getNextServer() {
            if (this.servers.length === 0) return null;
            const server = this.servers[this.serverIndex % this.servers.length];
            this.serverIndex = (this.serverIndex + 1) % this.servers.length;
            return server;
        }

        // Запрос через Amnezia-прокси
        request(url, success, error) {
            const server = this.getNextServer();
            if (!server) {
                error('Нет доступных серверов Amnezia');
                return;
            }

            const proxy = `http://${server.ip}:${server.port}`;
            const proxyUrl = proxy + '?url=' + encodeURIComponent(url);

            this.network.silent(proxyUrl, (data) => {
                success(data);
            }, (err) => {
                error(err);
            });
        }

        // Получить HTML страницы
        getHtml(url, success, error) {
            this.request(url, (data) => {
                success(data);
            }, error);
        }

        // Поиск
        search(query, page, success, error) {
            const url = `${CONFIG.baseUrl}/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
            if (page > 1) {
                // HDRezka использует пагинацию через ?page=N
                this.getHtml(url + '&page=' + page, success, error);
            } else {
                this.getHtml(url, success, error);
            }
        }

        // Получение категории (главная, фильмы, сериалы и т.д.)
        getCategory(category, page, success, error) {
            const url = `${CONFIG.baseUrl}/${category}/`;
            if (page > 1) {
                this.getHtml(url + 'page/' + page + '/', success, error);
            } else {
                this.getHtml(url, success, error);
            }
        }

        // Получение деталей фильма (для плеера)
        getDetails(url, success, error) {
            this.getHtml(url, success, error);
        }

        // Очистка
        clear() {
            this.network.clear();
        }
    }

    // ============================================================
    // 5. УТИЛИТЫ
    // ============================================================
    const Utils = {
        // Парсинг результатов поиска/категории
        parseResults(html) {
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const items = doc.querySelectorAll('.b-content__inline_item');
            items.forEach(item => {
                const link = item.querySelector('.b-content__inline_item-link a');
                const title = link?.textContent?.trim() || '';
                const href = link?.getAttribute('href') || '';
                const poster = item.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '';
                const year = item.querySelector('.b-content__inline_item-link .year')?.textContent?.trim() || '';

                const id = href.match(/\/(\d+)-/)?.[1] || '';
                const isSeries = href.includes('/series/');

                if (id) {
                    results.push({
                        id: id,
                        title: title,
                        poster: poster,
                        year: year,
                        url: href,
                        type: isSeries ? 'tv' : 'movie'
                    });
                }
            });

            return results;
        },

        // Парсинг страницы с деталями (для плеера)
        parseDetails(html) {
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
        },

        // Воспроизведение
        play(element) {
            if (!element.url) {
                Lampa.Noty.show('Ошибка: нет ссылки на фильм');
                return;
            }

            Lampa.Loading.start();

            const api = new HDRezkaApi();
            api.getDetails(CONFIG.baseUrl + element.url, (html) => {
                Lampa.Loading.stop();

                const details = this.parseDetails(html);

                if (details.playerUrl) {
                    Lampa.Player.playExternal(details.playerUrl, {
                        title: details.title || element.title,
                        poster: details.poster || element.poster
                    });
                } else {
                    // Если не нашли плеер — открываем страницу в браузере
                    Lampa.Noty.show('Открываем страницу фильма');
                    window.open(CONFIG.baseUrl + element.url, '_blank');
                }
            }, (err) => {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка загрузки: ' + err);
            });
        },

        // Показать результаты в виде списка
        showResults(results, title) {
            if (!results || results.length === 0) {
                Lampa.Noty.show('Ничего не найдено');
                return;
            }

            const items = results.map(item => ({
                title: item.title,
                subtitle: item.year || '',
                image: item.poster,
                onClick: () => {
                    Utils.play(item);
                }
            }));

            Lampa.Select.show({
                title: title || 'Результаты поиска',
                items: items,
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        }
    };

    // ============================================================
    // 6. КОМПОНЕНТ ГЛАВНОЙ СТРАНИЦЫ
    // ============================================================
    function HDRezkaMain(object) {
        const comp = new Lampa.InteractionMain(object);

        comp.create = function() {
            this.activity.loader(true);

            const api = new HDRezkaApi();

            // Загружаем главную страницу HDRezka
            api.getCategory('', 1, (html) => {
                const results = Utils.parseResults(html);

                const data = {
                    results: results,
                    total_pages: 50,
                    collection: true,
                    line_type: 'none',
                    card_events: {
                        onEnter: (card, element) => {
                            Utils.play(element);
                        }
                    }
                };

                this.build(data);
                this.activity.loader(false);

            }, (err) => {
                this.empty(err);
            });
        };

        comp.empty = function(er) {
            const empty = new Lampa.Empty({
                descr: typeof er == 'string' ? er : Lampa.Lang.translate('empty_text_two')
            });
            this.activity.render().find('.activity__body > div')[0].appendChild(empty.render(true));
            this.start = empty.start.bind(empty);
            this.activity.loader(false);
            this.activity.toggle();
        };

        return comp;
    }

    // ============================================================
    // 7. КОМПОНЕНТ КАТЕГОРИИ/ПОИСКА
    // ============================================================
    function HDRezkaView(object) {
        const comp = new Lampa.InteractionCategory(object);

        comp.create = function() {
            this.activity.loader(true);

            const api = new HDRezkaApi();

            // Определяем, что загружаем: поиск или категорию
            const isSearch = object.url && object.url.includes('search=');
            const loadFn = isSearch ? api.search.bind(api) : api.getCategory.bind(api);

            const params = isSearch
                ? [decodeURIComponent(object.url.split('search=')[1]), object.page || 1]
                : [object.url, object.page || 1];

            loadFn(...params, (html) => {
                const results = Utils.parseResults(html);

                const data = {
                    results: results,
                    total_pages: 50,
                    collection: true,
                    line_type: 'none',
                    card_events: {
                        onEnter: (card, element) => {
                            Utils.play(element);
                        }
                    }
                };

                this.build(data);
                this.activity.loader(false);

                // Добавляем кнопку фильтра (поиск)
                this.render().find('.head__actions').append(`
                    <div class="head__action head__settings selector" data-action="hdrezka_search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </div>
                `);

                // Обработчик поиска
                this.render().find('[data-action="hdrezka_search"]').on('hover:enter', () => {
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

            }, (err) => {
                this.empty(err);
            });
        };

        comp.empty = function(er) {
            const empty = new Lampa.Empty({
                descr: typeof er == 'string' ? er : Lampa.Lang.translate('empty_text_two')
            });
            this.activity.render().find('.activity__body > div')[0].appendChild(empty.render(true));
            this.start = empty.start.bind(empty);
            this.activity.loader(false);
            this.activity.toggle();
        };

        comp.nextPageReuest = function(object, resolve, reject) {
            // Заглушка для пагинации
            reject('Пагинация временно отключена');
        };

        return comp;
    }

    // ============================================================
    // 8. РЕГИСТРАЦИЯ КОМПОНЕНТОВ И МЕНЮ
    // ============================================================
    function startPlugin() {
        if (window['plugin_hdrezka_ready']) return;
        window['plugin_hdrezka_ready'] = true;

        console.log('[HDRezka] Плагин запускается');

        // Регистрируем компоненты
        Lampa.Component.add('hdrezka', HDRezkaMain);
        Lampa.Component.add('hdrezka_view', HDRezkaView);

        // ============================================================
        // 9. ДОБАВЛЯЕМ ПУНКТ В ГЛАВНОЕ МЕНЮ
        // ============================================================
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
                // Открываем главную страницу HDRezka
                Lampa.Activity.push({
                    url: '',
                    title: 'HDRezka',
                    component: 'hdrezka',
                    page: 1
                });
            });

            // Добавляем в конец меню
            $('.menu .menu__list').eq(0).append(menuItem);
            console.log('[HDRezka] Пункт меню добавлен');
        }

        // ============================================================
        // 10. ДОБАВЛЯЕМ НАСТРОЙКИ
        // ============================================================
        function addSettings() {
            if (window.hdrezka_settings_added) return;
            window.hdrezka_settings_added = true;

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
                    const menuItem = $('.menu .menu__list').find('.menu__text:contains("HDRezka")').closest('.menu__item');
                    if (value === 'true') {
                        menuItem.show();
                    } else {
                        menuItem.hide();
                    }
                }
            });

            console.log('[HDRezka] Настройки добавлены');
        }

        // ============================================================
        // 11. СТАРТ
        // ============================================================
        if (window.appready) {
            addMenuItem();
            addSettings();
        } else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type === 'ready') {
                    addMenuItem();
                    addSettings();
                }
            });
        }

        console.log('[HDRezka] Плагин готов');
    }

    // ============================================================
    // 12. ЗАПУСК
    // ============================================================
    // Проверяем, не загружен ли уже плагин
    if (!window['plugin_hdrezka_ready']) {
        startPlugin();
    }

})();
