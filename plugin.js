(function () {
    'use strict';

    /**
     * HDrezka.fi Plugin for Lampa
     * v0.3.0 - debug version
     */

    var DEBUG = true;

    function log() {
        if (DEBUG) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[HDrezka]');
            console.log.apply(console, args);
        }
    }

    function getMirror() {
        var mirror = Lampa.Storage.get('hdrezka_mirror', 'https://hdrezka.fi');
        if (mirror.indexOf('http') === -1) mirror = 'https://' + mirror;
        if (mirror.endsWith('/')) mirror = mirror.slice(0, -1);
        return mirror;
    }

    function getCorsProxyUrl() {
        var proxy = Lampa.Storage.get('hdrezka_cors_proxy', '');
        if (proxy && proxy.endsWith('/')) proxy = proxy.slice(0, -1);
        return proxy;
    }

    /**
     * Формирование URL для запроса с учётом CORS-прокси
     */
    function buildRequestUrl(url) {
        var corsProxy = getCorsProxyUrl();
        if (corsProxy) {
            // Некоторые прокси требуют просто добавить URL в конец
            return corsProxy + '/' + encodeURIComponent(url);
        }
        return url;
    }

    /**
     * Заголовки для запросов
     */
    function getRequestHeaders() {
        var mirror = getMirror();
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': mirror + '/',
            'Origin': mirror
        };
    }

    /**
     * Декодирование зашифрованных ссылок HDrezka
     */
    function decodeRezkaUrl(encrypted) {
        if (!encrypted) return '';
        try {
            if (encrypted.indexOf('//') === -1 && encrypted.length > 20) {
                var decoded = atob(encrypted);
                if (decoded.indexOf('http') === 0) return decoded;
            }
            if (encrypted.indexOf('http') === 0) return encrypted;
            return encrypted;
        } catch (e) {
            return encrypted;
        }
    }

    /**
     * Парсинг HTML-ответа поиска
     */
    function parseSearchResults(html) {
        log('parseSearchResults, html length:', html ? html.length : 0);

        var results = [];
        if (!html || html.length < 100) {
            log('HTML пустой или слишком короткий');
            return results;
        }

        // Пробуем разные селекторы, т.к. структура может меняться
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // Вариант 1: стандартные inline_item
        var items = doc.querySelectorAll('.b-content__inline_item');
        log('Найдено .b-content__inline_item:', items.length);

        // Вариант 2: другие возможные классы
        if (items.length === 0) {
            items = doc.querySelectorAll('.b-content__inline_items .b-content__inline_item');
            log('Найдено (v2):', items.length);
        }

        if (items.length === 0) {
            items = doc.querySelectorAll('[class*="inline_item"]');
            log('Найдено (v3 fuzzy):', items.length);
        }

        items.forEach(function(item, idx) {
            var linkEl = item.querySelector('.b-content__inline_item-link a');
            var imgEl = item.querySelector('img');
            var qualityEl = item.querySelector('.b-content__inline_item-quality');
            var infoEl = item.querySelector('.b-content__inline_item-link div:last-child');

            if (linkEl) {
                var href = linkEl.getAttribute('href') || '';
                var title = linkEl.textContent.trim();

                // Иногда ссылка относительная
                if (href && href.indexOf('http') !== 0) {
                    href = getMirror() + href;
                }

                results.push({
                    title: title,
                    url: href,
                    poster: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '',
                    quality: qualityEl ? qualityEl.textContent.trim() : '',
                    info: infoEl ? infoEl.textContent.trim() : ''
                });

                log('Результат #' + idx + ':', title, href);
            }
        });

        // Если DOM-парсинг не сработал, пробуем regex
        if (results.length === 0) {
            log('DOM-парсинг не дал результатов, пробуем regex...');
            var regex = /<div[^>]*class="[^"]*b-content__inline_item[^"]*"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>/gi;
            var match;
            while ((match = regex.exec(html)) !== null) {
                var href = match[1];
                var titleMatch = match[2].match(/>([^<]+)</);
                var title = titleMatch ? titleMatch[1].trim() : '';
                if (href && title) {
                    if (href.indexOf('http') !== 0) href = getMirror() + href;
                    results.push({
                        title: title,
                        url: href,
                        poster: '',
                        quality: '',
                        info: ''
                    });
                    log('Regex результат:', title, href);
                }
            }
        }

        log('Всего результатов поиска:', results.length);
        return results;
    }

    /**
     * Парсинг страницы фильма/сериала
     */
    function parseFilmPage(html) {
        log('parseFilmPage, html length:', html ? html.length : 0);

        var result = {
            id: '',
            translators: [],
            type: 'movie',
            title: '',
            poster: ''
        };

        if (!html || html.length < 100) return result;

        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // ID фильма
        var idMatch = html.match(/data-id="(\d+)"/);
        if (idMatch) result.id = idMatch[1];
        log('Film ID:', result.id);

        // Название
        var titleEl = doc.querySelector('h1');
        if (!titleEl) titleEl = doc.querySelector('.b-post__title');
        if (titleEl) result.title = titleEl.textContent.trim();
        log('Film title:', result.title);

        // Постер
        var posterEl = doc.querySelector('.b-sidecover img');
        if (!posterEl) posterEl = doc.querySelector('.b-post__infotable img');
        if (posterEl) result.poster = posterEl.getAttribute('src') || posterEl.getAttribute('data-src') || '';

        // Тип: сериал или фильм
        if (html.indexOf('b-simple_seasons__list') !== -1 || 
            html.indexOf('b-simple_episodes__list') !== -1 ||
            html.indexOf('"seasons"') !== -1) {
            result.type = 'tv_series';
        }
        log('Film type:', result.type);

        // Переводы
        var transBlocks = doc.querySelectorAll('.b-translator__item');
        log('Найдено переводов (DOM):', transBlocks.length);

        transBlocks.forEach(function(trans) {
            var tid = trans.getAttribute('data-translator_id');
            var tname = trans.getAttribute('title') || trans.textContent.trim();
            if (tid) {
                result.translators.push({ id: tid, name: tname });
                log('Перевод:', tid, tname);
            }
        });

        // Fallback: парсим из JS на странице
        if (result.translators.length === 0) {
            var transMatch = html.match(/data-translator_id="(\d+)"/g);
            if (transMatch) {
                var uniqueIds = [];
                transMatch.forEach(function(m) {
                    var id = m.match(/(\d+)/)[1];
                    if (uniqueIds.indexOf(id) === -1) {
                        uniqueIds.push(id);
                        var nameMatch = html.match(new RegExp('data-translator_id="' + id + '"[^>]*title="([^"]+)"'));
                        result.translators.push({
                            id: id,
                            name: nameMatch ? nameMatch[1] : 'Перевод ' + id
                        });
                    }
                });
            }
        }

        // Если совсем нет переводов, ставим дефолтный
        if (result.translators.length === 0) {
            result.translators.push({ id: '0', name: 'Оригинал' });
        }

        log('Итого переводов:', result.translators.length);
        return result;
    }

    /**
     * Основной класс балансера HDrezka
     */
    function hdrezka(component, _object) {
        var network = new Lampa.Reguest();
        var extract = {};
        var results = [];
        var object = _object;
        var filter_items = {};
        var choice = { season: 0, voice: 0, voice_name: '' };
        var mirror = getMirror();
        var filmData = null;

        /**
         * Поиск фильма/сериала
         */
        this.search = function (_object) {
            object = _object;
            var query = object.search || object.movie.title || '';
            var originalQuery = object.movie.original_title || '';

            log('=== НАЧАЛО ПОИСКА ===');
            log('Запрос:', query);
            log('Оригинал:', originalQuery);
            log('Зеркало:', mirror);
            log('CORS прокси:', getCorsProxyUrl() || 'не задан');

            component.loading(true);

            var searchQuery = originalQuery || query;
            var searchUrl = mirror + '/search/?do=search&subaction=search&q=' + encodeURIComponent(searchQuery);
            var requestUrl = buildRequestUrl(searchUrl);

            log('URL поиска:', searchUrl);
            log('URL запроса (с прокси):', requestUrl);

            network.clear();
            network.timeout(20000);

            // Используем network.native для большего контроля
            network.native(requestUrl, function(data) {
                log('Поиск: ответ получен, тип:', typeof data);

                var html = '';
                if (typeof data === 'string') {
                    html = data;
                } else if (data && typeof data === 'object') {
                    // Если прокси обернул ответ
                    html = data.body || data.html || data.data || JSON.stringify(data);
                }

                log('Длина HTML ответа:', html.length);

                if (html.indexOf('<!DOCTYPE') === -1 && html.indexOf('<html') === -1 && html.indexOf('<div') === -1) {
                    log('ОШИБКА: ответ не похож на HTML!');
                    log('Первые 500 символов:', html.substring(0, 500));
                }

                var searchResults = parseSearchResults(html);

                if (searchResults.length === 0 && query !== originalQuery && originalQuery) {
                    log('Пробуем поиск по русскому названию...');
                    searchUrl = mirror + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query);
                    requestUrl = buildRequestUrl(searchUrl);

                    network.clear();
                    network.timeout(20000);
                    network.native(requestUrl, function(data2) {
                        var html2 = typeof data2 === 'string' ? data2 : (data2.body || data2.html || '');
                        var searchResults2 = parseSearchResults(html2);
                        processSearchResults(searchResults2, query);
                    }, function(a, c) {
                        log('Ошибка поиска (рус):', a.status, a.statusText, c);
                        component.emptyForQuery(query);
                    }, false, {
                        dataType: 'text',
                        headers: getRequestHeaders()
                    });
                } else {
                    processSearchResults(searchResults, query);
                }
            }, function(a, c) {
                log('Ошибка поиска:', a.status, a.statusText, c);
                log('Response:', a.responseText ? a.responseText.substring(0, 500) : 'нет');
                component.emptyForQuery(query);
            }, false, {
                dataType: 'text',
                headers: getRequestHeaders()
            });
        };

        function processSearchResults(searchResults, query) {
            log('processSearchResults, найдено:', searchResults.length);

            if (!searchResults || searchResults.length === 0) {
                log('Результаты пустые, показываем empty');
                component.emptyForQuery(object.search || object.movie.title);
                return;
            }

            // Берём первый результат
            var bestMatch = searchResults[0];
            log('Выбран результат:', bestMatch.title, bestMatch.url);

            var filmUrl = bestMatch.url;
            var requestUrl = buildRequestUrl(filmUrl);

            log('Загружаем страницу фильма:', filmUrl);

            network.clear();
            network.timeout(20000);
            network.native(requestUrl, function(data) {
                var html = typeof data === 'string' ? data : (data.body || data.html || '');
                log('Страница фильма загружена, длина:', html.length);

                filmData = parseFilmPage(html);

                if (!filmData.id) {
                    log('ОШИБКА: не удалось извлечь ID фильма');
                    component.emptyForQuery(object.search || object.movie.title);
                    return;
                }

                loadStreams(filmData);
            }, function(a, c) {
                log('Ошибка загрузки страницы фильма:', a.status, a.statusText);
                component.emptyForQuery(object.search || object.movie.title);
            }, false, {
                dataType: 'text',
                headers: getRequestHeaders()
            });
        }

        function loadStreams(data) {
            log('loadStreams, translators:', data.translators.length, 'type:', data.type);

            extract = {
                translators: data.translators,
                streams: {},
                type: data.type
            };

            if (data.type === 'movie') {
                loadMovieStream(data.translators[0].id, function(streams) {
                    extract.streams[data.translators[0].id] = streams;
                    buildResults();
                });
            } else {
                // Для сериалов пока заглушка
                buildResults();
            }
        }

        /**
         * AJAX запрос для получения ссылки на видео
         */
        function loadMovieStream(translatorId, callback) {
            var timestamp = new Date().getTime();
            var ajaxUrl = mirror + '/ajax/get_cdn_series/?t=' + timestamp;
            var requestUrl = buildRequestUrl(ajaxUrl);

            log('AJAX запрос:', ajaxUrl);
            log('С прокси:', requestUrl);

            var postData = {
                id: filmData.id,
                translator_id: translatorId,
                action: 'get_movie'
            };

            log('POST data:', JSON.stringify(postData));

            network.clear();
            network.timeout(15000);
            network.native(requestUrl, function(json) {
                log('AJAX ответ:', JSON.stringify(json).substring(0, 500));

                if (json && json.url) {
                    var decoded = decodeRezkaUrl(json.url);
                    log('Декодированный URL:', decoded.substring(0, 100) + '...');
                    callback({
                        url: decoded,
                        quality: json.quality || '720p'
                    });
                } else {
                    log('В ответе нет url');
                    callback(null);
                }
            }, function(a, c) {
                log('Ошибка AJAX:', a.status, a.statusText);
                log('Ответ:', a.responseText ? a.responseText.substring(0, 500) : 'нет');
                callback(null);
            }, false, {
                dataType: 'json',
                post: postData,
                headers: getRequestHeaders()
            });
        }

        function buildResults() {
            log('buildResults');
            results = { 'player_links': { "movie": [] } };

            if (filmData.type === 'movie') {
                filmData.translators.forEach(function(trans, index) {
                    var stream = extract.streams[trans.id];
                    if (stream && stream.url) {
                        results['player_links']["movie"].push({
                            title: trans.name,
                            quality: stream.quality,
                            link: stream.url,
                            translation: (index + 1).toString()
                        });
                        log('Добавлен поток:', trans.name, stream.quality);
                    }
                });
            } else {
                results['player_links']["movie"].push({
                    title: filmData.translators[0] ? filmData.translators[0].name : 'Оригинал',
                    quality: '720p',
                    link: '',
                    translation: '1'
                });
            }

            if (results['player_links']["movie"].length === 0) {
                log('Нет потоков для отображения');
                component.emptyForQuery(object.search || object.movie.title);
                return;
            }

            extractData(results);
            append(filtred());
            component.loading(false);
            log('=== ПОИСК ЗАВЕРШЁН ===');
        }

        this.reset = function () {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            extractData(results);
            component.saveChoice(choice);
        };

        this.filter = function (type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice') choice.voice_name = filter_items.voice[b.index];
            component.reset();
            extractData(results);
            component.saveChoice(choice);
        };

        this.destroy = function () {
            network.clear();
            results = null;
        };

        function extractData(data) {
            extract = {};
            data.player_links.movie.forEach((movie, index) => {
                const id = (index + 1).toString();
                extract[id] = {
                    file: movie.link,
                    translation: movie.translation,
                    quality: movie.quality
                };
            });
        }

        function getFile(element) {
            var file = '';
            var translat = extract[element.translation];
            if (translat) {
                file = {
                    file: translat.file,
                    quality: { "480p": translat.file }
                };
            }
            return file;
        }

        function filtred() {
            var filtred = [];
            results.player_links.movie.forEach((movie, index) => {
                const id = (index + 1).toString();
                filtred.push({
                    title: movie.title,
                    translation: id,
                    quality: movie.quality
                });
            });
            return filtred;
        }

        function append(items) {
            component.reset();
            var viewed = Lampa.Storage.cache('online_view', 5000, []);
            var last_episode = component.getLastEpisode(items);

            items.forEach(function (element) {
                if (element.season) element.title = 'S' + element.season + ' / ' + Lampa.Lang.translate('torrent_serial_episode') + ' ' + element.episode;
                element.info = element.season ? ' / ' + Lampa.Utils.shortText(filter_items.voice[choice.voice], 50) : '';

                if (element.season) {
                    element.translate_episode_end = last_episode;
                    element.translate_voice = filter_items.voice[choice.voice];
                }

                var hash = Lampa.Utils.hash(element.season ? [element.season, element.episode, object.movie.original_title].join('') : object.movie.original_title);
                var view = Lampa.Timeline.view(hash);
                var item = Lampa.Template.get('hdrezka_fi', element);
                var hash_file = Lampa.Utils.hash(element.season ? [element.season, element.episode, object.movie.original_title, filter_items.voice[choice.voice]].join('') : object.movie.original_title + element.title);

                item.addClass('video--stream');
                element.timeline = view;
                item.append(Lampa.Timeline.render(view));

                if (Lampa.Timeline.details) {
                    item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
                }

                if (viewed.indexOf(hash_file) !== -1) {
                    item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                }

                item.on('hover:enter', function () {
                    if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);

                    var extra = getFile(element);
                    if (extra.file) {
                        var playlist = [];
                        var first = {
                            url: extra.file,
                            timeline: view,
                            title: element.season ? element.title : object.movie.title + ' / ' + element.title
                        };

                        if (element.season) {
                            items.forEach(function (elem) {
                                var ex = getFile(elem);
                                playlist.push({
                                    title: elem.title,
                                    url: ex.file,
                                    timeline: elem.timeline
                                });
                            });
                        } else {
                            playlist.push(first);
                        }

                        if (playlist.length > 1) first.playlist = playlist;

                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);

                        if (viewed.indexOf(hash_file) == -1) {
                            viewed.push(hash_file);
                            item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                            Lampa.Storage.set('online_view', viewed);
                        }
                    } else {
                        Lampa.Noty.show(Lampa.Lang.translate('online_nolink'));
                    }
                });

                component.append(item);
            });

            component.start(true);
        }
    }

    /**
     * Компонент Lampa
     */
    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Files(object);
        var filter = new Lampa.Filter(object);
        var balanser = Lampa.Storage.get('hdrezka_fi_balanser', 'hdrezka');
        var last_bls = Lampa.Storage.cache('online_last_balanser', 200, {});

        if (last_bls[object.movie.id]) balanser = last_bls[object.movie.id];

        var sources = { hdrezka: new hdrezka(this, object) };
        var last;
        var last_filter;
        var selected_id;

        var filter_translate = {
            season: Lampa.Lang.translate('torrent_serial_season'),
            voice: Lampa.Lang.translate('torrent_parser_voice'),
            source: Lampa.Lang.translate('settings_rest_source')
        };

        var filter_sources = ['hdrezka'];

        if (filter_sources.indexOf(balanser) == -1) {
            balanser = 'hdrezka';
            Lampa.Storage.set('hdrezka_fi_balanser', 'hdrezka');
        }

        scroll.body().addClass('torrent-list');

        function minus() {
            scroll.minus(window.innerWidth > 580 ? false : files.render().find('.files__left'));
        }

        window.addEventListener('resize', minus, false);
        minus();

        this.create = function () {
            this.activity.loader(true);

            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };

            files.append(scroll.render());
            scroll.append(filter.render());
            this.search();
            return this.render();
        };

        this.search = function () {
            this.activity.loader(true);
            this.reset();
            this.find();
        };

        this.find = function () {
            sources['hdrezka'].search(object);
        };

        this.saveChoice = function (choice) {
            var data = Lampa.Storage.cache('hdrezka_fi_choice_' + balanser, 500, {});
            data[selected_id || object.movie.id] = choice;
            Lampa.Storage.set('hdrezka_fi_choice_' + balanser, data);
        };

        this.reset = function () {
            last = false;
            scroll.render().find('.empty').remove();
            filter.render().detach();
            scroll.clear();
            scroll.append(filter.render());
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                this.activity.toggle();
            }
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });
            scroll.append(item);
        };

        this.empty = function (msg) {
            var empty = Lampa.Template.get('list_empty');
            if (msg) empty.find('.empty__descr').text(msg);
            scroll.append(empty);
            this.loading(false);
        };

        this.emptyForQuery = function (query) {
            this.empty(Lampa.Lang.translate('online_query_start') + ' (' + query + ') ' + Lampa.Lang.translate('hdrezka_fi_query_end'));
        };

        this.getLastEpisode = function (items) {
            var last_episode = 0;
            items.forEach(function (e) {
                if (typeof e.episode !== 'undefined') last_episode = Math.max(last_episode, parseInt(e.episode));
            });
            return last_episode;
        };

        this.start = function (first_select) {
            if (Lampa.Activity.active().activity !== this.activity) return;

            if (first_select) {
                var last_views = scroll.render().find('.selector.online').find('.torrent-item__viewed').parent().last();
                if (object.movie.number_of_seasons && last_views.length) last = last_views.eq(0)[0];
                else last = scroll.render().find('.selector').eq(3)[0];
            }

            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            Lampa.Controller.add('content', {
                toggle: function toggle() {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function up() {
                    if (Navigator.canmove('up')) {
                        if (scroll.render().find('.selector').slice(3).index(last) == 0 && last_filter) {
                            Lampa.Controller.collectionFocus(last_filter, scroll.render());
                        } else Navigator.move('up');
                    } else Lampa.Controller.toggle('head');
                },
                down: function down() {
                    Navigator.move('down');
                },
                right: function right() {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                left: function left() {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            network.clear();
            files.destroy();
            scroll.destroy();
            network = null;
            sources.hdrezka.destroy();
            window.removeEventListener('resize', minus);
        };
    }

    // Локализация
    if (!Lampa.Lang) {
        var lang_data = {};
        Lampa.Lang = {
            add: function add(data) { lang_data = data; },
            translate: function translate(key) { return lang_data[key] ? lang_data[key].ru : key; }
        };
    }

    Lampa.Lang.add({
        online_nolink: {
            ru: 'Не удалось извлечь ссылку',
            uk: 'Неможливо отримати посилання',
            en: 'Failed to fetch link'
        },
        hdrezka_fi_balanser: {
            ru: 'HDrezka',
            uk: 'HDrezka',
            en: 'HDrezka'
        },
        online_query_start: {
            ru: 'По запросу',
            uk: 'На запит',
            en: 'On request'
        },
        hdrezka_fi_query_end: {
            ru: 'нет результатов на HDrezka',
            uk: 'немає результатів на HDrezka',
            en: 'no results on HDrezka'
        },
        hdrezka_fi_title: {
            ru: 'HDrezka.fi',
            uk: 'HDrezka.fi',
            en: 'HDrezka.fi'
        }
    });

    function resetTemplates() {
        Lampa.Template.add('hdrezka_fi', `<div class="online selector">
            <div class="online__body">
                <div style="position: absolute;left: 0;top: -0.3em;width: 2.4em;height: 2.4em">
                    <svg style="height: 2.4em; width: 2.4em;" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/>
                        <path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/>
                    </svg>
                </div>
                <div class="online__title" style="padding-left: 2.1em;">{title}</div>
                <div class="online__quality" style="padding-left: 3.4em;">{quality}{info}</div>
            </div>
        </div>`);
    }

    var button = `<div class="full-start__button selector view--online" data-subtitle="v0.3.0">
        <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 30.051 30.051" style="enable-background:new 0 0 512 512">
            <g>
                <path d="M19.982,14.438l-6.24-4.536c-0.229-0.166-0.533-0.191-0.784-0.062c-0.253,0.128-0.411,0.388-0.411,0.669v9.069 c0,0.284,0.158,0.543,0.411,0.671c0.107,0.054,0.224,0.081,0.342,0.081c0.154,0,0.31-0.049,0.442-0.146l6.24-4.532 c0.197-0.145,0.312-0.369,0.312-0.607C20.295,14.803,20.177,14.58,19.982,14.438z" fill="currentColor"/>
                <path d="M15.026,0.002C6.726,0.002,0,6.728,0,15.028c0,8.297,6.726,15.021,15.026,15.021c8.298,0,15.025-6.725,15.025-15.021 C30.052,6.728,23.324,0.002,15.026,0.002z M15.026,27.542c-6.912,0-12.516-5.601-12.516-12.514c0-6.91,5.604-12.518,12.516-12.518 c6.911,0,12.514,5.607,12.514,12.518C27.541,21.941,21.937,27.542,15.026,27.542z" fill="currentColor"/>
            </g>
        </svg>
        <span>#{hdrezka_fi_title}</span>
    </div>`;

    Lampa.Component.add('hdrezka_fi', component);
    resetTemplates();

    Lampa.Listener.follow('full', function (e) {
        if (e.type == 'complite') {
            var btn = $(Lampa.Lang.translate(button));
            btn.on('hover:enter', function () {
                resetTemplates();
                Lampa.Component.add('hdrezka_fi', component);
                Lampa.Activity.push({
                    url: '',
                    title: Lampa.Lang.translate('hdrezka_fi_title'),
                    component: 'hdrezka_fi',
                    search: e.data.movie.title,
                    search_one: e.data.movie.title,
                    search_two: e.data.movie.original_title,
                    movie: e.data.movie,
                    page: 1
                });
            });
            e.object.activity.render().find('.view--torrent').after(btn);
        }
    });

    // ==================== НАСТРОЙКИ ====================

    Lampa.SettingsApi.addComponent({
        component: 'hdrezka_fi_config',
        name: 'HDrezka.fi',
        icon: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs><style>.a{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:3;}</style></defs><rect class="a" x="5.5" y="5.5" width="37" height="33.1724" rx="1.252"/><line class="a" x1="27.8276" y1="5.5" x2="27.8276" y2="38.6724"/><line class="a" x1="33.5898" y1="12.2251" x2="36.7378" y2="12.2251"/><line class="a" x1="33.5898" y1="17.3047" x2="36.7378" y2="17.3047"/><rect class="a" x="8.1292" y="38.6724" width="5.1034" height="3.8276"/><rect class="a" x="34.8687" y="38.6724" width="5.1034" height="3.8276"/></svg>`
    });

    Lampa.SettingsApi.addParam({
        component: 'hdrezka_fi_config',
        param: {
            name: 'hdrezka_mirror',
            type: 'input',
            placeholder: 'https://hdrezka.fi',
            values: '',
            default: 'https://hdrezka.fi'
        },
        field: {
            name: 'Зеркало HDrezka',
            description: 'Адрес: hdrezka.fi, rezka.ag, hdrezka.me и т.д.'
        }
    });

    Lampa.SettingsApi.addParam({
        component: 'hdrezka_fi_config',
        param: {
            name: 'hdrezka_cors_proxy',
            type: 'input',
            placeholder: 'https://cors.nb557.workers.dev',
            values: '',
            default: ''
        },
        field: {
            name: 'CORS Прокси (ОБЯЗАТЕЛЬНО для браузера!)',
            description: 'Прокси для обхода CORS и блокировки. Примеры: cors.nb557.workers.dev, cors557.deno.dev'
        }
    });

    Lampa.SettingsApi.addParam({
        component: 'hdrezka_fi_config',
        param: {
            name: 'hdrezka_login',
            type: 'input',
            placeholder: 'email',
            values: '',
            default: ''
        },
        field: {
            name: 'Логин HDrezka',
            description: 'Опционально'
        }
    });

    Lampa.SettingsApi.addParam({
        component: 'hdrezka_fi_config',
        param: {
            name: 'hdrezka_password',
            type: 'input',
            placeholder: 'пароль',
            values: '',
            default: ''
        },
        field: {
            name: 'Пароль HDrezka',
            description: 'Опционально'
        }
    });

})();
