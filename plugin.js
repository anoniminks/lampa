(function () {
    'use strict';

    /**
     * HDrezka.fi Plugin for Lampa
     * 
     * Базовый плагин для просмотра фильмов и сериалов с hdrezka.fi
     * 
     * ВНИМАНИЕ: Для полноценной работы требуется:
     * 1. Прокси/CORS-обход для запросов к hdrezka.fi
     * 2. Авторизация (cookie)
     * 3. Декодирование зашифрованных ссылок на видео (алгоритм меняется)
     * 
     * Рекомендуется использовать готовый Online Mod: https://nb557.github.io/plugins/online_mod.js
     */

    var PROXY_URL = '';

    function getProxyUrl(url) {
        var proxy = Lampa.Storage.get('hdrezka_proxy', '');
        if (proxy) {
            if (proxy.indexOf('http') === -1) proxy = 'http://' + proxy;
            url = proxy + (proxy.endsWith('/') ? '' : '/') + url;
        }
        return url;
    }

    function getMirror() {
        var mirror = Lampa.Storage.get('hdrezka_mirror', 'https://hdrezka.fi');
        if (mirror.indexOf('http') === -1) mirror = 'https://' + mirror;
        if (mirror.endsWith('/')) mirror = mirror.slice(0, -1);
        return mirror;
    }

    /**
     * Декодирование зашифрованных ссылок HDrezka
     * Алгоритм может меняться, это базовая реализация
     */
    function decodeRezkaUrl(encrypted) {
        if (!encrypted) return '';

        try {
            // Пробуем base64 декодирование
            if (encrypted.indexOf('//') === -1 && encrypted.length > 20) {
                var decoded = atob(encrypted);
                if (decoded.indexOf('http') === 0) return decoded;
            }

            // Альтернативный метод: XOR декодирование (актуальный алгоритм может отличаться)
            // Это заглушка - реальный алгоритм нужно извлекать из JS сайта
            return encrypted;
        } catch (e) {
            return encrypted;
        }
    }

    /**
     * Парсинг HTML-ответа поиска
     */
    function parseSearchResults(html) {
        var results = [];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var items = doc.querySelectorAll('.b-content__inline_item');

        items.forEach(function(item) {
            var linkEl = item.querySelector('.b-content__inline_item-link a');
            var imgEl = item.querySelector('img');
            var qualityEl = item.querySelector('.b-content__inline_item-quality');

            if (linkEl) {
                results.push({
                    title: linkEl.textContent.trim(),
                    url: linkEl.getAttribute('href'),
                    poster: imgEl ? imgEl.getAttribute('src') : '',
                    quality: qualityEl ? qualityEl.textContent.trim() : ''
                });
            }
        });

        return results;
    }

    /**
     * Парсинг страницы фильма/сериала
     */
    function parseFilmPage(html) {
        var result = {
            id: '',
            translators: [],
            type: 'movie', // 'movie' или 'tv_series'
            title: '',
            poster: ''
        };

        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // ID фильма
        var idMatch = html.match(/data-id="(\d+)"/);
        if (idMatch) result.id = idMatch[1];

        // Название
        var titleEl = doc.querySelector('h1[itemprop="name"]');
        if (titleEl) result.title = titleEl.textContent.trim();

        // Постер
        var posterEl = doc.querySelector('.b-sidecover a');
        if (posterEl) result.poster = posterEl.getAttribute('href');

        // Тип: сериал или фильм
        if (html.indexOf('b-simple_seasons__list') !== -1 || html.indexOf('b-simple_episodes__list') !== -1) {
            result.type = 'tv_series';
        }

        // Переводы
        var transBlocks = doc.querySelectorAll('.b-translator__item');
        transBlocks.forEach(function(trans) {
            var tid = trans.getAttribute('data-translator_id');
            var tname = trans.getAttribute('title') || trans.textContent.trim();
            if (tid) {
                result.translators.push({
                    id: tid,
                    name: tname
                });
            }
        });

        // Если переводы не найдены через data-translator_id, пробуем альтернативный метод
        if (result.translators.length === 0) {
            var transMatch = html.match(/data-translator_id="(\d+)"/g);
            if (transMatch) {
                var uniqueIds = [];
                transMatch.forEach(function(m) {
                    var id = m.match(/(\d+)/)[1];
                    if (uniqueIds.indexOf(id) === -1) {
                        uniqueIds.push(id);
                        result.translators.push({
                            id: id,
                            name: 'Перевод ' + id
                        });
                    }
                });
            }
        }

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
        var choice = {
            season: 0,
            voice: 0,
            voice_name: ''
        };
        var mirror = getMirror();
        var filmData = null;

        /**
         * Поиск фильма/сериала
         */
        this.search = function (_object) {
            object = _object;
            var query = object.search || object.movie.title || '';
            var originalQuery = object.movie.original_title || '';

            component.loading(true);

            // Пробуем найти по оригинальному названию, если есть
            var searchQuery = originalQuery || query;
            var searchUrl = mirror + '/search/?do=search&subaction=search&q=' + encodeURIComponent(searchQuery);

            network.clear();
            network.timeout(15000);
            network.silent(getProxyUrl(searchUrl), function(html) {
                var searchResults = parseSearchResults(html);

                if (searchResults.length === 0 && query !== originalQuery && originalQuery) {
                    // Пробуем по русскому названию
                    searchUrl = mirror + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query);
                    network.clear();
                    network.timeout(15000);
                    network.silent(getProxyUrl(searchUrl), function(html2) {
                        searchResults = parseSearchResults(html2);
                        processSearchResults(searchResults);
                    }, function() {
                        component.emptyForQuery(query);
                    });
                } else {
                    processSearchResults(searchResults);
                }
            }, function() {
                component.emptyForQuery(query);
            });
        };

        /**
         * Обработка результатов поиска - берём первый подходящий результат
         */
        function processSearchResults(searchResults) {
            if (!searchResults || searchResults.length === 0) {
                component.emptyForQuery(object.search || object.movie.title);
                return;
            }

            // Берём первый результат (можно добавить fuzzy matching)
            var bestMatch = searchResults[0];

            // Загружаем страницу фильма
            var filmUrl = bestMatch.url;
            if (filmUrl.indexOf('http') !== 0) filmUrl = mirror + filmUrl;

            network.clear();
            network.timeout(15000);
            network.silent(getProxyUrl(filmUrl), function(html) {
                filmData = parseFilmPage(html);

                if (!filmData.id) {
                    component.emptyForQuery(object.search || object.movie.title);
                    return;
                }

                loadStreams(filmData);
            }, function() {
                component.emptyForQuery(object.search || object.movie.title);
            });
        }

        /**
         * Загрузка потоков видео
         */
        function loadStreams(data) {
            if (!data.translators || data.translators.length === 0) {
                // Если нет переводов, пробуем с translator_id=0
                data.translators = [{id: '0', name: 'Оригинал'}];
            }

            extract = {
                translators: data.translators,
                streams: {},
                type: data.type
            };

            // Для фильмов загружаем сразу
            if (data.type === 'movie') {
                loadMovieStream(data.translators[0].id, function(streams) {
                    extract.streams[data.translators[0].id] = streams;
                    buildResults();
                });
            } else {
                // Для сериалов строим структуру сезонов/серий
                // Это упрощённая версия - реально нужно парсить сезоны и эпизоды
                buildResults();
            }
        }

        /**
         * AJAX запрос для получения ссылки на видео
         */
        function loadMovieStream(translatorId, callback) {
            var timestamp = new Date().getTime();
            var ajaxUrl = mirror + '/ajax/get_cdn_series/?t=' + timestamp;

            var postData = {
                id: filmData.id,
                translator_id: translatorId,
                action: 'get_movie'
            };

            network.clear();
            network.timeout(15000);
            network.native(getProxyUrl(ajaxUrl), function(json) {
                if (json && json.url) {
                    var decoded = decodeRezkaUrl(json.url);
                    callback({
                        url: decoded,
                        quality: json.quality || '720p'
                    });
                } else {
                    callback(null);
                }
            }, function() {
                callback(null);
            }, false, {
                dataType: 'json',
                post: postData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': mirror + '/'
                }
            });
        }

        /**
         * Формирование результатов для отображения
         */
        function buildResults() {
            results = { 'player_links': { "movie": [] } };

            if (filmData.type === 'movie') {
                filmData.translators.forEach(function(trans, index) {
                    var stream = extract.streams[trans.id];
                    if (stream && stream.url) {
                        results['player_links']["movie"].push({
                            title: trans.name,
                            quality: stream.quality,
                            link: stream.url,
                            translation: trans.name
                        });
                    }
                });
            } else {
                // Для сериалов - упрощённая заглушка
                results['player_links']["movie"].push({
                    title: 'Сезон 1 Серия 1',
                    quality: '720p',
                    link: '',
                    translation: filmData.translators[0] ? filmData.translators[0].name : 'Оригинал'
                });
            }

            if (results['player_links']["movie"].length === 0) {
                component.emptyForQuery(object.search || object.movie.title);
                return;
            }

            extractData(results);
            append(filtred());
            component.loading(false);
        }

        /**
         * Сброс фильтра
         */
        this.reset = function () {
            component.reset();
            choice = {
                season: 0,
                voice: 0,
                voice_name: ''
            };
            extractData(results);
            component.saveChoice(choice);
        };

        /**
         * Применить фильтр
         */
        this.filter = function (type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice') choice.voice_name = filter_items.voice[b.index];
            component.reset();
            extractData(results);
            component.saveChoice(choice);
        };

        /**
         * Уничтожить
         */
        this.destroy = function () {
            network.clear();
            results = null;
        };

        /**
         * Получить информацию о фильме
         */
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

        /**
         * Найти поток
         */
        function getFile(element) {
            var file = '';
            var translat = extract[element.translation];
            if (translat) {
                file = {
                    file: translat.file,
                    quality: {
                        "480p": translat.file
                    }
                };
            }
            return file;
        }

        /**
         * Отфильтровать файлы
         */
        function filtred() {
            var filtred = [];
            results.player_links.movie.forEach((movie, index) => {
                const id = (index + 1).toString();
                filtred.push({
                    title: movie.translation,
                    translation: id,
                    quality: movie.quality
                });
            });
            return filtred;
        }

        /**
         * Добавить видео в интерфейс
         */
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

        if (last_bls[object.movie.id]) {
            balanser = last_bls[object.movie.id];
        }

        var sources = {
            hdrezka: new hdrezka(this, object),
        };

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
            var _this = this;
            this.activity.loader(true);

            filter.onSearch = function (value) {
                Lampa.Activity.replace({
                    search: value,
                    clarification: true
                });
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
            add: function add(data) {
                lang_data = data;
            },
            translate: function translate(key) {
                return lang_data[key] ? lang_data[key].ru : key;
            }
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

    // Шаблоны
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

    var button = `<div class="full-start__button selector view--online" data-subtitle="v0.1.0">
        <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 30.051 30.051" style="enable-background:new 0 0 512 512">
            <g>
                <path d="M19.982,14.438l-6.24-4.536c-0.229-0.166-0.533-0.191-0.784-0.062c-0.253,0.128-0.411,0.388-0.411,0.669v9.069 c0,0.284,0.158,0.543,0.411,0.671c0.107,0.054,0.224,0.081,0.342,0.081c0.154,0,0.31-0.049,0.442-0.146l6.24-4.532 c0.197-0.145,0.312-0.369,0.312-0.607C20.295,14.803,20.177,14.58,19.982,14.438z" fill="currentColor"/>
                <path d="M15.026,0.002C6.726,0.002,0,6.728,0,15.028c0,8.297,6.726,15.021,15.026,15.021c8.298,0,15.025-6.725,15.025-15.021 C30.052,6.728,23.324,0.002,15.026,0.002z M15.026,27.542c-6.912,0-12.516-5.601-12.516-12.514c0-6.91,5.604-12.518,12.516-12.518 c6.911,0,12.514,5.607,12.514,12.518C27.541,21.941,21.937,27.542,15.026,27.542z" fill="currentColor"/>
            </g>
        </svg>
        <span>#{hdrezka_fi_title}</span>
    </div>`;

    // Регистрация компонента
    Lampa.Component.add('hdrezka_fi', component);
    resetTemplates();

    // Добавление кнопки на страницу фильма
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

    // Настройки плагина
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
            description: 'Адрес зеркала, например https://hdrezka.fi или https://rezka.ag'
        }
    });

    Lampa.SettingsApi.addParam({
        component: 'hdrezka_fi_config',
        param: {
            name: 'hdrezka_proxy',
            type: 'input',
            placeholder: '',
            values: '',
            default: ''
        },
        field: {
            name: 'CORS Прокси',
            description: 'Адрес прокси для обхода CORS, например https://cors.nb557.workers.dev/'
        }
    });

})();
