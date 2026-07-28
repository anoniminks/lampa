// ============================================================
// Плагин HDRezka для Lampa
// Точная копия подхода online_mod.js
// ============================================================

(function () {
    'use strict';

    // Проверка, что плагин уже загружен
    if (window.hdrezka_online_loaded) return;
    window.hdrezka_online_loaded = true;

    console.log('[HDRezka] Загрузка...');

    // ============================================================
    // 1. КОНФИГУРАЦИЯ (как в online_mod.js)
    // ============================================================
    var BASE_URL = 'https://hdrezka.ag';
    var PLUGIN_NAME = 'HDRezka';

    // ============================================================
    // 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (как в online_mod.js)
    // ============================================================
    function startsWith(str, search) {
        return str.lastIndexOf(search, 0) === 0;
    }

    function endsWith(str, search) {
        var start = str.length - search.length;
        if (start < 0) return false;
        return str.indexOf(search, start) === start;
    }

    function fixLink(link, referrer) {
        if (link) {
            if (!referrer || link.indexOf('://') !== -1) return link;
            var url = parseURL(referrer);
            if (startsWith(link, '//')) return url.protocol + link;
            if (startsWith(link, '/')) return url.origin + link;
            if (startsWith(link, '?')) return url.origin + url.pathname + link;
            if (startsWith(link, '#')) return url.origin + url.pathname + url.search + link;
            var base = url.origin + url.pathname;
            base = base.substring(0, base.lastIndexOf('/') + 1);
            return base + link;
        }
        return link;
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
                    source: 'hdrezka',
                    provider: 'hdrezka'
                });
            }
        });

        return results;
    }

    function parsePlayerUrl(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        var iframe = doc.querySelector('iframe[src*="hdrezka"]');
        if (iframe) return iframe.getAttribute('src');

        var video = doc.querySelector('video source');
        if (video) return video.getAttribute('src');

        var scripts = doc.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
            var content = scripts[i].textContent || '';
            var match = content.match(/player\.src\s*=\s*["']([^"']+)["']/);
            if (match) return match[1];
        }

        return null;
    }

    // ============================================================
    // 4. КОМПОНЕНТ ДЛЯ LAMPA (как в online_mod.js)
    // ============================================================
    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);

        var movieTitle = object.search || object.movie.title;

        // ============================================================
        // 4.1. ПОИСК НА HDREZKA
        // ============================================================
        function searchOnHDRezka(query, callback) {
            var url = BASE_URL + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query);

            network.clear();
            network.timeout(10000);
            network.silent(url, function(html) {
                var results = parseSearchResults(html);
                callback(results);
            }, function(a, c) {
                Lampa.Noty.show('❌ Ошибка поиска: ' + network.errorDecode(a, c));
                callback([]);
            }, false, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
        }

        // ============================================================
        // 4.2. ПОЛУЧЕНИЕ ССЫЛКИ НА ПЛЕЕР
        // ============================================================
        function getPlayerUrl(url, callback) {
            var fullUrl = url.startsWith('http') ? url : BASE_URL + url;

            network.clear();
            network.timeout(10000);
            network.silent(fullUrl, function(html) {
                var playerUrl = parsePlayerUrl(html);
                callback(playerUrl);
            }, function(a, c) {
                Lampa.Noty.show('❌ Ошибка загрузки плеера');
                callback(null);
            }, false, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
        }

        // ============================================================
        // 4.3. ПОКАЗ РЕЗУЛЬТАТОВ
        // ============================================================
        function showResults(results) {
            if (!results || results.length === 0) {
                Lampa.Noty.show('❌ Ничего не найдено на HDRezka');
                return;
            }

            if (results.length === 1) {
                Lampa.Noty.show('🎬 Загрузка...');
                getPlayerUrl(results[0].url, function(playerUrl) {
                    if (playerUrl) {
                        Lampa.Player.playExternal(playerUrl, {
                            title: results[0].title,
                            poster: results[0].poster
                        });
                    } else {
                        Lampa.Noty.show('📱 Открываем страницу');
                        window.open(BASE_URL + results[0].url, '_blank');
                    }
                });
                return;
            }

            var items = results.map(function(item) {
                return {
                    title: item.title,
                    image: item.poster || '',
                    onClick: function() {
                        Lampa.Noty.show('🎬 Загрузка...');
                        getPlayerUrl(item.url, function(playerUrl) {
                            if (playerUrl) {
                                Lampa.Player.playExternal(playerUrl, {
                                    title: item.title,
                                    poster: item.poster
                                });
                            } else {
                                Lampa.Noty.show('📱 Открываем страницу');
                                window.open(BASE_URL + item.url, '_blank');
                            }
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
        }

        // ============================================================
        // 4.4. ФУНКЦИИ КОМПОНЕНТА (как в online_mod.js)
        // ============================================================
        this.create = function() {
            this.activity.loader(true);

            // Добавляем кнопку поиска
            var searchButton = $(`
                <div class="head__action head__settings selector">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                </div>
            `);

            searchButton.on('hover:enter', function() {
                Lampa.Input.edit({
                    title: 'Поиск на HDRezka',
                    value: '',
                    free: true,
                    nosave: true
                }, function(value) {
                    if (value) {
                        Lampa.Activity.push({
                            url: '',
                            title: 'HDRezka - ' + value,
                            component: 'hdrezka',
                            search: value,
                            page: 1
                        });
                    }
                    Lampa.Controller.toggle('content');
                });
            });

            // Добавляем кнопку в шапку
            var headActions = this.activity.render().find('.head__actions');
            if (headActions.length) {
                headActions.append(searchButton);
            }

            // Загружаем главную страницу
            var url = BASE_URL + '/';
            network.clear();
            network.timeout(10000);
            network.silent(url, function(html) {
                var results = parseSearchResults(html);
                
                var data = {
                    results: results,
                    total_pages: 50,
                    collection: true,
                    line_type: 'none',
                    card_events: {
                        onEnter: function(card, element) {
                            Lampa.Noty.show('🎬 Загрузка...');
                            getPlayerUrl(element.url, function(playerUrl) {
                                if (playerUrl) {
                                    Lampa.Player.playExternal(playerUrl, {
                                        title: element.title,
                                        poster: element.poster
                                    });
                                } else {
                                    Lampa.Noty.show('📱 Открываем страницу');
                                    window.open(BASE_URL + element.url, '_blank');
                                }
                            });
                        }
                    }
                };

                this.build(data);
                this.activity.loader(false);
            }, function(a, c) {
                this.empty(network.errorDecode(a, c));
            }.bind(this), false, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
        };

        this.empty = function(msg) {
            this.activity.loader(false);
            var empty = Lampa.Template.get('list_empty');
            if (msg) empty.find('.empty__descr').text(msg);
            scroll.append(empty);
            this.activity.toggle();
        };

        this.render = function() {
            return files.render();
        };

        this.destroy = function() {
            network.clear();
            files.destroy();
            scroll.destroy();
        };

        // Строим интерфейс
        files.appendHead(scroll.render());
        files.appendFiles(scroll.render());

        return this.render();
    }

    // ============================================================
    // 5. РЕГИСТРАЦИЯ КОМПОНЕНТА (как в online_mod.js)
    // ============================================================
    function registerComponent() {
        if (window.hdrezka_component_registered) return;
        window.hdrezka_component_registered = true;

        Lampa.Component.add('hdrezka', component);
        console.log('[HDRezka] Компонент зарегистрирован');
    }

    // ============================================================
    // 6. ДОБАВЛЕНИЕ КНОПКИ НА КАРТОЧКУ (как в online_mod.js)
    // ============================================================
    function addCardButton() {
        var button = $(`
            <div class="full-start__button selector view--hdrezka">
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

        button.on('hover:enter', function() {
            var titleEl = $('.full-start__title');
            if (!titleEl.length) return;

            var movieTitle = titleEl.text().trim();
            if (!movieTitle) return;

            Lampa.Activity.push({
                url: '',
                title: 'HDRezka - ' + movieTitle,
                component: 'hdrezka',
                search: movieTitle,
                page: 1
            });
        });

        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite') {
                var container = e.object.activity.render().find('.full-start__buttons');
                if (container.length && !container.find('.view--hdrezka').length) {
                    container.append(button);
                }
            }
        });
    }

    // ============================================================
    // 7. ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ (как в online_mod.js)
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

        var list = $('.menu .menu__list').eq(0);
        if (list.length) {
            list.append(menuItem);
            console.log('[HDRezka] Пункт меню добавлен');
        }
    }

    // ============================================================
    // 8. ЗАПУСК (как в online_mod.js)
    // ============================================================
    function start() {
        console.log('[HDRezka] Старт...');

        registerComponent();
        addCardButton();
        addMenuItem();

        console.log('[HDRezka] Готов');
    }

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
