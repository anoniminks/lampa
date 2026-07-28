(function () {
    'use strict';

    // Уникальный идентификатор твоего плагина
    const PLUGIN_NAME = 'hdrezka_amnezia';

    // === 1. ЗАЩИТА ОТ ПОВТОРНОЙ ЗАГРУЗКИ ===
    if (window[`plugin_${PLUGIN_NAME}_ready`]) return;
    window[`plugin_${PLUGIN_NAME}_ready`] = true;

    // === 2. УТИЛИТЫ ПЛАГИНА ===
    // Вместо localStorage используй Lampa.Storage для хранения настроек
    const pluginStorage = {
        set: (key, val) => Lampa.Storage.set(`${PLUGIN_NAME}_${key}`, val),
        get: (key, def = null) => Lampa.Storage.get(`${PLUGIN_NAME}_${key}`, def)
    };

    // === 3. ЛОГИКА ПЛАГИНА ===
    function startPlugin() {
        console.log(`[${PLUGIN_NAME}] Запущен`);

        // Инициализация настроек
        initSettings();

        // Добавление кнопки "Смотреть онлайн" на карточку фильма
        addOnlineButton();

        // Регистрация источника в плеере
        registerPlayerSource();

        // Регистрация провайдера для поиска
        registerSearchProvider();
    }

    // === 4. НАСТРОЙКИ ПЛАГИНА ===
    function initSettings() {
        // Добавляем параметры в меню настроек Lampa
        Lampa.SettingsApi.addParam({
            component: 'plugin_settings', // Или свой компонент
            param: {
                name: `${PLUGIN_NAME}_enabled`,
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Включить HDRezka через Amnezia',
                description: 'Искать фильмы в источнике HDRezka'
            },
            onChange: function(value) {
                // value — это "true" или "false"
                console.log(`[${PLUGIN_NAME}] Статус изменён на: ${value}`);
            }
        });

        // Поле для ввода конфига
        Lampa.SettingsApi.addParam({
            component: 'plugin_settings',
            param: {
                name: `${PLUGIN_NAME}_config`,
                type: 'input', // type: 'input' для текстового поля
                placeholder: 'Вставьте ваш AmneziaWG конфиг',
                default: ''
            },
            field: {
                name: 'AmneziaWG 1.5 Конфиг',
                description: 'Вставьте полный конфиг для подключения'
            }
        });
    }

    // === 5. ДОБАВЛЕНИЕ КНОПКИ ===
    function addOnlineButton() {
        Lampa.Listener.follow('full', function (event) {
            if (event.type !== 'complite') return;

            // Проверяем, включён ли плагин
            const isEnabled = Lampa.Storage.get(`${PLUGIN_NAME}_enabled`, 'true') === 'true';
            if (!isEnabled) return;

            const movieObject = event.object; // Объект карточки фильма
            const movieData = event.data;     // Данные фильма

            // HTML для кнопки (используй иконку, которая есть в Lampa)
            const buttonHtml = `
                <div class="full-start__button view--${PLUGIN_NAME}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24px" height="24px">
                        <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v-2h3V8l4 4-4 4v-3z" fill="currentColor"/>
                    </svg>
                    <span>${Lampa.Lang.translate('Смотреть онлайн') || 'Смотреть онлайн'}</span>
                </div>
            `;

            var button = $(buttonHtml);

            // Обработчик нажатия на кнопку
            button.on('hover:enter', function () {
                console.log(`[${PLUGIN_NAME}] Нажата кнопка для:`, movieData);

                // Запускаем активность поиска для этого фильма
                Lampa.Activity.push({
                    title: `Поиск на HDRezka`,
                    component: 'online', // или свой компонент
                    data: {
                        provider: PLUGIN_NAME,
                        movie: movieData
                    }
                });

                // Или сразу пытаемся найти и воспроизвести
                // findAndPlay(movieData);
            });

            // Добавляем кнопку в DOM карточки
            var container = event.object.activity.render().find('.full-start__buttons');
            if (container.length) {
                // Удаляем старую кнопку, если она есть
                container.find(`.view--${PLUGIN_NAME}`).remove();
                container.append(button);
            }
        });
    }

    // === 6. РЕГИСТРАЦИЯ ИСТОЧНИКА ДЛЯ ПЛЕЕРА ===
    function registerPlayerSource() {
        Lampa.Player.addSource(PLUGIN_NAME, {
            name: 'HDRezka (Amnezia)',
            getUrl: async function (item) {
                // item — это объект фильма с данными от твоего провайдера
                // Здесь ты должен получить реальный URL для воспроизведения
                console.log(`[${PLUGIN_NAME}] Получение URL для:`, item.title);

                // TODO: Реализовать получение ссылки через твой Amnezia-парсер
                // ...
                // const videoUrl = await getVideoUrlFromAmnezia(item);
                // return videoUrl || null;
                return null; // Пока возвращаем null
            },
            onError: function (item, error) {
                console.error(`[${PLUGIN_NAME}] Ошибка воспроизведения:`, error);
                Lampa.Notify.show('Ошибка получения ссылки для просмотра');
            }
        });
    }

    // === 7. РЕГИСТРАЦИЯ ПРОВАЙДЕРА (НЕОБЯЗАТЕЛЬНО) ===
    function registerSearchProvider() {
        // Если ты хочешь, чтобы результаты отображались как отдельный источник
        // в каталоге, можно зарегистрировать провайдера.
        // Это сложный путь, обычно достаточно кнопки на карточке.
        // Lampa.Parser.addProvider(...);
    }

    // === 8. СТАРТ ПЛАГИНА ===
    // Проверяем, готова ли Lampa
    if (window.appready) {
        startPlugin();
    } else {
        // Подписываемся на событие готовности приложения
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') {
                startPlugin();
            }
        });
    }

    console.log(`[${PLUGIN_NAME}] Загружен и ожидает инициализации.`);
})();
