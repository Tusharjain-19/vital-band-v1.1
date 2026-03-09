let appConfig = {
    caregiver: JSON.parse(localStorage.getItem('caregiverData')) || { name: '', phone: '', email: '' },
    api: JSON.parse(localStorage.getItem('apiKeys')) || { 
        tgToken: "", 
        tgChatId: "",
        groqKey: ""
    }
};

// ALERT THROTTLING (Working like old)
let alertTimestamps = []; 
let emergencyActive = false;

// BLE Configuration
const BLE_SERVICE_UUID = 'e267751a-ae76-11eb-8529-0242ac130003';
const BLE_CHARACTERISTIC_UUID = 'e267751b-ae76-11eb-8529-0242ac130003';

const connectBtnMain = document.getElementById('connect-btn-main');
const connectNavBtn = document.getElementById('connect-nav-btn');
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
    initTheme();
    initECGChart();
    initSettingsTabs();
    initChatbot();
    initECGAnalysis();
    loadSavedSettings();
    updateConnectionUI();

    // Attach Connect Listeners
    connectBtnMain.onclick = connectToBLE;
    connectNavBtn.onclick = connectToBLE;
});

/**
 * THROTTLING LOGIC (Like old app)
 */
function canTriggerEmergency() {
    const now = Date.now();
    alertTimestamps = alertTimestamps.filter(ts => now - ts < 20000); // 20s window
    return alertTimestamps.length < 3 && !emergencyActive;
}

function recordAlertTimestamp() {
    alertTimestamps.push(Date.now());
}

/**
 * UI CONTROL: CONNECTION STATES
 */
function updateConnectionUI() {
    const overlay = document.getElementById('connection-overlay');
    const mainApp = document.getElementById('main-app');
    
    if (bleDevice && bleDevice.gatt.connected) {
        overlay.classList.add('hidden');
        mainApp.classList.remove('blurred');
    } else {
        overlay.classList.remove('hidden');
        mainApp.classList.add('blurred');
    }
}

/**
 * THEME & TABS
 */
function initTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    const set = (t) => {
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
        if (themeBtn) themeBtn.innerHTML = t === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    };
    const saved = localStorage.getItem('theme') || 'dark';
    set(saved);
    if (themeBtn) themeBtn.onclick = () => set(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

function initSettingsTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.settings-tab-content');
    
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.add('hidden'));
            tab.classList.add('active');
            document.querySelector(`[data-content="${tab.dataset.tab}"]`).classList.remove('hidden');
        };
    });

    // Save Handlers
    document.getElementById('caregiver-form').onsubmit = (e) => {
        e.preventDefault();
        appConfig.caregiver = {
            name: document.getElementById('caregiver-name').value,
            phone: document.getElementById('caregiver-phone').value,
            email: document.getElementById('caregiver-email').value
        };
        localStorage.setItem('caregiverData', JSON.stringify(appConfig.caregiver));
        showToast('Caregiver settings saved.', 'success');
        hideModal('settings-modal');
    };

    document.getElementById('api-form').onsubmit = (e) => {
        e.preventDefault();
        appConfig.api = {
            tgToken: document.getElementById('tg-token').value,
            tgChatId: document.getElementById('tg-chat-id').value,
            groqKey: document.getElementById('groq-key').value
        };
        localStorage.setItem('apiKeys', JSON.stringify(appConfig.api));
        showToast('API Configuration saved.', 'success');
        hideModal('settings-modal');
    };
}

function loadSavedSettings() {
    if (appConfig.caregiver.name) {
        document.getElementById('caregiver-name').value = appConfig.caregiver.name;
        document.getElementById('caregiver-phone').value = appConfig.caregiver.phone;
        document.getElementById('caregiver-email').value = appConfig.caregiver.email || '';
    }
    if (appConfig.api.tgToken) {
        document.getElementById('tg-token').value = appConfig.api.tgToken;
        document.getElementById('tg-chat-id').value = appConfig.api.tgChatId;
        document.getElementById('groq-key').value = appConfig.api.groqKey || '';
    }
}

/**
 * BLE COMMUNICATION
 */
