/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager } from '../db/indexedDB.ts';
import { Book, Lesson, LearningSession, SessionMode } from '../db/types.ts';
import { vocabularyService, WordWithStatus } from '../services/vocabularyService.ts';
import { bookService } from '../services/bookService.ts';
import { lessonService } from '../services/lessonService.ts';
import { explanationService, ExplanationResult } from '../services/explanationService.ts';

export interface LearningGamesHubViewProps {
  userId: string;
  initialBook?: Book;
  initialLessonNumber?: string;
}

type GameMode = 'hub' | 'flashcards' | 'matching' | 'quiz' | 'spelling' | 'memory' | 'quick';

export class LearningGamesHubView {
  private container: HTMLElement;
  private props: LearningGamesHubViewProps;
  private books: Book[] = [];
  private selectedBook: Book | null = null;
  private lessons: Lesson[] = [];
  private selectedLessonNumber: string = '';
  private categoryFilter: 'all' | 'learning' | 'known' | 'failed' = 'all';

  private activeGame: GameMode = 'hub';
  private sessionWords: WordWithStatus[] = [];
  private sessionIndex: number = 0;
  private correctCount: number = 0;
  private missCount: number = 0;
  private sessionStartedAt: number = 0;
  private sessionFinished: boolean = false;
  private isLoading: boolean = false;

  // Mode-specific transient state
  private flashcardRevealed: boolean = false;
  private quizOptions: { text: string; isCorrect: boolean }[] = [];
  private quizSelectedOption: number | null = null;
  private spellingInput: string = '';
  private spellingChecked: boolean = false;
  private spellingCorrect: boolean = false;

  // Explanation & Retry state for incorrect answers (Task 15)
  private currentExplanation: ExplanationResult | null = null;
  private isRetryAllowed: boolean = false;
  private hasRetried: boolean = false;

  // Matching & Memory game state
  private matchTiles: { id: string; text: string; matchKey: string; type: 'en' | 'trans' }[] = [];
  private selectedTileId: string | null = null;
  private matchedPairKeys: Set<string> = new Set();
  private memoryCards: { id: string; wordId: string; text: string; isFlipped: boolean; isMatched: boolean }[] = [];
  private memoryFirstSelectedId: string | null = null;
  private memoryLock: boolean = false;

