/* File: script.js */
// CONFIG: AI chatbot in demo mode (no API key required)
const AI_CONFIG = { demoMode: true };

// BLE VARIABLES
const connectBtn = document.getElementById('connect-btn');
let bleDevice = null;
let bleCharacteristic = null;

// ALERT THROTTLING
let emergencyActive = false;           // Lock active alert
let alertTimestamps = [];              // Track last alerts

// CHATBOT: Global health data for AI context
let currentData = { heartRate: 0, steps: 0, fall: false, lat: null, lng: null };

// CAREGIVER: Emergency contact data
let caregiverData = JSON.parse(localStorage.getItem('caregiverData')) || null;

// BLE Configuration
const BLE_SERVICE_UUID = 'e267751a-ae76-11eb-8529-0242ac130003';
const BLE_CHARACTERISTIC_UUID = 'e267751b-ae76-11eb-8529-0242ac130003';

// TELEGRAM CONFIG
const TELEGRAM_BOT_TOKEN = "7805125993:AAEwn_JivPsDbC5xKkISv7eM-pClH9bbkAQ";  
const TELEGRAM_CHAT_ID = "6286498044";      

// Connect to BLE device
async function connectToBLE() {
  try {
    console.log('Requesting Bluetooth Device...');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'GetFit BLE' }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    console.log('Connecting to GATT Server...');
    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    bleCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();
    bleCharacteristic.addEventListener('characteristicvaluechanged', handleBLEData);

    connectBtn.innerHTML = '<span class="btn-icon">✓</span> Connected';
    connectBtn.disabled = true;

    bleDevice.addEventListener('gattserverdisconnected', () => {
      console.log('Device disconnected');
      connectBtn.innerHTML = '<span class="btn-icon">🔗</span> Connect Device';
      connectBtn.disabled = false;
      bleDevice = null;
      bleCharacteristic = null;
    });

  } catch (error) {
    console.error('BLE connection failed:', error);
    alert('Failed to connect to device. Make sure Bluetooth is enabled and the device is nearby.');
  }
}

// Handle incoming BLE data
function handleBLEData(event) {
  const value = new TextDecoder().decode(event.target.value);
  try {
    const data = JSON.parse(value);
    console.log('Received BLE data:', data);
    updateDashboard(data);

    if (data.fall && canTriggerEmergency()) {
      emergencyActive = true;
      notifyUser('🚨 EMERGENCY: Fall detected!');
      handleEmergency();
      recordAlertTimestamp();
    }
  } catch (error) {
    console.error('Failed to parse BLE data:', error);
  }
}

// Check if emergency alert can be triggered (throttling)
function canTriggerEmergency() {
  const now = Date.now();
  // Remove timestamps older than 20 sec
  alertTimestamps = alertTimestamps.filter(ts => now - ts < 20000);
  return alertTimestamps.length < 3 && !emergencyActive;
}

// Record timestamp of triggered alert
function recordAlertTimestamp() {
  alertTimestamps.push(Date.now());
}

// Initialize caregiver settings
function initializeCaregiverSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const caregiverForm = document.getElementById('caregiver-form');

  if (!settingsBtn) return;

  if (caregiverData) {
    document.getElementById('caregiver-name').value = caregiverData.name || '';
    document.getElementById('caregiver-phone').value = caregiverData.phone || '';
    document.getElementById('caregiver-email').value = caregiverData.email || '';
  }

  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  settingsClose.addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  caregiverForm.addEventListener('submit', (e) => {
    e.preventDefault();
    caregiverData = {
      name: document.getElementById('caregiver-name').value,
      phone: document.getElementById('caregiver-phone').value,
      email: document.getElementById('caregiver-email').value
    };
    localStorage.setItem('caregiverData', JSON.stringify(caregiverData));
    settingsModal.classList.add('hidden');
    alert('Caregiver information saved!');
  });
}

// Send Telegram alert
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
      })
    });
    console.log("✅ Telegram alert sent:", await response.json());
  } catch (err) {
    console.error("❌ Telegram send failed:", err);
  }
}

