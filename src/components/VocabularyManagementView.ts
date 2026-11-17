/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, Lesson, PartOfSpeech, VocabularyType } from '../db/types.ts';
import { ValidationError } from '../db/validators.ts';
import { vocabularyService, WordWithStatus } from '../services/vocabularyService.ts';
import { VocabularyImportModal } from './VocabularyImportModal.ts';
import { PronunciationPracticeModal } from './PronunciationPracticeModal.ts';

export interface VocabularyManagementViewProps {
  userId: string;
  book: Book;
  currentLessonNumber?: string;
  lessons: Lesson[];
  highlightWordId?: string;
  onLessonFilterChanged?: (lessonNumber: string) => void;
  onWordChanged?: () => void;
}

export class VocabularyManagementView {
  private container: HTMLElement;
  private props: VocabularyManagementViewProps;
  private words: WordWithStatus[] = [];
  private searchQuery: string = '';
  private filterKnown: 'all' | 'known' | 'learning' = 'all';
  private viewMode: 'table' | 'cards' = 'table';
  private isLoading: boolean = true;

  // Modals state
  private activeModal: 'none' | 'create' | 'edit' | 'delete' = 'none';
  private targetWord: WordWithStatus | null = null;
  private modalError: string = '';
  private feedbackMessage: { text: string; type: 'success' | 'error' } | null = null;
  private showImportModal: boolean = false;

  constructor(container: HTMLElement, props: VocabularyManagementViewProps) {
    this.container = container;
    this.props = props;
    this.loadWords();
  }

  public async setFilter(book: Book, lessonNumber?: string, lessons?: Lesson[]): Promise<void> {
    this.props.book = book;
    this.props.currentLessonNumber = lessonNumber;
    if (lessons) this.props.lessons = lessons;
    await this.loadWords();
  }

