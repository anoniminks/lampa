let subscriptionSettings = {};
let serversList = [];

async function loadData() {
    try {
        // Загружаем subscription.txt
        const settingsResp = await fetch('subscription.txt?_=' + Date.now());
        const settingsText = await settingsResp.text();
        
        // Парсим настройки
        const settingsContainer = document.getElementById('settings');
        settingsContainer.innerHTML = '';
        
        settingsText.split('\n').forEach(line => {
            line = line.trim();
            if (line.startsWith('#')) {
                const match = line.match(/^#([^:]+):\s*(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    const value = match[2].trim();
                    subscriptionSettings[key] = value;
                    
                    const div = document.createElement('div');
                    div.className = 'setting';
                    div.innerHTML = `
                        <span class="key">${key}</span>
                        <span class="value">${value}</span>
                    `;
                    settingsContainer.appendChild(div);
                }
            }
        });
        
        // Загружаем servers.json
        const serversResp = await fetch('servers.json?_=' + Date.now());
        serversList = await serversResp.json();
        
        const serversContainer = document.getElementById('servers');
        serversContainer.innerHTML = '';
        
        serversList.forEach(server => {
            const div = document.createElement('div');
            div.className = 'server';
            div.innerHTML = `
                <span class="name">${server.name}</span>
                <span class="host">${server.host}:${server.port}</span>
                <span class="status ${server.status}">${server.status}</span>
                <span class="ping">${server.ping}ms</span>
                <span class="load">${server.load}%</span>
            `;
            serversContainer.appendChild(div);
        });
        
        // Убираем загрузку
        document.querySelectorAll('.loading').forEach(el => el.remove());
        
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('settings').innerHTML = '<div class="error">❌ Ошибка загрузки</div>';
    }
}

function copyAll() {
    // Собираем URL подписки
    let url = subscriptionSettings['subscription-url'] || 'https://ваша-панель.домен/subscription/token';
    
    // Добавляем параметры
    const params = new URLSearchParams();
    Object.entries(subscriptionSettings).forEach(([key, value]) => {
        if (key !== 'subscription-url') {
            params.append(key, value);
        }
    });
    
    const fullUrl = url + (url.includes('?') ? '&' : '?') + params.toString();
    
    navigator.clipboard.writeText(fullUrl)
        .then(() => alert('✅ Ссылка скопирована!'))
        .catch(() => {
            const input = document.createElement('textarea');
            input.value = fullUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            alert('✅ Ссылка скопирована!');
        });
}

document.addEventListener('DOMContentLoaded', loadData);
