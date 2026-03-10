# 🏃‍♂️ BLE Health Monitor

A modern web-based health monitoring dashboard that connects to ESP32 wearable devices via Bluetooth Low Energy (BLE). Features real-time health tracking with an AI-powered chatbot assistant.

## ✨ Features

### 📊 **Health Monitoring**

- **Step Counter** - Track daily steps using MPU6050 accelerometer
- **Heart Rate** - Real-time BPM monitoring via MAX30102/MAX30100 sensor
- **Fall Detection** - Automatic fall detection with 7-second status window
- **Live Updates** - Real-time data via Web Bluetooth API

### 🤖 **Smart Assistant**

- **AI Chatbot** - Powered by Hugging Face Mixtral model
- **Health Insights** - Ask questions like "Is my heart rate normal?"
- **Context-Aware** - Uses your live health data for personalized responses
- **Demo Mode** - Works offline with smart fallback responses

### 🎨 **Mobile-First UI**

- **Mobile Dedicated** - Optimized specifically for smartphones.
- **Modern Design** - Inspired by high-end apps like Zomato, Instagram, and Uber.
- **Sticky Navigation** - Smooth bottom navigation for easy one-handed use.
- **Glassmorphism & Gradients** - Premium visual elements with functional shadows.
- **Rounded Components** - Modern card-based layout with rounded corners.
- **Desktop Restriction** - Smart overlay for desktop users to ensure mobile experience.

## 🚀 How to Use

### 1. **Prepare ESP32 Device**

- Upload compatible firmware that broadcasts health data over BLE
- Ensure device name is set to "GetFit BLE" or use `acceptAllDevices` mode
- Required BLE service: `e267751a-ae76-11eb-8529-0242ac130003`

### 2. **Open Web App**

- Visit the GitHub Pages URL or run locally
- No installation required - runs entirely in your browser
- Works offline once loaded (except for AI chatbot)

### 3. **Connect Device**

- Tap **"Connect Device"** button
- Select your ESP32 from the Bluetooth pairing dialog
- Dashboard will start showing live health data

### 4. **Use AI Assistant**

- Click the 🤖 icon in bottom-right corner
- Ask health questions like:
  - "How's my heart rate?"
  - "Am I walking enough today?"
  - "Is my activity level good?"

## 🛠️ Technical Details

### **Frontend Stack**

- **HTML5** - Semantic structure
- **CSS3** - Modern dark theme with animations
- **Vanilla JavaScript** - Web Bluetooth API integration
- **Service Worker** - Offline support and notifications

### **BLE Integration**

- **Web Bluetooth API** - Direct browser-to-device connection
- **No backend required** - Fully client-side application
- **Real-time streaming** - JSON data every 1-2 seconds
- **Auto-reconnection** - Handles device disconnects gracefully

### **AI Features**

- **Hugging Face API** - Mixtral-8x7B-Instruct model
- **Context-aware responses** - Uses live health metrics
- **Fallback mode** - Smart demo responses when offline
- **Privacy-focused** - No data stored on servers

## 📱 Device Compatibility

### **Browsers**

- ✅ Chrome/Edge (Android & Desktop)
- ✅ Safari (iOS 16+)
- ❌ Firefox (Web Bluetooth not supported)

### **Hardware**

- **ESP32** with BLE capability
- **MPU6050** - Accelerometer for steps and fall detection
- **MAX30102/MAX30100** - Heart rate sensor
- **Custom firmware** broadcasting JSON health data

## 🔧 Development

### **Local Setup**

```bash
# Clone repository
git clone https://github.com/yourusername/ble-health-monitor.git

# Serve locally (required for BLE)
python -m http.server 8000
# or
npx serve .

# Open https://localhost:8000
```

### **File Structure**

```
├── index.html          # Main dashboard
├── style.css           # Dark theme styles
├── script.js           # BLE + AI integration
├── sw.js              # Service worker
└── README.md          # This file
```

## 🎯 Data Format

The ESP32 should broadcast JSON data via BLE characteristic:

```json
{
  "steps": 5432,
  "heartRate": 78,
  "fall": false
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with real ESP32 hardware
5. Submit a pull request