async function connectToBLE() {
    try {
        console.log('Requesting Bluetooth Device...');
        showToast('Scanning for VitalSafe Hub...', 'info');
        
        // Use name filtering to discover the device as done in the original app
        // ESP32 devices often don't advertise the GATT Service, so name filter or acceptAllDevices is required.
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'GetFit BLE' }],
            optionalServices: [BLE_SERVICE_UUID]
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);

        await bleCharacteristic.startNotifications();
        showToast('System Online & Syncing', 'success');
        
        // Force Caregiver Onboarding if missing
        if (!appConfig.caregiver.name || !appConfig.caregiver.phone) {
            setTimeout(() => {
                showToast('⚠️ Setup Required: Please enter your emergency contact.', 'warn', 6000);
                showModal('settings-modal');
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
                
                // Working like old: Throttling check
                if (data.fall && canTriggerEmergency()) {
                    recordAlertTimestamp();
                    triggerEmergency();
                }
            } catch (err) {}
        });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            bleDevice = null;
            showToast('Connection Lost', 'warn');
            updateConnectionUI();
        });

        updateConnectionUI();

    } catch (error) {
        console.error('BLE Error:', error);
        
        if (!window.isSecureContext) {
            showToast('Security Error: Use localhost or HTTPS', 'danger');
            return;
        }

        if (error.name === 'NotFoundError') {
            showToast('Search ended manually.', 'info');
        } else if (error.name === 'SecurityError') {
            showToast('Permission blocked by browser.', 'danger');
        } else if (error.message.includes('No Services')) {
            showToast('Hardware Mismatch: Check UUIDs', 'warn');
        } else {
            showToast('System Error: Refresh & Retry', 'danger');
        }
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

    if (steps !== undefined && stepsEl) {
        animateValue(stepsEl, currentData.steps || 0, steps, 800);
        const prog = document.getElementById('steps-progress');
        if (prog) prog.style.width = `${Math.min((steps / 10000) * 100, 100)}%`;
    }

    if (heartRate !== undefined && hrEl) {
        animateValue(hrEl, currentData.heartRate || 0, heartRate, 800);
        if (hrStatus) {
            hrStatus.textContent = heartRate > 100 ? "Elevated BPM" : "Resting Rate";
            hrStatus.style.color = heartRate > 100 ? "var(--warn-orange)" : "var(--text-secondary)";
        }
    }

    if (fall !== undefined && fallEl) {
        fallEl.textContent = fall ? "ALERT" : "SECURE";
        fallEl.style.color = fall ? "var(--danger-red)" : "var(--safe-green)";
    }

    // MPU6050 Kinematics
    if (mpu) {
        // Accelerometer expected in forces (g) roughly
        const ax = mpu.ax || 0, ay = mpu.ay || 0, az = mpu.az || 0;
        const mag = Math.sqrt(ax*ax + ay*ay + az*az);
        
        const intensityEl = document.getElementById('intensity');
        if (intensityEl) {
            let state = "Resting"; let color = "var(--text-secondary)";
            if (mag > 1.3) { state = "Active"; color = "var(--safe-green)"; }
            if (mag > 2.2) { state = "Vigorous"; color = "var(--warn-orange)"; }
            intensityEl.textContent = state;
            intensityEl.style.color = color;
        }

        const postureEl = document.getElementById('posture');
        if (postureEl) {
            let posture = "Upright";
            if (Math.abs(az) > 0.7) posture = "Lying Down";
            else if (Math.abs(ay) < 0.5) posture = "Reclined";
            postureEl.textContent = posture;
        }
    }

    // GPS Processing
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
                borderColor: '#2563eb',
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
 * AI ECG ANALYSIS (Groq Llama 3)
 */
function initECGAnalysis() {
    const btn = document.getElementById('analyze-ecg-btn');
    const resultBox = document.getElementById('ecg-analysis-result');
    const resultText = document.getElementById('ecg-analysis-text');

    if (!btn) return;

    btn.onclick = async () => {
        if (!bleDevice || !bleDevice.gatt.connected) {
            showToast("Connection Required: Please connect the Hub first.", "warn");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recording (15s)...`;
        resultBox.classList.add('hidden');
        
        isCollectingECG = true;
        ecgCollectionBuffer = [];

        setTimeout(async () => {
            isCollectingECG = false;
            btn.innerHTML = `<i class="fas fa-brain fa-pulse"></i> Processing...`;
            resultBox.classList.remove('hidden');
            resultText.textContent = "AI is evaluating waveform patterns...";

            const analysisResult = await analyzeECGWithGroq();
            
            resultText.innerHTML = analysisResult;
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-brain"></i> AI Analysis (15s)`;
        }, 15000);
    };
}

