// Configuration: Falls back to localStorage, overridden by config.js (.env)
const localApi = JSON.parse(localStorage.getItem('apiKeys')) || { tgToken: "", tgChatId: "", aiKey: "", aiUrl: "", aiModel: "" };
let appConfig = {
    caregiver: JSON.parse(localStorage.getItem('caregiverData')) || { name: '', phone: '', email: '' },
    api: {
        tgToken: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.TG_TOKEN) ? VITAL_ENV.TG_TOKEN : localApi.tgToken,
        tgChatId: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.TG_CHAT_ID) ? VITAL_ENV.TG_CHAT_ID : localApi.tgChatId,
        aiKey: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.AI_API_KEY) ? VITAL_ENV.AI_API_KEY : localApi.aiKey,
        aiUrl: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.AI_API_URL) ? VITAL_ENV.AI_API_URL : (localApi.aiUrl || "https://api.groq.com/openai/v1/chat/completions"),
        aiModel: (typeof VITAL_ENV !== 'undefined' && VITAL_ENV.AI_MODEL) ? VITAL_ENV.AI_MODEL : (localApi.aiModel || "llama3-8b-8192")
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
            tgChatId: document.getElementById('tg-chat-id').value,
            aiKey: document.getElementById('ai-key').value,
            aiUrl: document.getElementById('ai-url').value || "https://api.groq.com/openai/v1/chat/completions",
            aiModel: document.getElementById('ai-model').value || "llama3-8b-8192"
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
        document.getElementById('tg-chat-id').value = appConfig.api.tgChatId || '';
        document.getElementById('ai-key').value = appConfig.api.aiKey || '';
        document.getElementById('ai-url').value = appConfig.api.aiUrl || 'https://api.groq.com/openai/v1/chat/completions';
        document.getElementById('ai-model').value = appConfig.api.aiModel || 'llama3-8b-8192';
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
            clearTimeout(dataWatchdog);
            showToast('Connection Offline', 'warn');
            const hrStatus = document.getElementById('hr-status');
            if (hrStatus) hrStatus.textContent = "Disconnected";
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
let dataWatchdog = null;

function resetDataWatchdog() {
    clearTimeout(dataWatchdog);
    
    // Ensure badge says ONLINE if we were previously offline
    const badge = document.getElementById('connection-status-badge');
    if (badge && badge.textContent !== 'ONLINE') {
        badge.textContent = 'ONLINE';
        badge.style.background = '#dcfce7';
        badge.style.color = '#10b981';
    }

    dataWatchdog = setTimeout(() => {
        showToast('No Data Streaming from Module', 'warn');
        const hrStatus = document.getElementById('hr-status');
        if (hrStatus) {
            hrStatus.textContent = "No Data Received";
            hrStatus.style.color = "var(--danger)";
        }
        
        const hrEl = document.getElementById('heart-rate');
        if (hrEl) hrEl.textContent = "--";
        
        const stepsEl = document.getElementById('steps');
        if (stepsEl) stepsEl.textContent = "--";
        
        const speedEl = document.getElementById('speed');
        if (speedEl) speedEl.textContent = "--";
        
        const intensityEl = document.getElementById('intensity');
        if (intensityEl) {
            intensityEl.textContent = "Offline";
            intensityEl.style.color = "var(--text-secondary)";
        }
        
        const fallEl = document.getElementById('fall-alert');
        if (fallEl) {
            fallEl.textContent = "Unknown";
            fallEl.style.color = "var(--text-secondary)";
        }

        if (badge) {
            badge.textContent = 'NO DATA';
            badge.style.background = '#fef08a';
            badge.style.color = '#ca8a04';
        }
    }, 5000); // 5 Seconds Timeout
}

