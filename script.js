let config = null;

// Загружаем при открытии
loadConfig();

function loadConfig() {
    fetch('config.json?_=' + Date.now())
        .then(res => res.json())
        .then(data => {
            config = data;
            showInfo(data);
            showServers(data);
        })
        .catch(() => {
            document.getElementById('info').innerHTML = '<div class="card">❌ Ошибка загрузки config.json</div>';
            document.getElementById('servers').innerHTML = '<div class="card">❌ Ошибка загрузки</div>';
        });
}

function showInfo(data) {
    const container = document.getElementById('info');
    let html = `<div class="card"><b>📌 Название:</b> ${data.remarks || 'Без названия'}</div>`;
    
    if (data.dns && data.dns.servers) {
        html += `<div class="card"><b>🌐 DNS:</b> ${data.dns.servers.join(', ')}</div>`;
    }
    
    container.innerHTML = html;
}

function showServers(data) {
    const container = document.getElementById('servers');
    
    if (!data.outbounds) {
        container.innerHTML = '<div class="card">Нет серверов</div>';
        return;
    }
    
    // Фильтруем только VLESS/Vmess/Trojan сервера
    const servers = data.outbounds.filter(o => 
        o.protocol === 'vless' || o.protocol === 'vmess' || o.protocol === 'trojan'
    );
    
    if (servers.length === 0) {
        container.innerHTML = '<div class="card">Нет активных серверов</div>';
        return;
    }
    
    let html = '';
    servers.forEach((s, i) => {
        const address = s.settings?.vnext?.[0]?.address || '—';
        const port = s.settings?.vnext?.[0]?.port || '—';
        const network = s.streamSettings?.network || 'tcp';
        const security = s.streamSettings?.security || 'none';
        
        html += `
            <div class="server">
                <b>#${i+1} ${s.tag || 'Без имени'}</b><br>
                📡 ${address}:${port} &nbsp;
                <span class="protocol">${network}</span> &nbsp;
                <span class="protocol">${security}</span>
                ${s.streamSettings?.realitySettings ? ' 🔒 Reality' : ''}
                ${s.streamSettings?.tlsSettings ? ' 🔒 TLS' : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
        .then(() => alert('✅ Ссылка скопирована!'))
        .catch(() => {
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            alert('✅ Ссылка скопирована!');
        });
}
