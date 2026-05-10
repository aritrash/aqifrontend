// ==========================================
// AE Sensor Live Dashboard - Pure JS
// ==========================================

// -----------------------------------------
// DOM Elements
// -----------------------------------------
const elements = {
    aqiValue: document.getElementById('aqi-value'),
    aqiCategory: document.getElementById('aqi-category'),
    aqiIconContainer: document.querySelector('.aqi-icon'), // Fixed for Lucide regeneration
    aqiProgressBar: document.getElementById('aqi-progress-bar'),
    tempValue: document.getElementById('temp-value'),
    humidityValue: document.getElementById('humidity-value'),
    pm25Value: document.getElementById('pm25-value'),
    pm10Value: document.getElementById('pm10-value'),
    pm25ActualValue: document.getElementById('pm25-actual-value'),
    rawAvg: document.getElementById('raw-avg'),
    rawVar: document.getElementById('raw-var'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    lastUpdated: document.getElementById('last-updated'),
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    backendIpInput: document.getElementById('backend-ip'),
    saveSettingsBtn: document.getElementById('save-settings'),
    closeSettingsBtn: document.getElementById('close-settings'),
    pollutantBtns: document.querySelectorAll('.pollutant-btn')
};

// -----------------------------------------
// Application State
// -----------------------------------------
let config = {
    ip: localStorage.getItem('ae_sensor_ip') || '192.168.4.1',
    pollInterval: 1000, 
    timer: null,
    activePollutant: 'PM2.5',
    activeTimeframe: '1H', // Tracks the active graph view
    latestData: null,
    envUpdateTick: 0 // Throttles temp/humidity updates
};

// -----------------------------------------
// DUAL MEMORY BANKS (Tracks 1H and 6H continuously)
// -----------------------------------------
let historyState = {
    '1H': {
        secondsToBuffer: 60, // 1 min per point
        labels: Array(60).fill(''),
        'PM2.5': { data: Array(60).fill(null), buffer: [] },
        'PM10':  { data: Array(60).fill(null), buffer: [] },
        'PM25':  { data: Array(60).fill(null), buffer: [] }
    },
    '6H': {
        secondsToBuffer: 300, // 5 mins per point
        labels: Array(72).fill(''),
        'PM2.5': { data: Array(72).fill(null), buffer: [] },
        'PM10':  { data: Array(72).fill(null), buffer: [] },
        'PM25':  { data: Array(72).fill(null), buffer: [] }
    }
};

let aqiChartInstance = null;

// -----------------------------------------
// Initialization
// -----------------------------------------
elements.backendIpInput.value = config.ip;
setupSelectors();
initChart();
startPolling();

// -----------------------------------------
// AQI Calculation Engine
// -----------------------------------------
function calculateAQI(concentration, pollutant) {
    if (concentration === undefined || concentration === null) return { value: "--", category: "WAITING" };

    let breakpoints = [];
    
    if (pollutant === 'PM2.5') {
        if (concentration > 250) return { value: Math.round(400 + (100/130) * (concentration - 250)), category: 'SEVERE' };
        breakpoints = [
            { BPLo: 0, BPHi: 30, ILo: 0, IHi: 50, category: 'GOOD' },
            { BPLo: 31, BPHi: 60, ILo: 51, IHi: 100, category: 'SATISFACTORY' },
            { BPLo: 61, BPHi: 90, ILo: 101, IHi: 200, category: 'MODERATE' },
            { BPLo: 91, BPHi: 120, ILo: 201, IHi: 300, category: 'POOR' },
            { BPLo: 121, BPHi: 250, ILo: 301, IHi: 400, category: 'VERY POOR' }
        ];
    } else if (pollutant === 'PM10') {
        if (concentration > 430) return { value: Math.round(400 + (100/70) * (concentration - 430)), category: 'SEVERE' }; 
        breakpoints = [
            { BPLo: 0, BPHi: 50, ILo: 0, IHi: 50, category: 'GOOD' },
            { BPLo: 51, BPHi: 100, ILo: 51, IHi: 100, category: 'SATISFACTORY' },
            { BPLo: 101, BPHi: 250, ILo: 101, IHi: 200, category: 'MODERATE' },
            { BPLo: 251, BPHi: 350, ILo: 201, IHi: 300, category: 'POOR' },
            { BPLo: 351, BPHi: 430, ILo: 301, IHi: 400, category: 'VERY POOR' }
        ];
    } else {
        return { value: Math.round(concentration), category: 'RAW VALUE' };
    }

    for (let bp of breakpoints) {
        if (concentration >= bp.BPLo && concentration <= bp.BPHi) {
            const aqi = ((bp.IHi - bp.ILo) / (bp.BPHi - bp.BPLo)) * (concentration - bp.BPLo) + bp.ILo;
            return { value: Math.round(aqi), category: bp.category };
        }
    }
    return { value: "--", category: "WAITING" };
}

// -----------------------------------------
// Chart Initialization
// -----------------------------------------
function initChart() {
    const ctx = document.getElementById('aqiChart').getContext('2d');
    aqiChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: historyState['1H'].labels,
            datasets: [{
                label: 'Selected AQI Value',
                data: historyState['1H'][config.activePollutant].data, 
                borderColor: '#00ffff',
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, 
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#a0aec0' }
                },
                x: {
                    grid: { display: false },
                    ticks: { display: false } 
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}

// -----------------------------------------
// Event Setup (Buttons & Toggles)
// -----------------------------------------
function setupSelectors() {
    // Pollutant Selectors
    elements.pollutantBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.pollutantBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            config.activePollutant = e.target.getAttribute('data-pollutant');
            
            if (aqiChartInstance) {
                aqiChartInstance.data.datasets[0].data = historyState[config.activeTimeframe][config.activePollutant].data;
                aqiChartInstance.update();
            }
            if (config.latestData) updateUI(config.latestData);
        });
    });

    // Timeframe Selectors (NO MORE WIPING DATA!)
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const minutes = parseInt(e.target.getAttribute('data-time'));
            config.activeTimeframe = minutes === 60 ? '1H' : '6H';

            // Just swap the view to the other memory bank
            if (aqiChartInstance) {
                aqiChartInstance.data.labels = historyState[config.activeTimeframe].labels;
                aqiChartInstance.data.datasets[0].data = historyState[config.activeTimeframe][config.activePollutant].data;
                aqiChartInstance.update();
            }
        });
    });
}

