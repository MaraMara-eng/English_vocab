# Vocab Quest - macOS Installation Guide

Vocab Quest is fully optimized for **macOS** (Apple Silicon M1/M2/M3/M4 and Intel Macs). Because it is built as a high-performance Progressive Web App (PWA) with a built-in IndexedDB database, you can install it as a **native macOS application** on your Mac in seconds—complete with a dedicated Dock icon, offline mode, and separate app window.

---

## Method 1: Install as a Native macOS App via Google Chrome or Microsoft Edge (Recommended)

This is the cleanest and easiest way to get a dedicated Vocab Quest app on your Mac Dock without any bloat:

1. Open **Google Chrome**, **Microsoft Edge**, or **Brave** on your Mac and go to the app URL.
2. Look at the right side of your browser address bar. Click the **Install icon** (a computer monitor with a download arrow or plus symbol `[+]`), or click the browser menu (three dots `⋮`) and select **"Install Vocab Quest..."**.
3. Click **Install**.
4. **Result**: 
   - Vocab Quest will immediately launch in its own clean, borderless macOS application window.
   - A dedicated Vocab Quest app icon will be added to your **macOS Applications folder** and **Dock**.
   - You can right-click the icon in your Dock and select **"Keep in Dock"** so it's always accessible with one click, even when offline.

---

## Method 2: Create a Desktop Shortcut on macOS via Safari

If you prefer using Apple **Safari** on macOS:

1. Open Vocab Quest in **Safari**.
2. Click **File** in the top macOS menu bar -> **Add to Dock** (or drag the URL from the address bar onto your Desktop to create a direct shortcut).
3. The app will open in a dedicated web app profile.

---

## Method 3: Run Locally & Offline on macOS (Self-Hosted)

If you want to run Vocab Quest 100% locally on your Mac without relying on the cloud:

1. Open your Mac **Terminal**.
2. Navigate to the project folder and install dependencies:
   ```bash
   npm install
   ```
3. Build the production app bundle:
   ```bash
   npm run build
   ```
4. Start the local server:
   ```bash
   npx serve dist -l 3000
   ```
5. Open `http://localhost:3000` in Chrome or Safari on your Mac and click **Install App**.

---

## Data & Database Storage on macOS
- All your vocabulary words, flashcard progress, user accounts, and test history are stored locally in your Mac's browser storage (**IndexedDB**).
- You can export and import JSON backups anytime from the **Account & Settings** view.
