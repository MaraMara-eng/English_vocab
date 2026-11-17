# Vocab Quest - Standalone, Offline & Cross-Platform Guide

Vocab Quest is designed from the ground up to be **100% independent of AI Studio**, featuring a **built-in local database (IndexedDB)** and full **Progressive Web App (PWA)** capabilities. You can run, install, and use Vocab Quest completely offline across **iOS, Android, macOS, Windows, Linux, and all cross-browser environments** with zero external cloud servers or API dependencies.

---

## 1. Zero AI Studio Dependency & Built-In Database

- **No Cloud Backend Required**: All user accounts, authentication (salted PBKDF2 password hashing), textbooks, lessons, vocabulary words, flashcard history, quiz scores, and failed word records are stored **locally on your device** using browser **IndexedDB** and **LocalStorage**.
- **Complete Data Privacy**: Your data never leaves your device unless you explicitly export or import a JSON backup file.
- **Multi-User Isolation**: Multiple users can securely share the same device or browser with zero cross-user data leakage.

---

## 2. Installing as a Standalone App (Cross-Platform)

You can install Vocab Quest as a native-feeling standalone application on any operating system:

### 📱 iOS (iPhone & iPad)
1. Open Vocab Quest in **Safari**.
2. Tap the **Share** button (square with an upward arrow) in the Safari toolbar.
3. Scroll down and tap **"Add to Home Screen"**.
4. Confirm the name and tap **Add**. Vocab Quest will appear on your home screen with its own app icon and launch in full-screen standalone mode without browser UI.

### 🤖 Android (Smartphones & Tablets)
1. Open Vocab Quest in **Google Chrome** or **Samsung Internet**.
2. Tap the menu icon (three vertical dots) in the top right.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. Confirm installation. The app will be added to your app drawer and home screen.

### 💻 Windows & macOS & Linux (Desktop Browsers)
1. Open Vocab Quest in **Google Chrome**, **Microsoft Edge**, or **Brave**.
2. Click the **Install** icon (a monitor with a download arrow or plus badge) in the right side of the address bar, or click the browser menu and select **"Install Vocab Quest..."**.
3. Click **Install**. The app will launch in its own dedicated window and pin itself to your desktop taskbar, dock, or applications menu.

---

## 3. Running Vocab Quest Locally & Offline (Self-Hosted)

If you want to run Vocab Quest locally on your computer or host it on your own private server (Home server, Raspberry Pi, internal network, or static web host):

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm (comes with Node.js) or bun

### Step-by-Step Local Setup
1. **Download or Clone** the Vocab Quest project repository to your computer.
2. Open a terminal in the project root directory and install dependencies:
   ```bash
   npm install
   ```
3. **Run in Development Mode** (with hot reloading on port 3000):
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in any browser.

4. **Build for Production** (generates a high-performance static bundle in the `/dist` folder):
   ```bash
   npm run build
   ```

5. **Serve the Production Build Locally**:
   You can serve the `/dist` folder using any static web server (e.g., `npx serve dist`, Python's `http.server`, Nginx, Apache, or Caddy):
   ```bash
   npx serve dist -l 3000
   ```

---

## 4. Hosting on Free Static Cloud Providers

Because Vocab Quest builds into standard static HTML, CSS, and JavaScript files (`/dist`), you can host your own permanent instance for free on any static cloud hosting provider:
- **Vercel** (`npx vercel`)
- **Netlify** (drag and drop the `dist/` folder)
- **GitHub Pages** (deploy via GitHub Actions)
- **Cloudflare Pages**
- **Firebase Hosting**

Once hosted on any HTTPS URL, the Service Worker (`sw.js`) automatically caches all assets, enabling 100% offline functionality across all your devices.

---

## 5. Data Backup & Migration

- **Export Backup**: Go to **Account & Settings** in Vocab Quest and click **"Export My Data Backup (.json)"** to download a complete backup of all your progress and textbooks.
- **Restore Backup**: On any other device or browser, open your exported JSON file using **"Restore Data Backup"** in the Account view to instantly sync all your progress.
