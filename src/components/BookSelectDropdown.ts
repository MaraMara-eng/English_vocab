/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager } from '../db/indexedDB.ts';
import { Book, Lesson } from '../db/types.ts';
import { bookService } from '../services/bookService.ts';
import { lessonService } from '../services/lessonService.ts';

export interface BookSelectDropdownProps {
  userId: string;
  selectedBookId?: string;
  onBookChange: (book: Book, lessons: Lesson[]) => void;
  onCreateBookRequested?: () => void;
  placeholder?: string;
  showCreateOption?: boolean;
}

export class BookSelectDropdown {
  private container: HTMLElement;
  private props: BookSelectDropdownProps;
  private books: Book[] = [];
  private selectedBook: Book | null = null;
  private isOpen: boolean = false;
  private searchQuery: string = '';
  private highlightedIndex: number = -1;
  private lessons: Lesson[] = [];
  private isDestroyed: boolean = false;

  constructor(container: HTMLElement, props: BookSelectDropdownProps) {
    this.container = container;
    this.props = {
      placeholder: 'Select a textbook...',
      showCreateOption: true,
      ...props,
    };
    this.init();
  }

  public async init(): Promise<void> {
    try {
      await lessonService.ensureDefaultBonkLessons();
      this.books = await bookService.getUserBooks(this.props.userId);

      // Determine initial selection
      let initialBookId = this.props.selectedBookId;

      if (!initialBookId) {
        // Try localStorage rapid restoration
        try {
          const raw = localStorage.getItem('vq:sel:' + this.props.userId);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.b) initialBookId = parsed.b;
          }
        } catch {
          // Ignore
        }
      }

      if (!initialBookId) {
        // Try user settings in DB
        const settings = await dbManager.getSettings(this.props.userId);
        initialBookId = settings.selectedBookId;
      }

      // Match selected book or fallback to first available (e.g. bonk1)
      this.selectedBook =
        this.books.find((b) => b.id === initialBookId) ||
        this.books[0] ||
        null;

