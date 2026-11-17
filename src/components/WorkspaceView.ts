/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager } from '../db/indexedDB.ts';
import { AppSettings, Book, Lesson, User, VocabularyWord } from '../db/types.ts';
import { ValidationError } from '../db/validators.ts';
import { authService } from '../services/authService.ts';
import { sessionManager, UserSession } from '../services/sessionManager.ts';
import { lessonService } from '../services/lessonService.ts';
import { vocabularyService } from '../services/vocabularyService.ts';
import { BookManagementView } from './BookManagementView.ts';
import { BookSelectDropdown } from './BookSelectDropdown.ts';
import { LessonManagementView } from './LessonManagementView.ts';
import { VocabularyManagementView } from './VocabularyManagementView.ts';
import { GlobalSearchView } from './GlobalSearchView.ts';
import { LearningGamesHubView } from './LearningGamesHubView.ts';
import { FailedWordsView } from './FailedWordsView.ts';
import { DashboardView } from './DashboardView.ts';
import { bookService } from '../services/bookService.ts';

export interface WorkspaceViewProps {
  user: User;
  onLogout: () => void;
  onSwitchAccount?: (user: User) => void;
  onAccountDeleted?: (message: string) => void;
}

export class WorkspaceView {
  private container: HTMLElement;
  private props: WorkspaceViewProps;
  private settings: AppSettings | null = null;
  private session: UserSession | null = null;
  private allUsers: User[] = [];
  private activeTab: 'dashboard' | 'textbooks' | 'lessons' | 'vocabulary' | 'search' | 'review' | 'games' | 'account' = 'dashboard';
  private initialSearchQuery: string = '';
  private pendingHighlightWordId?: string;
  private deferredPrompt: any = null;
  private installGuideTab: 'desktop' | 'ios' | 'android' | 'offline' = 'desktop';

  // Book Selection state
  private bookDropdown: BookSelectDropdown | null = null;
  private currentBook: Book | null = null;
  private currentLessons: Lesson[] = [];
  private currentLessonId: string = '';
  private currentWords: VocabularyWord[] = [];
  private isLoadingWords: boolean = false;