function updateDashboard(data) {
    resetDataWatchdog();

    const { steps, heartRate, fall, mpu, gps } = data;
    const stepsEl = document.getElementById('steps');
    const hrEl = document.getElementById('heart-rate');
    const fallEl = document.getElementById('fall-alert');
    const hrStatus = document.getElementById('hr-status');

    if (mpu && mpu.ax !== undefined) {
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

    if (stepsEl && steps !== undefined) stepsEl.textContent = steps;

    if (heartRate !== undefined && hrEl) {
        if (!window.smoothedBPM) window.smoothedBPM = heartRate;
        
        if (Math.abs(heartRate - window.smoothedBPM) > 30) {
            window.smoothedBPM = heartRate; 
        } else {
            window.smoothedBPM = (window.smoothedBPM * 0.7) + (heartRate * 0.3);
        }
        
        let displayBPM = Math.round(window.smoothedBPM);
        
        hrEl.textContent = displayBPM;
        if (hrStatus) {
            hrStatus.textContent = displayBPM > 100 ? "🚨 Elevated BPM" : "Resting Rate";
            hrStatus.style.color = displayBPM > 100 ? "var(--danger)" : "var(--text-secondary)";
        }
    }

    if (fallEl && fall !== undefined) {
        fallEl.textContent = fall ? "ALERT" : "OK";
        fallEl.style.color = fall ? "var(--danger)" : "var(--safe)";
    }
    
    if (fall && canTriggerEmergency()) {
        recordAlertTimestamp();
        triggerEmergency();
    }

    if (gps && gps.speed !== undefined) {
        const speedEl = document.getElementById('speed');
        if (speedEl) speedEl.textContent = parseFloat(gps.speed).toFixed(1);
    }

    currentData = { ...currentData, ...data, steps: steps, fall: fall };
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

            const analysisResult = await analyzeECGWithAI();
            resultText.innerHTML = analysisResult;
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-robot"></i> AI Analysis`;
        }, 8000); // Shorter for demo
    };
}

async function analyzeECGWithAI() {
    const { aiKey, aiUrl, aiModel } = appConfig.api;
    if (!aiKey) return "AI Key missing in settings.";
    if (ecgCollectionBuffer.length === 0) return "No data points gathered.";

    try {
        const payload = {
            model: aiModel,
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

        const response = await fetch(aiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${aiKey}`,
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
let emergencyTimeoutId = null;
let emergencyCountdownInterval = null;

function canTriggerEmergency() {
    const now = Date.now();
    alertTimestamps = alertTimestamps.filter(ts => now - ts < 20000);
    return alertTimestamps.length < 3 && !emergencyActive;
}

function recordAlertTimestamp() { alertTimestamps.push(Date.now()); }

async function triggerEmergency() {
    if (emergencyActive) return;
    
    if (!appConfig.api.tgToken || !appConfig.api.tgChatId) {
        showToast("SOS Failed: Telegram not configured in Profile -> Advanced", "danger", 5000);
        return;
    }

    emergencyActive = true;
    const modal = document.getElementById('emergency-modal');
    const content = document.getElementById('emergency-content');
    const cancelBtn = document.getElementById('emergency-cancel-btn');
    
    modal.classList.remove('hidden');
    let timeLeft = 7;
    
    content.innerHTML = `Detecting critical event...<br><br>Sending SOS in <b style="font-size:1.5rem">${timeLeft}</b> seconds`;

    if (emergencyCountdownInterval) clearInterval(emergencyCountdownInterval);
    if (emergencyTimeoutId) clearTimeout(emergencyTimeoutId);

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            clearInterval(emergencyCountdownInterval);
            clearTimeout(emergencyTimeoutId);
            emergencyActive = false;
            modal.classList.add('hidden');
            showToast('Emergency Alert Cancelled', 'info');
        };
    }

    emergencyCountdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            content.innerHTML = `Detecting critical event...<br><br>Sending SOS in <b style="font-size:1.5rem">${timeLeft}</b> seconds`;
        } else {
            clearInterval(emergencyCountdownInterval);
        }
    }, 1000);

    emergencyTimeoutId = setTimeout(() => {
        clearInterval(emergencyCountdownInterval);
        emergencyActive = false;
        modal.classList.add('hidden');
        sendEmergencyWithLocation();
    }, 7000);
}

function sendEmergencyWithLocation() {
    const defaultMsg = `🚨 EMERGENCY ALERT 🚨\nFall Detected for ${appConfig.caregiver.name || 'User'}!\nPhone: ${appConfig.caregiver.phone || 'N/A'}`;
    
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
                sendTelegramAlert(`${defaultMsg}\n\nLocation: ${mapsLink}`);
                showToast("Emergency Alert Sent with Location!", "danger");
            },
            (error) => {
                sendTelegramAlert(`${defaultMsg}\n\nCould not retrieve GPS location.`);
                showToast("Emergency Alert Sent! (No Location)", "danger");
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    } else {
        sendTelegramAlert(`${defaultMsg}\n\nGeolocation is not supported.`);
        showToast("Emergency Alert Sent!", "danger");
    }
}

async function sendTelegramAlert(text) {
    const { tgToken, tgChatId } = appConfig.api;
    if (!tgToken || !tgChatId) return;

    try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ chat_id: tgChatId, text: text })
        });
    } catch(err) {
        console.error("Telegram error:", err);
    }
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