      if (this.selectedBook) {
        this.lessons = await lessonService.getLessonsForBook(this.selectedBook.id);
        this.props.onBookChange(this.selectedBook, this.lessons);
      }
    } catch (err) {
      console.warn('Failed to initialize book select dropdown:', err);
    }

    if (!this.isDestroyed) {
      this.render();
    }
  }

  public getSelectedBook(): Book | null {
    return this.selectedBook;
  }

  public getLessons(): Lesson[] {
    return this.lessons;
  }

  public async selectBookById(bookId: string): Promise<void> {
    const book = this.books.find((b) => b.id === bookId);
    if (book) {
      await this.selectBook(book);
    }
  }

  public async reloadBooks(): Promise<void> {
    this.books = await bookService.getUserBooks(this.props.userId);
    if (this.selectedBook) {
      // Re-verify currently selected book still exists
      const stillExists = this.books.find((b) => b.id === this.selectedBook?.id);
      if (!stillExists) {
        this.selectedBook = this.books[0] || null;
        if (this.selectedBook) {
          await this.selectBook(this.selectedBook);
        }
      }
    }
    this.render();
  }

  private async selectBook(book: Book): Promise<void> {
    this.selectedBook = book;
    this.isOpen = false;
    this.searchQuery = '';
    this.highlightedIndex = -1;

    // Persist to localStorage for immediate retrieval on page reload
    try {
      localStorage.setItem('vq:sel:' + this.props.userId, JSON.stringify({ b: book.id }));
    } catch {
      // Ignore
    }

    // Persist to user settings in IndexedDB
    try {
      await dbManager.saveSettings(this.props.userId, { selectedBookId: book.id });
    } catch (err) {
      console.warn('Failed to persist selected book in settings:', err);
    }

    // Load lessons for newly selected book
    this.lessons = await lessonService.getLessonsForBook(book.id);

    // Notify listener
    this.props.onBookChange(book, this.lessons);

    this.render();
  }

  private getFilteredBooks(): Book[] {
    if (!this.searchQuery.trim()) {
      return this.books;
    }
    const q = this.searchQuery.toLowerCase().trim();
    return this.books.filter(
      (b) => b.name.toLowerCase().includes(q) || (b.description && b.description.toLowerCase().includes(q))
    );
  }

  private render(): void {
    const filtered = this.getFilteredBooks();
    const hasSelection = this.selectedBook !== null;
    const isBuiltin = this.selectedBook?.isBuiltin;

    this.container.innerHTML = `
      <div class="vq-combobox-wrapper" style="position: relative; width: 100%; min-width: 200px; font-size: 0.9rem;">
        <!-- Combobox Trigger Button -->
        <button
          type="button"
          id="comboboxTriggerBtn"
          aria-haspopup="listbox"
          aria-expanded="${this.isOpen}"
          style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: var(--sf); border: 1px solid var(--ln); border-radius: 12px; text-align: left; transition: border-color 0.15s, box-shadow 0.15s;"
        >
          <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <span style="font-size: 1.1rem; flex-shrink: 0;">${isBuiltin ? '📖' : '📘'}</span>
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span style="font-weight: 600; color: var(--tx);">
                ${hasSelection ? this.selectedBook?.name : (this.props.placeholder || 'Select textbook')}
              </span>
            </div>
            ${
              hasSelection
                ? `<span class="chip ${isBuiltin ? 'ok' : 'wn'}" style="font-size: 0.65rem; padding: 1px 6px; flex-shrink: 0;">
                    ${isBuiltin ? 'Standard' : 'Custom'}
                  </span>`
                : ''
            }
          </div>

          <span style="font-size: 0.8rem; color: var(--mu); transition: transform 0.2s; transform: ${this.isOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">
            ▼
          </span>
        </button>

        <!-- Dropdown Popover Menu -->
        ${
          this.isOpen
            ? `
          <div
            id="comboboxDropdown"
            role="listbox"
            style="position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 280px; max-width: 100%; background: var(--sf); border: 1px solid var(--ln); border-radius: 14px; box-shadow: var(--sh); z-index: 70; overflow: hidden; display: flex; flex-direction: column; animation: pop 0.2s ease-out;"
          >
            <!-- Search Input Header -->
            <div style="padding: 10px; border-bottom: 1px solid var(--ln); background: color-mix(in srgb, var(--bg) 50%, var(--sf));">
              <input
                type="search"
                id="comboboxSearchInput"
                placeholder="Search textbooks..."
                value="${this.searchQuery}"
                autocomplete="off"
                spellcheck="false"
                style="width: 100%; padding: 8px 10px; font-size: 0.85rem; border-radius: 8px;"
              />
            </div>

            <!-- Scrollable Books Options List -->
            <div id="comboboxOptionsList" style="max-height: 250px; overflow-y: auto; padding: 6px 0;">
              ${
                filtered.length === 0
                  ? `
                  <div style="padding: 20px 14px; text-align: center; color: var(--mu); font-size: 0.85rem;">
                    <div style="font-size: 1.3rem; margin-bottom: 4px;">🔍</div>
                    <p style="margin: 0;">No textbooks found matching "${this.searchQuery}".</p>
                  </div>
                `
                  : filtered
                      .map((book, idx) => {
                        const isSelected = book.id === this.selectedBook?.id;
                        const isHighlighted = idx === this.highlightedIndex;
                        return `
                        <div
                          role="option"
                          aria-selected="${isSelected}"
                          data-book-id="${book.id}"
                          class="combobox-item"
                          style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; cursor: pointer; transition: background 0.1s; background: ${
                            isSelected
                              ? 'color-mix(in srgb, var(--ac) 10%, var(--sf))'
                              : isHighlighted
                              ? 'color-mix(in srgb, var(--ac) 5%, var(--sf))'
                              : 'transparent'
                          };"
                        >
                          <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                            <span style="font-size: 1.1rem; flex-shrink: 0;">${book.isBuiltin ? '📖' : '📘'}</span>
                            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                              <div style="font-weight: ${isSelected ? '700' : '500'}; font-size: 0.88rem; color: var(--tx);">
                                ${book.name}
                              </div>
                              ${
                                book.description
                                  ? `<div style="font-size: 0.75rem; color: var(--mu); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                      ${book.description}
                                    </div>`
                                  : ''
                              }
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span class="chip ${book.isBuiltin ? 'ok' : 'wn'}" style="font-size: 0.65rem;">
                              ${book.isBuiltin ? 'Standard' : 'Custom'}
                            </span>
                            ${isSelected ? '<span style="color: var(--ok); font-weight: 700;">✓</span>' : ''}
                          </div>
                        </div>
                      `;
                      })
                      .join('')
              }
            </div>

            <!-- Optional Create New Book Action -->
            ${
              this.props.showCreateOption
                ? `
                <div style="padding: 8px 10px; border-top: 1px solid var(--ln); background: color-mix(in srgb, var(--bg) 40%, var(--sf));">
                  <button
                    type="button"
                    id="comboboxCreateBtn"
                    style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; font-size: 0.85rem; border-radius: 8px; border: 1px dashed var(--ac); color: var(--ac); background: color-mix(in srgb, var(--ac) 5%, transparent); font-weight: 600;"
                  >
                    <span>➕</span> Create New Textbook…
                  </button>
                </div>
              `
                : ''
            }
          </div>
        `
            : ''
        }
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const triggerBtn = this.container.querySelector('#comboboxTriggerBtn') as HTMLButtonElement | null;
    const searchInput = this.container.querySelector('#comboboxSearchInput') as HTMLInputElement | null;
    const optionsList = this.container.querySelector('#comboboxOptionsList') as HTMLElement | null;
    const createBtn = this.container.querySelector('#comboboxCreateBtn') as HTMLButtonElement | null;

    triggerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isOpen = !this.isOpen;
      this.render();

      if (this.isOpen) {
        setTimeout(() => {
          const input = this.container.querySelector('#comboboxSearchInput') as HTMLInputElement | null;
          input?.focus();
        }, 50);
      }
    });

    searchInput?.addEventListener('input', (e) => {
      e.stopPropagation();
      this.searchQuery = (searchInput.value || '').trim();
      this.highlightedIndex = 0;
      this.render();

      const nextInput = this.container.querySelector('#comboboxSearchInput') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    });

    // Keyboard navigation (Escape, Up, Down, Enter)
    searchInput?.addEventListener('keydown', (e) => {
      const filtered = this.getFilteredBooks();

      if (e.key === 'Escape') {
        this.isOpen = false;
        this.render();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlightedIndex = Math.min(filtered.length - 1, this.highlightedIndex + 1);
        this.render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
        this.render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlightedIndex >= 0 && this.highlightedIndex < filtered.length) {
          this.selectBook(filtered[this.highlightedIndex]);
        }
      }
    });

    // Option click delegation
    optionsList?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const optionEl = target.closest('[data-book-id]') as HTMLElement | null;
      if (optionEl) {
        const bookId = optionEl.dataset.bookId;
        const book = this.books.find((b) => b.id === bookId);
        if (book) {
          this.selectBook(book);
        }
      }
    });

    // Create New Book click
    createBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (this.props.onCreateBookRequested) {
        this.props.onCreateBookRequested();
      }
    });

    // Click outside to dismiss dropdown
    const handleOutsideClick = (e: MouseEvent) => {
      if (!this.container.contains(e.target as Node) && this.isOpen) {
        this.isOpen = false;
        this.render();
      }
    };

    document.addEventListener('click', handleOutsideClick);
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.container.innerHTML = '';
  }
}
