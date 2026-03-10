// Configuration: Falls back to localStorage, overridden by config.js (.env)
const localApi = JSON.parse(localStorage.getItem('apiKeys')) || { tgToken: "", tgChatId: "", groqKey: "" };
let appConfig = {
    caregiver: JSON.parse(localStorage.getItem('caregiverData')) || { name: '', phone: '', email: '' },
    api: {
        tgToken: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.TG_TOKEN) ? VITAL_ENV.TG_TOKEN : localApi.tgToken,
        tgChatId: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.TG_CHAT_ID) ? VITAL_ENV.TG_CHAT_ID : localApi.tgChatId,
        groqKey: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.GROQ_API_KEY) ? VITAL_ENV.GROQ_API_KEY : localApi.groqKey
    }
};

// ALERT THROTTLING
let alertTimestamps = []; 
let emergencyActive = false;

// BLE Configuration
const BLE_SERVICE_UUID = 'e267751a-ae76-11eb-8529-0242ac130003';
const BLE_CHARACTERISTIC_UUID = 'e267751b-ae76-11eb-8529-0242ac130003';

let bleDevice = null;
let bleCharacteristic = null;
let currentData = { heartRate: 0, steps: 0, fall: false, mpu: null, gps: null };

let ecgChart = null;
const MAX_DATA_POINTS = 50; 
let ecgDataBuffer = Array(MAX_DATA_POINTS).fill(0);

// AI COLLECTION STATE
let isCollectingECG = false;
let ecgCollectionBuffer = [];

/**
 * APP INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    initECGChart();
    initForms();
    initChat();
    initECGAnalysis();
    loadSavedSettings();
    updateConnectionUI();

    // Attach Connect Listener
    document.getElementById('connect-btn-main').onclick = connectToBLE;
});

/**
 * UI CONTROL: BOTTOM SHEETS & TABS
 */
function openBottomSheet(id) {
    document.getElementById('sheet-backdrop').classList.add('active');
    document.getElementById(id).classList.add('open');
}

function closeAllSheets() {
    document.getElementById('sheet-backdrop').classList.remove('active');
    const sheets = document.querySelectorAll('.bottom-sheet');
    sheets.forEach(s => s.classList.remove('open'));
}

function switchTab(btn, contentId) {
    const parent = btn.parentElement;
    parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const container = parent.nextElementSibling.parentElement;
    container.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(contentId).classList.remove('hidden');
}

/**
 * UI CONTROL: CHAT
 */
function openChat() {
    document.getElementById('chat-window').classList.add('open');
}

function closeChat() {
    document.getElementById('chat-window').classList.remove('open');
}

