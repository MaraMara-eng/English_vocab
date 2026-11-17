/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager } from '../db/indexedDB.ts';
import { FailedWord, Book, VocabularyWord } from '../db/types.ts';
import { bookService } from '../services/bookService.ts';
import { vocabularyService } from '../services/vocabularyService.ts';

export interface FailedWordsViewProps {
  userId: string;
  onPracticeFailed: () => void;
  onOpenInLesson?: (bookId: string, lessonNum: string, wordId: string) => void;
}

export class FailedWordsView {
  private container: HTMLElement;
  private props: FailedWordsViewProps;
  private failedWords: FailedWord[] = [];
  private books: Book[] = [];
  private selectedBookId: string = 'all';
  private wordDetailsMap: Map<string, VocabularyWord> = new Map();
  private bookMap: Map<string, Book> = new Map();
  private isLoading: boolean = true;

  // Manual Add Modal State
  private isAddModalOpen: boolean = false;
  private addBooks: Book[] = [];
  private addSelectedBookId: string = '';
  private addLessons: { lessonNumber: string; name: string }[] = [];
  private addSelectedLessonNum: string = '';
  private addAvailableWords: VocabularyWord[] = [];
  private addSelectedWordId: string = '';

  constructor(container: HTMLElement, props: FailedWordsViewProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.isLoading = true;
    this.render();

    try {
      this.books = await bookService.getUserBooks(this.props.userId);
      this.bookMap.clear();
      this.books.forEach((b) => this.bookMap.set(b.id, b));

      this.failedWords = await dbManager.query<FailedWord>('failedWords', {}, this.props.userId);
      // Sort by most recently missed
      this.failedWords.sort((a, b) => b.lastMissedAt - a.lastMissedAt);

      // Load vocabulary word details for each failed word
      this.wordDetailsMap.clear();
      for (const fw of this.failedWords) {
        try {
          const bookWords = await vocabularyService.getWordsForBookAndLesson(this.props.userId, fw.bookId);
          const match = bookWords.find((w) => w.id === fw.wordId || w.normalizedEn === fw.wordKey || w.en.toLowerCase() === fw.wordKey.toLowerCase());
          if (match) {
            this.wordDetailsMap.set(fw.id, match);
          }
        } catch {
          // Ignore individual enrichment failures
        }
      }
    } catch (err) {
      console.warn('Could not load failed words:', err);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private async openAddModal(): Promise<void> {
    try {
      this.addBooks = await bookService.getUserBooks(this.props.userId);
      if (this.addBooks.length > 0) {
        this.addSelectedBookId = this.addBooks[0].id;
        await this.loadAddLessonsAndWords();
      }
      this.isAddModalOpen = true;
      this.render();
    } catch (err) {
      alert('Could not open add modal: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async loadAddLessonsAndWords(): Promise<void> {
    if (!this.addSelectedBookId) return;
    try {
      const lessons = await dbManager.query<any>('lessons', {
        indexName: 'bookId',
        range: IDBKeyRange.only(this.addSelectedBookId),
      });
      this.addLessons = lessons.map((l: any) => ({
        lessonNumber: l.lessonNumber,
        name: l.name || `Lesson ${l.lessonNumber}`,
      }));
      this.addSelectedLessonNum = this.addLessons.length > 0 ? this.addLessons[0].lessonNumber : '';

      this.addAvailableWords = await vocabularyService.getWordsForBookAndLesson(
        this.props.userId,
        this.addSelectedBookId,
        this.addSelectedLessonNum || undefined
      );
      this.addSelectedWordId = this.addAvailableWords.length > 0 ? this.addAvailableWords[0].id : '';
    } catch {
      this.addLessons = [];
      this.addAvailableWords = [];
    }
  }

  private render(): void {
    const filteredWords =
      this.selectedBookId === 'all'
        ? this.failedWords
        : this.failedWords.filter((fw) => fw.bookId === this.selectedBookId);

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Header Banner -->
        <div class="card" style="margin-bottom: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--no) 8%, var(--sf)), var(--sf)); border-left: 4px solid var(--no);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.4rem;">⚠️</span>
                <h2 style="margin: 0; font-size: 1.3rem;">Failed & Difficult Words Collection</h2>
                <span class="chip no" style="font-size: 0.75rem;">
                  ${this.failedWords.length} ${this.failedWords.length === 1 ? 'word' : 'words'}
                </span>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.88rem;">
                Review words you missed during practice, track your misses, and master difficult vocabulary.
              </p>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button id="openAddFailedModalBtn" class="sm" style="display: flex; align-items: center; gap: 6px;">
                <span>➕</span> Add Word
              </button>
              ${
                this.failedWords.length > 0
                  ? `<button id="practiceFailedBtn" class="sm" style="background: var(--ac); color: #fff; border: 0; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                      <span>🎮</span> Practice Failed Words
                    </button>
                    <button id="clearAllFailedBtn" class="sm" style="color: var(--no); border-color: var(--no);" title="Clear all failed words">
                      Clear All
                    </button>`
                  : ''
              }
            </div>
          </div>

          <!-- Book Filter Bar -->
          ${
            this.books.length > 1
              ? `<div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--ln); display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <span style="font-size: 0.85rem; color: var(--mu); font-weight: 600;">Filter by Textbook:</span>
                  <select id="failedBookFilterSelect" style="padding: 6px 10px; font-size: 0.85rem; border-radius: 8px;">
                    <option value="all" ${this.selectedBookId === 'all' ? 'selected' : ''}>All Textbooks (${this.failedWords.length})</option>
                    ${this.books
                      .map((b) => {
                        const count = this.failedWords.filter((fw) => fw.bookId === b.id).length;
                        return `<option value="${b.id}" ${this.selectedBookId === b.id ? 'selected' : ''}>${b.name} (${count})</option>`;
                      })
                      .join('')}
                  </select>
                </div>`
              : ''
          }
        </div>

        <!-- Content Area -->
        ${
          this.isLoading
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 1.8rem; marginBottom: 8px;">⏳</div>
                <p style="margin: 0;">Loading failed words collection...</p>
              </div>`
            : filteredWords.length === 0
            ? `<div class="card" style="text-align: center; padding: 48px; color: var(--mu);">
                <div style="font-size: 2.5rem; marginBottom: 10px;">🎉</div>
                <h3 style="margin: 0 0 6px; color: var(--tx); font-size: 1.15rem;">No difficult words in this collection!</h3>
                <p style="margin: 0; font-size: 0.88rem; max-width: 400px; margin-left: auto; margin-right: auto;">
                  ${
                    this.failedWords.length === 0
                      ? 'Fantastic job! Words you answer incorrectly in practice games will automatically appear here for review.'
                      : 'No failed words match the selected textbook filter.'
                  }
                </p>
              </div>`
            : `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px;">
                ${filteredWords
                  .map((fw) => {
                    const word = this.wordDetailsMap.get(fw.id);
                    const book = this.bookMap.get(fw.bookId);
                    const missedDateStr = new Date(fw.lastMissedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return `
                    <div class="card" style="margin-bottom: 0; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; border-left: 3px solid var(--no); background: var(--sf);">
                      <div>
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                          <div>
                            <span style="font-weight: 700; font-size: 1.15rem; color: var(--tx);">
                              ${word ? word.en : fw.wordKey}
                            </span>
                            ${word && word.type ? `<span class="chip" style="font-size: 0.65rem; margin-left: 6px; text-transform: uppercase;">${word.type}</span>` : ''}
                          </div>
                          <span class="chip no" style="font-size: 0.7rem; font-weight: 600;" title="Total times answered incorrectly">
                            🔥 ${fw.totalMisses} ${fw.totalMisses === 1 ? 'miss' : 'misses'}
                          </span>
                        </div>

                        ${
                          word
                            ? `<div style="display: grid; gap: 4px; font-size: 0.88rem; margin: 8px 0; padding: 8px 10px; background: var(--bg); border-radius: 8px;">
                                ${word.hy ? `<div><span style="color: var(--mu); font-size: 0.75rem;">HY:</span> ${word.hy}</div>` : ''}
                                ${word.ru ? `<div><span style="color: var(--mu); font-size: 0.75rem;">RU:</span> ${word.ru}</div>` : ''}
                                ${word.definition ? `<div style="color: var(--mu); font-size: 0.82rem; font-style: italic;">${word.definition}</div>` : ''}
                              </div>`
                            : `<div style="font-size: 0.85rem; color: var(--mu); margin: 8px 0;">Word key: <code>${fw.wordKey}</code></div>`
                        }

                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--mu); margin-top: 8px;">
                          <span>📚 ${book ? book.name : 'Textbook'} • Unit ${word?.lesson || 'General'}</span>
                          <span>Last missed: ${missedDateStr}</span>
                        </div>
                      </div>

                      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ln); gap: 8px;">
                        <span style="font-size: 0.75rem; color: var(--mu);">
                          Reviews needed: <strong>${fw.remainingReviews}</strong>
                        </span>
                        <div style="display: flex; gap: 6px;">
                          ${
                            word && this.props.onOpenInLesson
                              ? `<button class="sm" data-goto-word="${fw.bookId}:${word.lesson || ''}:${word.id}" style="font-size: 0.75rem;" title="View word in lesson">
                                  View
                                </button>`
                              : ''
                          }
                          <button class="sm" data-mark-mastered="${fw.id}" style="font-size: 0.75rem; background: color-mix(in srgb, var(--ok) 15%, var(--sf)); color: var(--ok); border-color: var(--ok);" title="Mark word as mastered and remove from failed list">
                            ✓ Mastered
                          </button>
                          <button class="sm" data-remove-failed="${fw.id}" style="font-size: 0.75rem; color: var(--no); border-color: var(--no);" title="Remove from failed collection">
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  `;
                  })
                  .join('')}
              </div>`
        }

        <!-- Manual Add Modal -->
        ${
          this.isAddModalOpen
            ? `<div class="modal" style="display: grid;">
                <div class="box" style="max-width: 480px; width: 100%;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                    <h3 style="margin: 0; font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                      <span>➕</span> Add Word to Review Collection
                    </h3>
                    <button type="button" id="closeAddModalXBtn" class="sm" style="font-size: 0.8rem;">✕</button>
                  </div>

                  <form id="addFailedWordForm" style="display: grid; gap: 14px;" novalidate>
                    <label class="field-label">
                      <span>Select Textbook <span class="req">*</span></span>
                      <select id="addModalBookSel" style="width: 100%; padding: 8px 12px; border-radius: 8px;" required>
                        ${this.addBooks
                          .map((b) => `<option value="${b.id}" ${b.id === this.addSelectedBookId ? 'selected' : ''}>${b.name}</option>`)
                          .join('')}
                      </select>
                    </label>

                    <label class="field-label">
                      <span>Select Unit / Lesson</span>
                      <select id="addModalLessonSel" style="width: 100%; padding: 8px 12px; border-radius: 8px;">
                        <option value="">(All Lessons)</option>
                        ${this.addLessons
                          .map((l) => `<option value="${l.lessonNumber}" ${l.lessonNumber === this.addSelectedLessonNum ? 'selected' : ''}>${l.name}</option>`)
                          .join('')}
                      </select>
                    </label>

                    <label class="field-label">
                      <span>Select Vocabulary Word <span class="req">*</span></span>
                      <select id="addModalWordSel" style="width: 100%; padding: 8px 12px; border-radius: 8px;" required>
                        ${this.addAvailableWords.length === 0
                          ? '<option value="">(No words available in this lesson)</option>'
                          : this.addAvailableWords
                              .map(
                                (w) =>
                                  `<option value="${w.id}" ${w.id === this.addSelectedWordId ? 'selected' : ''}>${w.en} ${w.hy ? '— ' + w.hy : ''}</option>`
                              )
                              .join('')}
                      </select>
                    </label>

                    <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                      <button type="button" id="cancelAddModalBtn">Cancel</button>
                      <button type="submit" style="background: var(--ac); color: #fff; border: 0; font-weight: 600; padding: 8px 16px; border-radius: 8px;">
                        Add to Review Collection
                      </button>
                    </div>
                  </form>
                </div>
              </div>`
            : ''
        }
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const practiceBtn = this.container.querySelector('#practiceFailedBtn');
    practiceBtn?.addEventListener('click', () => {
      this.props.onPracticeFailed();
    });

    const clearAllBtn = this.container.querySelector('#clearAllFailedBtn');
    clearAllBtn?.addEventListener('click', async () => {
      const confirmed = confirm('Are you sure you want to clear all failed words from your collection?');
      if (confirmed) {
        await dbManager.clearFailedWords(this.props.userId, this.selectedBookId === 'all' ? undefined : this.selectedBookId);
        await this.loadData();
      }
    });

    const bookFilterSel = this.container.querySelector('#failedBookFilterSelect') as HTMLSelectElement | null;
    bookFilterSel?.addEventListener('change', (e) => {
      this.selectedBookId = (e.target as HTMLSelectElement).value;
      this.render();
    });

    const openAddBtn = this.container.querySelector('#openAddFailedModalBtn');
    openAddBtn?.addEventListener('click', () => {
      this.openAddModal();
    });

    // Delegated actions on failed word cards
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // Mark Mastered / Remove
      const masteredBtn = target.closest('[data-mark-mastered]') as HTMLElement | null;
      if (masteredBtn) {
        const failedId = masteredBtn.dataset.markMastered;
        if (failedId) {
          await dbManager.delete('failedWords', failedId, this.props.userId);
          await this.loadData();
        }
        return;
      }

      const removeBtn = target.closest('[data-remove-failed]') as HTMLElement | null;
      if (removeBtn) {
        const failedId = removeBtn.dataset.removeFailed;
        if (failedId) {
          await dbManager.delete('failedWords', failedId, this.props.userId);
          await this.loadData();
        }
        return;
      }

      // View in lesson
      const gotoBtn = target.closest('[data-goto-word]') as HTMLElement | null;
      if (gotoBtn && this.props.onOpenInLesson) {
        const [bookId, lessonNum, wordId] = gotoBtn.dataset.gotoWord!.split(':');
        this.props.onOpenInLesson(bookId, lessonNum, wordId);
        return;
      }
    });

    // Add Modal Events
    const closeAddX = this.container.querySelector('#closeAddModalXBtn');
    const cancelAddBtn = this.container.querySelector('#cancelAddModalBtn');
    const addForm = this.container.querySelector('#addFailedWordForm') as HTMLFormElement | null;
    const addModalBookSel = this.container.querySelector('#addModalBookSel') as HTMLSelectElement | null;
    const addModalLessonSel = this.container.querySelector('#addModalLessonSel') as HTMLSelectElement | null;
    const addModalWordSel = this.container.querySelector('#addModalWordSel') as HTMLSelectElement | null;

    const closeAddModal = () => {
      this.isAddModalOpen = false;
      this.render();
    };

    closeAddX?.addEventListener('click', closeAddModal);
    cancelAddBtn?.addEventListener('click', closeAddModal);

    addModalBookSel?.addEventListener('change', async (e) => {
      this.addSelectedBookId = (e.target as HTMLSelectElement).value;
      await this.loadAddLessonsAndWords();
      this.render();
    });

    addModalLessonSel?.addEventListener('change', async (e) => {
      this.addSelectedLessonNum = (e.target as HTMLSelectElement).value;
      this.addAvailableWords = await vocabularyService.getWordsForBookAndLesson(
        this.props.userId,
        this.addSelectedBookId,
        this.addSelectedLessonNum || undefined
      );
      this.addSelectedWordId = this.addAvailableWords.length > 0 ? this.addAvailableWords[0].id : '';
      this.render();
    });

    addForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wordId = addModalWordSel?.value;
      if (!wordId) {
        alert('Please select a valid vocabulary word.');
        return;
      }

      const word = this.addAvailableWords.find((w) => w.id === wordId);
      if (!word) return;

      const wordKey = word.normalizedEn || word.en.toLowerCase().trim();
      const failedId = `${this.props.userId}:${word.bookId}:${wordKey}`;

      const existing = await dbManager.getById<FailedWord>('failedWords', failedId, this.props.userId);
      const record: FailedWord = {
        id: failedId,
        userId: this.props.userId,
        bookId: word.bookId,
        wordId: word.id,
        wordKey,
        remainingReviews: 2,
        totalMisses: existing ? existing.totalMisses + 1 : 1,
        lastMissedAt: Date.now(),
      };

      if (existing) {
        await dbManager.update('failedWords', failedId, record, this.props.userId);
      } else {
        await dbManager.create('failedWords', record, this.props.userId);
      }

      this.isAddModalOpen = false;
      await this.loadData();
    });
  }
}
