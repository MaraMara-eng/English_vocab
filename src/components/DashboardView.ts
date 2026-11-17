/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager } from '../db/indexedDB.ts';
import { Book, Lesson, LearningSession, FailedWord, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { bookService } from '../services/bookService.ts';
import { lessonService } from '../services/lessonService.ts';
import { vocabularyService } from '../services/vocabularyService.ts';

export interface DashboardViewProps {
  userId: string;
  onNavigateTab: (tab: string) => void;
}

export class DashboardView {
  private container: HTMLElement;
  private props: DashboardViewProps;
  private isLoading: boolean = true;

  // Stats Data
  private totalWords: number = 0;
  private knownWords: number = 0;
  private learningWords: number = 0;
  private progressPercent: number = 0;
  private completedLessonsCount: number = 0;
  private failedWordsCount: number = 0;
  private overallAccuracy: number = 0;
  private recentSessions: LearningSession[] = [];
  private bookProgressList: { book: Book; total: number; known: number; percent: number }[] = [];
  private streakDays: number = 0;

  constructor(container: HTMLElement, props: DashboardViewProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    await this.loadStats();
  }

  private async loadStats(): Promise<void> {
    this.isLoading = true;
    this.render();

    try {
      const books = await bookService.getUserBooks(this.props.userId);
      const allProgress = await dbManager.query<UserWordProgress>('userWordProgress', {}, this.props.userId);
      const progressMap = new Map<string, UserWordProgress>();
      allProgress.forEach((p) => progressMap.set(`${p.bookId}:${p.wordKey}`, p));

      const failedRecords = await dbManager.query<FailedWord>('failedWords', {}, this.props.userId);
      this.failedWordsCount = failedRecords.length;

      const sessions = await dbManager.query<LearningSession>('learningSessions', {}, this.props.userId);
      sessions.sort((a, b) => b.completedAt - a.completedAt);
      this.recentSessions = sessions.slice(0, 10);

      // Calculate accuracy across sessions
      let totalCorrect = 0;
      let totalAttempts = 0;
      sessions.forEach((s) => {
        totalCorrect += s.correctCount;
        totalAttempts += (s.correctCount + s.missCount);
      });
      this.overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

      // Calculate streak from session dates
      const sessionDays = new Set<string>();
      sessions.forEach((s) => {
        const d = new Date(s.completedAt).toISOString().slice(0, 10);
        sessionDays.add(d);
      });
      this.streakDays = sessionDays.size;

      let totalWordCount = 0;
      let knownWordCount = 0;
      let completedLessons = 0;
      const bookProgs: { book: Book; total: number; known: number; percent: number }[] = [];

      for (const b of books) {
        const words = await vocabularyService.getWordsForBookAndLesson(this.props.userId, b.id);
        const lessons = await lessonService.getLessonsForBook(b.id, this.props.userId);

        let bookTotal = words.length;
        let bookKnown = 0;

        words.forEach((w) => {
          const key = w.normalizedEn || w.en.toLowerCase().trim();
          const p = progressMap.get(`${b.id}:${key}`);
          if (p && p.isKnown) {
            bookKnown++;
          }
        });

        totalWordCount += bookTotal;
        knownWordCount += bookKnown;

        const bookPercent = bookTotal > 0 ? Math.round((bookKnown / bookTotal) * 100) : 0;
        bookProgs.push({ book: b, total: bookTotal, known: bookKnown, percent: bookPercent });

        // Check completed lessons (lessons where all words are known)
        for (const l of lessons) {
          const lessonWords = words.filter((w) => w.lesson === l.lessonNumber || w.lessonId === `${b.id}:${l.lessonNumber}`);
          if (lessonWords.length > 0) {
            const lessonKnown = lessonWords.filter((w) => {
              const key = w.normalizedEn || w.en.toLowerCase().trim();
              const p = progressMap.get(`${b.id}:${key}`);
              return p && p.isKnown;
            }).length;
            if (lessonKnown === lessonWords.length) {
              completedLessons++;
            }
          }
        }
      }

      this.totalWords = totalWordCount;
      this.knownWords = knownWordCount;
      this.learningWords = Math.max(0, totalWordCount - knownWordCount);
      this.progressPercent = totalWordCount > 0 ? Math.round((knownWordCount / totalWordCount) * 100) : 0;
      this.completedLessonsCount = completedLessons;
      this.bookProgressList = bookProgs;
    } catch (err) {
      console.warn('Could not calculate learning stats:', err);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private render(): void {
    const isEmpty = this.totalWords === 0;

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Header Banner -->
        <div class="card" style="margin-bottom: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--ac) 10%, var(--sf)), var(--sf)); border-left: 4px solid var(--ac);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.5rem;">📊</span>
                <h2 style="margin: 0; font-size: 1.35rem;">Learning Statistics & Dashboard</h2>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.88rem;">
                Track your vocabulary mastery, practice accuracy, learning streak, and textbook progress.
              </p>
            </div>
            <div style="display: flex; gap: 10px;">
              <button id="refreshStatsBtn" class="sm" style="display: flex; align-items: center; gap: 6px;">
                <span>🔄</span> Refresh Stats
              </button>
            </div>
          </div>
        </div>

        ${
          this.isLoading
            ? `<div class="card" style="text-align: center; padding: 48px; color: var(--mu);">
                <div style="font-size: 2rem; margin-bottom: 8px;">⏳</div>
                <p style="margin: 0;">Calculating your learning statistics...</p>
              </div>`
            : isEmpty
            ? `<div class="card" style="text-align: center; padding: 56px; color: var(--mu);">
                <div style="font-size: 3rem; margin-bottom: 12px;">📚</div>
                <h3 style="margin: 0 0 8px; color: var(--tx); font-size: 1.2rem;">No vocabulary records found yet</h3>
                <p style="margin: 0 0 16px; font-size: 0.9rem; max-width: 420px; margin-left: auto; margin-right: auto;">
                  Import vocabulary or select a textbook to start building your personal learning statistics dashboard.
                </p>
                <button id="goToBooksBtn" class="p" style="font-weight: 600;">
                  Explore Textbooks 📚
                </button>
              </div>`
            : `
            <!-- Top Summary Cards Grid -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px;">
              <!-- Overall Progress Card -->
              <div class="card" style="margin-bottom: 0; border-top: 3px solid var(--ac);">
                <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Overall Mastery</div>
                <div style="font-size: 2rem; font-weight: 800; color: var(--tx); margin-bottom: 6px;">${this.progressPercent}%</div>
                <div style="background: var(--ln); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
                  <div style="background: linear-gradient(90deg, var(--ac), var(--ac2)); width: ${this.progressPercent}%; height: 100%;"></div>
                </div>
                <div style="font-size: 0.78rem; color: var(--mu);">
                  <strong>${this.knownWords}</strong> of <strong>${this.totalWords}</strong> words mastered
                </div>
              </div>

              <!-- Known Words Card -->
              <div class="card" style="margin-bottom: 0; border-top: 3px solid var(--ok);">
                <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Mastered Words</div>
                <div style="font-size: 2rem; font-weight: 800; color: var(--ok); margin-bottom: 6px;">✓ ${this.knownWords}</div>
                <div style="font-size: 0.82rem; color: var(--mu); margin-top: 4px;">
                  Passed 3+ review streaks successfully
                </div>
              </div>

              <!-- Learning / Unknown Card -->
              <div class="card" style="margin-bottom: 0; border-top: 3px solid var(--wn);">
                <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Words to Learn</div>
                <div style="font-size: 2rem; font-weight: 800; color: var(--wn); margin-bottom: 6px;">⏳ ${this.learningWords}</div>
                <div style="font-size: 0.82rem; color: var(--mu); margin-top: 4px;">
                  In progress or awaiting practice
                </div>
              </div>

              <!-- Practice Accuracy Card -->
              <div class="card" style="margin-bottom: 0; border-top: 3px solid #6366f1;">
                <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Practice Accuracy</div>
                <div style="font-size: 2rem; font-weight: 800; color: #6366f1; margin-bottom: 6px;">🎯 ${this.overallAccuracy}%</div>
                <div style="font-size: 0.82rem; color: var(--mu); margin-top: 4px;">
                  Based on completed game sessions
                </div>
              </div>
            </div>

            <!-- Secondary Metrics Grid -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 4px;">
              <!-- Left: Progress by Textbook -->
              <div class="card" style="margin-bottom: 0;">
                <h3 style="margin: 0 0 12px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                  <span>📚</span> Progress by Textbook
                </h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  ${this.bookProgressList
                    .map(
                      (bp) => `
                    <div style="padding: 10px 12px; background: var(--bg); border-radius: 10px; border: 1px solid var(--ln);">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 600; font-size: 0.92rem; color: var(--tx);">${bp.book.name}</span>
                        <span class="chip ok" style="font-size: 0.72rem;">${bp.percent}%</span>
                      </div>
                      <div style="background: var(--ln); height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
                        <div style="background: var(--ac); width: ${bp.percent}%; height: 100%;"></div>
                      </div>
                      <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--mu);">
                        <span>Mastered: ${bp.known} / ${bp.total}</span>
                        <span>${bp.book.isBuiltin ? 'Standard' : 'Custom'}</span>
                      </div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>

              <!-- Right: Activity & Milestones -->
              <div style="display: flex; flex-direction: column; gap: 16px;">
                <!-- Milestones Card -->
                <div class="card" style="margin-bottom: 0;">
                  <h3 style="margin: 0 0 12px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>🏆</span> Learning Milestones
                  </h3>
                  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                    <div style="padding: 12px; background: var(--bg); border-radius: 10px; text-align: center; border: 1px solid var(--ln);">
                      <div style="font-size: 1.5rem; font-weight: 800; color: var(--tx);">${this.completedLessonsCount}</div>
                      <div style="font-size: 0.78rem; color: var(--mu); margin-top: 2px;">Completed Units</div>
                    </div>
                    <div style="padding: 12px; background: var(--bg); border-radius: 10px; text-align: center; border: 1px solid var(--ln);">
                      <div style="font-size: 1.5rem; font-weight: 800; color: var(--no);">${this.failedWordsCount}</div>
                      <div style="font-size: 0.78rem; color: var(--mu); margin-top: 2px;">Failed Words Pool</div>
                    </div>
                    <div style="padding: 12px; background: var(--bg); border-radius: 10px; text-align: center; border: 1px solid var(--ln);">
                      <div style="font-size: 1.5rem; font-weight: 800; color: var(--ok);">${this.streakDays}</div>
                      <div style="font-size: 0.78rem; color: var(--mu); margin-top: 2px;">Active Practice Days</div>
                    </div>
                    <div style="padding: 12px; background: var(--bg); border-radius: 10px; text-align: center; border: 1px solid var(--ln);">
                      <div style="font-size: 1.5rem; font-weight: 800; color: #6366f1;">${this.recentSessions.length}</div>
                      <div style="font-size: 0.78rem; color: var(--mu); margin-top: 2px;">Total Game Sessions</div>
                    </div>
                  </div>
                </div>

                <!-- Recent Activity Card -->
                <div class="card" style="margin-bottom: 0; flex: 1;">
                  <h3 style="margin: 0 0 12px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span>⚡</span> Recent Learning Activity
                  </h3>
                  ${
                    this.recentSessions.length === 0
                      ? `<p style="margin: 0; color: var(--mu); font-size: 0.85rem; font-style: italic;">No practice sessions recorded yet. Play games to log activity!</p>`
                      : `<div style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto;">
                          ${this.recentSessions
                            .map((s) => {
                              const dateStr = new Date(s.completedAt).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              });
                              const acc = s.correctCount + s.missCount > 0 ? Math.round((s.correctCount / (s.correctCount + s.missCount)) * 100) : 0;
                              return `
                              <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg); border-radius: 8px; font-size: 0.85rem; border: 1px solid var(--ln);">
                                <div>
                                  <span class="chip ok" style="font-size: 0.68rem; text-transform: uppercase; margin-right: 6px;">${s.mode}</span>
                                  <span style="font-weight: 600; color: var(--tx);">Score: ${s.correctCount}/${s.correctCount + s.missCount}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                  <span class="chip" style="font-size: 0.72rem;">${acc}% accuracy</span>
                                  <span style="font-size: 0.75rem; color: var(--mu);">${dateStr}</span>
                                </div>
                              </div>
                            `;
                            })
                            .join('')}
                        </div>`
                  }
                </div>
              </div>
            </div>
            `
        }
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const refreshBtn = this.container.querySelector('#refreshStatsBtn');
    refreshBtn?.addEventListener('click', () => {
      this.loadStats();
    });

    const goToBooksBtn = this.container.querySelector('#goToBooksBtn');
    goToBooksBtn?.addEventListener('click', () => {
      this.props.onNavigateTab('textbooks');
    });
  }
}
