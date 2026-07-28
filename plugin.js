(function () {
    'use strict';

    if (window.hdrezka_plugin_loaded) return;
    window.hdrezka_plugin_loaded = true;

    // ============================================================
    // 1. ХРАНИЛИЩЕ И НАСТРОЙКИ (С ВАШИМИ ДАННЫМИ ПО УМОЛЧАНИЮ)
    // ============================================================
    const DEFAULT_MIRROR = 'https://hdrezka.ag';
    const DEFAULT_PROXY = 'http://khk6zwo4:h7n4qa3o9aah@2.26.96.23:26829';

    function getMirror() {
        try {
            return localStorage.getItem('hdrezka_mirror') || DEFAULT_MIRROR;
        } catch {
            return DEFAULT_MIRROR;
        }
    }

    function setMirror(value) {
        try {
            let url = (value || DEFAULT_MIRROR).trim().replace(/\/+$/, '');
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            localStorage.setItem('hdrezka_mirror', url);
        } catch {}
    }

    function getProxy() {
        try {
            return localStorage.getItem('hdrezka_proxy') || DEFAULT_PROXY;
        } catch {
            return DEFAULT_PROXY;
        }
    }

    function setProxy(value) {
        try {
            localStorage.setItem('hdrezka_proxy', (value || '').trim());
        } catch {}
    }

    function getEnabled() {
        try {
            return localStorage.getItem('hdrezka_enabled') !== 'false';
        } catch {
            return true;
        }
    }

    function setEnabled(value) {
        try {
            localStorage.setItem('hdrezka_enabled', value ? 'true' : 'false');
        } catch {}
    }

    // ============================================================
    // 2. СЕТЕВОЙ МОДУЛЬ И АВТОРИЗАЦИЯ ПРОКСИ
    // ============================================================
    function parseProxyUrl(proxyStr) {
        if (!proxyStr) return { hostUrl: '', headers: {} };
        
        try {
            const urlObj = new URL(proxyStr);
            const headers = {};
            
            // Если в URL прокси указаны логин и пароль (khk6zwo4:h7n4qa3o9aah)
            if (urlObj.username || urlObj.password) {
                const auth = btoa(`${decodeURIComponent(urlObj.username)}:${decodeURIComponent(urlObj.password)}`);
                headers['Proxy-Authorization'] = `Basic ${auth}`;
                headers['Authorization'] = `Basic ${auth}`;
            }

            // Очищаем URL от логина/пароля для передачи в fetch
            const cleanHost = `${urlObj.protocol}//${urlObj.host}`;
            return { hostUrl: cleanHost, headers };
        } catch (e) {
            return { hostUrl: proxyStr, headers: {} };
        }
    }

    function request(path, options = {}) {
        return new Promise((resolve, reject) => {
            const mirror = getMirror();
            const fullTargetUrl = path.startsWith('http') ? path : `${mirror}${path.startsWith('/') ? '' : '/'}${path}`;
            const proxySetting = getProxy();

            let fetchUrl = fullTargetUrl;
            let customHeaders = {
                'X-Requested-With': 'XMLHttpRequest',
                ...(options.headers || {})
            };

            if (proxySetting) {
                const { hostUrl, headers: proxyHeaders } = parseProxyUrl(proxySetting);
                // Формируем шлюз-запрос к прокси
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
                console.error('[HDRezka] Запрос завершился ошибкой:', err);
                reject(err);
            });
        });
    }

    // ============================================================
    // 3. ДЕКОДИРОВАНИЕ ССЫЛОК И ПАРСИНГ
    // ============================================================
    function decodeStreams(str) {
        if (!str) return {};
        try {
            let clean = str.replace('#h', '');
            if (clean.startsWith('//_//')) {
                clean = clean.substring(5);
            }
            
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
                    
                    if (!streamUrl.startsWith('http')) {
                        streamUrl = bk(streamUrl);
                    }
                    
                    const urls = streamUrl.split(' or ');
                    streams[quality] = urls[0];
                }
            });
            
            return streams;
        } catch (err) {
            console.error('[HDRezka] Ошибка декодирования:', err);
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

            if (!id) throw new Error('Не удалось найти ID фильма');

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
            if (!res.success) throw new Error(res.message || 'Не удалось получить поток');
            
            const streams = decodeStreams(res.url);
            const qualities = Object.keys(streams);
            if (qualities.length === 0) throw new Error('Видео не найдено');

            const bestQuality = qualities[qualities.length - 1];
            return {
                url: streams[bestQuality],
                qualities: streams
            };
        });
    }

    // ============================================================
    // 4. ВОСПРОИЗВЕДЕНИЕ И ИНТЕРФЕЙС
    // ============================================================
    function playMedia(streamData, title, poster) {
        Lampa.Player.play({
            url: streamData.url,
            title: title,
            poster: poster
        });
        
        Lampa.Player.playlist([
            {
                url: streamData.url,
                title: title,
                poster: poster
            }
        ]);
    }

    function handleSelectTranslator(item, mediaData) {
        const translatorItems = mediaData.translators.map(tr => ({
            title: tr.name,
            onClick: function() {
                Lampa.Noty.show('Загрузка видео...');
                getStream(mediaData.id, tr.id)
                    .then(streamData => {
                        playMedia(streamData, item.title, item.poster);
                    })
                    .catch(err => {
                        Lampa.Noty.show('Ошибка: ' + (err.message || err));
                    });
            }
        }));

        if (translatorItems.length === 1) {
            translatorItems[0].onClick();
        } else {
            Lampa.Select.show({
                title: 'Выберите озвучку',
                items: translatorItems,
                onBack: () => Lampa.Controller.toggle('content')
            });
        }
    }

    function showResults(results, movieTitle) {
        if (!results || results.length === 0) {
            Lampa.Noty.show('Ничего не найдено на HDRezka');
            return;
        }

        const items = results.map(item => ({
            title: item.title,
            image: item.poster,
            onClick: function() {
                Lampa.Noty.show('Получение вариантов озвучки...');
                getMediaData(item.url)
                    .then(mediaData => {
                        handleSelectTranslator(item, mediaData);
                    })
                    .catch(err => {
                        Lampa.Noty.show('Ошибка: ' + (err.message || err));
                    });
            }
        }));

        Lampa.Select.show({
            title: 'HDRezka: ' + movieTitle,
            items: items,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    // ============================================================
    // 5. ВСТРАИВАНИЕ КНОПКИ В КАРТОЧКУ
    // ============================================================
    function addButton() {
        if (!$('.full-start').length || $('.hdrezka-button').length) return;

        const titleEl = $('.full-start__title');
        if (!titleEl.length) return;

        const movieTitle = titleEl.text().trim();
        const container = $('.full-start__buttons');
        if (!container.length) return;

        const button = $(
            '<div class="full-start__button hdrezka-button selector">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<rect x="2" y="2" width="20" height="20" rx="2.18"/>' +
                    '<path d="M7 12h10M12 7v10"/>' +
                '</svg>' +
                '<span>HDRezka</span>' +
            '</div>'
        );

        button.on('hover:enter', function() {
            if (!getEnabled()) {
                Lampa.Noty.show('Плагин отключён');
                return;
            }

            Lampa.Noty.show('Поиск на HDRezka...');
            search(movieTitle)
                .then(results => showResults(results, movieTitle))
                .catch(err => Lampa.Noty.show('Ошибка поиска: ' + (err.message || err)));
        });

        container.append(button);
    }

    // ============================================================
    // 6. РЕГИСТРАЦИЯ НАСТРОЕК В МЕНЮ LAMPA
    // ============================================================
    function addSettings() {
        if (window.hdrezka_settings_done) return;
        window.hdrezka_settings_done = true;

        try {
            Lampa.SettingsApi.addComponent({
                component: 'hdrezka',
                name: 'HDRezka',
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/></svg>'
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
                    description: 'Показывать кнопку на карточке фильма'
                },
                onChange: value => setEnabled(value === 'true' || value === true)
            });

            Lampa.SettingsApi.addParam({
                component: 'hdrezka',
                param: {
                    name: 'hdrezka_mirror',
                    type: 'input',
                    default: DEFAULT_MIRROR
                },
                field: {
                    name: 'Зеркало HDRezka',
                    description: 'Основной адрес сайта'
                },
                onChange: value => setMirror(value)
            });

            Lampa.SettingsApi.addParam({
                component: 'hdrezka',
                param: {
                    name: 'hdrezka_proxy',
                    type: 'input',
                    default: DEFAULT_PROXY
                },
                field: {
                    name: 'HTTP Прокси с авторизацией',
                    description: 'Адрес прокси (например http://user:pass@ip:port)'
                },
                onChange: value => setProxy(value)
            });

        } catch (e) {
            console.warn('[HDRezka] Ошибка меню настроек:', e);
        }
    }

    // ============================================================
    // 7. ЗАПУСК
    // ============================================================
    function start() {
        addSettings();

        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite' || e.type === 'open') {
                setTimeout(addButton, 300);
            }
        });

        const observer = new MutationObserver(() => {
            if ($('.full-start').length) setTimeout(addButton, 200);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') start();
        });
    }
})();
