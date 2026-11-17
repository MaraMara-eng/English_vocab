/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book } from '../db/types.ts';
import { bookService } from '../services/bookService.ts';
import { vocabularySearchService, GlobalSearchResult } from '../services/vocabularySearchService.ts';
import { vocabularyService } from '../services/vocabularyService.ts';
import { PronunciationPracticeModal } from './PronunciationPracticeModal.ts';

export interface GlobalSearchViewProps {
  userId: string;
  initialQuery?: string;
  onOpenInLesson: (bookId: string, lessonNumber: string, wordId: string) => void;
}

export class GlobalSearchView {
  private container: HTMLElement;
  private props: GlobalSearchViewProps;
  private query: string = '';
  private selectedBookId: string = 'all';
  private statusFilter: 'all' | 'known' | 'learning' = 'all';
  private accessibleBooks: Book[] = [];
  private searchResults: GlobalSearchResult[] = [];
  private isSearching: boolean = false;
  private debounceTimer: number | null = null;

  constructor(container: HTMLElement, props: GlobalSearchViewProps) {
    this.container = container;
    this.props = props;
    this.query = props.initialQuery || '';
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.accessibleBooks = await bookService.getUserBooks(this.props.userId);
    } catch (err) {
      console.warn('Could not load accessible books for search filter:', err);
    }