// -----------------------------------------
// Network Polling Logic
// -----------------------------------------
function startPolling() {
    if (config.timer) clearInterval(config.timer);
    fetchData();
    config.timer = setInterval(fetchData, config.pollInterval);
}

async function fetchData() {
    const url = `http://${config.ip}/data`;
    try {
        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error('Network error');
        
        const data = await response.json();
        config.latestData = data; 
        updateUI(data);
        setConnectionStatus(true);
    } catch (error) {
        console.error('Fetch error:', error);
        setConnectionStatus(false);
    }
}

function setConnectionStatus(isConnected) {
    if (isConnected) {
        elements.statusIndicator.classList.remove('disconnected');
        elements.statusIndicator.classList.add('connected');
        elements.statusText.textContent = 'Live';
    } else {
        elements.statusIndicator.classList.remove('connected');
        elements.statusIndicator.classList.add('disconnected');
        elements.statusText.textContent = 'Offline';
        elements.aqiValue.textContent = '--';
        elements.aqiCategory.textContent = 'WAITING';
        elements.aqiCategory.style.color = 'var(--text-secondary)';
    }
}

// -----------------------------------------
// UI Rendering & Continuous Tracking
// -----------------------------------------
function updateUI(data) {
    // 1-Second Raw Updates
    elements.pm25Value.textContent = data.pm2_5;
    elements.pm10Value.textContent = data.pm10;
    elements.pm25ActualValue.textContent = data.pm25;
    elements.rawAvg.textContent = data.features?.avg || data.avg || '--';
    elements.rawVar.textContent = data.features?.variance || data.variance || '--';
    
    // Throttled 2-Second Env Updates
    config.envUpdateTick++;
    if (config.envUpdateTick % 2 === 0) {
        elements.tempValue.textContent = data.env?.temp?.toFixed(1) || data.temperature?.toFixed(1) || '--';
        elements.humidityValue.textContent = data.env?.humidity?.toFixed(1) || data.humidity?.toFixed(1) || '--';
        
        [elements.tempValue, elements.humidityValue].forEach(el => {
            el.classList.add('updated');
            setTimeout(() => el.classList.remove('updated'), 500);
        });
    }
    
    // --- CONTINUOUS BACKGROUND TRACKING LOGIC (1H and 6H) ---
    if (aqiChartInstance) {
        const streams = [
            { key: 'PM2.5', raw: data.pm2_5 },
            { key: 'PM10', raw: data.pm10 },
            { key: 'PM25', raw: data.pm25 }
        ];

        streams.forEach(stream => {
            const result = calculateAQI(stream.raw, stream.key);
            
            if (stream.key === config.activePollutant) {
                elements.aqiValue.textContent = result.value;
                elements.aqiCategory.textContent = result.category;
                updateAQIStyle(result.value, result.category);
            }
            
            if (result.value !== "--") {
                // Feeds the data into BOTH the 1H and 6H memory banks simultaneously!
                ['1H', '6H'].forEach(tf => {
                    let tfState = historyState[tf];
                    let streamState = tfState[stream.key];
                    
                    streamState.buffer.push(result.value);

                    // Left-to-Right starting point
                    if (streamState.data.every(val => val === null)) {
                        streamState.data[0] = result.value;
                    }

                    if (streamState.buffer.length >= tfState.secondsToBuffer) {
                        const average = streamState.buffer.reduce((a, b) => a + b, 0) / streamState.buffer.length;
                        
                        // Left-to-Right filling logic
                        const firstEmptySlot = streamState.data.indexOf(null);
                        if (firstEmptySlot !== -1) {
                            streamState.data[firstEmptySlot] = Math.round(average);
                        } else {
                            streamState.data.push(Math.round(average));
                            streamState.data.shift(); 
                        }
                        streamState.buffer = []; 
                    }
                });
            }
        });

        aqiChartInstance.update();
    }

    const now = new Date();
    elements.lastUpdated.textContent = `Last update: ${now.toLocaleTimeString()}`;
    
    const fastMetrics = [elements.aqiValue, elements.pm25Value, elements.pm10Value, elements.pm25ActualValue];
    fastMetrics.forEach(el => {
        el.classList.add('updated');
        setTimeout(() => el.classList.remove('updated'), 500);
    });
}