  public async loadWords(): Promise<void> {
    this.isLoading = true;
    this.render();
    try {
      this.words = await vocabularyService.getWordsWithStatus(
        this.props.userId,
        this.props.book.id,
        this.props.currentLessonNumber
      );
    } catch (err) {
      console.warn('Failed to load vocabulary words:', err);
      this.words = [];
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private render(): void {
    const isOwner = this.props.book.createdBy === this.props.userId;
    const isBuiltin = this.props.book.isBuiltin;
    const lessonTitle = this.props.currentLessonNumber
      ? this.props.lessons.find((l) => l.lessonNumber === this.props.currentLessonNumber)?.name ||
        `Lesson ${this.props.currentLessonNumber}`
      : 'All Lessons';

    const filteredWords = this.words.filter((w) => {
      // Known status filter
      if (this.filterKnown === 'known' && !w.isKnown) return false;
      if (this.filterKnown === 'learning' && w.isKnown) return false;

      // Text query filter
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return (
        w.en.toLowerCase().includes(q) ||
        w.hy.toLowerCase().includes(q) ||
        (w.ru && w.ru.toLowerCase().includes(q)) ||
        (w.type && w.type.toLowerCase().includes(q)) ||
        (w.note && w.note.toLowerCase().includes(q)) ||
        (w.hint && w.hint.toLowerCase().includes(q)) ||
        (w.sourcePage && w.sourcePage.includes(q)) ||
        (w.page && w.page.includes(q)) ||
        (w.definition && w.definition.toLowerCase().includes(q)) ||
        (w.example && w.example.toLowerCase().includes(q))
      );
    });

    const knownCount = this.words.filter((w) => w.isKnown).length;
    const learningCount = this.words.length - knownCount;

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <!-- Success & Error Feedback Banner -->
        ${
          this.feedbackMessage
            ? `<div class="chip ${this.feedbackMessage.type === 'success' ? 'ok' : 'no'}" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-radius: 12px; font-size: 0.9rem; font-weight: 600; box-shadow: var(--sh);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 1.1rem;">${this.feedbackMessage.type === 'success' ? '✅' : '⚠️'}</span>
                  <span>${this.feedbackMessage.text}</span>
                </div>
                <button type="button" id="dismissVocabFeedbackBtn" style="background: transparent; border: 0; cursor: pointer; font-size: 1.1rem; color: inherit; padding: 0 4px; line-height: 1;">✕</button>
              </div>`
            : ''
        }

        <!-- Header & Action Bar -->
        <div class="card" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">📝</span>
                <h3 style="margin: 0; font-size: 1.25rem;">
                  Vocabulary in "${this.props.book.name}"
                </h3>
                <span class="chip ${isBuiltin ? 'ok' : 'wn'}" style="font-size: 0.7rem;">
                  ${isBuiltin ? 'Standard' : 'Custom'}
                </span>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
                Showing: <strong>${lessonTitle}</strong> • Total entries: <strong>${this.words.length}</strong> (<span>✓ Known: ${knownCount}</span> • <span>⏳ Learning: ${learningCount}</span>)
              </p>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button id="openImportVocabBtn" class="sm" style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; padding: 8px 14px;">
                <span>📥</span> Import Vocabulary
              </button>
              ${
                isOwner && !isBuiltin
                  ? `<button id="openCreateWordBtn" class="p" style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; padding: 9px 15px;">
                      <span>➕</span> Add Vocabulary Word
                    </button>`
                  : `<span class="chip" style="font-size: 0.72rem;">Curriculum vocabulary (Read-only)</span>`
              }
            </div>
          </div>

          <!-- Filters, Search, and View Controls -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 14px;">
            <div style="flex: 1; min-width: 240px;">
              <input
                type="search"
                id="vocabSearchInput"
                placeholder="Search English, Armenian, Russian, definition, or example…"
                value="${this.searchQuery}"
                style="padding: 9px 14px; font-size: 0.88rem; width: 100%; border-radius: 10px;"
              />
            </div>

            <!-- Status filter & View mode toggles -->
            <div style="display: flex; gap: 8px; align-items: center;">
              <div class="tabs" style="padding: 2px; margin: 0; display: inline-flex;">
                <button id="filterAllBtn" class="${this.filterKnown === 'all' ? 'on' : ''}" style="padding: 5px 10px; font-size: 0.8rem;">
                  All (${this.words.length})
                </button>
                <button id="filterKnownBtn" class="${this.filterKnown === 'known' ? 'on' : ''}" style="padding: 5px 10px; font-size: 0.8rem;">
                  ✓ Known (${knownCount})
                </button>
                <button id="filterLearningBtn" class="${this.filterKnown === 'learning' ? 'on' : ''}" style="padding: 5px 10px; font-size: 0.8rem;">
                  ⏳ Learning (${learningCount})
                </button>
              </div>

              <button id="toggleViewModeBtn" class="sm" title="Toggle between Table and Cards view">
                ${this.viewMode === 'table' ? '🗂️ Cards' : '📊 Table'}
              </button>
            </div>
          </div>
        </div>

        <!-- Vocabulary Content (Table or Cards) -->
        ${
          this.isLoading
            ? `<div class="card" style="text-align: center; padding: 36px; color: var(--mu);">
                <div style="font-size: 1.8rem; margin-bottom: 8px;">⏳</div>
                <p style="margin: 0;">Loading vocabulary words...</p>
              </div>`
            : filteredWords.length === 0
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
                <p style="margin: 0 0 8px; font-size: 1.05rem; font-weight: 600;">No vocabulary words found</p>
                <p style="margin: 0 0 16px; font-size: 0.85rem;">
                  ${
                    this.searchQuery || this.filterKnown !== 'all'
                      ? 'No vocabulary words match your active search and status filter.'
                      : isOwner && !isBuiltin
                      ? 'This lesson has no vocabulary words yet. Click "Add Vocabulary Word" to start building your collection!'
                      : 'No vocabulary words recorded for this unit.'
                  }
                </p>
                ${
                  this.searchQuery || this.filterKnown !== 'all'
                    ? `<button id="resetVocabFiltersBtn" class="sm">Clear filters</button>`
                    : isOwner && !isBuiltin
                    ? `<button id="addFirstWordBtn" class="p sm">➕ Add First Word</button>`
                    : ''
                }
              </div>`
            : this.viewMode === 'table'
            ? this.renderTableView(filteredWords, isOwner && !isBuiltin)
            : this.renderCardsView(filteredWords, isOwner && !isBuiltin)
        }

        <!-- Modals Host -->
        <div id="vocabModalsHost">
          ${this.renderActiveModal()}
        </div>
        <div id="vocabImportHost"></div>
      </div>
    `;

    this.bindEvents();

    if (this.props.highlightWordId) {
      this.highlightWord(this.props.highlightWordId);
    }
  }

  public highlightWord(wordId: string): void {
    if (!wordId) return;
    setTimeout(() => {
      // Find row or card by data attribute or id
      const el =
        (this.container.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`) as HTMLElement | null) ||
        (this.container.querySelector(`#word-row-${CSS.escape(wordId)}`) as HTMLElement | null) ||
        (this.container.querySelector(`#word-card-${CSS.escape(wordId)}`) as HTMLElement | null);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'all 0.4s ease';
        el.style.boxShadow = '0 0 0 3px var(--ac), var(--sh)';
        el.style.background = 'color-mix(in srgb, var(--ac) 18%, var(--sf))';
        setTimeout(() => {
          el.style.boxShadow = '';
          el.style.background = '';
        }, 3200);
      }
    }, 150);
  }

  private renderTableView(words: WordWithStatus[], canEdit: boolean): string {
    return `
      <div class="card" style="margin-bottom: 0; padding: 0; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
          <thead>
            <tr style="border-bottom: 2px solid var(--ln); background: color-mix(in srgb, var(--bg) 60%, var(--sf)); color: var(--mu); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px;">
              <th style="padding: 12px 14px; width: 60px;">Status</th>
              <th style="padding: 12px 14px;">English Word / Phrase</th>
              <th style="padding: 12px 14px;">Armenian (Հայերեն)</th>
              <th style="padding: 12px 14px;">Russian (Русский)</th>
              <th style="padding: 12px 14px;">Details & Examples</th>
              <th style="padding: 12px 14px; width: 80px;">Unit</th>
              ${canEdit ? '<th style="padding: 12px 14px; width: 110px; text-align: right;">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${words
              .map(
                (w, idx) => `
              <tr id="word-row-${w.id}" data-word-id="${w.id}" style="border-bottom: 1px solid var(--ln); background: ${idx % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--bg) 30%, transparent)'};">
                <!-- Status Toggle Button -->
                <td style="padding: 10px 14px;">
                  <button
                    type="button"
                    class="sm"
                    data-toggle-known="${w.id}"
                    data-known="${w.isKnown}"
                    title="${w.isKnown ? 'Mark as learning' : 'Mark as known'}"
                    style="border-radius: 50%; width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 0.95rem; border-color: ${w.isKnown ? 'var(--ok)' : 'var(--ln)'}; background: ${w.isKnown ? 'color-mix(in srgb, var(--ok) 15%, var(--sf))' : 'transparent'}; color: ${w.isKnown ? 'var(--ok)' : 'var(--mu)'};"
                  >
                    ${w.isKnown ? '✓' : '○'}
                  </button>
                </td>

                <!-- English -->
                <td style="padding: 10px 14px;">
                  <div style="font-weight: 700; font-size: 0.98rem; color: var(--tx);">
                    ${w.en}
                  </div>
                  <div style="display: flex; gap: 6px; align-items: center; margin-top: 2px; flex-wrap: wrap;">
                    ${w.type ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px; text-transform: uppercase;">${w.type}</span>` : ''}
                    ${w.pronunciation ? `<span style="font-family: monospace; font-size: 0.78rem; color: var(--mu);">${w.pronunciation}</span>` : ''}
                    ${w.partOfSpeech ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px;">${w.partOfSpeech}</span>` : ''}
                  </div>
                </td>

                <!-- Armenian -->
                <td style="padding: 10px 14px; font-weight: 600; color: var(--tx);">
                  ${w.hy}
                </td>

                <!-- Russian -->
                <td style="padding: 10px 14px; color: var(--mu);">
                  ${w.ru || '<em style="font-size: 0.78rem; opacity: 0.6;">—</em>'}
                </td>

                <!-- Definition / Example / Note -->
                <td style="padding: 10px 14px; max-width: 280px; font-size: 0.82rem; line-height: 1.35;">
                  ${w.definition ? `<div style="color: var(--tx); margin-bottom: 2px;">${w.definition}</div>` : ''}
                  ${w.example ? `<div style="color: var(--mu); font-style: italic;">"${w.example}"</div>` : ''}
                  ${(w.note || w.hint) ? `<div style="color: var(--ac); font-size: 0.78rem; margin-top: 2px;">💡 ${w.note || w.hint}</div>` : ''}
                  ${!w.definition && !w.example && !w.note && !w.hint ? '<em style="color: var(--mu); font-size: 0.75rem;">—</em>' : ''}
                </td>

                <!-- Lesson Unit & Page -->
                <td style="padding: 10px 14px; font-size: 0.8rem; color: var(--mu);">
                  <span class="chip" style="font-size: 0.7rem;">Unit ${w.lesson}</span>
                  ${(w.sourcePage || w.page) ? `<span style="display: block; font-size: 0.7rem; color: var(--mu); margin-top: 2px;">p. ${w.sourcePage || w.page}</span>` : ''}
                </td>

                <!-- Actions -->
                <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
                  <button class="sm" data-practice-word="${w.id}" title="Pronunciation & voice practice" style="color: var(--ac); border-color: var(--ac);">
                    🔊
                  </button>
                  ${
                    canEdit
                      ? `<button class="sm" data-edit-word="${w.id}" title="Edit word">
                          ✏️
                        </button>
                        <button class="sm" data-delete-word="${w.id}" style="color: var(--no); border-color: var(--no);" title="Delete word">
                          🗑️
                        </button>`
                      : ''
                  }
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderCardsView(words: WordWithStatus[], canEdit: boolean): string {
    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 14px;">
        ${words
          .map(
            (w) => `
          <div id="word-card-${w.id}" data-word-id="${w.id}" class="card" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid ${w.isKnown ? 'var(--ok)' : 'var(--ac)'};">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                <div>
                  <h4 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--tx);">
                    ${w.en}
                  </h4>
                  <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                    ${w.type ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px; text-transform: uppercase;">${w.type}</span>` : ''}
                    ${w.pronunciation ? `<span style="font-family: monospace; font-size: 0.8rem; color: var(--mu);">${w.pronunciation}</span>` : ''}
                    ${w.partOfSpeech ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px;">${w.partOfSpeech}</span>` : ''}
                  </div>
                </div>

                <!-- Mark as known toggle -->
                <button
                  type="button"
                  class="sm"
                  data-toggle-known="${w.id}"
                  data-known="${w.isKnown}"
                  title="${w.isKnown ? 'Mark as learning' : 'Mark as known'}"
                  style="border-radius: 50%; width: 34px; height: 34px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 1.05rem; border-color: ${w.isKnown ? 'var(--ok)' : 'var(--ln)'}; background: ${w.isKnown ? 'color-mix(in srgb, var(--ok) 15%, var(--sf))' : 'transparent'}; color: ${w.isKnown ? 'var(--ok)' : 'var(--mu)'};"
                >
                  ${w.isKnown ? '✓' : '○'}
                </button>
              </div>

              <!-- Translations -->
              <div style="display: grid; gap: 6px; padding: 8px 12px; background: var(--bg); border-radius: 10px; margin-bottom: 10px; font-size: 0.9rem;">
                <div style="font-weight: 600; color: var(--tx);">
                  <span style="color: var(--mu); font-size: 0.75rem; text-transform: uppercase; margin-right: 4px;">HY:</span>
                  ${w.hy}
                </div>
                ${
                  w.ru
                    ? `<div style="color: var(--mu);">
                        <span style="color: var(--mu); font-size: 0.75rem; text-transform: uppercase; margin-right: 4px;">RU:</span>
                        ${w.ru}
                      </div>`
                    : ''
                }
              </div>

              <!-- Definition & Example & Note -->
              ${
                w.definition
                  ? `<div style="font-size: 0.84rem; color: var(--tx); margin-bottom: 6px; line-height: 1.35;">
                      <strong>Def:</strong> ${w.definition}
                    </div>`
                  : ''
              }
              ${
                w.example
                  ? `<div style="font-size: 0.82rem; color: var(--mu); font-style: italic; margin-bottom: 8px; line-height: 1.35;">
                      "${w.example}"
                    </div>`
                  : ''
              }
              ${
                (w.note || w.hint)
                  ? `<div style="font-size: 0.82rem; color: var(--ac); margin-bottom: 8px; line-height: 1.35;">
                      💡 <strong>Note:</strong> ${w.note || w.hint}
                    </div>`
                  : ''
              }
            </div>

            <!-- Card Footer -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid var(--ln); font-size: 0.75rem; color: var(--mu); margin-top: 8px;">
              <span>Unit: <strong>${w.lesson}</strong> ${(w.sourcePage || w.page) ? `• p. ${w.sourcePage || w.page}` : ''}</span>

              <div style="display: flex; gap: 6px; align-items: center;">
                <button class="sm" data-practice-word="${w.id}" title="Pronunciation & voice practice" style="color: var(--ac); border-color: var(--ac); font-size: 0.78rem;">
                  🔊 Practice
                </button>
                ${
                  canEdit
                    ? `<button class="sm" data-edit-word="${w.id}" title="Edit word">
                        ✏️
                      </button>
                      <button class="sm" data-delete-word="${w.id}" style="color: var(--no); border-color: var(--no);" title="Delete word">
                        🗑️
                      </button>`
                    : `<span class="chip ${w.isKnown ? 'ok' : ''}" style="font-size: 0.68rem;">
                        ${w.isKnown ? '✓ Known' : 'Learning'}
                      </span>`
                }
              </div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  private renderActiveModal(): string {
    if (this.activeModal === 'none') return '';

    const lessonOptions = this.props.lessons.map(
      (l) => `<option value="${l.lessonNumber}" ${l.lessonNumber === this.props.currentLessonNumber ? 'selected' : ''}>${l.name || 'Lesson ' + l.lessonNumber}</option>`
    );

    const partsOfSpeech: PartOfSpeech[] = [
      'noun',
      'verb',
      'adjective',
      'adverb',
      'pronoun',
      'preposition',
      'conjunction',
      'interjection',
      'idiom',
      'phrase',
      'other',
    ];

    if (this.activeModal === 'create') {
      return `
        <div class="modal" id="vocabModalOverlay" style="display: grid;">
          <div class="box" style="max-width: 580px;">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>➕</span> Add Vocabulary Word
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Add a new vocabulary entry to <strong>${this.props.book.name}</strong>.
            </p>

            <form id="createWordForm" style="display: grid; gap: 12px;" novalidate>
              <!-- Target Lesson Dropdown -->
              <label class="field-label">
                <span>Target Lesson / Unit <span class="req">*</span></span>
                <select id="modalWordLesson" required>
                  ${lessonOptions.length ? lessonOptions.join('') : '<option value="1">Lesson 1</option>'}
                </select>
              </label>

              <!-- English & Armenian (Required) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>English Word or Phrase <span class="req">*</span></span>
                  <input
                    type="text"
                    id="newWordEn"
                    placeholder="e.g. serendipity"
                    maxlength="150"
                    required
                  />
                </label>

                <label class="field-label">
                  <span>Armenian (Հայերեն) <span class="req">*</span></span>
                  <input
                    type="text"
                    id="newWordHy"
                    placeholder="e.g. հաջող պատահականություն"
                    maxlength="250"
                    required
                  />
                </label>
              </div>

              <!-- Russian & Pronunciation (Optional) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>Russian (Русский) <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="newWordRu"
                    placeholder="e.g. счастливая случайность"
                    maxlength="250"
                  />
                </label>

                <label class="field-label">
                  <span>Pronunciation (IPA) <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="newWordPron"
                    placeholder="e.g. /ˌserənˈdɪpəti/"
                    maxlength="80"
                  />
                </label>
              </div>

              <!-- Part of Speech & Type -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>Part of Speech <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <select id="newWordPos">
                    <option value="">(None / unspecified)</option>
                    ${partsOfSpeech.map((pos) => `<option value="${pos}">${pos}</option>`).join('')}
                  </select>
                </label>

                <label class="field-label">
                  <span>Entry Type</span>
                  <select id="newWordType">
                    <option value="word" selected>Word</option>
                    <option value="phrase">Phrase</option>
                    <option value="combination">Combination</option>
                    <option value="sentence">Sentence</option>
                    <option value="idiom">Idiom</option>
                    <option value="colloquial">Colloquial</option>
                  </select>
                </label>
              </div>

              <!-- Definition -->
              <label class="field-label">
                <span>English Definition <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="newWordDef"
                  placeholder="e.g. The occurrence and development of events by chance in a happy or beneficial way"
                  maxlength="500"
                />
              </label>

              <!-- Example Sentence -->
              <label class="field-label">
                <span>Example Sentence <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="newWordExample"
                  placeholder="e.g. Finding my lost passport was a piece of pure serendipity."
                  maxlength="500"
                />
              </label>

              ${
                this.modalError
                  ? `<div class="chip no" style="display: block; padding: 8px 12px; font-size: 0.85rem;">
                      ${this.modalError}
                    </div>`
                  : ''
              }

              <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                <button type="button" id="closeVocabModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitCreateWordBtn">Save Vocabulary Word</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'edit' && this.targetWord) {
      return `
        <div class="modal" id="vocabModalOverlay" style="display: grid;">
          <div class="box" style="max-width: 580px;">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>✏️</span> Edit Vocabulary Word
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Update entry for <strong>${this.targetWord.en}</strong> in Unit ${this.targetWord.lesson}.
            </p>

            <form id="editWordForm" style="display: grid; gap: 12px;" novalidate>
              <!-- English & Armenian (Required) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>English Word or Phrase <span class="req">*</span></span>
                  <input
                    type="text"
                    id="editWordEn"
                    value="${this.targetWord.en}"
                    maxlength="150"
                    required
                  />
                </label>

                <label class="field-label">
                  <span>Armenian (Հայերեն) <span class="req">*</span></span>
                  <input
                    type="text"
                    id="editWordHy"
                    value="${this.targetWord.hy}"
                    maxlength="250"
                    required
                  />
                </label>
              </div>

              <!-- Russian & Pronunciation -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>Russian (Русский) <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="editWordRu"
                    value="${this.targetWord.ru || ''}"
                    maxlength="250"
                  />
                </label>

                <label class="field-label">
                  <span>Pronunciation (IPA) <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="editWordPron"
                    value="${this.targetWord.pronunciation || ''}"
                    maxlength="80"
                  />
                </label>
              </div>

              <!-- Part of Speech -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <label class="field-label">
                  <span>Part of Speech <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <select id="editWordPos">
                    <option value="">(None / unspecified)</option>
                    ${partsOfSpeech
                      .map(
                        (pos) =>
                          `<option value="${pos}" ${this.targetWord?.partOfSpeech === pos ? 'selected' : ''}>${pos}</option>`
                      )
                      .join('')}
                  </select>
                </label>

                <label class="field-label">
                  <span>Entry Type</span>
                  <select id="editWordType">
                    <option value="word" ${this.targetWord.type === 'word' ? 'selected' : ''}>Word</option>
                    <option value="phrase" ${this.targetWord.type === 'phrase' ? 'selected' : ''}>Phrase</option>
                    <option value="combination" ${this.targetWord.type === 'combination' ? 'selected' : ''}>Combination</option>
                    <option value="sentence" ${this.targetWord.type === 'sentence' ? 'selected' : ''}>Sentence</option>
                    <option value="colloquial" ${this.targetWord.type === 'colloquial' ? 'selected' : ''}>Colloquial</option>
                  </select>
                </label>
              </div>

              <!-- Definition -->
              <label class="field-label">
                <span>English Definition <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="editWordDef"
                  value="${this.targetWord.definition || ''}"
                  maxlength="500"
                />
              </label>

              <!-- Example Sentence -->
              <label class="field-label">
                <span>Example Sentence <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="editWordExample"
                  value="${this.targetWord.example || ''}"
                  maxlength="500"
                />
              </label>

              <!-- Page Number & Pedagogical Note / Hint -->
              <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px;">
                <label class="field-label">
                  <span>Page Number <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="editWordPage"
                    value="${this.targetWord.sourcePage || this.targetWord.page || ''}"
                    placeholder="e.g. 431"
                    maxlength="20"
                  />
                </label>

                <label class="field-label">
                  <span>Pedagogical Note / Hint <span style="font-size: 0.72rem; color: var(--mu);">(optional)</span></span>
                  <input
                    type="text"
                    id="editWordNote"
                    value="${this.targetWord.note || this.targetWord.hint || ''}"
                    placeholder="e.g. synonym of: to learn"
                    maxlength="250"
                  />
                </label>
              </div>

              ${
                this.modalError
                  ? `<div class="chip no" style="display: block; padding: 8px 12px; font-size: 0.85rem;">
                      ${this.modalError}
                    </div>`
                  : ''
              }

              <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                <button type="button" id="closeVocabModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitEditWordBtn">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'delete' && this.targetWord) {
      return `
        <div class="modal" id="vocabModalOverlay" style="display: grid;">
          <div class="box">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
              <span style="font-size: 2rem;">⚠️</span>
              <div>
                <h3 style="margin: 0; font-size: 1.25rem; color: var(--no);">Delete Vocabulary Word</h3>
                <p style="margin: 2px 0 0; font-size: 0.85rem; color: var(--mu);">
                  Word: <strong>${this.targetWord.en}</strong> (${this.targetWord.hy})
                </p>
              </div>
            </div>

            <div class="chip no" style="display: block; width: 100%; border-radius: 12px; padding: 12px; font-size: 0.85rem; line-height: 1.5; margin-bottom: 16px;">
              <strong>Warning: This action is permanent!</strong>
              <p style="margin: 4px 0 0;">
                Deleting this word will remove it from Lesson ${this.targetWord.lesson} and erase any associated practice mastery streaks.
              </p>
              ${
                this.targetWord.streak > 0 || this.targetWord.failCount > 0
                  ? `<div style="margin-top: 8px; font-size: 0.82rem; background: rgba(0, 0, 0, 0.15); padding: 8px 12px; border-radius: 8px;">
                      Learning History: Current Streak: <strong>${this.targetWord.streak}</strong> • Review Misses: <strong>${this.targetWord.failCount}</strong> • Status: <strong>${this.targetWord.isKnown ? 'Mastered (Known)' : 'In Progress'}</strong>
                    </div>`
                  : ''
              }
            </div>

            ${
              this.modalError
                ? `<div class="chip no" style="display: block; padding: 8px 12px; font-size: 0.85rem; margin-bottom: 12px;">
                    ${this.modalError}
                  </div>`
                : ''
            }

            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
              <button type="button" id="closeVocabModalBtn">Cancel</button>
              <button
                type="button"
                id="confirmDeleteWordBtn"
                style="background: var(--no); color: #fff; border: 0; font-weight: 600; padding: 9px 16px; border-radius: 12px;"
              >
                Permanently Delete Word
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  private bindEvents(): void {
    // Dismiss feedback banner
    this.container.querySelector('#dismissVocabFeedbackBtn')?.addEventListener('click', () => {
      this.feedbackMessage = null;
      this.render();
    });

    // Search input
    const searchInput = this.container.querySelector('#vocabSearchInput') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.searchQuery = (searchInput.value || '').trim();
      this.render();
      const nextInput = this.container.querySelector('#vocabSearchInput') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    });

    // Reset filters
    this.container.querySelector('#resetVocabFiltersBtn')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.filterKnown = 'all';
      this.render();
    });

    // Known Status Filter buttons
    this.container.querySelector('#filterAllBtn')?.addEventListener('click', () => {
      this.filterKnown = 'all';
      this.render();
    });
    this.container.querySelector('#filterKnownBtn')?.addEventListener('click', () => {
      this.filterKnown = 'known';
      this.render();
    });
    this.container.querySelector('#filterLearningBtn')?.addEventListener('click', () => {
      this.filterKnown = 'learning';
      this.render();
    });

    // Toggle View Mode (Table / Cards)
    this.container.querySelector('#toggleViewModeBtn')?.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'table' ? 'cards' : 'table';
      this.render();
    });

    // Open Import Vocabulary Modal
    this.container.querySelector('#openImportVocabBtn')?.addEventListener('click', () => {
      const host = this.container.querySelector('#vocabImportHost') as HTMLElement | null;
      if (host) {
        new VocabularyImportModal(host, {
          userId: this.props.userId,
          defaultBookId: this.props.book.id,
          defaultLessonNumber: this.props.currentLessonNumber,
          onImportCompleted: async (summary) => {
            this.feedbackMessage = {
              text: `Import completed: ${summary.imported} words added, ${summary.updated} updated, ${summary.skipped} skipped.`,
              type: 'success',
            };
            await this.loadWords();
            if (this.props.onWordChanged) {
              this.props.onWordChanged();
            }
          },
          onClose: () => {
            if (host) host.innerHTML = '';
          },
        });
      }
    });

    // Open Create Modal
    const openCreate = () => {
      this.activeModal = 'create';
      this.modalError = '';
      this.render();
      const enInput = this.container.querySelector('#newWordEn') as HTMLInputElement | null;
      enInput?.focus();
    };

    this.container.querySelector('#openCreateWordBtn')?.addEventListener('click', openCreate);
    this.container.querySelector('#addFirstWordBtn')?.addEventListener('click', openCreate);

    // Close Modal handler
    const closeModal = () => {
      this.activeModal = 'none';
      this.targetWord = null;
      this.modalError = '';
      this.render();
    };

    this.container.querySelector('#closeVocabModalBtn')?.addEventListener('click', closeModal);
    const overlay = this.container.querySelector('#vocabModalOverlay');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Submit Create Word Form
    const createForm = this.container.querySelector('#createWordForm') as HTMLFormElement | null;
    createForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lessonSelect = this.container.querySelector('#modalWordLesson') as HTMLSelectElement | null;
      const enInput = this.container.querySelector('#newWordEn') as HTMLInputElement | null;
      const hyInput = this.container.querySelector('#newWordHy') as HTMLInputElement | null;
      const ruInput = this.container.querySelector('#newWordRu') as HTMLInputElement | null;
      const pronInput = this.container.querySelector('#newWordPron') as HTMLInputElement | null;
      const posSelect = this.container.querySelector('#newWordPos') as HTMLSelectElement | null;
      const typeSelect = this.container.querySelector('#newWordType') as HTMLSelectElement | null;
      const defInput = this.container.querySelector('#newWordDef') as HTMLInputElement | null;
      const exInput = this.container.querySelector('#newWordExample') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitCreateWordBtn') as HTMLButtonElement | null;

      const targetLesson = (lessonSelect?.value || this.props.currentLessonNumber || '1').trim();
      const en = (enInput?.value || '').trim();
      const hy = (hyInput?.value || '').trim();
      const ru = (ruInput?.value || '').trim();
      const pronunciation = (pronInput?.value || '').trim();
      const partOfSpeech = (posSelect?.value || '').trim() as PartOfSpeech;
      const type = (typeSelect?.value || 'word') as VocabularyType;
      const definition = (defInput?.value || '').trim();
      const example = (exInput?.value || '').trim();

      if (!en) {
        this.modalError = 'Please provide an English word or phrase.';
        this.render();
        return;
      }
      if (!hy) {
        this.modalError = 'Please provide an Armenian translation.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }

        await vocabularyService.addWord(this.props.userId, this.props.book.id, targetLesson, {
          en,
          hy,
          ru: ru || undefined,
          pronunciation: pronunciation || undefined,
          partOfSpeech: partOfSpeech || undefined,
          type,
          definition: definition || undefined,
          example: example || undefined,
        });

        this.feedbackMessage = { text: `Vocabulary word "${en}" added successfully!`, type: 'success' };
        closeModal();
        await this.loadWords();
        if (this.props.onWordChanged) {
          this.props.onWordChanged();
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          this.modalError = err.message;
        } else if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not add vocabulary word.';
        }
        this.render();
      }
    });

    // Submit Edit Word Form
    const editForm = this.container.querySelector('#editWordForm') as HTMLFormElement | null;
    editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.targetWord) return;

      const enInput = this.container.querySelector('#editWordEn') as HTMLInputElement | null;
      const hyInput = this.container.querySelector('#editWordHy') as HTMLInputElement | null;
      const ruInput = this.container.querySelector('#editWordRu') as HTMLInputElement | null;
      const pronInput = this.container.querySelector('#editWordPron') as HTMLInputElement | null;
      const posSelect = this.container.querySelector('#editWordPos') as HTMLSelectElement | null;
      const typeSelect = this.container.querySelector('#editWordType') as HTMLSelectElement | null;
      const defInput = this.container.querySelector('#editWordDef') as HTMLInputElement | null;
      const exInput = this.container.querySelector('#editWordExample') as HTMLInputElement | null;
      const pageInput = this.container.querySelector('#editWordPage') as HTMLInputElement | null;
      const noteInput = this.container.querySelector('#editWordNote') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitEditWordBtn') as HTMLButtonElement | null;

      const en = (enInput?.value || '').trim();
      const hy = (hyInput?.value || '').trim();
      const ru = (ruInput?.value || '').trim();
      const pronunciation = (pronInput?.value || '').trim();
      const partOfSpeech = (posSelect?.value || '').trim() as PartOfSpeech;
      const type = (typeSelect?.value || 'word') as VocabularyType;
      const definition = (defInput?.value || '').trim();
      const example = (exInput?.value || '').trim();
      const page = (pageInput?.value || '').trim();
      const note = (noteInput?.value || '').trim();

      if (!en) {
        this.modalError = 'English word or phrase cannot be empty.';
        this.render();
        return;
      }
      if (!hy) {
        this.modalError = 'Armenian translation cannot be empty.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }

        await vocabularyService.updateWord(this.props.userId, this.targetWord.id, {
          en,
          hy,
          ru: ru || undefined,
          pronunciation: pronunciation || undefined,
          partOfSpeech: partOfSpeech || undefined,
          type,
          definition: definition || undefined,
          example: example || undefined,
          page: page || undefined,
          sourcePage: page || undefined,
          hint: note || undefined,
          note: note || undefined,
        });

        this.feedbackMessage = { text: `Vocabulary word "${en}" updated successfully!`, type: 'success' };
        closeModal();
        await this.loadWords();
        if (this.props.onWordChanged) {
          this.props.onWordChanged();
        }
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not update vocabulary word.';
        }
        this.render();
      }
    });

    // Confirm Delete Word
    const confirmDeleteBtn = this.container.querySelector('#confirmDeleteWordBtn') as HTMLButtonElement | null;
    confirmDeleteBtn?.addEventListener('click', async () => {
      if (!this.targetWord) return;
      const wordToDeleteEn = this.targetWord.en;

      try {
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = 'Deleting...';
        await vocabularyService.deleteWord(this.props.userId, this.targetWord.id);
        this.feedbackMessage = { text: `Vocabulary word "${wordToDeleteEn}" deleted successfully.`, type: 'success' };
        closeModal();
        await this.loadWords();
        if (this.props.onWordChanged) {
          this.props.onWordChanged();
        }
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not delete vocabulary word.';
        }
        this.render();
      }
    });

    // Delegation: Toggle Known status, Edit click, Delete click
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // Toggle Known / Learning Status
      const toggleKnownBtn = target.closest('[data-toggle-known]') as HTMLButtonElement | null;
      if (toggleKnownBtn) {
        const wordId = toggleKnownBtn.dataset.toggleKnown;
        const currentKnown = toggleKnownBtn.dataset.known === 'true';
        if (wordId) {
          const nextKnown = !currentKnown;
          toggleKnownBtn.disabled = true;
          try {
            await vocabularyService.setWordKnownStatus(this.props.userId, wordId, nextKnown);
            await this.loadWords();
          } catch (err) {
            console.warn('Failed to update known status:', err);
          } finally {
            toggleKnownBtn.disabled = false;
          }
        }
        return;
      }

      // Edit Word
      const editBtn = target.closest('[data-edit-word]') as HTMLElement | null;
      if (editBtn) {
        const wordId = editBtn.dataset.editWord;
        const word = this.words.find((w) => w.id === wordId);
        if (word) {
          this.targetWord = word;
          this.activeModal = 'edit';
          this.modalError = '';
          this.render();
          const enInput = this.container.querySelector('#editWordEn') as HTMLInputElement | null;
          enInput?.focus();
        }
        return;
      }

      // Delete Word
      const deleteBtn = target.closest('[data-delete-word]') as HTMLElement | null;
      if (deleteBtn) {
        const wordId = deleteBtn.dataset.deleteWord;
        const word = this.words.find((w) => w.id === wordId);
        if (word) {
          this.targetWord = word;
          this.activeModal = 'delete';
          this.modalError = '';
          this.render();
        }
        return;
      }

      // Practice Pronunciation
      const practiceBtn = target.closest('[data-practice-word]') as HTMLElement | null;
      if (practiceBtn) {
        const wordId = practiceBtn.dataset.practiceWord;
        const word = this.words.find((w) => w.id === wordId);
        if (word) {
          this.openPracticeModal(word);
        }
        return;
      }
    });
  }

  private openPracticeModal(word: WordWithStatus): void {
    const host = this.container.querySelector('#vocabModalsHost') as HTMLElement | null;
    if (host) {
      new PronunciationPracticeModal(host, {
        word,
        onClose: () => {
          if (host) host.innerHTML = '';
        },
        onPracticed: async (wordId, success) => {
          if (success) {
            try {
              await vocabularyService.setWordKnownStatus(this.props.userId, wordId, true);
              await this.loadWords();
              if (this.props.onWordChanged) {
                this.props.onWordChanged();
              }
            } catch (err) {
              console.warn('Could not auto-mark word as known after successful pronunciation practice:', err);
            }
          }
        },
      });
    }
  }
}