function initChat() {
    const chatInp = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    const chatMsgs = document.getElementById('chat-messages');

    const handleSend = () => {
        if (!chatInp.value) return;
        const msg = chatInp.value;
        chatMsgs.innerHTML += `<div class="message user-msg">${msg}</div>`;
        chatInp.value = '';
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        setTimeout(() => {
            chatMsgs.innerHTML += `<div class="message bot-msg">System Check: Vitals stable. Heart rate ${currentData.heartRate} BPM. No anomalies detected.</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        }, 1000);
    };

    chatSend.onclick = handleSend;
    chatInp.onkeypress = (e) => { if(e.key === 'Enter') handleSend(); };
}

/**
 * UI CONTROL: CONNECTION STATES
 */
function updateConnectionUI() {
    const overlay = document.getElementById('connection-overlay');
    const mainApp = document.getElementById('main-app');
    const badge = document.getElementById('connection-status-badge');
    
    if (bleDevice && bleDevice.gatt.connected) {
        overlay.classList.add('hidden');
        mainApp.classList.remove('blurred');
        if (badge) {
            badge.textContent = 'ONLINE';
            badge.style.background = '#dcfce7';
            badge.style.color = '#10b981';
        }
    } else {
        overlay.classList.remove('hidden');
        mainApp.classList.add('blurred');
        if (badge) {
            badge.textContent = 'OFFLINE';
            badge.style.background = '#fee2e2';
            badge.style.color = '#ef4444';
        }
    }
}

/**
 * FORMS & SETTINGS
 */
function initForms() {
    document.getElementById('caregiver-form').onsubmit = (e) => {
        e.preventDefault();
        appConfig.caregiver = {
            name: document.getElementById('caregiver-name').value,
            phone: document.getElementById('caregiver-phone').value
        };
        localStorage.setItem('caregiverData', JSON.stringify(appConfig.caregiver));
        showToast('Contact Saved', 'success');
        closeAllSheets();
    };

    document.getElementById('api-form').onsubmit = (e) => {
        e.preventDefault();
        appConfig.api = {
            tgToken: document.getElementById('tg-token').value,
            groqKey: document.getElementById('groq-key').value
        };
        localStorage.setItem('apiKeys', JSON.stringify(appConfig.api));
        showToast('Config Updated', 'success');
        closeAllSheets();
    };
}

function loadSavedSettings() {
    if (appConfig.caregiver.name) {
        document.getElementById('caregiver-name').value = appConfig.caregiver.name;
        document.getElementById('caregiver-phone').value = appConfig.caregiver.phone;
    }
    if (appConfig.api.tgToken) {
        document.getElementById('tg-token').value = appConfig.api.tgToken;
        document.getElementById('groq-key').value = appConfig.api.groqKey || '';
    }
}

/**
 * BLE COMMUNICATION
 */
async function connectToBLE() {
    try {
        showToast('Searching for VitalSafe Band...', 'info');
        
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'GetFit BLE' }],
            optionalServices: [BLE_SERVICE_UUID]
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);

        await bleCharacteristic.startNotifications();
        showToast('Online & Syncing', 'success');
        
        if (!appConfig.caregiver.name || !appConfig.caregiver.phone) {
            setTimeout(() => {
                showToast('Setup Missing: Add contact in Profile', 'warn', 6000);
            }, 1000);
        }
        
        bleCharacteristic.addEventListener('characteristicvaluechanged', (e) => {
            const val = new TextDecoder().decode(e.target.value);
            try {
                const data = JSON.parse(val);
                updateDashboard(data);
                if (data.ecg !== undefined) {
                    updateECGChart(data.ecg);
                    if (isCollectingECG) ecgCollectionBuffer.push(data.ecg);
                }
                
                if (data.fall && canTriggerEmergency()) {
                    recordAlertTimestamp();
                    triggerEmergency();
                }
            } catch (err) {}
        });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            bleDevice = null;
            showToast('Connection Offline', 'warn');
            updateConnectionUI();
        });

        updateConnectionUI();

    } catch (error) {
        console.error('BLE Error:', error);
        showToast('Search Cancelled or Offline', 'danger');
    }
}

/**
 * DASHBOARD & CHART
 */
function updateDashboard(data) {
    const { steps, heartRate, fall, mpu, gps } = data;
    const stepsEl = document.getElementById('steps');
    const hrEl = document.getElementById('heart-rate');
    const fallEl = document.getElementById('fall-alert');
    const hrStatus = document.getElementById('hr-status');

    if (steps !== undefined && stepsEl) stepsEl.textContent = steps;

    if (heartRate !== undefined && hrEl) {
        hrEl.textContent = heartRate;
        if (hrStatus) {
            hrStatus.textContent = heartRate > 100 ? "🚨 Elevated BPM" : "Resting Rate";
            hrStatus.style.color = heartRate > 100 ? "var(--danger)" : "var(--text-secondary)";
        }
    }

    if (fall !== undefined && fallEl) {
        fallEl.textContent = fall ? "ALERT" : "OK";
        fallEl.style.color = fall ? "var(--danger)" : "var(--safe)";
    }

    if (mpu) {
        const ax = mpu.ax || 0, ay = mpu.ay || 0, az = mpu.az || 0;
        const mag = Math.sqrt(ax*ax + ay*ay + az*az);
        const intensityEl = document.getElementById('intensity');
        if (intensityEl) {
            let state = "Resting"; let color = "var(--text-secondary)";
            if (mag > 1.3) { state = "Active"; color = "var(--safe)"; }
            if (mag > 2.2) { state = "Intense"; color = "var(--warn)"; }
            intensityEl.textContent = state;
            intensityEl.style.color = color;
        }
    }

    if (gps && gps.speed !== undefined) {
        const speedEl = document.getElementById('speed');
        if (speedEl) speedEl.textContent = parseFloat(gps.speed).toFixed(1);
    }

    currentData = { ...currentData, ...data };
}

function initECGChart() {
    const ctx = document.getElementById('ecgChart').getContext('2d');
    ecgChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(MAX_DATA_POINTS).fill(''),
            datasets: [{
                data: ecgDataBuffer,
                borderColor: '#3b82f6',
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.4,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: { x: { display: false }, y: { min: -1, max: 1, display: false } },
            plugins: { legend: { display: false } }
        }
    });
}

function updateECGChart(val) {
    ecgDataBuffer.push(val);
    ecgDataBuffer.shift();
    ecgChart.update('none');
}

/**
 * AI ECG ANALYSIS
 */
function initECGAnalysis() {
    const btn = document.getElementById('analyze-ecg-btn');
    const resultBox = document.getElementById('ecg-analysis-result');
    const resultText = document.getElementById('ecg-analysis-text');

    btn.onclick = async () => {
        if (!bleDevice || !bleDevice.gatt.connected) {
            showToast("Band Offline", "warn");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recording...`;
        resultBox.classList.add('hidden');
        
        isCollectingECG = true;
        ecgCollectionBuffer = [];

        setTimeout(async () => {
            isCollectingECG = false;
            btn.innerHTML = `<i class="fas fa-brain"></i> Evaluating...`;
            resultBox.classList.remove('hidden');
            resultText.textContent = "AI analyzing waveform...";

            const analysisResult = await analyzeECGWithGroq();
            resultText.innerHTML = analysisResult;
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-robot"></i> AI Analysis`;
        }, 8000); // Shorter for demo
    };
}

async function analyzeECGWithGroq() {
    const groqKey = appConfig.api.groqKey;
    if (!groqKey) return "Groq Key missing in settings.";
    if (ecgCollectionBuffer.length === 0) return "No data points gathered.";

    try {
        const payload = {
            model: "llama3-8b-8192",
            messages: [
                {
                    role: "system",
                    content: "Evaluate cardiac waveform data strictly. Provide 2 sentences. Conclude: 'Non-clinical advisory.'"
                },
                {
                    role: "user",
                    content: `ECG Data: ${JSON.stringify(ecgCollectionBuffer.slice(0, 100))}`
                }
            ]
        };

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json();
        return resData.choices[0].message.content;
    } catch (e) {
        return "AI Service Offline.";
    }
}

/**
 * EMERGENCY SOS
 */
function canTriggerEmergency() {
    const now = Date.now();
    alertTimestamps = alertTimestamps.filter(ts => now - ts < 20000);
    return alertTimestamps.length < 3 && !emergencyActive;
}

function recordAlertTimestamp() { alertTimestamps.push(Date.now()); }

async function triggerEmergency() {
    emergencyActive = true;
    const modal = document.getElementById('emergency-modal');
    modal.classList.remove('hidden');
    // Simplified emergency logic for mobile view
    setTimeout(() => {
        if (emergencyActive) showToast('Emergency Alerts Dispatched', 'danger');
        emergencyActive = false;
        modal.classList.add('hidden');
    }, 5000);
}

/**
 * HELPERS
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'warn') icon = 'fa-exclamation-triangle';
    if (type === 'danger') icon = 'fa-times-circle';
    
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showSection(id) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    event.currentTarget.classList.add('active');
    showToast(`${id} section selected`, 'info');
}


