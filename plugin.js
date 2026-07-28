(function () {
    'use strict';

    // ==========================================
    // 1. НАСТРОЙКИ ПРОКСИ И БАЛАНСЕРОВ
    // ==========================================
    const CONFIG = {
        proxy: {
            useProxy: true,
            // Добавь свой URL прокси при необходимости
            proxyUrl: function (url) {
                if (!this.useProxy) return url;
                return 'https://cors.lampa.stream/' + url; // Пример стандартного CORS-прокси
            }
        },
        sources: {
            hdrezka: {
                enabled: true,
                domain: 'https://hdrezka.ag',
                title: 'HDRezka'
            },
            filmix: {
                enabled: true,
                domain: 'https://filmix.biz',
                title: 'Filmix'
            }
        }
    };

    // ==========================================
    // 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (NETWORK / PROXY)
    // ==========================================
    const Network = {
        request: function (url, options = {}) {
            return new Promise((resolve, reject) => {
                const targetUrl = CONFIG.proxy.proxyUrl(url);
                
                $.ajax({
                    url: targetUrl,
                    method: options.method || 'GET',
                    data: options.data || {},
                    headers: options.headers || {},
                    dataType: options.dataType || 'json',
                    success: (response) => resolve(response),
                    error: (jqXHR, textStatus, errorThrown) => reject(errorThrown || textStatus)
                });
            });
        }
    };

    // ==========================================
    // 3. МОДУЛЬ HDREZKA
    // ==========================================
    const HDRezka = {
        search: async function (object) {
            if (!CONFIG.sources.hdrezka.enabled) return [];
            
            const title = object.movie.title || object.movie.name;
            const query = encodeURIComponent(title);
            const searchUrl = `${CONFIG.sources.hdrezka.domain}/engine/ajax/search.php`;

            try {
                const response = await Network.request(searchUrl, {
                    method: 'POST',
                    data: { q: query },
                    dataType: 'html'
                });

                // Здесь происходит парсинг HTML-ответа от HDRezka
                return this.parseSearch(response);
            } catch (error) {
                console.error('[HDRezka] Ошибка поиска:', error);
                return [];
            }
        },

        parseSearch: function (html) {
            // Парсинг элементов выпадающего списка или результатов поиска
            const results = [];
            const $html = $(html);

            $html.find('li').each(function () {
                const $item = $(this);
                const url = $item.find('a').attr('href');
                const title = $item.find('.title').text() || $item.text();

                if (url) {
                    results.push({
                        title: title.trim(),
                        url: url,
                        source: 'hdrezka'
                    });
                }
            });

            return results;
        }
    };

    // ==========================================
    // 4. МОДУЛЬ FILM
    // ==========================================
    const Filmix = {
        search: async function (object) {
            if (!CONFIG.sources.filmix.enabled) return [];

            const title = object.movie.title || object.movie.name;
            const query = encodeURIComponent(title);
            const searchUrl = `${CONFIG.sources.filmix.domain}/api/v2/search?story=${query}`;

            try {
                const response = await Network.request(searchUrl, {
                    method: 'GET',
                    dataType: 'json'
                });

                return this.parseSearch(response);
            } catch (error) {
                console.error('[Filmix] Ошибка поиска:', error);
                return [];
            }
        },

        parseSearch: function (data) {
            const results = [];
            
            if (data && Array.isArray(data)) {
                data.forEach(item => {
                    results.push({
                        title: item.title || item.name,
                        url: item.link || `${CONFIG.sources.filmix.domain}/post/${item.id}`,
                        source: 'filmix'
                    });
                });
            }

            return results;
        }
    };

    // ==========================================
    // 5. ИНИЦИАЛИЗАЦИЯ И ИНТЕГРАЦИЯ С LAMPA
    // ==========================================
    function Plugin() {
        this.start = function (object) {
            // Запуск параллельного поиска по HDRezka и Filmix
            Promise.allSettled([
                HDRezka.search(object),
                Filmix.search(object)
            ]).then(results => {
                const hdrezkaResults = results[0].status === 'fulfilled' ? results[0].value : [];
                const filmixResults = results[1].status === 'fulfilled' ? results[1].value : [];

                const combinedResults = [...hdrezkaResults, ...filmixResults];
                
                console.log('[Plugin] Найденные результаты:', combinedResults);
                
                // Передача результатов в UI Lampa (вызов отрисовки)
                if (object.success) {
                    object.success(combinedResults);
                }
            });
        };
    }

    // Регистрация плагина в системе Lampa
    if (window.appready) {
        Lampa.Component.add('custom_sources', Plugin);
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                Lampa.Component.add('custom_sources', Plugin);
            }
        });
    }

})();