  constructor(container: HTMLElement, props: WorkspaceViewProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.settings = await dbManager.getSettings(this.props.user.id);
      this.session = sessionManager.getCurrentSession();
      this.applyTheme(this.settings.theme);

      // Restore last selected lesson if stored
      try {
        const raw = localStorage.getItem('vq:sel:' + this.props.user.id);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.l) this.currentLessonId = parsed.l;
        }
      } catch {
        // Ignore
      }
      if (!this.currentLessonId && this.settings.selectedLesson) {
        this.currentLessonId = this.settings.selectedLesson;
      }

      await this.loadAllUsers();
    } catch (err) {
      console.warn('Could not load workspace data:', err);
    }

    // PWA Install Prompt Listener
    window.addEventListener('beforeinstallprompt', (e: any) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const headerInstallBtn = this.container.querySelector('#headerInstallBtn') as HTMLElement | null;
      if (headerInstallBtn) headerInstallBtn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      const headerInstallBtn = this.container.querySelector('#headerInstallBtn') as HTMLElement | null;
      if (headerInstallBtn) headerInstallBtn.style.display = 'none';
    });

    this.render();
  }

  private async loadAllUsers(): Promise<void> {
    try {
      this.allUsers = await dbManager.query<User>('users', {});
      this.allUsers.sort((a, b) => a.username.localeCompare(b.username));
    } catch {
      this.allUsers = [this.props.user];
    }
  }

  private applyTheme(theme: string): void {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  private updateLessonsSelect(): void {
    const lessonSel = this.container.querySelector('#headerLessonSel') as HTMLSelectElement | null;
    if (!lessonSel) return;

    const totalCount = this.currentLessons.length;
    let html = `<option value="">(All Lessons / ${totalCount} ${totalCount === 1 ? 'unit' : 'units'})</option>`;

    this.currentLessons.forEach((l) => {
      const isSelected = l.lessonNumber === this.currentLessonId || l.id === this.currentLessonId;
      html += `<option value="${l.lessonNumber}" ${isSelected ? 'selected' : ''}>${l.name || 'Lesson ' + l.lessonNumber}</option>`;
    });

    lessonSel.innerHTML = html;
  }

  private async loadCurrentWords(): Promise<void> {
    if (!this.currentBook) {
      this.currentWords = [];
      return;
    }
    this.isLoadingWords = true;
    try {
      this.currentWords = await vocabularyService.getWordsForBookAndLesson(
        this.props.user.id,
        this.currentBook.id,
        this.currentLessonId
      );
    } catch (err) {
      console.warn('Could not load vocabulary words:', err);
      this.currentWords = [];
    } finally {
      this.isLoadingWords = false;
      const vocabMount = this.container.querySelector('#vocabMountPoint');
      if (vocabMount) {
        vocabMount.innerHTML = this.renderVocabularyList();
      }
    }
  }

  private renderVocabularyList(): string {
    if (!this.currentBook) {
      return `
        <div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📖</div>
          <p style="margin: 0; font-weight: 600;">Please select a textbook first.</p>
        </div>
      `;
    }

    if (this.isLoadingWords) {
      return `
        <div class="card" style="text-align: center; padding: 36px; color: var(--mu);">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">⏳</div>
          <p style="margin: 0;">Loading vocabulary words...</p>
        </div>
      `;
    }

    const lessonName = this.currentLessonId
      ? this.currentLessons.find((l) => l.lessonNumber === this.currentLessonId)?.name ||
        `Lesson ${this.currentLessonId}`
      : 'All Lessons';

    return `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card" style="margin-bottom: 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.3rem;">📝</span>
              <h3 style="margin: 0; font-size: 1.25rem;">
                Vocabulary Words
              </h3>
              <span class="chip ok" style="font-size: 0.72rem;">
                ${this.currentWords.length} ${this.currentWords.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
              Showing vocabulary for <strong>${this.currentBook.name}</strong> • <em>${lessonName}</em>
            </p>
          </div>

          <div style="display: flex; gap: 8px;">
            ${
              this.currentLessonId
                ? `<button id="clearLessonFilterBtn" class="sm" style="font-size: 0.8rem;">
                    Show All Lessons
                  </button>`
                : ''
            }
          </div>
        </div>

        ${
          this.currentWords.length === 0
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
                <p style="margin: 0 0 6px; font-weight: 600; font-size: 1.05rem;">No vocabulary entries found</p>
                <p style="margin: 0; font-size: 0.85rem;">
                  ${
                    this.currentLessonId
                      ? `There are no words recorded for ${lessonName} yet.`
                      : 'This textbook has no vocabulary words yet.'
                  }
                </p>
              </div>`
            : `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px;">
                ${this.currentWords
                  .map(
                    (w) => `
                  <div class="card" style="margin-bottom: 0; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; border-left: 3px solid var(--ac);">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 6px;">
                        <span style="font-weight: 700; font-size: 1.1rem; color: var(--tx);">
                          ${w.en}
                        </span>
                        <span class="chip" style="font-size: 0.65rem; text-transform: uppercase;">
                          ${w.type}
                        </span>
                      </div>

                      <div style="display: grid; gap: 4px; font-size: 0.88rem; margin-top: 6px;">
                        ${w.hy ? `<div style="color: var(--tx);"><span style="color: var(--mu); font-size: 0.75rem;">HY:</span> ${w.hy}</div>` : ''}
                        ${w.ru ? `<div style="color: var(--mu);"><span style="color: var(--mu); font-size: 0.75rem;">RU:</span> ${w.ru}</div>` : ''}
                        ${(w.note || w.hint) ? `<div style="color: var(--ac); font-size: 0.8rem; margin-top: 2px;">💡 ${w.note || w.hint}</div>` : ''}
                      </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--ln); font-size: 0.72rem; color: var(--mu);">
                      <span>Unit: ${w.lesson || 'General'}</span>
                      ${(w.sourcePage || w.page) ? `<span>p. ${w.sourcePage || w.page}</span>` : ''}
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;
  }

  private render(): void {
    const { user } = this.props;
    const isTeacher = user.role === 'teacher';
    const roleEmoji = isTeacher ? '👑' : '👤';
    const createdStr = new Date(user.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const expiresStr = this.session
      ? new Date(this.session.expiresAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Active';

    this.container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column;">
        <!-- Top Navigation Bar -->
        <header style="position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--ln); padding: 10px 20px;">
          <div style="max-width: 1000px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.5rem;">📖</span>
              <span style="font-weight: 800; font-size: 1.25rem; background: linear-gradient(135deg, var(--ac), var(--ac2)); -webkit-background-clip: text; background-clip: text; color: transparent;">
                Vocab Quest
              </span>
              <span class="chip ${isTeacher ? 'wn' : 'ok'}" style="margin-left: 6px;">
                ${roleEmoji} ${user.role}
              </span>
            </div>

            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="chip" style="font-size: 0.85rem;">
                ${user.username}
              </span>
              <button id="headerQuickSearchBtn" class="sm" title="Global vocabulary search (Ctrl+K / ⌘K)" style="display: flex; align-items: center; gap: 5px;">
                <span>🔍</span> <span>Search</span>
              </button>
              <button id="headerInstallBtn" class="sm" title="Install Vocab Quest App" style="display: none; align-items: center; gap: 5px; background: color-mix(in srgb, var(--ac) 15%, var(--sf)); color: var(--ac); border-color: var(--ac);">
                <span>📱</span> <span>Install App</span>
              </button>
              <button id="themeToggleBtn" class="sm" title="Toggle Theme">
                ${this.settings?.theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
              <button id="logoutBtn" class="sm" style="border-color: var(--no); color: var(--no);">
                Log out
              </button>
            </div>
          </div>

          <!-- Books & Lessons Selector Bar -->
          <div style="max-width: 1000px; margin: 10px auto 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 220px; max-width: 380px;" id="headerBookDropdownMount"></div>
            <div style="flex: 1; min-width: 180px; max-width: 300px;">
              <select id="headerLessonSel" style="width: 100%; padding: 8px 12px; font-size: 0.88rem; border-radius: 12px;">
                <option value="">(Loading lessons…)</option>
              </select>
            </div>
          </div>

          <!-- Section Navigation Tabs -->
          <nav class="tabs" style="max-width: 1000px; margin: 12px auto 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap;">
            <button id="navTabDashboard" class="${this.activeTab === 'dashboard' ? 'on' : ''}">
              📊 Dashboard
            </button>
            <button id="navTabTextbooks" class="${this.activeTab === 'textbooks' ? 'on' : ''}">
              📚 Textbooks
            </button>
            <button id="navTabLessons" class="${this.activeTab === 'lessons' ? 'on' : ''}">
              📑 Lessons (${this.currentLessons.length})
            </button>
            <button id="navTabVocabulary" class="${this.activeTab === 'vocabulary' ? 'on' : ''}">
              📝 Vocabulary
            </button>
            <button id="navTabSearch" class="${this.activeTab === 'search' ? 'on' : ''}">
              🔍 Search
            </button>
            <button id="navTabReview" class="${this.activeTab === 'review' ? 'on' : ''}">
              ⚠️ Review
            </button>
            <button id="navTabGames" class="${this.activeTab === 'games' ? 'on' : ''}">
              🎮 Games
            </button>
            <button id="navTabAccount" class="${this.activeTab === 'account' ? 'on' : ''}">
              ⚙️ Account & Settings
            </button>
          </nav>
        </header>

        <!-- Main Workspace Content -->
        <main style="max-width: 1000px; margin: 0 auto; padding: 24px 20px 60px; width: 100%; flex: 1;">
          <!-- Welcome Banner -->
          <div class="card" style="margin-bottom: 20px; background: linear-gradient(135deg, color-mix(in srgb, var(--ac) 8%, var(--sf)), var(--sf));">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="margin: 0 0 6px; font-size: 1.4rem;">
                  Welcome to your workspace, ${user.username}!
                </h2>
                <p style="margin: 0; color: var(--mu); font-size: 0.9rem;">
                  Your independent local environment is active and securely persisted in IndexedDB.
                </p>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                <span class="chip ok" style="padding: 6px 12px; font-size: 0.8rem;">
                  🔒 Active Session Verified
                </span>
                <span style="font-size: 0.75rem; color: var(--mu);">
                  Session valid until: ${expiresStr}
                </span>
              </div>
            </div>
          </div>

          <!-- Tab Content Panels -->
          ${
            this.activeTab === 'dashboard'
              ? `<div id="dashboardMountPoint"></div>`
              : this.activeTab === 'textbooks'
              ? `<div id="textbooksMountPoint"></div>`
              : this.activeTab === 'lessons'
              ? `<div id="lessonsMountPoint"></div>`
              : this.activeTab === 'vocabulary'
              ? `<div id="vocabMountPoint"></div>`
              : this.activeTab === 'search'
              ? `<div id="searchMountPoint"></div>`
              : this.activeTab === 'review'
              ? `<div id="reviewMountPoint"></div>`
              : this.activeTab === 'games'
              ? `<div id="gamesMountPoint"></div>`
              : `
              <!-- Account & Settings Tab Content -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; margin-bottom: 24px;">
                <!-- Account Details Card -->
                <div class="card">
                  <h3 style="margin: 0 0 14px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>👤</span> Account Information & Settings
                  </h3>
                  <div style="display: grid; gap: 10px; font-size: 0.9rem;">
                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--ln);">
                      <span style="color: var(--mu);">Username:</span>
                      <span style="font-weight: 600;">${user.username}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--ln);">
                      <span style="color: var(--mu);">Email:</span>
                      <span>${user.email || '<em style="color: var(--mu);">Not provided</em>'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--ln);">
                      <span style="color: var(--mu);">Role:</span>
                      <span class="chip ${isTeacher ? 'wn' : 'ok'}">${roleEmoji} ${user.role}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--ln);">
                      <span style="color: var(--mu);">Account Created:</span>
                      <span>${createdStr}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: var(--mu);">Isolated Workspace ID:</span>
                      <code style="font-size: 0.75rem; background: var(--ln); padding: 2px 6px; border-radius: 6px;">${user.id}</code>
                    </div>

                    <!-- Delete Account Option -->
                    <div style="margin-top: 6px; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                      <div>
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--no);">Delete Account</div>
                        <div style="font-size: 0.75rem; color: var(--mu);">Permanently erase your account and all data</div>
                      </div>
                      <button id="openDeleteAccountModalBtn" class="sm" style="color: var(--no); border-color: var(--no); font-weight: 600;">
                        Delete Account…
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Workspace Storage & Backup Card -->
                <div class="card">
                  <h3 style="margin: 0 0 14px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>💾</span> Local Data & Backup
                  </h3>
                  <p style="margin: 0 0 14px; font-size: 0.85rem; color: var(--mu); line-height: 1.4;">
                    All your learning history, book progress, failed words list, and preferences are strictly isolated to your user ID in browser storage.
                  </p>
                  <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button id="exportBackupBtn" class="sm" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                      <span>📥</span> Export My Data Backup (.json)
                    </button>
                    <label style="display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--ln); border-radius: 12px; padding: 8px; cursor: pointer; font-size: 0.85rem; color: var(--mu);">
                      <span>📤</span> Restore Data Backup
                      <input type="file" id="importBackupInput" accept=".json,application/json" style="display: none;" />
                    </label>
                    <div id="backupFeedback" class="chip ok" style="display: none; justify-content: center;"></div>
                  </div>
                </div>

                <!-- Install App & PWA Guide Card -->
                <div class="card">
                  <h3 style="margin: 0 0 14px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>📱</span> Standalone App, Offline & Cross-Platform
                  </h3>
                  <p style="margin: 0 0 14px; font-size: 0.85rem; color: var(--mu); line-height: 1.4;">
                    100% independent of AI Studio with a built-in IndexedDB database. Works offline and installable on iOS, Android, macOS, Windows & cross-browser.
                  </p>
                  <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button id="cardInstallBtn" class="p" style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600;">
                      <span>📲</span> Install App Now
                    </button>
                    <button id="openInstallGuideBtn" class="sm" style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                      <span>📖</span> View Standalone Installation Guide
                    </button>
                  </div>
                </div>
              </div>

              <!-- Accounts & Multi-User Management -->
              <div class="card" style="margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                  <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>👥</span> Local Accounts & Workspace Switcher
                  </h3>
                  <span class="chip" style="font-size: 0.75rem;">
                    ${this.allUsers.length} local ${this.allUsers.length === 1 ? 'account' : 'accounts'}
                  </span>
                </div>
                <p style="margin: 0 0 14px; font-size: 0.85rem; color: var(--mu);">
                  Switching accounts instantly purges all in-memory caches and re-scopes the session to the selected user, preventing any cross-user data leakage.
                </p>

                <div id="usersListContainer" style="display: flex; flex-direction: column; gap: 8px;">
                  ${this.allUsers
                    .map((u) => {
                      const isCurrent = u.id === user.id;
                      const isUserTeacher = u.role === 'teacher';
                      return `
                      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--ln); background: ${isCurrent ? 'color-mix(in srgb, var(--ac) 6%, var(--sf))' : 'var(--sf)'};">
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <span style="font-size: 1.1rem;">${isUserTeacher ? '👑' : '👤'}</span>
                          <div>
                            <div style="font-weight: 600; font-size: 0.95rem;">
                              ${u.username}
                              ${isCurrent ? '<span class="chip ok" style="margin-left: 6px; font-size: 0.7rem;">Active (You)</span>' : ''}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--mu);">
                              ${u.email ? u.email + ' • ' : ''}Role: ${u.role}
                            </div>
                          </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                          ${
                            !isCurrent
                              ? `<button class="sm" data-switch-user="${u.id}" title="Switch to this account">
                                  Switch
                                </button>`
                              : ''
                          }
                          ${
                            isTeacher && !isCurrent
                              ? `<button class="sm" data-toggle-role="${u.id}" title="Toggle between Teacher and Student role">
                                  ${isUserTeacher ? 'Make student' : 'Make teacher'}
                                </button>
                                <button class="sm" data-delete-user="${u.id}" style="color: var(--no); border-color: var(--no);" title="Delete student account">
                                  Delete
                                </button>`
                              : ''
                          }
                        </div>
                      </div>
                    `;
                    })
                    .join('')}
                </div>
              </div>
              `
          }
        </main>

        <!-- Delete Account Confirmation Modal -->
        <div id="deleteAccountModal" class="modal" style="display: none;">
          <div class="box">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
              <div style="font-size: 2rem;">⚠️</div>
              <div>
                <h3 style="margin: 0; font-size: 1.3rem; color: var(--no);">Delete Account Permanently</h3>
                <p style="margin: 2px 0 0; font-size: 0.85rem; color: var(--mu);">
                  Account: <strong>${user.username}</strong>
                </p>
              </div>
            </div>

            <!-- Clear Warning Banner -->
            <div class="chip no" style="display: block; width: 100%; border-radius: 14px; padding: 14px; font-size: 0.85rem; line-height: 1.5; margin-bottom: 18px;">
              <strong style="display: block; margin-bottom: 4px; font-size: 0.9rem;">
                Warning: This action is permanent and cannot be undone!
              </strong>
              Deleting your account will permanently destroy all your vocabulary words, practice streaks, custom textbooks, learning session records, failed words list, and saved application settings.
            </div>

            <form id="deleteAccountForm" style="display: grid; gap: 14px;" novalidate>
              <label class="field-label">
                <span>Enter your password to confirm deletion <span class="req">*</span></span>
                <input
                  type="password"
                  id="deleteConfirmPassword"
                  placeholder="Your current password"
                  autocomplete="current-password"
                  required
                />
              </label>

              <div id="deleteAccountError" class="chip no" style="display: none; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.4;"></div>

              <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                <button type="button" id="cancelDeleteAccountBtn">Cancel</button>
                <button
                  type="submit"
                  id="confirmDeleteAccountBtn"
                  style="background: var(--no); color: #fff; border: 0; font-weight: 600; padding: 10px 18px; border-radius: 12px;"
                >
                  Permanently Delete My Account
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Install Guide Modal -->
        <div id="installGuideModal" class="modal" style="display: none; position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); place-items: center; padding: 16px;">
          <div class="box" style="background: var(--sf); border: 1px solid var(--ln); border-radius: 20px; padding: 24px; max-width: 520px; width: 100%; box-shadow: var(--sh);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.8rem;">🎬</span>
                <div>
                  <h3 style="margin: 0; font-size: 1.2rem;">Step-by-Step Installation Walkthrough</h3>
                  <p style="margin: 2px 0 0; font-size: 0.78rem; color: var(--mu);">100% offline & independent of AI Studio</p>
                </div>
              </div>
              <button id="closeInstallGuideBtn" class="sm" style="border: 0; background: transparent; font-size: 1.2rem;" title="Close">✕</button>
            </div>

            <!-- Device Tabs -->
            <div class="seg" style="display: flex; width: 100%; margin-bottom: 16px;">
              <button type="button" class="install-tab-btn ${this.installGuideTab === 'desktop' ? 'on' : ''}" data-tab="desktop" style="flex: 1; font-size: 0.8rem; padding: 7px 4px;">💻 Desktop</button>
              <button type="button" class="install-tab-btn ${this.installGuideTab === 'ios' ? 'on' : ''}" data-tab="ios" style="flex: 1; font-size: 0.8rem; padding: 7px 4px;">🍎 iOS</button>
              <button type="button" class="install-tab-btn ${this.installGuideTab === 'android' ? 'on' : ''}" data-tab="android" style="flex: 1; font-size: 0.8rem; padding: 7px 4px;">🤖 Android</button>
              <button type="button" class="install-tab-btn ${this.installGuideTab === 'offline' ? 'on' : ''}" data-tab="offline" style="flex: 1; font-size: 0.8rem; padding: 7px 4px;">💾 Offline DB</button>
            </div>

            <!-- Tab Content Area -->
            <div id="installGuideTabContent" style="display: grid; gap: 12px; font-size: 0.88rem; line-height: 1.5; min-height: 200px;">
              ${this.renderInstallGuideTabContent()}
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();

    // Mount header BookSelectDropdown
    const bookDropdownMount = this.container.querySelector('#headerBookDropdownMount') as HTMLElement | null;
    if (bookDropdownMount) {
      this.bookDropdown = new BookSelectDropdown(bookDropdownMount, {
        userId: this.props.user.id,
        selectedBookId: this.currentBook?.id || this.settings?.selectedBookId,
        onBookChange: (book, lessons) => {
          this.currentBook = book;
          this.currentLessons = lessons;
          this.updateLessonsSelect();
        },
        onCreateBookRequested: () => {
          this.activeTab = 'textbooks';
          this.render();
          const createBtn = this.container.querySelector('#openCreateBookBtn') as HTMLButtonElement | null;
          createBtn?.click();
        },
      });
    }

    // Mount BookManagementView if on textbooks tab
    if (this.activeTab === 'textbooks') {
      const mount = this.container.querySelector('#textbooksMountPoint') as HTMLElement | null;
      if (mount) {
        new BookManagementView(mount, {
          userId: this.props.user.id,
          onBookSelected: (book) => {
            if (this.bookDropdown) {
              this.bookDropdown.selectBookById(book.id);
            }
          },
        });
      }
    }

    // Mount LessonManagementView if on lessons tab
    if (this.activeTab === 'lessons' && this.currentBook) {
      const mount = this.container.querySelector('#lessonsMountPoint') as HTMLElement | null;
      if (mount) {
        new LessonManagementView(mount, {
          userId: this.props.user.id,
          book: this.currentBook,
          onLessonSelected: (lessonNumber) => {
            this.currentLessonId = lessonNumber;
            const sel = this.container.querySelector('#headerLessonSel') as HTMLSelectElement | null;
            if (sel) sel.value = lessonNumber;
            this.activeTab = 'vocabulary';
            this.render();
            this.loadCurrentWords();
          },
          onLessonsChanged: async () => {
            if (this.currentBook) {
              this.currentLessons = await lessonService.getLessonsForBook(this.currentBook.id, this.props.user.id);
              this.updateLessonsSelect();
              // Update tab counter in nav
              const navBtn = this.container.querySelector('#navTabLessons');
              if (navBtn) navBtn.textContent = `📑 Lessons (${this.currentLessons.length})`;
            }
          },
        });
      }
    }

    // Mount VocabularyManagementView if on vocabulary tab
    if (this.activeTab === 'vocabulary' && this.currentBook) {
      const mount = this.container.querySelector('#vocabMountPoint') as HTMLElement | null;
      if (mount) {
        new VocabularyManagementView(mount, {
          userId: this.props.user.id,
          book: this.currentBook,
          currentLessonNumber: this.currentLessonId || undefined,
          lessons: this.currentLessons,
          highlightWordId: this.pendingHighlightWordId,
          onLessonFilterChanged: (lessonNum) => {
            this.currentLessonId = lessonNum;
            const sel = this.container.querySelector('#headerLessonSel') as HTMLSelectElement | null;
            if (sel) sel.value = lessonNum;
          },
          onWordChanged: async () => {
            // Also notify any lesson count updates if needed
          },
        });
        this.pendingHighlightWordId = undefined; // clear after mounting
      }
    }

    // Mount GlobalSearchView if on search tab
    if (this.activeTab === 'search') {
      const mount = this.container.querySelector('#searchMountPoint') as HTMLElement | null;
      if (mount) {
        new GlobalSearchView(mount, {
          userId: this.props.user.id,
          initialQuery: this.initialSearchQuery,
          onOpenInLesson: async (bookId, lessonNum, wordId) => {
            // 1. Load book and select in dropdown
            const targetBook = await bookService.getBookById(this.props.user.id, bookId);
            if (targetBook) {
              this.currentBook = targetBook;
              if (this.bookDropdown) {
                this.bookDropdown.selectBookById(bookId);
              }
              // 2. Load lessons for book
              this.currentLessons = await lessonService.getLessonsForBook(bookId, this.props.user.id);
              this.currentLessonId = lessonNum;
              this.pendingHighlightWordId = wordId;
              this.activeTab = 'vocabulary';
              this.render();
            }
          },
        });
      }
    }

    // Mount FailedWordsView if on review tab
    if (this.activeTab === 'review') {
      const mount = this.container.querySelector('#reviewMountPoint') as HTMLElement | null;
      if (mount) {
        new FailedWordsView(mount, {
          userId: this.props.user.id,
          onPracticeFailed: () => {
            this.activeTab = 'games';
            this.render();
          },
          onOpenInLesson: async (bookId, lessonNum, wordId) => {
            const targetBook = await bookService.getBookById(this.props.user.id, bookId);
            if (targetBook) {
              this.currentBook = targetBook;
              if (this.bookDropdown) {
                this.bookDropdown.selectBookById(bookId);
              }
              this.currentLessons = await lessonService.getLessonsForBook(bookId, this.props.user.id);
              this.currentLessonId = lessonNum;
              this.pendingHighlightWordId = wordId;
              this.activeTab = 'vocabulary';
              this.render();
            }
          },
        });
      }
    }

    // Mount DashboardView if on dashboard tab
    if (this.activeTab === 'dashboard') {
      const mount = this.container.querySelector('#dashboardMountPoint') as HTMLElement | null;
      if (mount) {
        new DashboardView(mount, {
          userId: this.props.user.id,
          onNavigateTab: (tab) => {
            this.activeTab = tab as any;
            this.render();
          },
        });
      }
    }

    // Mount LearningGamesHubView if on games tab
    if (this.activeTab === 'games') {
      const mount = this.container.querySelector('#gamesMountPoint') as HTMLElement | null;
      if (mount) {
        new LearningGamesHubView(mount, {
          userId: this.props.user.id,
          initialBook: this.currentBook || undefined,
          initialLessonNumber: this.currentLessonId || undefined,
        });
      }
    }
  }

  private bindEvents(): void {
    const logoutBtn = this.container.querySelector('#logoutBtn') as HTMLButtonElement | null;
    const themeToggleBtn = this.container.querySelector('#themeToggleBtn') as HTMLButtonElement | null;
    const exportBtn = this.container.querySelector('#exportBackupBtn') as HTMLButtonElement | null;
    const importInput = this.container.querySelector('#importBackupInput') as HTMLInputElement | null;
    const feedback = this.container.querySelector('#backupFeedback') as HTMLElement | null;
    const lessonSel = this.container.querySelector('#headerLessonSel') as HTMLSelectElement | null;

    // Lesson selection change
    lessonSel?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.currentLessonId = val;

      // Persist in localStorage and settings
      try {
        const raw = localStorage.getItem('vq:sel:' + this.props.user.id);
        const selObj = raw ? JSON.parse(raw) : {};
        selObj.l = val;
        localStorage.setItem('vq:sel:' + this.props.user.id, JSON.stringify(selObj));
      } catch {
        // Ignore
      }

      try {
        await dbManager.saveSettings(this.props.user.id, { selectedLesson: val });
      } catch {
        // Ignore
      }

      // If vocabulary tab is active or visible, refresh words list immediately
      if (this.activeTab === 'vocabulary') {
        this.loadCurrentWords();
      }
    });

    // Tabs
    this.container.querySelector('#navTabDashboard')?.addEventListener('click', () => {
      this.activeTab = 'dashboard';
      this.render();
    });
    this.container.querySelector('#navTabTextbooks')?.addEventListener('click', () => {
      this.activeTab = 'textbooks';
      this.render();
    });
    this.container.querySelector('#navTabLessons')?.addEventListener('click', () => {
      this.activeTab = 'lessons';
      this.render();
    });
    this.container.querySelector('#navTabVocabulary')?.addEventListener('click', () => {
      this.activeTab = 'vocabulary';
      this.render();
    });
    this.container.querySelector('#navTabSearch')?.addEventListener('click', () => {
      this.activeTab = 'search';
      this.render();
    });
    this.container.querySelector('#navTabReview')?.addEventListener('click', () => {
      this.activeTab = 'review';
      this.render();
    });
    this.container.querySelector('#navTabGames')?.addEventListener('click', () => {
      this.activeTab = 'games';
      this.render();
    });
    this.container.querySelector('#navTabAccount')?.addEventListener('click', () => {
      this.activeTab = 'account';
      this.render();
    });
    this.container.querySelector('#headerQuickSearchBtn')?.addEventListener('click', () => {
      this.activeTab = 'search';
      this.render();
    });

    // Clear lesson filter button on vocabulary tab
    this.container.querySelector('#clearLessonFilterBtn')?.addEventListener('click', async () => {
      this.currentLessonId = '';
      const sel = this.container.querySelector('#headerLessonSel') as HTMLSelectElement | null;
      if (sel) sel.value = '';
      try {
        await dbManager.saveSettings(this.props.user.id, { selectedLesson: '' });
      } catch {
        // Ignore
      }
      this.loadCurrentWords();
    });

    // Delete Account Elements
    const openDeleteBtn = this.container.querySelector('#openDeleteAccountModalBtn') as HTMLButtonElement | null;
    const deleteModal = this.container.querySelector('#deleteAccountModal') as HTMLElement | null;
    const cancelDeleteBtn = this.container.querySelector('#cancelDeleteAccountBtn') as HTMLButtonElement | null;
    const deleteForm = this.container.querySelector('#deleteAccountForm') as HTMLFormElement | null;
    const deletePasswordInput = this.container.querySelector('#deleteConfirmPassword') as HTMLInputElement | null;
    const deleteErrorBox = this.container.querySelector('#deleteAccountError') as HTMLElement | null;
    const confirmDeleteBtn = this.container.querySelector('#confirmDeleteAccountBtn') as HTMLButtonElement | null;

    logoutBtn?.addEventListener('click', () => {
      authService.logout();
      this.props.onLogout();
    });

    themeToggleBtn?.addEventListener('click', async () => {
      const nextTheme = this.settings?.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(nextTheme);
      if (this.settings) {
        this.settings.theme = nextTheme;
        await dbManager.saveSettings(this.props.user.id, { theme: nextTheme });
      }
      if (themeToggleBtn) {
        themeToggleBtn.textContent = nextTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
      }
    });

    exportBtn?.addEventListener('click', async () => {
      try {
        const backup = await dbManager.exportUserData(this.props.user.id);
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vocab_quest_backup_${this.props.user.username}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (feedback) {
          feedback.textContent = '✓ Data backup downloaded successfully!';
          feedback.style.display = 'inline-flex';
          setTimeout(() => {
            feedback.style.display = 'none';
          }, 3000);
        }
      } catch (err) {
        alert('Could not export backup: ' + (err instanceof Error ? err.message : String(err)));
      }
    });

    importInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await dbManager.importUserData(this.props.user.id, data);
        if (feedback) {
          feedback.textContent = `✓ Restored ${result.importedCount} records successfully!`;
          feedback.style.display = 'inline-flex';
          setTimeout(() => {
            feedback.style.display = 'none';
          }, 3000);
        }
        if (this.bookDropdown) {
          await this.bookDropdown.reloadBooks();
        }
      } catch (err) {
        alert('Import failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    });

    // Delete Account Modal handlers
    openDeleteBtn?.addEventListener('click', () => {
      if (deleteModal) {
        deleteModal.style.display = 'grid';
        if (deleteErrorBox) {
          deleteErrorBox.style.display = 'none';
          deleteErrorBox.textContent = '';
        }
        if (deletePasswordInput) {
          deletePasswordInput.value = '';
          deletePasswordInput.focus();
        }
      }
    });

    const closeDeleteModal = () => {
      if (deleteModal) {
        deleteModal.style.display = 'none';
      }
      if (deletePasswordInput) {
        deletePasswordInput.value = '';
      }
      if (deleteErrorBox) {
        deleteErrorBox.style.display = 'none';
        deleteErrorBox.textContent = '';
      }
    };

    cancelDeleteBtn?.addEventListener('click', closeDeleteModal);

    // Close on background click
    deleteModal?.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        closeDeleteModal();
      }
    });

    // Form submission for account deletion
    deleteForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = (deletePasswordInput?.value || '').trim();

      if (!password) {
        if (deleteErrorBox) {
          deleteErrorBox.textContent = 'Please enter your password to confirm deletion.';
          deleteErrorBox.style.display = 'block';
        }
        deletePasswordInput?.focus();
        return;
      }

      try {
        if (confirmDeleteBtn) {
          confirmDeleteBtn.disabled = true;
          confirmDeleteBtn.textContent = 'Permanently deleting...';
        }
        if (deleteErrorBox) {
          deleteErrorBox.style.display = 'none';
        }

        await authService.deleteAccount(this.props.user.id, password);

        closeDeleteModal();

        if (this.props.onAccountDeleted) {
          this.props.onAccountDeleted(
            `Account "${this.props.user.username}" and all associated vocabulary data have been permanently deleted.`
          );
        } else {
          this.props.onLogout();
        }
      } catch (err) {
        if (deleteErrorBox) {
          if (err instanceof ValidationError) {
            deleteErrorBox.textContent = err.message;
          } else if (err instanceof Error) {
            deleteErrorBox.textContent = err.message;
          } else {
            deleteErrorBox.textContent = 'Failed to delete account. Please try again.';
          }
          deleteErrorBox.style.display = 'block';
        }
        deletePasswordInput?.focus();
      } finally {
        if (confirmDeleteBtn) {
          confirmDeleteBtn.disabled = false;
          confirmDeleteBtn.textContent = 'Permanently Delete My Account';
        }
      }
    });

    // Account switcher & teacher management delegation
    const listContainer = this.container.querySelector('#usersListContainer');
    listContainer?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // Switch user
      const switchBtn = target.closest('[data-switch-user]') as HTMLElement | null;
      if (switchBtn) {
        const targetUserId = switchBtn.dataset.switchUser;
        const targetUser = this.allUsers.find((u) => u.id === targetUserId);
        if (targetUser) {
          authService.switchAccount(targetUser);
          if (this.props.onSwitchAccount) {
            this.props.onSwitchAccount(targetUser);
          } else {
            this.props.onLogout();
          }
        }
        return;
      }

      // Role toggle (Teacher only)
      const toggleRoleBtn = target.closest('[data-toggle-role]') as HTMLElement | null;
      if (toggleRoleBtn) {
        const targetUserId = toggleRoleBtn.dataset.toggleRole;
        const targetUser = this.allUsers.find((u) => u.id === targetUserId);
        if (targetUser) {
          const newRole = targetUser.role === 'teacher' ? 'student' : 'teacher';
          await dbManager.update('users', targetUser.id, { role: newRole });
          targetUser.role = newRole;
          this.render();
        }
        return;
      }

      // Delete student user by Teacher
      const deleteUserBtn = target.closest('[data-delete-user]') as HTMLElement | null;
      if (deleteUserBtn) {
        const targetUserId = deleteUserBtn.dataset.deleteUser;
        const targetUser = this.allUsers.find((u) => u.id === targetUserId);
        if (targetUser) {
          const confirmed = confirm(
            `Delete account "${targetUser.username}" and all of its progress records permanently?`
          );
          if (confirmed) {
            await dbManager.deleteUserAccount(targetUser.id);
            await this.loadAllUsers();
            this.render();
          }
        }
        return;
      }
    });

    // PWA Install / Guide event handlers
    const triggerInstall = async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const choice = await this.deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          this.deferredPrompt = null;
        }
      } else {
        const installModal = this.container.querySelector('#installGuideModal') as HTMLElement | null;
        if (installModal) installModal.style.display = 'grid';
      }
    };

    this.container.querySelector('#headerInstallBtn')?.addEventListener('click', triggerInstall);
    this.container.querySelector('#cardInstallBtn')?.addEventListener('click', triggerInstall);

    const openInstallGuideBtn = this.container.querySelector('#openInstallGuideBtn') as HTMLButtonElement | null;
    const installGuideModal = this.container.querySelector('#installGuideModal') as HTMLElement | null;
    const closeInstallGuideBtn = this.container.querySelector('#closeInstallGuideBtn') as HTMLButtonElement | null;

    openInstallGuideBtn?.addEventListener('click', () => {
      if (installGuideModal) installGuideModal.style.display = 'grid';
    });

    installGuideModal?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tabBtn = target.closest('[data-tab]') as HTMLElement | null;
      if (tabBtn) {
        const tab = tabBtn.dataset.tab as any;
        if (tab) {
          this.installGuideTab = tab;
          installGuideModal.querySelectorAll('.install-tab-btn').forEach((b) => b.classList.remove('on'));
          tabBtn.classList.add('on');
          const contentArea = installGuideModal.querySelector('#installGuideTabContent');
          if (contentArea) {
            contentArea.innerHTML = this.renderInstallGuideTabContent();
          }
        }
        return;
      }
      if (e.target === installGuideModal || target.closest('#closeInstallGuideBtn')) {
        installGuideModal.style.display = 'none';
      }
    });
  }

  private renderInstallGuideTabContent(): string {
    if (this.installGuideTab === 'desktop') {
      return `
        <div style="font-weight: 700; color: var(--ac); margin-bottom: 2px;">Step-by-Step Windows, macOS & Linux Installation</div>
        <div style="display: grid; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">1</span>
            <div><strong>Open in Chrome or Edge:</strong> Navigate to Vocab Quest in Google Chrome, Microsoft Edge, or Brave browser.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">2</span>
            <div><strong>Click Install Icon:</strong> Look at the right side of your address bar for the Install icon (💻 monitor with a downward arrow or plus badge).</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">3</span>
            <div><strong>Launch App Window:</strong> Click <strong>Install</strong>. Vocab Quest will open in its own standalone desktop window and add itself to your taskbar or applications menu!</div>
          </div>
        </div>
      `;
    } else if (this.installGuideTab === 'ios') {
      return `
        <div style="font-weight: 700; color: var(--ac2); margin-bottom: 2px;">Step-by-Step iPhone & iPad (iOS Safari) Installation</div>
        <div style="display: grid; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac2) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac2); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">1</span>
            <div><strong>Open in Safari:</strong> Launch the Apple <strong>Safari</strong> browser on your iPhone or iPad and open Vocab Quest.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac2) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac2); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">2</span>
            <div><strong>Tap Share Button:</strong> Tap the <strong>Share</strong> icon (square with an upward arrow) in the bottom toolbar (iPhone) or top toolbar (iPad).</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ac2) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ac2); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">3</span>
            <div><strong>Add to Home Screen:</strong> Scroll down the share sheet options and tap <strong>"Add to Home Screen"</strong>, then tap <strong>Add</strong>. Vocab Quest is now installed on your iOS home screen!</div>
          </div>
        </div>
      `;
    } else if (this.installGuideTab === 'android') {
      return `
        <div style="font-weight: 700; color: var(--wn); margin-bottom: 2px;">Step-by-Step Android Installation</div>
        <div style="display: grid; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--wn) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--wn); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">1</span>
            <div><strong>Open in Chrome:</strong> Open Vocab Quest in Google Chrome on your Android device.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--wn) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--wn); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">2</span>
            <div><strong>Open Menu:</strong> Tap the three-dot menu icon in the top right corner of Chrome.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--wn) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--wn); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">3</span>
            <div><strong>Install App:</strong> Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong> and confirm. The app will appear in your app drawer!</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div style="font-weight: 700; color: var(--ok); margin-bottom: 2px;">Built-In Database & Offline Operation</div>
        <div style="display: grid; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ok) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ok); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">1</span>
            <div><strong>Local IndexedDB Database:</strong> All your study progress, flashcard reviews, quiz scores, and textbooks live securely in your browser's local database with zero cloud dependencies.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ok) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ok); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">2</span>
            <div><strong>100% Offline Ready:</strong> The built-in Service Worker caches all application assets automatically, allowing you to study anywhere without internet.</div>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: color-mix(in srgb, var(--ok) 6%, var(--sf)); border: 1px solid var(--ln);">
            <span style="background: var(--ok); color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;">3</span>
            <div><strong>Backup & Restore:</strong> Easily export your progress to a JSON file in Account & Settings and restore it on any other device anytime.</div>
          </div>
        </div>
      `;
    }
  }
}
