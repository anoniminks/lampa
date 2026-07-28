// ============================================================
// Плагин HDRezka для Lampa
// Работает через инжект в index.html или как внешний скрипт
// ============================================================

(function () {
    'use strict';

    // Проверка, что плагин уже загружен
    if (window.hdrezka_plugin_loaded) return;
    window.hdrezka_plugin_loaded = true;

    console.log('[HDRezka] Загрузка плагина...');

    // ============================================================
    // 1. БАЗОВЫЕ НАСТРОЙКИ (как в online_mod.js)
    // ============================================================
    var BASE_URL = 'https://hdrezka.ag';
    var PLUGIN_NAME = 'HDRezka';
    var PLUGIN_ID = 'hdrezka';

    // ============================================================
    // 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (как в online_mod.js)
    // ============================================================
    function startsWith(str, search) {
        return str.indexOf(search) === 0;
    }

    function endsWith(str, search) {
        return str.indexOf(search, str.length - search.length) !== -1;
    }

    function fixLink(link, referrer) {
        if (!link) return link;
        if (link.indexOf('://') !== -1) return link;
        
        var url = parseURL(referrer || BASE_URL);
        if (startsWith(link, '//')) return url.protocol + link;
        if (startsWith(link, '/')) return url.origin + link;
        if (startsWith(link, '?')) return url.origin + url.pathname + link;
        
        var base = url.origin + url.pathname;
        base = base.substring(0, base.lastIndexOf('/') + 1);
        return base + link;
    }

    function parseURL(link) {
        var url = {
            href: link,
            protocol: '',
            host: '',
            origin: '',
            pathname: '',
            search: '',
            hash: ''
        };
        var pos = link.indexOf('#');
        if (pos !== -1) {
            url.hash = link.substring(pos);
            link = link.substring(0, pos);
        }
        pos = link.indexOf('?');
        if (pos !== -1) {
            url.search = link.substring(pos);
            link = link.substring(0, pos);
        }
        pos = link.indexOf(':');
        var path_pos = link.indexOf('/');
        if (pos !== -1 && (path_pos === -1 || path_pos > pos)) {
            url.protocol = link.substring(0, pos + 1);
            link = link.substring(pos + 1);
        }
        if (startsWith(link, '//')) {
            pos = link.indexOf('/', 2);
            if (pos !== -1) {
                url.host = link.substring(2, pos);
                link = link.substring(pos);
            } else {
                url.host = link.substring(2);
                link = '/';
            }
            url.origin = url.protocol + '//' + url.host;
        }
        url.pathname = link;
        return url;
    }

    // ============================================================
    // 3. ПАРСИНГ HDREZKA (как в online_mod.js)
    // ============================================================
    function parseSearchResults(html) {
        var results = [];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        var items = doc.querySelectorAll('.b-content__inline_item');
        items.forEach(function(item) {
            var link = item.querySelector('.b-content__inline_item-link a');
            if (!link) return;

            var title = link.textContent.trim();
            var href = link.getAttribute('href');
            var poster = item.querySelector('.b-content__inline_item-cover img')?.getAttribute('src') || '';
            var year = item.querySelector('.b-content__inline_item-link .year')?.textContent?.trim() || '';

            var id = href.match(/\/(\d+)-/)?.[1] || '';
            var isSeries = href.includes('/series/');

            if (id) {
                results.push({
                    id: id,
                    title: title,
                    poster: poster,
                    year: year,
                    url: href,
                    type: isSeries ? 'tv' : 'movie',
                    source: PLUGIN_ID,
                    provider: PLUGIN_ID
                });
            }
        });

        return results;
    }

    function parsePlayerURL(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // 1. Ищем iframe
        var iframe = doc.querySelector('iframe[src*="hdrezka"]');
        if (iframe) return iframe.getAttribute('src');

        // 2. Ищем video source
        var video = doc.querySelector('video source');
        if (video) return video.getAttribute('src');

        // 3. Ищем в скриптах
        var scripts = doc.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
            var content = scripts[i].textContent || '';
            var match = content.match(/player\.src\s*=\s*["']([^"']+)["']/);
            if (match) return match[1];
        }

        return null;
    }

    // ============================================================
    // 4. ЗАПРОСЫ (как в online_mod.js)
    // ============================================================
    function fetchPage(url, success, error) {
        fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
            }
        })
        .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        })
        .then(function(html) {
            success(html);
        })
        .catch(function(err) {
            error(err);
        });
    }

    // ============================================================
    // 5. РЕГИСТРАЦИЯ ИСТОЧНИКА В ПЛЕЕРЕ (как в online_mod.js)
    // ============================================================
    function registerPlayerSource() {
        if (window['hdrezka_source_registered']) return;
        window['hdrezka_source_registered'] = true;

        Lampa.Player.addSource(PLUGIN_ID, {
            name: PLUGIN_NAME,
            getUrl: function(item) {
                return new Promise(function(resolve, reject) {
                    if (item.provider !== PLUGIN_ID && item.source !== PLUGIN_ID) {
                        resolve(null);
                        return;
                    }

                    var fullUrl = BASE_URL + item.url;
                    fetchPage(fullUrl, function(html) {
                        var playerUrl = parsePlayerURL(html);
                        if (playerUrl) {
                            resolve(playerUrl);
                        } else {
                            Lampa.Noty.show('❌ Не найдена ссылка на видео');
                            resolve(null);
                        }
                    }, function(err) {
                        Lampa.Noty.show('❌ Ошибка: ' + err.message);
                        resolve(null);
                    });
                });
            },
            onError: function(item, error) {
                console.error('[HDRezka] Ошибка плеера:', error);
                Lampa.Noty.show('❌ Ошибка воспроизведения');
            }
        });

        console.log('[HDRezka] Источник зарегистрирован');
    }

    // ============================================================
    // 6. ДОБАВЛЕНИЕ КНОПКИ НА КАРТОЧКУ (как в online_mod.js)
    // ============================================================
    function addButton() {
        // Проверяем, что карточка открыта
        if (!$('.full-start').length) return;
        if ($('.hdrezka-button').length) return;

        var titleEl = $('.full-start__title');
        if (!titleEl.length) return;

        var movieTitle = titleEl.text().trim();
        if (!movieTitle) return;

        var container = $('.full-start__buttons');
        if (!container.length) return;

        var button = $(`
            <div class="full-start__button hdrezka-button selector" style="order:5;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" fill="none" stroke="currentColor" stroke-width="2"/>
                    <line x1="8" y1="2" x2="8" y2="22" stroke="currentColor" stroke-width="2"/>
                    <line x1="16" y1="2" x2="16" y2="22" stroke="currentColor" stroke-width="2"/>
                    <line x1="2" y1="8" x2="22" y2="8" stroke="currentColor" stroke-width="2"/>
                    <line x1="2" y1="16" x2="22" y2="16" stroke="currentColor" stroke-width="2"/>
                    <text x="12" y="17" text-anchor="middle" font-size="9" fill="currentColor" font-weight="bold">HD</text>
                </svg>
                <span>${PLUGIN_NAME}</span>
            </div>
        `);

        button.on('hover:enter', function() {
            Lampa.Noty.show('🔍 Поиск на HDRezka...');

            var url = BASE_URL + '/search/?do=search&subaction=search&q=' + encodeURIComponent(movieTitle);
            fetchPage(url, function(html) {
                var results = parseSearchResults(html);
                
                if (!results || results.length === 0) {
                    Lampa.Noty.show('❌ Ничего не найдено');
                    return;
                }

                if (results.length === 1) {
                    Lampa.Player.play({
                        title: results[0].title,
                        poster: results[0].poster,
                        url: results[0].url,
                        source: PLUGIN_ID,
                        provider: PLUGIN_ID,
                        id: results[0].id,
                        type: results[0].type
                    });
                    return;
                }

                // Показываем список для выбора
                var items = results.map(function(item) {
                    return {
                        title: item.title,
                        image: item.poster || '',
                        onClick: function() {
                            Lampa.Player.play({
                                title: item.title,
                                poster: item.poster,
                                url: item.url,
                                source: PLUGIN_ID,
                                provider: PLUGIN_ID,
                                id: item.id,
                                type: item.type
                            });
                            Lampa.Controller.toggle('content');
                        }
                    };
                });

                Lampa.Select.show({
                    title: 'Результаты: ' + movieTitle,
                    items: items,
                    onBack: function() {
                        Lampa.Controller.toggle('content');
                    }
                });
            }, function(err) {
                Lampa.Noty.show('❌ Ошибка поиска: ' + err.message);
            });
        });

        container.append(button);
        console.log('[HDRezka] Кнопка добавлена');
    }

    // ============================================================
    // 7. СЛЕЖЕНИЕ ЗА КАРТОЧКОЙ (как в online_mod.js)
    // ============================================================
    function observeCard() {
        // Событие открытия карточки
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite' || e.type === 'open') {
                setTimeout(addButton, 300);
            }
        });

        // MutationObserver
        var observer = new MutationObserver(function() {
            if ($('.full-start').length) {
                setTimeout(addButton, 200);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Первоначальная проверка
        setTimeout(addButton, 500);
    }

    // ============================================================
    // 8. ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ (как в online_mod.js)
    // ============================================================
    function addMenuItem() {
        var menuItem = $(`
            <li class="menu__item selector">
                <div class="menu__ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;">
                        <rect x="2" y="2" width="20" height="20" rx="2.18"/>
                        <line x1="8" y1="2" x2="8" y2="22"/>
                        <line x1="16" y1="2" x2="16" y2="22"/>
                        <line x1="2" y1="8" x2="22" y2="8"/>
                        <line x1="2" y1="16" x2="22" y2="16"/>
                    </svg>
                </div>
                <div class="menu__text">${PLUGIN_NAME}</div>
            </li>
        `);

        menuItem.on('hover:enter', function() {
            // Просто открываем сайт в браузере
            window.open(BASE_URL, '_blank');
        });

        var list = $('.menu .menu__list').eq(0);
        if (list.length) {
            list.append(menuItem);
            console.log('[HDRezka] Пункт меню добавлен');
        }
    }

    // ============================================================
    // 9. ЗАПУСК (как в online_mod.js)
    // ============================================================
    function start() {
        console.log('[HDRezka] Старт...');

        registerPlayerSource();
        observeCard();
        addMenuItem();

        console.log('[HDRezka] Готов');
    }

    // Ждём готовности Lampa (как в online_mod.js)
    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                start();
            }
        });
    }

    console.log('[HDRezka] Загружен');
})();