  constructor(container: HTMLElement, props: LearningGamesHubViewProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.books = await bookService.getUserBooks(this.props.userId);
      if (this.props.initialBook) {
        this.selectedBook = this.props.initialBook;
      } else if (this.books.length > 0) {
        this.selectedBook = this.books[0];
      }

      if (this.selectedBook) {
        this.lessons = await lessonService.getLessonsForBook(this.selectedBook.id, this.props.userId);
      }
      this.selectedLessonNumber = this.props.initialLessonNumber || '';
    } catch (err) {
      console.warn('Could not initialize learning games hub:', err);
    }
    this.render();
  }

  private async loadWordsForSession(): Promise<WordWithStatus[]> {
    if (!this.selectedBook) return [];
    try {
      let list = await vocabularyService.getWordsWithStatus(
        this.props.userId,
        this.selectedBook.id,
        this.selectedLessonNumber || undefined
      );

      if (this.categoryFilter === 'known') {
        list = list.filter((w) => w.isKnown);
      } else if (this.categoryFilter === 'learning') {
        list = list.filter((w) => !w.isKnown);
      } else if (this.categoryFilter === 'failed') {
        const failedRecords = await dbManager.getFailedWordsForBook(this.props.userId, this.selectedBook.id);
        const failedKeys = new Set(failedRecords.map((f) => f.wordKey || f.wordId));
        list = list.filter((w) => failedKeys.has(w.normalizedEn) || failedKeys.has(w.id));
      }

      return list;
    } catch {
      return [];
    }
  }

  private async startGame(mode: GameMode): Promise<void> {
    this.isLoading = true;
    this.render();

    const rawWords = await this.loadWordsForSession();
    if (rawWords.length === 0) {
      alert('No vocabulary words available for the selected book, lesson, and category filter.');
      this.isLoading = false;
      this.render();
      return;
    }

    this.sessionWords = [...rawWords].sort(() => Math.random() - 0.5);
    if (this.sessionWords.length > 25 && mode !== 'flashcards') {
      this.sessionWords = this.sessionWords.slice(0, 20);
    }

    this.activeGame = mode;
    this.sessionIndex = 0;
    this.correctCount = 0;
    this.missCount = 0;
    this.sessionStartedAt = Date.now();
    this.sessionFinished = false;
    this.isLoading = false;

    this.initModeState(mode);
    this.render();
  }

  private initModeState(mode: GameMode): void {
    this.currentExplanation = null;
    this.isRetryAllowed = false;
    this.hasRetried = false;

    if (mode === 'flashcards' || mode === 'quick') {
      this.flashcardRevealed = false;
    } else if (mode === 'quiz') {
      this.setupQuizQuestion();
    } else if (mode === 'spelling') {
      this.spellingInput = '';
      this.spellingChecked = false;
      this.spellingCorrect = false;
    } else if (mode === 'matching') {
      this.setupMatchingTiles();
    } else if (mode === 'memory') {
      this.setupMemoryCards();
    }
  }

  private setupQuizQuestion(): void {
    const current = this.sessionWords[this.sessionIndex];
    if (!current) return;

    this.quizSelectedOption = null;
    const correctTranslation = current.hy;

    const otherWords = this.sessionWords.filter((w) => w.id !== current.id);
    const wrongOptions: string[] = [];

    while (wrongOptions.length < 3 && otherWords.length > 0) {
      const idx = Math.floor(Math.random() * otherWords.length);
      const candidate = otherWords.splice(idx, 1)[0].hy;
      if (candidate !== correctTranslation && !wrongOptions.includes(candidate)) {
        wrongOptions.push(candidate);
      }
    }

    const fallbacks = ['տուն (House)', 'դպրոց (School)', 'գիրք (Book)', 'ընկեր (Friend)', 'աշխատանք (Work)'];
    for (const fb of fallbacks) {
      if (wrongOptions.length < 3 && !wrongOptions.includes(fb) && fb !== correctTranslation) {
        wrongOptions.push(fb);
      }
    }

    const options = [
      { text: correctTranslation, isCorrect: true },
      ...wrongOptions.map((text) => ({ text, isCorrect: false })),
    ];

    this.quizOptions = options.sort(() => Math.random() - 0.5);
  }

  private setupMatchingTiles(): void {
    const currentSubset = this.sessionWords.slice(0, Math.min(6, this.sessionWords.length));
    const tiles: { id: string; text: string; matchKey: string; type: 'en' | 'trans' }[] = [];

    currentSubset.forEach((w, idx) => {
      tiles.push({
        id: `en_${idx}`,
        text: w.en,
        matchKey: w.id,
        type: 'en',
      });
      tiles.push({
        id: `tr_${idx}`,
        text: w.hy,
        matchKey: w.id,
        type: 'trans',
      });
    });

    this.matchTiles = tiles.sort(() => Math.random() - 0.5);
    this.selectedTileId = null;
    this.matchedPairKeys.clear();
  }

  private setupMemoryCards(): void {
    const currentSubset = this.sessionWords.slice(0, Math.min(6, this.sessionWords.length));
    const cards: { id: string; wordId: string; text: string; isFlipped: boolean; isMatched: boolean }[] = [];

    currentSubset.forEach((w, idx) => {
      cards.push({
        id: `card_en_${idx}`,
        wordId: w.id,
        text: w.en,
        isFlipped: false,
        isMatched: false,
      });
      cards.push({
        id: `card_tr_${idx}`,
        wordId: w.id,
        text: w.hy,
        isFlipped: false,
        isMatched: false,
      });
    });

    this.memoryCards = cards.sort(() => Math.random() - 0.5);
    this.memoryFirstSelectedId = null;
    this.memoryLock = false;
  }

  private async recordAttempt(word: WordWithStatus, isCorrect: boolean): Promise<void> {
    if (!this.selectedBook) return;
    const wordKey = word.normalizedEn || word.en.toLowerCase().trim();
    try {
      await dbManager.recordWordAttempt(this.props.userId, this.selectedBook.id, wordKey, isCorrect);
      if (isCorrect) {
        this.correctCount++;
      } else {
        this.missCount++;
      }
    } catch (err) {
      console.warn('Failed to record word attempt:', err);
    }
  }

  private async finishSession(): Promise<void> {
    this.sessionFinished = true;
    const duration = Math.round((Date.now() - this.sessionStartedAt) / 1000);
    const modeMap: Record<GameMode, SessionMode> = {
      hub: 'lesson',
      flashcards: 'cards',
      matching: 'match',
      quiz: 'lesson',
      spelling: 'lesson',
      memory: 'cards',
      quick: 'lesson',
    };

    const sessionRecord: LearningSession = {
      id: `session_${this.props.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: this.props.userId,
      bookId: this.selectedBook?.id || 'unknown',
      lesson: this.selectedLessonNumber || undefined,
      mode: modeMap[this.activeGame] || 'lesson',
      totalCards: this.correctCount + this.missCount,
      correctCount: this.correctCount,
      missCount: this.missCount,
      durationSeconds: duration,
      startedAt: this.sessionStartedAt,
      completedAt: Date.now(),
    };

    try {
      await dbManager.create('learningSessions', sessionRecord, this.props.userId);
    } catch (err) {
      console.warn('Failed to save learning session record:', err);
    }

    this.render();
  }

  private render(): void {
    if (this.isLoading) {
      this.container.innerHTML = `
        <div class="card" style="text-align: center; padding: 48px; color: var(--mu);">
          <div style="font-size: 2rem; margin-bottom: 8px;">⏳</div>
          <p style="margin: 0; font-weight: 600;">Preparing learning session...</p>
        </div>
      `;
      return;
    }

    if (this.activeGame === 'hub') {
      this.renderHub();
    } else if (this.sessionFinished) {
      this.renderSessionSummary();
    } else {
      this.renderActiveGame();
    }
  }

  private renderHub(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div class="card" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.4rem;">🎮</span>
                <h3 style="margin: 0; font-size: 1.3rem;">Vocabulary Learning Games</h3>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
                Choose a textbook, lesson unit, and game mode to test and reinforce your vocabulary.
              </p>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
            <label class="field-label" style="margin: 0;">
              <span>Textbook</span>
              <select id="hubBookSelect" style="width: 100%; padding: 8px 12px; font-size: 0.88rem; border-radius: 10px;">
                ${this.books.map((b) => `<option value="${b.id}" ${this.selectedBook?.id === b.id ? 'selected' : ''}>${b.isBuiltin ? '📖 ' : '📘 '} ${b.name}</option>`).join('')}
              </select>
            </label>

            <label class="field-label" style="margin: 0;">
              <span>Lesson Unit</span>
              <select id="hubLessonSelect" style="width: 100%; padding: 8px 12px; font-size: 0.88rem; border-radius: 10px;">
                <option value="">(All Lessons / Units)</option>
                ${this.lessons.map((l) => `<option value="${l.lessonNumber}" ${this.selectedLessonNumber === l.lessonNumber ? 'selected' : ''}>${l.name || 'Lesson ' + l.lessonNumber}</option>`).join('')}
              </select>
            </label>

            <label class="field-label" style="margin: 0;">
              <span>Category Filter</span>
              <select id="hubCategorySelect" style="width: 100%; padding: 8px 12px; font-size: 0.88rem; border-radius: 10px;">
                <option value="all" ${this.categoryFilter === 'all' ? 'selected' : ''}>All Words</option>
                <option value="learning" ${this.categoryFilter === 'learning' ? 'selected' : ''}>⏳ In Progress (Learning)</option>
                <option value="known" ${this.categoryFilter === 'known' ? 'selected' : ''}>✓ Mastered (Known)</option>
                <option value="failed" ${this.categoryFilter === 'failed' ? 'selected' : ''}>⚠️ Failed Words Review Pool</option>
              </select>
            </label>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
          <div class="card game-card" data-mode="flashcards" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid var(--ac);">
            <div style="font-size: 2rem; margin-bottom: 8px;">🃏</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Flashcards</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Flip cards to review English words and translations.</p>
          </div>
          <div class="card game-card" data-mode="matching" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid var(--ok);">
            <div style="font-size: 2rem; margin-bottom: 8px;">🧩</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Matching Game</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Match English words with their translations in pairs.</p>
          </div>
          <div class="card game-card" data-mode="quiz" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid #8b5cf6;">
            <div style="font-size: 2rem; margin-bottom: 8px;">❓</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Multiple-Choice Quiz</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Select the correct translation from multiple options.</p>
          </div>
          <div class="card game-card" data-mode="spelling" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid #f59e0b;">
            <div style="font-size: 2rem; margin-bottom: 8px;">⌨️</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Spelling Practice</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Type the English word after seeing its translation.</p>
          </div>
          <div class="card game-card" data-mode="memory" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid #ec4899;">
            <div style="font-size: 2rem; margin-bottom: 8px;">🧠</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Memory Flip Game</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Flip cards over to find matching pairs.</p>
          </div>
          <div class="card game-card" data-mode="quick" style="margin-bottom: 0; cursor: pointer; border-left: 4px solid #06b6d4;">
            <div style="font-size: 2rem; margin-bottom: 8px;">⚡</div>
            <h4 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--tx);">Quick Review</h4>
            <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">Rapid-fire review of random vocabulary.</p>
          </div>
        </div>
      </div>
    `;

    this.bindHubEvents();
  }

  private bindHubEvents(): void {
    const bookSelect = this.container.querySelector('#hubBookSelect') as HTMLSelectElement | null;
    const lessonSelect = this.container.querySelector('#hubLessonSelect') as HTMLSelectElement | null;
    const categorySelect = this.container.querySelector('#hubCategorySelect') as HTMLSelectElement | null;

    bookSelect?.addEventListener('change', async (e) => {
      const bookId = (e.target as HTMLSelectElement).value;
      this.selectedBook = this.books.find((b) => b.id === bookId) || null;
      if (this.selectedBook) {
        this.lessons = await lessonService.getLessonsForBook(this.selectedBook.id, this.props.userId);
        this.selectedLessonNumber = '';
      }
      this.render();
    });

    lessonSelect?.addEventListener('change', (e) => {
      this.selectedLessonNumber = (e.target as HTMLSelectElement).value;
    });

    categorySelect?.addEventListener('change', (e) => {
      this.categoryFilter = (e.target as HTMLSelectElement).value as any;
    });

    this.container.querySelectorAll('.game-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset.mode as GameMode;
        if (mode) {
          this.startGame(mode);
        }
      });
    });
  }

  private renderExplanationCard(): string {
    if (!this.currentExplanation) return '';
    const exp = this.currentExplanation;

    return `
      <div class="card" style="background: color-mix(in srgb, var(--no) 10%, var(--sf)); border: 1px solid var(--no); border-radius: 16px; padding: 20px; margin-top: 14px; animation: fadeIn 0.3s ease;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span style="font-size: 1.2rem;">💡</span>
          <h4 style="margin: 0; font-size: 1.05rem; color: var(--no);">${exp.title}</h4>
        </div>

        <div style="display: grid; gap: 8px; font-size: 0.9rem; margin-bottom: 14px;">
          <div style="color: var(--tx);">
            Correct Answer: <strong style="font-size: 1.05rem; color: var(--ok);">${exp.correctAnswerText}</strong> (${exp.correctTranslationText})
          </div>

          ${exp.comparisonNote ? `
            <div style="color: var(--tx); background: rgba(0,0,0,0.04); padding: 8px 12px; border-radius: 8px;">
              ${exp.comparisonNote}
            </div>
          ` : ''}

          <div style="color: var(--tx); line-height: 1.4;">
            ${exp.explanation}
          </div>

          ${exp.exampleSentence ? `
            <div style="color: var(--mu); font-style: italic; margin-top: 2px;">
              Example: "${exp.exampleSentence}"
            </div>
          ` : ''}
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 10px; border-top: 1px solid var(--ln);">
          ${this.isRetryAllowed && !this.hasRetried ? `
            <button type="button" id="retryQuestionBtn" class="sm" style="background: var(--ac); color: #fff; border: 0; font-weight: 600; padding: 8px 14px; border-radius: 10px;">
              🔄 Retry Question
            </button>
          ` : ''}
          <button type="button" id="nextQuestionAfterExpBtn" class="p" style="font-weight: 600; padding: 8px 16px; border-radius: 10px; font-size: 0.88rem;">
            Continue ➔
          </button>
        </div>
      </div>
    `;
  }

  private renderActiveGame(): void {
    const currentWord = this.sessionWords[this.sessionIndex];
    const total = this.sessionWords.length;
    const progressPct = Math.round(((this.sessionIndex) / total) * 100);

    let gameContentHtml = '';

    if (this.activeGame === 'flashcards' || this.activeGame === 'quick') {
      gameContentHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 20px;">
          <div id="flashcardEl" class="card" style="width: 100%; max-width: 480px; min-height: 260px; display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; padding: 32px; cursor: pointer; background: var(--sf); border: 2px solid var(--ln); border-radius: 20px; box-shadow: var(--sh);">
            <div style="font-size: 0.78rem; color: var(--mu); text-transform: uppercase; letter-spacing: 0.5px;">
              ${this.flashcardRevealed ? 'Translation & Details' : 'English Word (Tap to reveal)'}
            </div>

            <div style="margin: auto 0;">
              <div style="font-size: 2rem; font-weight: 800; color: var(--tx); margin-bottom: 8px;">
                ${currentWord.en}
              </div>
              <div style="display: flex; gap: 6px; justify-content: center; margin-bottom: 12px; flex-wrap: wrap;">
                ${currentWord.type ? `<span class="chip" style="font-size: 0.7rem; text-transform: uppercase;">${currentWord.type}</span>` : ''}
                ${currentWord.pronunciation ? `<span style="font-family: monospace; font-size: 0.82rem; color: var(--mu);">${currentWord.pronunciation}</span>` : ''}
              </div>

              ${this.flashcardRevealed ? `
                <div style="animation: fadeIn 0.3s ease; border-top: 1px dashed var(--ln); padding-top: 14px; margin-top: 6px; width: 100%;">
                  <div style="font-size: 1.25rem; font-weight: 700; color: var(--tx); margin-bottom: 4px;">
                    🇦🇲 ${currentWord.hy}
                  </div>
                  ${currentWord.ru ? `<div style="font-size: 1.05rem; color: var(--mu); margin-bottom: 6px;">🇷🇺 ${currentWord.ru}</div>` : ''}
                  ${currentWord.definition ? `<div style="font-size: 0.88rem; color: var(--tx); margin-top: 6px;">${currentWord.definition}</div>` : ''}
                  ${currentWord.example ? `<div style="font-size: 0.85rem; color: var(--mu); font-style: italic; margin-top: 4px;">"${currentWord.example}"</div>` : ''}
                </div>
              ` : `
                <div style="font-size: 0.9rem; color: var(--ac); margin-top: 16px; font-weight: 600;">
                  Tap card or press Space to reveal 👆
                </div>
              `}
            </div>

            <div style="font-size: 0.75rem; color: var(--mu);">
              Unit ${currentWord.lesson}
            </div>
          </div>

          ${this.flashcardRevealed ? `
            <div style="display: flex; gap: 12px; width: 100%; max-width: 480px;">
              <button type="button" id="flashcardIncorrectBtn" style="flex: 1; padding: 12px; border-radius: 14px; background: color-mix(in srgb, var(--no) 15%, var(--sf)); color: var(--no); border: 1px solid var(--no); font-weight: 600;">
                ✕ Still Learning
              </button>
              <button type="button" id="flashcardCorrectBtn" style="flex: 1; padding: 12px; border-radius: 14px; background: var(--ok); color: #fff; border: 0; font-weight: 600;">
                ✓ I Know This!
              </button>
            </div>
          ` : `
            <button type="button" id="flashcardRevealBtn" class="p" style="width: 100%; max-width: 480px; padding: 12px; border-radius: 14px; font-weight: 600;">
              Reveal Translation
            </button>
          `}

          ${this.currentExplanation ? this.renderExplanationCard() : ''}
        </div>
      `;
    } else if (this.activeGame === 'quiz') {
      gameContentHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 520px; margin: 0 auto;">
          <div class="card" style="width: 100%; margin-bottom: 0; padding: 24px; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; margin-bottom: 6px;">Select the correct translation</div>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--tx); margin-bottom: 4px;">${currentWord.en}</div>
            ${currentWord.pronunciation ? `<div style="font-family: monospace; font-size: 0.85rem; color: var(--mu);">${currentWord.pronunciation}</div>` : ''}
          </div>

          <div style="display: grid; grid-template-columns: 1fr; gap: 10px; width: 100%;">
            ${this.quizOptions
              .map((opt, idx) => {
                let bg = 'var(--sf)';
                let border = 'var(--ln)';
                if (this.quizSelectedOption !== null) {
                  if (opt.isCorrect) {
                    bg = 'color-mix(in srgb, var(--ok) 20%, var(--sf))';
                    border = 'var(--ok)';
                  } else if (this.quizSelectedOption === idx) {
                    bg = 'color-mix(in srgb, var(--no) 20%, var(--sf))';
                    border = 'var(--no)';
                  }
                }
                return `
                  <button
                    type="button"
                    class="quiz-option-btn"
                    data-option-idx="${idx}"
                    style="padding: 14px 18px; border-radius: 14px; background: ${bg}; border: 2px solid ${border}; font-size: 1.05rem; font-weight: 600; text-align: left; cursor: pointer; color: var(--tx); transition: all 0.2s;"
                    ${this.quizSelectedOption !== null ? 'disabled' : ''}
                  >
                    <span style="display: inline-block; width: 24px; color: var(--mu); font-weight: 700;">${String.fromCharCode(65 + idx)}.</span>
                    ${opt.text}
                  </button>
                `;
              })
              .join('')}
          </div>

          ${this.quizSelectedOption !== null && !this.currentExplanation ? `
            <button type="button" id="nextQuizWordBtn" class="p" style="width: 100%; padding: 14px; border-radius: 14px; font-weight: 600; font-size: 1rem; margin-top: 4px;">
              Next Word ➔
            </button>
          ` : ''}

          ${this.currentExplanation ? this.renderExplanationCard() : ''}
        </div>
      `;
    } else if (this.activeGame === 'spelling') {
      gameContentHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 500px; margin: 0 auto;">
          <div class="card" style="width: 100%; margin-bottom: 0; padding: 24px; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--mu); text-transform: uppercase; margin-bottom: 6px;">Type the English spelling</div>
            <div style="font-size: 1.6rem; font-weight: 800; color: var(--tx); margin-bottom: 8px;">🇦🇲 ${currentWord.hy}</div>
            ${currentWord.ru ? `<div style="font-size: 0.95rem; color: var(--mu); margin-bottom: 6px;">🇷🇺 ${currentWord.ru}</div>` : ''}
            ${currentWord.definition ? `<div style="font-size: 0.85rem; color: var(--mu); font-style: italic;">"${currentWord.definition}"</div>` : ''}
          </div>

          <form id="spellingForm" style="display: flex; flex-direction: column; gap: 12px; width: 100%;" novalidate>
            <input
              type="text"
              id="spellingInput"
              placeholder="Type English word here..."
              value="${this.spellingInput}"
              autocomplete="off"
              autofocus
              style="padding: 14px 16px; font-size: 1.15rem; border-radius: 14px; border: 2px solid var(--ln); text-align: center;"
              ${this.spellingChecked && !this.isRetryAllowed ? 'disabled' : ''}
            />

            ${this.spellingChecked && !this.isRetryAllowed ? `
              <div class="chip ${this.spellingCorrect ? 'ok' : 'no'}" style="display: block; text-align: center; padding: 12px; border-radius: 12px; font-size: 1rem; font-weight: 600;">
                ${this.spellingCorrect ? '✓ Correct spelling!' : `✕ Incorrect.`}
              </div>
            ` : ''}

            ${!this.spellingChecked ? `
              <button type="submit" class="p" style="padding: 12px; border-radius: 14px; font-weight: 600;">
                Check Spelling
              </button>
            ` : ''}

            ${this.spellingChecked && this.spellingCorrect && !this.currentExplanation ? `
              <button type="button" id="nextSpellingWordBtn" class="p" style="width: 100%; padding: 14px; border-radius: 14px; font-weight: 600; font-size: 1rem;">
                Next Word ➔
              </button>
            ` : ''}
          </form>

          ${this.currentExplanation ? this.renderExplanationCard() : ''}
        </div>
      `;
    } else if (this.activeGame === 'matching') {
      const allMatched = this.matchedPairKeys.size === Math.min(6, this.sessionWords.length);
      gameContentHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center;">
            <h4 style="margin: 0 0 4px; font-size: 1.15rem;">Match English Words with Translations</h4>
            <p style="margin: 0; font-size: 0.85rem; color: var(--mu);">Tap an English card and its corresponding translation card.</p>
          </div>

          ${allMatched ? `
            <div class="card" style="text-align: center; padding: 32px; width: 100%; background: color-mix(in srgb, var(--ok) 12%, var(--sf));">
              <div style="font-size: 2.2rem; margin-bottom: 8px;">🎉</div>
              <h3 style="margin: 0 0 8px; color: var(--ok);">All pairs matched successfully!</h3>
              <button type="button" id="matchingCompleteBtn" class="p" style="padding: 10px 20px; border-radius: 12px; font-weight: 600; margin-top: 10px;">
                View Results ➔
              </button>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; width: 100%;">
              ${this.matchTiles
                .map((tile) => {
                  const isMatched = this.matchedPairKeys.has(tile.matchKey);
                  const isSelected = this.selectedTileId === tile.id;
                  if (isMatched) return '';
                  return `
                    <button
                      type="button"
                      class="match-tile-btn"
                      data-tile-id="${tile.id}"
                      data-match-key="${tile.matchKey}"
                      style="padding: 16px 12px; min-height: 80px; border-radius: 14px; background: ${isSelected ? 'color-mix(in srgb, var(--ac) 20%, var(--sf))' : 'var(--sf)'}; border: 2px solid ${isSelected ? 'var(--ac)' : 'var(--ln)'}; font-size: 0.95rem; font-weight: 600; cursor: pointer; color: var(--tx); display: flex; align-items: center; justify-content: center; text-align: center; box-shadow: var(--sh);"
                    >
                      ${tile.text}
                    </button>
                  `;
                })
                .join('')}
            </div>
          `}
        </div>
      `;
    } else if (this.activeGame === 'memory') {
      const allMemoryMatched = this.memoryCards.every((c) => c.isMatched);
      gameContentHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center;">
            <h4 style="margin: 0 0 4px; font-size: 1.15rem;">Memory Flip Game</h4>
            <p style="margin: 0; font-size: 0.85rem; color: var(--mu);">Flip two cards at a time to find matching English-translation pairs.</p>
          </div>

          ${allMemoryMatched ? `
            <div class="card" style="text-align: center; padding: 32px; width: 100%; background: color-mix(in srgb, var(--ok) 12%, var(--sf));">
              <div style="font-size: 2.2rem; margin-bottom: 8px;">🏆</div>
              <h3 style="margin: 0 0 8px; color: var(--ok);">Memory match completed!</h3>
              <button type="button" id="memoryCompleteBtn" class="p" style="padding: 10px 20px; border-radius: 12px; font-weight: 600; margin-top: 10px;">
                View Results ➔
              </button>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; width: 100%;">
              ${this.memoryCards
                .map((card) => {
                  if (card.isMatched) {
                    return `<div style="min-height: 90px; border-radius: 14px; opacity: 0.2; background: var(--ln);"></div>`;
                  }
                  return `
                    <button
                      type="button"
                      class="memory-card-btn"
                      data-card-id="${card.id}"
                      style="min-height: 90px; padding: 12px; border-radius: 14px; background: ${card.isFlipped ? 'var(--sf)' : 'var(--ac)'}; color: ${card.isFlipped ? 'var(--tx)' : '#fff'}; border: 2px solid var(--ln); font-size: 0.9rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; text-align: center; box-shadow: var(--sh); transition: transform 0.2s;"
                    >
                      ${card.isFlipped ? card.text : '❓'}
                    </button>
                  `;
                })
                .join('')}
            </div>
          `}
        </div>
      `;
    }

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 18px; max-width: 700px; margin: 0 auto;">
        <div class="card" style="margin-bottom: 0; display: flex; justify-content: space-between; align-items: center; padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <button type="button" id="exitGameHubBtn" class="sm" title="Return to Games Hub">
              ✕ Exit Game
            </button>
            <span style="font-weight: 700; font-size: 1rem; text-transform: capitalize;">
              ${this.activeGame} Practice
            </span>
          </div>

          ${this.activeGame !== 'matching' && this.activeGame !== 'memory' ? `
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 0.85rem; color: var(--mu);">
                Card <strong class="tabular-nums">${this.sessionIndex + 1}</strong> of <strong class="tabular-nums">${total}</strong>
              </span>
              <div style="width: 100px; height: 8px; background: var(--ln); border-radius: 4px; overflow: hidden;">
                <div style="width: ${progressPct}%; height: 100%; background: var(--ac); transition: width 0.3s ease;"></div>
              </div>
            </div>
          ` : ''}
        </div>

        ${gameContentHtml}
      </div>
    `;

    this.bindGameEvents();
  }

  private bindGameEvents(): void {
    this.container.querySelector('#exitGameHubBtn')?.addEventListener('click', () => {
      this.activeGame = 'hub';
      this.render();
    });

    // Flashcards events
    const flashcardEl = this.container.querySelector('#flashcardEl');
    const revealBtn = this.container.querySelector('#flashcardRevealBtn');
    const correctBtn = this.container.querySelector('#flashcardCorrectBtn');
    const incorrectBtn = this.container.querySelector('#flashcardIncorrectBtn');

    const revealCard = () => {
      this.flashcardRevealed = true;
      this.render();
    };

    flashcardEl?.addEventListener('click', revealCard);
    revealBtn?.addEventListener('click', revealCard);

    correctBtn?.addEventListener('click', async () => {
      await this.recordAttempt(this.sessionWords[this.sessionIndex], true);
      this.nextFlashcard();
    });

    incorrectBtn?.addEventListener('click', async () => {
      const currentWord = this.sessionWords[this.sessionIndex];
      await this.recordAttempt(currentWord, false);

      if (!this.hasRetried && !this.currentExplanation) {
        this.currentExplanation = explanationService.generateExplanation(currentWord, 'Still learning rating');
        this.isRetryAllowed = true;
        this.render();
      } else {
        this.nextFlashcard();
      }
    });

    // Quiz events
    this.container.querySelectorAll('.quiz-option-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        if (this.quizSelectedOption !== null) return;
        const idx = parseInt((e.currentTarget as HTMLElement).dataset.optionIdx || '0', 10);
        this.quizSelectedOption = idx;
        const opt = this.quizOptions[idx];
        const currentWord = this.sessionWords[this.sessionIndex];

        await this.recordAttempt(currentWord, opt.isCorrect);

        if (!opt.isCorrect && !this.hasRetried) {
          this.currentExplanation = explanationService.generateExplanation(currentWord, opt.text);
          this.isRetryAllowed = true;
          this.render();
        } else {
          this.render();
        }
      });
    });

    this.container.querySelector('#nextQuestionAfterExpBtn')?.addEventListener('click', () => {
      this.advanceAfterExplanation();
    });

    this.container.querySelector('#nextQuizWordBtn')?.addEventListener('click', () => {
      this.advanceAfterExplanation();
    });

    this.container.querySelector('#nextSpellingWordBtn')?.addEventListener('click', () => {
      this.advanceAfterExplanation();
    });

    this.container.querySelector('#retryQuestionBtn')?.addEventListener('click', () => {
      this.hasRetried = true;
      this.currentExplanation = null;
      this.isRetryAllowed = false;
      if (this.activeGame === 'quiz') {
        this.quizSelectedOption = null;
      } else if (this.activeGame === 'spelling') {
        this.spellingChecked = false;
        this.spellingInput = '';
      } else if (this.activeGame === 'flashcards' || this.activeGame === 'quick') {
        this.flashcardRevealed = false;
      }
      this.render();
    });

    // Spelling events
    const spellingForm = this.container.querySelector('#spellingForm');
    spellingForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.spellingChecked && !this.isRetryAllowed) return;

      const inputEl = this.container.querySelector('#spellingInput') as HTMLInputElement | null;
      const val = (inputEl?.value || '').trim();
      this.spellingInput = val;
      const current = this.sessionWords[this.sessionIndex];
      const expected = current.en.toLowerCase().trim();

      this.spellingCorrect = val.toLowerCase().trim() === expected;
      this.spellingChecked = true;
      await this.recordAttempt(current, this.spellingCorrect);

      if (!this.spellingCorrect && !this.hasRetried) {
        this.currentExplanation = explanationService.generateExplanation(current, val);
        this.isRetryAllowed = true;
        this.render();
      } else {
        this.render();
      }
    });

    // Matching game events
    this.container.querySelectorAll('.match-tile-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const tileId = target.dataset.tileId || '';
        const matchKey = target.dataset.matchKey || '';

        if (!this.selectedTileId) {
          this.selectedTileId = tileId;
          this.render();
        } else if (this.selectedTileId === tileId) {
          this.selectedTileId = null;
          this.render();
        } else {
          const firstTile = this.matchTiles.find((t) => t.id === this.selectedTileId);
          const secondTile = this.matchTiles.find((t) => t.id === tileId);

          if (firstTile && secondTile && firstTile.matchKey === secondTile.matchKey && firstTile.type !== secondTile.type) {
            this.matchedPairKeys.add(matchKey);
            const word = this.sessionWords.find((w) => w.id === matchKey);
            if (word) await this.recordAttempt(word, true);
          } else {
            const word = this.sessionWords.find((w) => w.id === matchKey);
            if (word) await this.recordAttempt(word, false);
          }
          this.selectedTileId = null;
          this.render();
        }
      });
    });

    this.container.querySelector('#matchingCompleteBtn')?.addEventListener('click', () => {
      this.finishSession();
    });

    // Memory game events
    this.container.querySelectorAll('.memory-card-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        if (this.memoryLock) return;
        const target = e.currentTarget as HTMLElement;
        const cardId = target.dataset.cardId || '';
        const card = this.memoryCards.find((c) => c.id === cardId);
        if (!card || card.isFlipped || card.isMatched) return;

        card.isFlipped = true;

        if (!this.memoryFirstSelectedId) {
          this.memoryFirstSelectedId = cardId;
          this.render();
        } else {
          const firstCard = this.memoryCards.find((c) => c.id === this.memoryFirstSelectedId);
          this.memoryFirstSelectedId = null;

          if (firstCard && firstCard.wordId === card.wordId && firstCard.id !== card.id) {
            firstCard.isMatched = true;
            card.isMatched = true;
            const word = this.sessionWords.find((w) => w.id === card.wordId);
            if (word) await this.recordAttempt(word, true);
            this.render();
          } else {
            this.memoryLock = true;
            const word = this.sessionWords.find((w) => w.id === card.wordId);
            if (word) await this.recordAttempt(word, false);
            this.render();
            setTimeout(() => {
              if (firstCard) firstCard.isFlipped = false;
              card.isFlipped = false;
              this.memoryLock = false;
              this.render();
            }, 900);
          }
        }
      });
    });

    this.container.querySelector('#memoryCompleteBtn')?.addEventListener('click', () => {
      this.finishSession();
    });
  }

  private advanceAfterExplanation(): void {
    this.sessionIndex++;
    if (this.sessionIndex >= this.sessionWords.length) {
      this.finishSession();
    } else {
      this.initModeState(this.activeGame);
      this.render();
    }
  }

  private nextFlashcard(): void {
    if (this.currentExplanation) {
      this.advanceAfterExplanation();
      return;
    }
    this.sessionIndex++;
    if (this.sessionIndex >= this.sessionWords.length) {
      this.finishSession();
    } else {
      this.flashcardRevealed = false;
      this.render();
    }
  }

  private renderSessionSummary(): void {
    const total = this.correctCount + this.missCount;
    const accuracy = total === 0 ? 0 : Math.round((this.correctCount / total) * 100);

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 520px; margin: 0 auto; text-align: center;">
        <div class="card" style="width: 100%; padding: 40px; margin-bottom: 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🏆</div>
          <h2 style="margin: 0 0 6px; font-size: 1.5rem; color: var(--tx);">Session Completed!</h2>
          <p style="margin: 0 0 24px; color: var(--mu); font-size: 0.9rem;">
            Great job practicing vocabulary in <strong>${this.selectedBook?.name || 'Textbook'}</strong>.
          </p>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
            <div style="background: var(--bg); padding: 14px; border-radius: 12px;">
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--tx);" class="tabular-nums">${total}</div>
              <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Cards Practiced</div>
            </div>
            <div style="background: var(--bg); padding: 14px; border-radius: 12px;">
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--ok);" class="tabular-nums">${this.correctCount}</div>
              <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Correct</div>
            </div>
            <div style="background: var(--bg); padding: 14px; border-radius: 12px;">
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--ac);" class="tabular-nums">${accuracy}%</div>
              <div style="font-size: 0.75rem; color: var(--mu); text-transform: uppercase;">Accuracy</div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <button type="button" id="playAgainBtn" class="p" style="padding: 10px 20px; border-radius: 12px; font-weight: 600;">
              Play Again
            </button>
            <button type="button" id="returnHubBtn" class="sm" style="padding: 10px 20px; border-radius: 12px; font-weight: 600;">
              Choose Another Game
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector('#playAgainBtn')?.addEventListener('click', () => {
      this.startGame(this.activeGame);
    });

    this.container.querySelector('#returnHubBtn')?.addEventListener('click', () => {
      this.activeGame = 'hub';
      this.sessionFinished = false;
      this.render();
    });
  }
}
