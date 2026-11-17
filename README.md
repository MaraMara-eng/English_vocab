# Vocab Quest - Trilingual Vocabulary Learning Studio

Vocab Quest is a modern, high-performance, offline-first Progressive Web App (PWA) designed for mastering English vocabulary with translations and explanations in Armenian and Russian. Built with React, TypeScript, Tailwind CSS, and IndexedDB, it delivers a seamless, native-like educational experience across mobile devices, tablets, and desktop computers.

---

## Key Features

1. **Trilingual Support**: English vocabulary items paired with Armenian and Russian translations, definitions, and example sentences.
2. **User Authentication & Isolation**: Secure local user registration and login with PBKDF2-derived salted password hashing, role-based permissions (Teacher / Student), and strict multi-user data isolation in IndexedDB.
3. **Textbook & Lesson Management**: Organize vocabulary hierarchically by books and chapters/lessons.
4. **Interactive Learning Modes**:
   - Flashcards with audio pronunciation and difficulty rating (Again, Hard, Good, Easy).
   - Quizzes with instant feedback and incorrect-answer explanations.
   - Spelling Practice & Matching Games.
5. **Word Status Management & Resets**: Mark words as known/unknown, reset individual word statuses, reset lesson progress, book progress, or full account progress with explicit confirmations.
6. **Learning Dashboard & Statistics**: Real-time stats showing total words, known words, unknown words, progress percentage, completed lessons, progress by book, practice accuracy, failed words count, and learning streaks.
7. **Lesson Completion & PDF Reports**: Track lesson completion (100% known words), view detailed reports for individual lessons or entire books, and generate printable/downloadable PDF reports with full Armenian and Russian character support.
8. **Data Backup & Restoration**: Export encrypted or structured JSON backups of account progress and restore them anytime.
9. **Progressive Web App (PWA)**: Installable on iOS, Android, macOS, and Windows with offline support powered by a service worker and IndexedDB caching.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Storage**: IndexedDB (Local-first, zero cloud dependencies)
- **Build Tool**: Vite
- **PWA**: Web App Manifest, Service Worker (`sw.js`)

---

## Setup & Local Development

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or bun

### Installation
1. Clone or download the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally in Development Mode
Start the Vite development server on port 3000:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:3000`.

---

## Production Build & Preview

To build the application for production:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

---

## Serving over HTTPS for Mobile PWA Installation

Browsers require a secure context (HTTPS or `localhost`) to enable PWA installation and service worker registration on mobile devices.

- **Local Development**: When running `npm run dev` on `localhost:3000`, browsers treat it as a secure context, allowing immediate installation.
- **Production Hosting**: Deploy the `dist/` build folder to any static hosting provider supporting HTTPS (e.g., Vercel, Netlify, GitHub Pages, Firebase Hosting, or an internal Nginx/Apache server with TLS certificates).

---

## Installing as a Progressive Web App (PWA)

### iOS (Safari)
1. Open the app URL in Safari on your iPhone or iPad.
2. Tap the **Share** button in the browser toolbar.
3. Scroll down and tap **"Add to Home Screen"**.
4. Confirm the app name and tap **Add**. Vocab Quest will appear on your home screen as a standalone app.

### Android (Chrome)
1. Open the app URL in Chrome on your Android device.
2. Tap the three-dot menu icon in the top right.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. Follow the prompt to install. The app will be added to your app drawer.

### Desktop (Chrome / Edge / Safari / Firefox)
1. Open the app URL in your desktop browser.
2. Click the install icon (a monitor with a down arrow or a plus badge) in the right side of the address bar, or open the browser menu and select **"Install Vocab Quest..."**.
3. Confirm installation. The app will launch in its own dedicated standalone window.

---

## Data Export & Restoration

Vocab Quest stores all user data locally in your browser's IndexedDB database.
- **Export Backup**: Navigate to your **Account** view in the application and click **"Export Data Backup"** to download a JSON file containing your learning progress and word statuses.
- **Restore Backup**: In the **Account** view, select your backup JSON file and click **"Restore Backup"** to load your progress onto the current device.

---

## Offline Operation

Once loaded and cached via the service worker, Vocab Quest works fully offline without an internet connection. All study sessions, word status updates, and statistics calculations are performed locally in IndexedDB and synchronize automatically when connectivity is restored.
