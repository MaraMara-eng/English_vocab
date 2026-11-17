/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, Lesson, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { dbManager } from '../db/indexedDB.ts';
import { vocabularyService } from '../services/vocabularyService.ts';
import { lessonService } from '../services/lessonService.ts';

export interface ReportModalProps {
  userId: string;
  book: Book;
  lesson?: Lesson; // Optional: if provided, report for single lesson; otherwise full book report
  onClose: () => void;
}

export class ReportModal {
  private container: HTMLElement;
  private props: ReportModalProps;
  private words: { word: VocabularyWord; isKnown: boolean }[] = [];
  private lessons: Lesson[] = [];
  private isLoading: boolean = true;
  private stats = {
    totalWords: 0,
    knownWords: 0,
    learningWords: 0,
    percent: 0,
    isCompleted: false,
    completedDateStr: 'N/A',
  };

  constructor(container: HTMLElement, props: ReportModalProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    await this.loadReportData();
  }

  private async loadReportData(): Promise<void> {
    this.isLoading = true;
    this.render();

    try {
      this.lessons = await lessonService.getLessonsForBook(this.props.book.id, this.props.userId);
      const rawWords = await vocabularyService.getWordsWithStatus(
        this.props.userId,
        this.props.book.id,
        this.props.lesson ? this.props.lesson.lessonNumber : undefined
      );

      this.words = rawWords.map((w) => ({
        word: w,
        isKnown: w.isKnown,
      }));

      const totalWords = this.words.length;
      const knownWords = this.words.filter((w) => w.isKnown).length;
      const learningWords = Math.max(0, totalWords - knownWords);
      const percent = totalWords > 0 ? Math.round((knownWords / totalWords) * 100) : 0;
      const isCompleted = totalWords > 0 && knownWords === totalWords;

      // Completion date tracking: find latest practice timestamp among known words if completed
      let completedDateStr = 'Not completed yet';
      if (isCompleted) {
        const progressRecords = await dbManager.getUserBookProgress(this.props.userId, this.props.book.id);
        const knownDates = progressRecords.filter((p) => p.isKnown).map((p) => p.lastPracticedAt || p.updatedAt);
        if (knownDates.length > 0) {
          const maxDate = Math.max(...knownDates);
          completedDateStr = new Date(maxDate).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        } else {
          completedDateStr = new Date().toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        }
      }

      this.stats = {
        totalWords,
        knownWords,
        learningWords,
        percent,
        isCompleted,
        completedDateStr,
      };
    } catch (err) {
      console.warn('Could not load report data:', err);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private render(): void {
    const { book, lesson } = this.props;
    const reportTitle = lesson ? `Lesson Report: ${lesson.name} (${lesson.lessonNumber})` : `Textbook Report: ${book.name}`;
    const generatedDate = new Date().toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    this.container.innerHTML = `
      <div class="modal" id="reportModalOverlay" style="display: grid; z-index: 100;">
        <div class="box" style="max-width: 720px; width: 100%; max-height: 90vh; display: flex; flex-direction: column;">
          <!-- Modal Header (Non-printable) -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--ln);">
            <div>
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
                <span>📊</span> ${reportTitle}
              </h3>
              <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--mu);">
                Generated locally on ${generatedDate} • Vocab Quest Reporting
              </p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" id="printReportBtn" class="p sm" style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>📥</span> Download PDF / Print
              </button>
              <button type="button" id="closeReportModalBtn" class="sm">✕ Close</button>
            </div>
          </div>

          <!-- Printable Report Content Area -->
          <div id="printableReportArea" style="flex: 1; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 16px;">
            <!-- Header Summary Card -->
            <div class="card" style="margin-bottom: 0; background: var(--sf); border-left: 4px solid var(--ac);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
                <div>
                  <h2 style="margin: 0 0 4px; font-size: 1.3rem; color: var(--tx);">
                    ${book.name}
                  </h2>
                  <p style="margin: 0; font-size: 0.9rem; color: var(--mu);">
                    ${lesson ? `Lesson: <strong>${lesson.name}</strong> (${lesson.lessonNumber})` : `Full Textbook Summary (${this.lessons.length} units)`}
                  </p>
                </div>
                <div>
                  <span class="chip ${this.stats.isCompleted ? 'ok' : 'wn'}" style="font-size: 0.82rem; padding: 6px 12px; font-weight: 700;">
                    ${this.stats.isCompleted ? '✅ Lesson Completed' : '⏳ In Progress'}
                  </span>
                </div>
              </div>

              <!-- Statistics Grid -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ln);">
                <div style="background: var(--bg); padding: 10px; border-radius: 8px; text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Total Words</div>
                  <div style="font-size: 1.25rem; font-weight: 800; color: var(--tx);">${this.stats.totalWords}</div>
                </div>
                <div style="background: var(--bg); padding: 10px; border-radius: 8px; text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Mastered (Known)</div>
                  <div style="font-size: 1.25rem; font-weight: 800; color: var(--ok);">${this.stats.knownWords} (${this.stats.percent}%)</div>
                </div>
                <div style="background: var(--bg); padding: 10px; border-radius: 8px; text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Learning / Unknown</div>
                  <div style="font-size: 1.25rem; font-weight: 800; color: var(--wn);">${this.stats.learningWords}</div>
                </div>
                <div style="background: var(--bg); padding: 10px; border-radius: 8px; text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Completion Date</div>
                  <div style="font-size: 0.95rem; font-weight: 700; color: var(--tx); margin-top: 2px;">${this.stats.completedDateStr}</div>
                </div>
              </div>
            </div>

            <!-- Vocabulary Details Table -->
            <div class="card" style="margin-bottom: 0;">
              <h4 style="margin: 0 0 10px; font-size: 1.05rem; display: flex; align-items: center; gap: 6px;">
                <span>📝</span> Vocabulary Details & Status (${this.words.length} entries)
              </h4>

              ${
                this.isLoading
                  ? `<div style="text-align: center; padding: 24px; color: var(--mu);">Loading vocabulary details...</div>`
                  : this.words.length === 0
                  ? `<p style="margin: 0; color: var(--mu); font-size: 0.85rem; font-style: italic;">No vocabulary words in this selection.</p>`
                  : `<div style="overflow-x: auto;">
                      <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
                        <thead>
                          <tr style="border-bottom: 2px solid var(--ln); color: var(--mu); font-size: 0.75rem; text-transform: uppercase;">
                            <th style="padding: 8px 10px; width: 40px;">Status</th>
                            <th style="padding: 8px 10px;">English (EN)</th>
                            <th style="padding: 8px 10px;">Armenian (HY)</th>
                            <th style="padding: 8px 10px;">Russian (RU)</th>
                            <th style="padding: 8px 10px; width: 70px;">Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${this.words
                            .map(
                              ({ word: w, isKnown }, idx) => `
                            <tr style="border-bottom: 1px solid var(--ln); background: ${idx % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--bg) 30%, transparent)'};">
                              <td style="padding: 8px 10px; text-align: center; font-size: 1rem; color: ${isKnown ? 'var(--ok)' : 'var(--mu)'};">
                                ${isKnown ? '✓' : '○'}
                              </td>
                              <td style="padding: 8px 10px; font-weight: 700; color: var(--tx);">
                                ${w.en} ${w.type ? `<span class="chip" style="font-size: 0.62rem; margin-left: 4px; text-transform: uppercase;">${w.type}</span>` : ''}
                              </td>
                              <td style="padding: 8px 10px; font-weight: 600; color: var(--tx);">
                                ${w.hy}
                              </td>
                              <td style="padding: 8px 10px; color: var(--mu);">
                                ${w.ru || '—'}
                              </td>
                              <td style="padding: 8px 10px; font-size: 0.78rem; color: var(--mu);">
                                Unit ${w.lesson}
                              </td>
                            </tr>
                          `
                            )
                            .join('')}
                        </tbody>
                      </table>
                    </div>`
              }
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const closeBtn = this.container.querySelector('#closeReportModalBtn');
    const overlay = this.container.querySelector('#reportModalOverlay');
    const printBtn = this.container.querySelector('#printReportBtn');

    const close = () => {
      this.props.onClose();
    };

    closeBtn?.addEventListener('click', close);
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    printBtn?.addEventListener('click', () => {
      // Trigger native browser print-to-PDF with localized report styling
      window.print();
    });
  }
}