    if (this.query) {
      await this.executeSearch();
    } else {
      this.render();
    }
  }

  public setQuery(newQuery: string): void {
    this.query = newQuery;
    const input = this.container.querySelector('#globalSearchInput') as HTMLInputElement | null;
    if (input) input.value = newQuery;
    this.executeSearch();
  }

  private async executeSearch(): Promise<void> {
    const q = this.query.trim();
    if (!q) {
      this.searchResults = [];
      this.isSearching = false;
      this.render();
      return;
    }

    this.isSearching = true;
    this.renderResultsSectionOnly();

    try {
      this.searchResults = await vocabularySearchService.searchVocabulary(
        this.props.userId,
        q,
        {
          bookId: this.selectedBookId,
          filterStatus: this.statusFilter,
        }
      );
    } catch (err) {
      console.warn('Search execution error:', err);
      this.searchResults = [];
    } finally {
      this.isSearching = false;
      this.renderResultsSectionOnly();
    }
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Search Controls Card -->
        <div class="card" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.4rem;">🔍</span>
                <h3 style="margin: 0; font-size: 1.3rem;">
                  Global Vocabulary Search
                </h3>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
                Search across all your books and lessons by English word, Armenian, Russian, or definition.
              </p>
            </div>

            <!-- Quick Book Scope Selector -->
            <div style="display: flex; align-items: center; gap: 8px;">
              <label style="font-size: 0.82rem; color: var(--mu);">Textbook:</label>
              <select id="searchBookScopeSelect" style="padding: 7px 12px; font-size: 0.85rem; border-radius: 10px; min-width: 170px;">
                <option value="all" ${this.selectedBookId === 'all' ? 'selected' : ''}>
                  All Textbooks (${this.accessibleBooks.length})
                </option>
                ${this.accessibleBooks
                  .map(
                    (b) => `
                  <option value="${b.id}" ${this.selectedBookId === b.id ? 'selected' : ''}>
                    ${b.isBuiltin ? '📖 ' : '📘 '} ${b.name}
                  </option>
                `
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <!-- Main Live Search Bar -->
          <div style="position: relative; display: flex; align-items: center;">
            <span style="position: absolute; left: 14px; font-size: 1.15rem; color: var(--mu); pointer-events: none;">
              🔍
            </span>
            <input
              type="search"
              id="globalSearchInput"
              placeholder="Type English word, Armenian (հայերեն), Russian (русский), or definition…"
              value="${this.escapeHtml(this.query)}"
              autofocus
              style="width: 100%; padding: 13px 44px 13px 42px; font-size: 1.05rem; border-radius: 14px; border: 2px solid var(--ln); background: var(--bg); color: var(--tx); transition: border-color 0.2s;"
            />
            ${
              this.query
                ? `<button
                    type="button"
                    id="clearSearchQueryBtn"
                    title="Clear search"
                    style="position: absolute; right: 12px; background: transparent; border: 0; cursor: pointer; font-size: 1.1rem; color: var(--mu); padding: 4px 8px;"
                  >
                    ✕
                  </button>`
                : ''
            }
          </div>

          <!-- Secondary Filters & Status Tabs -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 14px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 0.82rem; color: var(--mu);">Status:</span>
              <div class="tabs" style="padding: 2px; margin: 0; display: inline-flex;">
                <button id="searchFilterAll" class="${this.statusFilter === 'all' ? 'on' : ''}" style="padding: 5px 12px; font-size: 0.8rem;">
                  All Statuses
                </button>
                <button id="searchFilterKnown" class="${this.statusFilter === 'known' ? 'on' : ''}" style="padding: 5px 12px; font-size: 0.8rem;">
                  ✓ Known
                </button>
                <button id="searchFilterLearning" class="${this.statusFilter === 'learning' ? 'on' : ''}" style="padding: 5px 12px; font-size: 0.8rem;">
                  ⏳ Learning
                </button>
              </div>
            </div>

            <div style="font-size: 0.8rem; color: var(--mu);">
              Supports Armenian Unicode (Հայերեն), Cyrillic (Русский), and English partial matches
            </div>
          </div>
        </div>

        <!-- Dynamic Results Container -->
        <div id="searchResultsMountPoint">
          ${this.renderResultsHtml()}
        </div>
        <div id="searchModalsHost"></div>
      </div>
    `;

    this.bindEvents();
  }

  private renderResultsSectionOnly(): void {
    const mount = this.container.querySelector('#searchResultsMountPoint');
    if (mount) {
      mount.innerHTML = this.renderResultsHtml();
      this.bindResultEvents();
    }
  }

  private renderResultsHtml(): string {
    const trimmedQuery = this.query.trim();

    // 1. Initial State: No query entered yet
    if (!trimmedQuery) {
      return `
        <div class="card" style="text-align: center; padding: 48px 24px; color: var(--mu);">
          <div style="font-size: 2.8rem; margin-bottom: 12px;">📚</div>
          <h4 style="margin: 0 0 8px; font-size: 1.2rem; color: var(--tx);">
            Search Your Entire Vocabulary Library
          </h4>
          <p style="margin: 0 auto 20px; max-width: 540px; font-size: 0.9rem; line-height: 1.5;">
            Instantly locate words across all of your textbooks and lessons. Search by:
          </p>
          <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-bottom: 24px;">
            <span class="chip" style="font-size: 0.8rem; padding: 4px 10px;">🇬🇧 English Word or Phrase</span>
            <span class="chip" style="font-size: 0.8rem; padding: 4px 10px;">🇦🇲 Armenian Translation (հայերեն)</span>
            <span class="chip" style="font-size: 0.8rem; padding: 4px 10px;">🇷🇺 Russian Translation (русский)</span>
            <span class="chip" style="font-size: 0.8rem; padding: 4px 10px;">📖 Definition & Context</span>
          </div>

          <div style="font-size: 0.85rem; color: var(--mu); margin-top: 10px;">
            Try quick searches:
            <button class="sm quick-search-tag" data-query="book" style="margin: 0 4px; font-size: 0.78rem;">book</button>
            <button class="sm quick-search-tag" data-query="տուն" style="margin: 0 4px; font-size: 0.78rem;">տուն</button>
            <button class="sm quick-search-tag" data-query="друг" style="margin: 0 4px; font-size: 0.78rem;">друг</button>
            <button class="sm quick-search-tag" data-query="school" style="margin: 0 4px; font-size: 0.78rem;">school</button>
          </div>
        </div>
      `;
    }

    // 2. Loading State
    if (this.isSearching) {
      return `
        <div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
          <div style="font-size: 2rem; margin-bottom: 8px;">⏳</div>
          <p style="margin: 0; font-size: 0.95rem;">Searching vocabulary words...</p>
        </div>
      `;
    }

    // 3. Empty Results State (Helpful message when no results found)
    if (this.searchResults.length === 0) {
      return `
        <div class="card" style="text-align: center; padding: 44px 24px; color: var(--mu);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">📭</div>
          <h4 style="margin: 0 0 8px; font-size: 1.2rem; color: var(--tx);">
            No vocabulary words found for "${this.escapeHtml(trimmedQuery)}"
          </h4>
          <p style="margin: 0 auto 16px; max-width: 520px; font-size: 0.88rem; line-height: 1.5;">
            We couldn’t find any matches in your books and lessons.
          </p>
          <ul style="display: inline-block; text-align: left; margin: 0 auto 20px; font-size: 0.85rem; line-height: 1.6; color: var(--mu); padding-left: 20px;">
            <li>Check for spelling mistakes or typos.</li>
            <li>Try searching for a shorter or partial word (e.g. "read" instead of "reading").</li>
            <li>Try searching in Armenian (e.g. "գիրք") or Russian (e.g. "книга").</li>
            <li>If you have selected a specific textbook scope, try switching to <strong>All Textbooks</strong>.</li>
          </ul>
          <div>
            <button id="clearSearchFromEmptyBtn" class="sm" style="font-size: 0.85rem; padding: 8px 16px;">
              ✕ Clear Search
            </button>
          </div>
        </div>
      `;
    }

    // 4. Results List
    const count = this.searchResults.length;
    return `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <!-- Result count & summary banner -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px;">
          <div style="font-size: 0.9rem; color: var(--mu);">
            Found <strong class="tabular-nums" style="color: var(--tx);">${count}</strong> ${
      count === 1 ? 'matching word' : 'matching words'
    } for "<strong style="color: var(--tx);">${this.escapeHtml(trimmedQuery)}</strong>"
          </div>
        </div>

        <!-- Results Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px;">
          ${this.searchResults.map((res) => this.renderResultCard(res, trimmedQuery)).join('')}
        </div>
      </div>
    `;
  }

  private renderResultCard(res: GlobalSearchResult, query: string): string {
    const { word } = res;

    // Field highlight badges
    const matchedBadges = res.matchedFields.map((f) => {
      if (f === 'english') return '<span class="chip ok" style="font-size: 0.65rem;">Match: English</span>';
      if (f === 'armenian') return '<span class="chip ok" style="font-size: 0.65rem;">Match: Armenian</span>';
      if (f === 'russian') return '<span class="chip ok" style="font-size: 0.65rem;">Match: Russian</span>';
      return '<span class="chip ok" style="font-size: 0.65rem;">Match: Definition</span>';
    });

    return `
      <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid ${
        res.isKnown ? 'var(--ok)' : 'var(--ac)'
      }; padding: 16px;">
        <div>
          <!-- Header: English + Type + Status Toggle -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <div>
              <div style="font-weight: 700; font-size: 1.15rem; color: var(--tx);">
                ${this.highlightMatch(word.en, query)}
              </div>
              <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                ${
                  word.type
                    ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px; text-transform: uppercase;">${word.type}</span>`
                    : ''
                }
                ${
                  word.pronunciation
                    ? `<span style="font-family: monospace; font-size: 0.78rem; color: var(--mu);">${word.pronunciation}</span>`
                    : ''
                }
                ${
                  word.partOfSpeech
                    ? `<span class="chip" style="font-size: 0.65rem; padding: 1px 6px;">${word.partOfSpeech}</span>`
                    : ''
                }
              </div>
            </div>

            <!-- Known status button -->
            <button
              type="button"
              class="sm toggle-search-known-btn"
              data-word-id="${word.id}"
              data-known="${res.isKnown}"
              title="${res.isKnown ? 'Mark as learning' : 'Mark as known'}"
              style="border-radius: 50%; width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 0.95rem; border-color: ${
                res.isKnown ? 'var(--ok)' : 'var(--ln)'
              }; background: ${
      res.isKnown ? 'color-mix(in srgb, var(--ok) 15%, var(--sf))' : 'transparent'
    }; color: ${res.isKnown ? 'var(--ok)' : 'var(--mu)'};"
            >
              ${res.isKnown ? '✓' : '○'}
            </button>
          </div>

          <!-- Translations Box -->
          <div style="display: grid; gap: 6px; padding: 9px 12px; background: var(--bg); border-radius: 10px; margin-bottom: 10px; font-size: 0.9rem;">
            <div style="font-weight: 600; color: var(--tx);">
              <span style="color: var(--mu); font-size: 0.75rem; text-transform: uppercase; margin-right: 4px;">HY:</span>
              ${this.highlightMatch(word.hy, query)}
            </div>
            ${
              word.ru
                ? `<div style="color: var(--mu);">
                    <span style="color: var(--mu); font-size: 0.75rem; text-transform: uppercase; margin-right: 4px;">RU:</span>
                    ${this.highlightMatch(word.ru, query)}
                  </div>`
                : ''
            }
          </div>

          <!-- Definition & Examples -->
          ${
            word.definition
              ? `<div style="font-size: 0.84rem; color: var(--tx); margin-bottom: 6px; line-height: 1.35;">
                  <strong>Def:</strong> ${this.highlightMatch(word.definition, query)}
                </div>`
              : ''
          }
          ${
            word.example
              ? `<div style="font-size: 0.82rem; color: var(--mu); font-style: italic; margin-bottom: 6px; line-height: 1.35;">
                  "${this.highlightMatch(word.example, query)}"
                </div>`
              : ''
          }
          ${
            word.note || word.hint
              ? `<div style="font-size: 0.78rem; color: var(--ac); margin-bottom: 6px;">
                  💡 ${word.note || word.hint}
                </div>`
              : ''
          }

          <!-- Match origin tags -->
          <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px;">
            ${matchedBadges.join('')}
          </div>
        </div>

        <!-- Footer: Book & Lesson origin + Open in Lesson CTA -->
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ln); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 0.76rem; color: var(--mu); display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: 600; color: var(--tx); display: flex; align-items: center; gap: 4px;">
              <span>${res.bookIsBuiltin ? '📖' : '📘'}</span>
              <span>${res.bookName}</span>
            </div>
            <div>
              <span>${res.lessonName}</span>
              ${word.sourcePage || word.page ? `<span> · p. ${word.sourcePage || word.page}</span>` : ''}
            </div>
          </div>

          <!-- Actions: Practice + Open in Lesson -->
          <div style="display: flex; gap: 6px; align-items: center;">
            <button
              type="button"
              class="sm search-practice-word-btn"
              data-word-id="${word.id}"
              style="font-size: 0.8rem; padding: 6px 12px; font-weight: 600;"
            >
              🔊 Practice
            </button>
            <button
              type="button"
              class="sm open-in-lesson-btn"
              data-book-id="${res.bookId}"
              data-lesson-num="${res.lessonNumber}"
              data-word-id="${word.id}"
              style="font-size: 0.8rem; padding: 6px 12px; font-weight: 600; color: var(--ac); border-color: var(--ac);"
            >
              ➔ Open in Lesson
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private highlightMatch(text: string | undefined, query: string): string {
    if (!text) return '';
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) return this.escapeHtml(text);

    // Escape regex characters
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');

    return this.escapeHtml(text).replace(
      regex,
      `<mark style="background: color-mix(in srgb, var(--ac) 28%, transparent); color: inherit; padding: 0 2px; border-radius: 3px; font-weight: 700;">$1</mark>`
    );
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private bindEvents(): void {
    const input = this.container.querySelector('#globalSearchInput') as HTMLInputElement | null;
    const clearBtn = this.container.querySelector('#clearSearchQueryBtn') as HTMLButtonElement | null;
    const bookScopeSelect = this.container.querySelector('#searchBookScopeSelect') as HTMLSelectElement | null;

    // Live search on input with immediate responsiveness (50ms debounce)
    input?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => {
        this.executeSearch();
      }, 50);
    });

    // Keyboard shortcuts: Escape to clear
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.query = '';
        if (input) input.value = '';
        this.executeSearch();
      }
    });

    clearBtn?.addEventListener('click', () => {
      this.query = '';
      if (input) {
        input.value = '';
        input.focus();
      }
      this.executeSearch();
    });

    bookScopeSelect?.addEventListener('change', (e) => {
      this.selectedBookId = (e.target as HTMLSelectElement).value;
      this.executeSearch();
    });

    // Status filter buttons
    this.container.querySelector('#searchFilterAll')?.addEventListener('click', () => {
      this.statusFilter = 'all';
      this.render();
      this.executeSearch();
    });
    this.container.querySelector('#searchFilterKnown')?.addEventListener('click', () => {
      this.statusFilter = 'known';
      this.render();
      this.executeSearch();
    });
    this.container.querySelector('#searchFilterLearning')?.addEventListener('click', () => {
      this.statusFilter = 'learning';
      this.render();
      this.executeSearch();
    });

    this.bindResultEvents();
  }

  private bindResultEvents(): void {
    const mount = this.container.querySelector('#searchResultsMountPoint');
    if (!mount) return;

    // Quick search tags on initial empty state
    mount.querySelectorAll('.quick-search-tag').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const q = (e.currentTarget as HTMLElement).dataset.query || '';
        this.setQuery(q);
      });
    });

    // Clear search button in empty state
    mount.querySelector('#clearSearchFromEmptyBtn')?.addEventListener('click', () => {
      this.query = '';
      const input = this.container.querySelector('#globalSearchInput') as HTMLInputElement | null;
      if (input) {
        input.value = '';
        input.focus();
      }
      this.executeSearch();
    });

    // Open in Lesson delegation
    mount.querySelectorAll('.open-in-lesson-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const bookId = target.dataset.bookId || '';
        const lessonNum = target.dataset.lessonNum || '';
        const wordId = target.dataset.wordId || '';
        if (bookId) {
          this.props.onOpenInLesson(bookId, lessonNum, wordId);
        }
      });
    });

    // Toggle Known status delegation
    mount.querySelectorAll('.toggle-search-known-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const wordId = target.dataset.wordId || '';
        const currentKnown = target.dataset.known === 'true';
        const nextKnown = !currentKnown;

        try {
          await vocabularyService.setWordKnownStatus(this.props.userId, wordId, nextKnown);
          // Update local state and button display immediately
          target.dataset.known = String(nextKnown);
          target.textContent = nextKnown ? '✓' : '○';
          target.style.borderColor = nextKnown ? 'var(--ok)' : 'var(--ln)';
          target.style.background = nextKnown ? 'color-mix(in srgb, var(--ok) 15%, var(--sf))' : 'transparent';
          target.style.color = nextKnown ? 'var(--ok)' : 'var(--mu)';

          // Update matching item in searchResults
          const item = this.searchResults.find((r) => r.word.id === wordId);
          if (item) {
            item.isKnown = nextKnown;
          }
        } catch (err) {
          console.warn('Failed to update known status from search:', err);
        }
      });
    });

    // Practice pronunciation delegation
    mount.querySelectorAll('.search-practice-word-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const wordId = target.dataset.wordId || '';
        const item = this.searchResults.find((r) => r.word.id === wordId);
        if (item) {
          this.openPracticeModal(item.word);
        }
      });
    });
  }

  private openPracticeModal(word: any): void {
    const host = this.container.querySelector('#searchModalsHost') as HTMLElement | null;
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
              const item = this.searchResults.find((r) => r.word.id === wordId);
              if (item) {
                item.isKnown = true;
              }
              this.executeSearch();
            } catch (err) {
              console.warn('Could not auto-mark word as known after search practice:', err);
            }
          }
        },
      });
    }
  }
}
