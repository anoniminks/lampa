(function () {
    'use strict';

    if (window.hdrezka_plugin_loaded) return;
    window.hdrezka_plugin_loaded = true;

    // ============================================================
    // КОНФИГУРАЦИЯ (ВАШ ПРОКСИ И ЗЕРКАЛО)
    // ============================================================
    const MIRROR_URL = 'https://hdrezka.ag';
    const PROXY_URL = 'http://khk6zwo4:h7n4qa3o9aah@2.26.96.23:26829';

    // ============================================================
    // СЕТЕВОЙ МОДУЛЬ (ОБРАБОТКА PROXY)
    // ============================================================
    function parseProxyUrl(proxyStr) {
        if (!proxyStr) return { hostUrl: '', headers: {} };
        try {
            const urlObj = new URL(proxyStr);
            const headers = {};
            if (urlObj.username || urlObj.password) {
                const auth = btoa(`${decodeURIComponent(urlObj.username)}:${decodeURIComponent(urlObj.password)}`);
                headers['Proxy-Authorization'] = `Basic ${auth}`;
                headers['Authorization'] = `Basic ${auth}`;
            }
            const cleanHost = `${urlObj.protocol}//${urlObj.host}`;
            return { hostUrl: cleanHost, headers };
        } catch (e) {
            return { hostUrl: proxyStr, headers: {} };
        }
    }

    function request(path, options = {}) {
        return new Promise((resolve, reject) => {
            const fullTargetUrl = path.startsWith('http') ? path : `${MIRROR_URL}${path.startsWith('/') ? '' : '/'}${path}`;

            let fetchUrl = fullTargetUrl;
            let customHeaders = {
                'X-Requested-With': 'XMLHttpRequest',
                ...(options.headers || {})
            };

            if (PROXY_URL) {
                const { hostUrl, headers: proxyHeaders } = parseProxyUrl(PROXY_URL);
                fetchUrl = `${hostUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(fullTargetUrl)}`;
                Object.assign(customHeaders, proxyHeaders);
            }

            fetch(fetchUrl, {
                method: options.method || 'GET',
                headers: customHeaders,
                body: options.body
            })
            .then(res => {
                if (!res.ok) throw new Error('HTTP status ' + res.status);
                return options.json ? res.json() : res.text();
            })
            .then(resolve)
            .catch(err => {
                console.error('[HDRezka] Ошибка запроса:', err);
                reject(err);
            });
        });
    }

    // ============================================================
    // ПАРСИНГ И ДЕКОДИРОВАНИЕ ССЫЛОК HDREZKA
    // ============================================================
    function decodeStreams(str) {
        if (!str) return {};
        try {
            let clean = str.replace('#h', '');
            if (clean.startsWith('//_//')) clean = clean.substring(5);
            
            const bk = (s) => {
                try {
                    return decodeURIComponent(atob(s).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                } catch (e) {
                    return atob(s);
                }
            };

            const streams = {};
            const items = clean.split(',');
            
            items.forEach(item => {
                const match = item.match(/\[([0-9]+p)\](.*)/);
                if (match) {
                    const quality = match[1];
                    let streamUrl = match[2];
                    if (!streamUrl.startsWith('http')) streamUrl = bk(streamUrl);
                    const urls = streamUrl.split(' or ');
                    streams[quality] = urls[0];
                }
            });
            return streams;
        } catch (err) {
            return {};
        }
    }

    function search(query) {
        const searchUrl = `/search/?do=search&subaction=search&q=${encodeURIComponent(query)}`;
        return request(searchUrl).then(html => {
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const items = doc.querySelectorAll('.b-content__inline_item');

            items.forEach(item => {
                const link = item.querySelector('.b-content__inline_item-link a');
                if (!link) return;

                const title = link.textContent.trim();
                const href = link.getAttribute('href');
                const img = item.querySelector('.b-content__inline_item-cover img');
                const poster = img ? img.getAttribute('src') : '';
                const info = item.querySelector('.b-content__inline_item-link div');
                const subtext = info ? info.textContent.trim() : '';

                const idMatch = href.match(/\/(\d+)-/);
                if (idMatch) {
                    results.push({
                        id: idMatch[1],
                        title: title + (subtext ? ` (${subtext})` : ''),
                        poster: poster,
                        url: href
                    });
                }
            });

            return results;
        });
    }

    function getMediaData(itemUrl) {
        return request(itemUrl).then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const idInput = doc.querySelector('#post_id');
            const id = idInput ? idInput.value : null;

            if (!id) throw new Error('ID не найден');

            const translators = [];
            const translatorEls = doc.querySelectorAll('.b-translators__list .b-translator__item');
            
            translatorEls.forEach(el => {
                translators.push({
                    id: el.getAttribute('data-translator_id'),
                    name: el.textContent.trim()
                });
            });

            return {
                id: id,
                translators: translators.length ? translators : [{ id: '0', name: 'По умолчанию' }]
            };
        });
    }

    function getStream(id, translatorId) {
        const formData = new FormData();
        formData.append('id', id);
        formData.append('translator_id', translatorId);
        formData.append('action', 'get_movie');

        return request('/ajax/get_cdn_series/?t=' + Date.now(), {
            method: 'POST',
            body: formData,
            json: true
        }).then(res => {
            if (!res.success) throw new Error(res.message || 'Ошибка получения потока');
            const streams = decodeStreams(res.url);
            const qualities = Object.keys(streams);
            if (qualities.length === 0) throw new Error('Видео не найдено');
            return { url: streams[qualities[qualities.length - 1]] };
        });
    }

    // ============================================================
    // ИНТЕГРАЦИЯ В МЕНЮ «ИСТОЧНИКИ» (ONLINE)
    // ============================================================
    function startSearchHDRezka(object) {
        const title = object.movie.title || object.movie.name;
        Lampa.Noty.show('Поиск на HDRezka...');

        search(title)
            .then(results => {
                if (!results || results.length === 0) {
                    Lampa.Noty.show('Ничего не найдено на HDRezka');
                    return;
                }

                const items = results.map(item => ({
                    title: item.title,
                    image: item.poster,
                    onClick: function() {
                        Lampa.Noty.show('Загрузка озвучек...');
                        getMediaData(item.url)
                            .then(mediaData => {
                                const trItems = mediaData.translators.map(tr => ({
                                    title: tr.name,
                                    onClick: function() {
                                        Lampa.Noty.show('Загрузка видео...');
                                        getStream(mediaData.id, tr.id)
                                            .then(streamData => {
                                                Lampa.Player.play({
                                                    url: streamData.url,
                                                    title: item.title,
                                                    poster: item.poster
                                                });
                                                Lampa.Player.playlist([{
                                                    url: streamData.url,
                                                    title: item.title,
                                                    poster: item.poster
                                                }]);
                                            })
                                            .catch(err => Lampa.Noty.show('Ошибка: ' + (err.message || err)));
                                    }
                                }));

                                if (trItems.length === 1) {
                                    trItems[0].onClick();
                                } else {
                                    Lampa.Select.show({
                                        title: 'Выберите озвучку',
                                        items: trItems,
                                        onBack: () => Lampa.Controller.toggle('content')
                                    });
                                }
                            })
                            .catch(err => Lampa.Noty.show('Ошибка: ' + (err.message || err)));
                    }
                }));

                Lampa.Select.show({
                    title: 'HDRezka: ' + title,
                    items: items,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            })
            .catch(err => Lampa.Noty.show('Ошибка поиска: ' + (err.message || err)));
    }

    // Регистрация кнопки в меню Источники
    function initHDRezkaSource() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                const render = e.object.activity.render();
                
                // Внедряем слушатель нажатия на «Смотреть / Источники»
                e.object.activity.render().find('.button--play, .full-start__button').on('click hover:enter', function () {
                    // Ждем открытия бокового меню и добавляем пункт HDRezka PROXY
                    setTimeout(() => {
                        if ($('.activity--select').length && !$('.hdrezka-source-item').length) {
                            const hdrezkaItem = $(
                                '<div class="select__item selector hdrezka-source-item">' +
                                    '<div class="select__title">HDRezka (Proxy)</div>' +
                                    '<div class="select__descr">Смотреть через ваш Xray Прокси</div>' +
                                '</div>'
                            );

                            hdrezkaItem.on('hover:enter click', function () {
                                startSearchHDRezka(e.object);
                            });

                            $('.select__body .scroll__content').prepend(hdrezkaItem);
                        }
                    }, 100);
                });
            }
        });
    }

    if (window.appready) {
        initHDRezkaSource();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') initHDRezkaSource();
        });
    }
})();