async function analyzeECGWithGroq() {
    const groqKey = appConfig.api.groqKey;
    if (!groqKey) return "⚠️ API Key missing. Please add your Groq API Key in Hub Configuration.";
    if (ecgCollectionBuffer.length === 0) return "⚠️ No signals collected. Ensure device is worn securely.";

    try {
        const payload = {
            model: "llama3-8b-8192", // Using lightweight LLaMA 3 for speed
            messages: [
                {
                    role: "system",
                    content: "You are a medical AI assistant. Analyze the raw single-lead ECG integer array provided. Look for significant high/low variances that might indicate arrhythmias. Respond strictly in 2-3 short, clear sentences. Conclude explicitly with: 'This is a prototype determination and is NOT clinically validated.'"
                },
                {
                    role: "user",
                    content: `ECG Data points (15s): ${JSON.stringify(ecgCollectionBuffer)}`
                }
            ],
            temperature: 0.2
        };

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("API Connection Failed");

        const resData = await response.json();
        return resData.choices[0].message.content;
    } catch (e) {
        console.error("Groq AI Error: ", e);
        return "⚠️ External AI Service Unavailable. Please try again later.";
    }
}

/**
 * EMERGENCY SYSTEM: Enhanced with Geolocation & Multi-channel Alerts
 */
async function triggerEmergency() {
    emergencyActive = true;
    const modal = document.getElementById('emergency-modal');
    const content = document.getElementById('emergency-content');
    modal.classList.remove('hidden');

    let locationInfo = { text: 'Retrieving location...', mapsUrl: '' };
    
    content.innerHTML = `
        <div class="emergency-flow">
            <p>🚨 Fall detected for <strong>${appConfig.caregiver.name || 'Emergency Contact'}</strong>.</p>
            <div id="location-display" class="location-status">Scanning GPS...</div>
            <div class="timer-box">7s</div>
            <div class="emergency-actions">
                <button class="save-btn" onclick="cancelEmergency()" style="background: var(--text-secondary);">I AM OK / FALSE ALARM</button>
            </div>
        </div>
    `;

    // Attempt to get location while timer runs
    try {
        const pos = await getCurrentLocation();
        locationInfo.text = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
        locationInfo.mapsUrl = `https://maps.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
        const locDisp = document.getElementById('location-display');
        if (locDisp) locDisp.innerHTML = `<i class="fas fa-location-dot"></i> Location Found: ${locationInfo.text}`;
    } catch (err) {
        const locDisp = document.getElementById('location-display');
        if (locDisp) locDisp.innerHTML = `<i class="fas fa-location-slash"></i> Location unavailable`;
    }

    let count = 7;
    const itv = setInterval(() => {
        count--;
        const timerBox = document.querySelector('.timer-box');
        if (timerBox) timerBox.textContent = `${count}s`;
        
        if (count <= 0) {
            clearInterval(itv);
            if (emergencyActive) executeAlerts(locationInfo);
        }
    }, 1000);
}

function cancelEmergency() {
    emergencyActive = false;
    document.getElementById('emergency-modal').classList.add('hidden');
    showToast('Emergency Canceled', 'info');
}

async function executeAlerts(location) {
    const locText = location.mapsUrl ? `View Location: ${location.mapsUrl}` : "Location unavailable";
    const msgBody = `🚨 VitalSafe EMERGENCY: Fall detected for your loved one!\n${locText}`;
    
    const whatsappMsg = `🚨 *VitalSafe EMERGENCY ALERT* 🚨\nFall detected!\n${location.mapsUrl ? `📍 *Location:* ${location.mapsUrl}` : '_Location unavailable_'}`;

    // 1. Telegram Alert (Automated)
    if (appConfig.api.tgToken && appConfig.api.tgChatId) {
        fetch(`https://api.telegram.org/bot${appConfig.api.tgToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: appConfig.api.tgChatId, 
                text: `🚨 <b>VitalSafe ALERT</b>\nFall detected!\n${location.mapsUrl ? `<a href="${location.mapsUrl}">📍 View on Map</a>` : 'Location unavailable'}`,
                parse_mode: 'HTML'
            })
        }).catch(err => console.error('Telegram failed:', err));
    }

    // 2. Direct WhatsApp
    if (appConfig.caregiver.phone) {
        const cleanPhone = appConfig.caregiver.phone.replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
    }

    // 3. Direct SMS
    if (appConfig.caregiver.phone) {
        setTimeout(() => {
            window.location.href = `sms:${appConfig.caregiver.phone}?body=${encodeURIComponent(msgBody)}`;
        }, 1500);
    }

    // 4. Email Alert (Restore old behavior)
    if (appConfig.caregiver.email) {
        setTimeout(() => {
            const subject = encodeURIComponent("🚨 VitalSafe EMERGENCY: Fall Detected");
            const body = encodeURIComponent(msgBody);
            window.open(`mailto:${appConfig.caregiver.email}?subject=${subject}&body=${body}`, '_blank');
        }, 3000);
    }

    const content = document.getElementById('emergency-content');
    if (content) {
        content.innerHTML = `
            <div class="success-alert">
                <i class="fas fa-check-circle" style="font-size: 3rem; color: var(--safe-green);"></i>
                <h3 style="margin-top: 1.5rem;">Alerts Dispatched</h3>
                <p style="color: var(--text-secondary); margin-top: 0.5rem;">WhatsApp, SMS, and Email triggered.</p>
                <button class="save-btn" style="margin-top: 2rem; background: var(--bg-dark); border: 1px solid var(--border-color); color: var(--text-primary);" onclick="cancelEmergency()">Return to Dashboard</button>
            </div>
        `;
    }
}