// Handle emergency with 7-sec cancel timer
async function handleEmergency() {
  const emergencyModal = document.getElementById('emergency-modal');
  const emergencyContent = document.getElementById('emergency-content');
  emergencyModal.classList.remove('hidden');

  if (!caregiverData) {
    emergencyContent.innerHTML = `
      <p>⚠️ No caregiver configured!</p>
      <button class="emergency-btn" onclick="document.getElementById('settings-modal').classList.remove('hidden'); document.getElementById('emergency-modal').classList.add('hidden'); emergencyActive=false;">Setup Caregiver</button>
    `;
    return;
  }

  let locationText = 'Location unavailable';
  let mapsUrl = '';
  try {
    const position = await getCurrentLocation();
    locationText = `Lat: ${position.coords.latitude}, Lng: ${position.coords.longitude}`;
    mapsUrl = `https://maps.google.com/maps?q=${position.coords.latitude},${position.coords.longitude}`;
  } catch {}

  // 7-sec cancel timer
  let countdown = 7;
  emergencyContent.innerHTML = `
    <p><strong>🚨 FALL DETECTED!</strong></p>
    <p>Caregiver: ${caregiverData.name}</p>
    <div class="location-info">
      <strong>Location:</strong> ${locationText}<br>
      ${mapsUrl ? `<a href="${mapsUrl}" target="_blank">View on Maps</a>` : '' }
    </div>
    <p id="cancel-timer">Sending alert in ${countdown} seconds...</p>
    <button class="emergency-btn" onclick="cancelEmergency()">Cancel Alert</button>
  `;

  const timerInterval = setInterval(() => {
    countdown--;
    document.getElementById('cancel-timer').textContent = `Sending alert in ${countdown} seconds...`;
    if (countdown <= 0) {
      clearInterval(timerInterval);
      sendAllAlerts(locationText, mapsUrl);
      emergencyContent.innerHTML += `<p>✅ Alerts sent!</p>`;
      setTimeout(() => { emergencyModal.classList.add('hidden'); emergencyActive=false; }, 5000);
    }
  }, 1000);
}

// Cancel emergency
function cancelEmergency() {
  const emergencyModal = document.getElementById('emergency-modal');
  emergencyModal.classList.add('hidden');
  emergencyActive = false;
  console.log('Emergency alert cancelled by user.');
}

// Send SMS / WhatsApp / Email / Telegram
function sendAllAlerts(location, mapsUrl) {
  if (!caregiverData) return;

  const smsMsg = `🚨 EMERGENCY: Fall detected! Location: ${location} ${mapsUrl}`;
  const whatsappMsg = `🚨 EMERGENCY ALERT 🚨\nFall detected!\nLocation: ${location}\nMaps: ${mapsUrl}`;
  const emailSubject = '🚨 EMERGENCY: Fall Detected';
  const emailBody = `Fall detected!\n\nLocation: ${location}\nMaps: ${mapsUrl}`;

  // SMS
  if (caregiverData.phone) window.location.href = `sms:${caregiverData.phone}?body=${encodeURIComponent(smsMsg)}`;

  // WhatsApp
  if (caregiverData.phone) window.open(`https://wa.me/${caregiverData.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(whatsappMsg)}`, '_blank');

  // Email
  if (caregiverData.email) window.open(`mailto:${caregiverData.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`);

  // Telegram
  sendTelegramAlert(`🚨 <b>EMERGENCY ALERT!</b>\nFall detected!\nCaregiver: ${caregiverData.name}\n${location}\n${mapsUrl}`);
}

// Get current location
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

// Notifications
async function notifyUser(message) {
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') new Notification('Vital Band Alert', { body: message });
}

// Update dashboard
function updateDashboard({ steps, heartRate, fall, lat, lng }) {
  const stepsEl = document.getElementById('steps');
  const heartRateEl = document.getElementById('heart-rate');
  const fallAlertEl = document.getElementById('fall-alert');

  if (stepsEl) stepsEl.textContent = `Steps: ${steps || 0}`;
  if (heartRateEl) heartRateEl.textContent = `BPM: ${heartRate || 0}`;
  if (fallAlertEl) fallAlertEl.textContent = fall ? 'Fall detected!' : 'All good';

  currentData = { heartRate, steps, fall, lat, lng };
}

document.addEventListener('DOMContentLoaded', () => {
  initializeCaregiverSettings();
  if (!navigator.bluetooth) {
    connectBtn.textContent = 'Bluetooth not supported';
    connectBtn.disabled = true;
    alert('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Safari.');
  }
});

connectBtn.addEventListener('click', connectToBLE);