// -----------------------------------------
// Styling Helpers (Vibrant Colors Fixed)
// -----------------------------------------
function updateAQIStyle(value, category) {
    let color = '#a0aec0'; 
    let icon = 'help-circle';
    let progress = 0;

    if (value !== "--") {
        progress = Math.min((value / 500) * 100, 100);
    }

    if (category.includes('GOOD')) {
        color = '#00e676'; 
        icon = 'smile';
    } else if (category.includes('SATISFACTORY')) {
        color = '#b2ff59'; 
        icon = 'smile';
    } else if (category.includes('MODERATE')) {
        color = '#fee440'; 
        icon = 'meh';
    } else if (category.includes('POOR') && !category.includes('VERY')) {
        color = '#f4a261'; 
        icon = 'frown';
    } else if (category.includes('VERY POOR')) {
        color = '#e76f51'; 
        icon = 'frown';
    } else if (category.includes('SEVERE')) {
        color = '#ff4d6d'; 
        icon = 'alert-triangle';
    } else if (category === 'RAW VALUE') {
        color = '#00ffff'; 
        icon = 'database';
        progress = Math.min((value / 100) * 100, 100); 
    }

    elements.aqiCategory.style.color = color;
    elements.aqiProgressBar.style.width = `${progress}%`;
    elements.aqiProgressBar.style.backgroundColor = color;
    
    if (elements.aqiIconContainer) {
        elements.aqiIconContainer.innerHTML = `<i data-lucide="${icon}" size="48"></i>`;
        lucide.createIcons();
    }
}

// -----------------------------------------
// Modal Event Listeners
// -----------------------------------------
elements.settingsBtn.addEventListener('click', () => elements.settingsModal.classList.remove('hidden'));
elements.closeSettingsBtn.addEventListener('click', () => elements.settingsModal.classList.add('hidden'));

elements.saveSettingsBtn.addEventListener('click', () => {
    const newIp = elements.backendIpInput.value.trim();
    if (newIp) {
        config.ip = newIp;
        localStorage.setItem('ae_sensor_ip', config.ip);
        elements.settingsModal.classList.add('hidden');
        elements.statusText.textContent = 'Reconnecting...';
        startPolling();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.settingsModal.classList.contains('hidden')) {
        elements.settingsModal.classList.add('hidden');
    }
});

// =========================================
// UI DESIGNER TEST MODE
// =========================================
function runMockTest() {
    console.log("🛠️ Running in Mock UI Test Mode...");
    if (config.timer) clearInterval(config.timer);
    
    // Override buffer times so you can see it move fast during testing!
    //historyState['1H'].secondsToBuffer = 1; // 1H updates every 1 second
    //historyState['6H'].secondsToBuffer = 2; // 6H updates every 2 seconds
    
    setInterval(() => {
        const basePM25 = 80 + (Math.sin(Date.now() / 10000) * 40); 
        
        const mockData = {
            pm2_5: Math.round(basePM25 + (Math.random() * 10 - 5)),
            pm10: Math.round(basePM25 * 1.5 + (Math.random() * 15 - 7.5)),
            pm25: Math.round(basePM25 * 2.2 + (Math.random() * 20 - 10)),
            env: {
                temp: 26.0 + (Math.random() * 2 - 1),
                humidity: 65.0 + (Math.random() * 4 - 2)
            },
            features: {
                avg: Math.floor(Math.random() * 500) + 1000,
                variance: Math.floor(Math.random() * 50) + 10
            }
        };

        config.latestData = mockData;
        updateUI(mockData);
        setConnectionStatus(true);
        
    }, 1000); 
}

 //runMockTest();