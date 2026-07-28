// Это загрузчик. Он не содержит логики, а только подгружает основной скрипт.
(function() {
  'use strict';
  // ... находит путь к текущему скрипту ...
  // ... и подгружает online.js с версией для обновления кеша ...
  Lampa.Utils.putScriptAsync([host + '/online.js?v=' + version], function() {});
})();