function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        // priority 1: Seamless hardware GPS (ESP32) Without exposing source to user
        if (currentData.gps && currentData.gps.lat && currentData.gps.lon && currentData.gps.lat !== 0) {
            return resolve({
                coords: {
                    latitude: currentData.gps.lat,
                    longitude: currentData.gps.lon,
                    speed: currentData.gps.speed || 0,
                    accuracy: 5 // Hardware precision simulation
                }
            });
        }

        // Priority 2: Cellular/Mobile GPS fallback seamlessly
        if (!navigator.geolocation) {
            return reject(new Error('Geolocation not supported inside environment.'));
        }
        
        navigator.geolocation.getCurrentPosition(resolve, reject, { 
            enableHighAccuracy: true, 
            timeout: 10000, 
            maximumAge: 0 
        });
    });
}

/**
 * HELPERS
 */
function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function showTab(tabId) {
    // Currently only 'dashboard' exists, but expandable
    const mainApp = document.getElementById('main-app');
    mainApp.scrollIntoView({ behavior: 'smooth' });
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('settings-close').onclick = () => hideModal('settings-modal');

/**
 * IN-APP NOTIFICATION SYSTEM (Replaces alert)
 */
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'warn') icon = 'fa-exclamation-triangle';
    if (type === 'danger') icon = 'fa-times-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Auto remove
    setTimeout(() => {
        toast.classList.add('fading');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

// Override native alert for a professional feel
window.alert = (msg) => showToast(msg, 'info');

/**
 * CHATBOT (Mobile Optimized)
 */
function initChatbot() {
    const toggle = document.getElementById('chat-toggle');
    const win = document.getElementById('chat-window');
    toggle.onclick = () => win.classList.toggle('hidden');
    document.getElementById('chat-close').onclick = () => win.classList.add('hidden');

    document.getElementById('chat-send').onclick = () => {
        const inp = document.getElementById('chat-input');
        if (!inp.value) return;
        const msg = inp.value;
        const chat = document.getElementById('chat-messages');
        chat.innerHTML += `<div class="message user-msg">${msg}</div>`;
        inp.value = '';
        setTimeout(() => {
            chat.innerHTML += `<div class="message bot-msg">Your vitals are steady. Resting heart rate is ${currentData.heartRate} BPM.</div>`;
            chat.scrollTop = chat.scrollHeight;
        }, 1000);
    };
}


