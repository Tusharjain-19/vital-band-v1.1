// VITAL SAFE SECURE CONFIGURATION (.env equivalent for static JS)
// ------------------------------------------------------------------
// IMPORTANT: This file is ignored by Git, meaning it will NEVER be uploaded to GitHub.
// This is how you securely store keys in a frontend-only application without a server. 
// Do NOT share this file with anyone.

window.VITAL_ENV = {
    // 1. Telegram Alert Configuration
    TG_TOKEN: "YOUR_TELEGRAM_BOT_TOKEN_HERE",
    TG_CHAT_ID: "YOUR_TELEGRAM_CHAT_ID_HERE",
    
    // 2. Groq AI Configuration (LLaMA 3)
    GROQ_API_KEY: "YOUR_GROQ_API_KEY_HERE"
};
