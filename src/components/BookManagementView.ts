/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book } from '../db/types.ts';
import { ValidationError } from '../db/validators.ts';
import { bookService, BookStats } from '../services/bookService.ts';

export interface BookManagementViewProps {
  userId: string;
  onBookSelected?: (book: Book) => void;
}

export class BookManagementView {
  private container: HTMLElement;
  private props: BookManagementViewProps;
  private books: Book[] = [];
  private statsCache: Map<string, BookStats> = new Map();
  private searchQuery: string = '';
  private isLoading: boolean = true;

  // Modals state
  private activeModal: 'none' | 'create' | 'edit' | 'delete' = 'none';
  private targetBook: Book | null = null;
  private targetStats: BookStats | null = null;
  private modalError: string = '';

  constructor(container: HTMLElement, props: BookManagementViewProps) {
    this.container = container;
    this.props = props;
    this.loadBooks();
  }

  public async loadBooks(): Promise<void> {
    this.isLoading = true;
    this.render();
    try {
      this.books = await bookService.getUserBooks(this.props.userId);
      // Fetch stats for all user books in parallel
      const statsList = await Promise.all(
        this.books.map((b) => bookService.getBookStats(this.props.userId, b.id).catch(() => null))
      );
      this.statsCache.clear();
      statsList.forEach((s) => {
        if (s) this.statsCache.set(s.book.id, s);
      });
    } catch (err) {
      console.warn('Failed to load books:', err);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private render(): void {
    const filteredBooks = this.books.filter((b) => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return b.name.toLowerCase().includes(q) || (b.description && b.description.toLowerCase().includes(q));
    });

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Header & Controls -->
        <div class="card" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <h2 style="margin: 0 0 4px; font-size: 1.3rem; display: flex; align-items: center; gap: 8px;">
                <span>📚</span> My Textbooks & Collections
              </h2>
              <p style="margin: 0; color: var(--mu); font-size: 0.85rem;">
                Manage your personal vocabulary textbooks and study collections. Stored locally in IndexedDB.
              </p>
            </div>

            <div style="display: flex; gap: 10px; align-items: center;">
              <button id="openCreateBookBtn" class="p" style="display: flex; align-items: center; gap: 6px; font-size: 0.9rem; padding: 10px 16px;">
                <span>➕</span> Create Textbook
              </button>
            </div>
          </div>

          <!-- Search Filter -->
          <div style="margin-top: 16px;">
            <input
              type="search"
              id="bookSearchInput"
              placeholder="Search textbooks by name or description…"
              value="${this.searchQuery}"
              style="padding: 10px 14px; font-size: 0.9rem;"
            />
          </div>
        </div>

        <!-- Books List / Grid -->
        ${
          this.isLoading
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 1.8rem; margin-bottom: 8px;">⏳</div>
                <p style="margin: 0;">Loading your textbooks from IndexedDB...</p>
              </div>`
            : filteredBooks.length === 0
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 2rem; margin-bottom: 8px;">📖</div>
                <p style="margin: 0 0 10px; font-size: 1rem; font-weight: 600;">No textbooks found</p>
                <p style="margin: 0 0 16px; font-size: 0.85rem;">
                  ${this.searchQuery ? 'No textbooks match your search filter.' : 'You have not created any custom textbooks yet.'}
                </p>
                ${
                  this.searchQuery
                    ? `<button id="clearSearchBtn" class="sm">Clear search filter</button>`
                    : `<button id="createFirstBookBtn" class="p sm">Create your first textbook</button>`
                }
              </div>`
            : `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
                ${filteredBooks.map((book) => this.renderBookCard(book)).join('')}
              </div>`
        }

        <!-- Modals Container -->
        <div id="bookModalsHost">
          ${this.renderActiveModal()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderBookCard(book: Book): string {
    const isOwner = book.createdBy === this.props.userId;
    const stats = this.statsCache.get(book.id);
    const lessonCount = stats ? stats.lessonCount : 0;
    const wordCount = stats ? stats.wordCount : 0;
    const progressCount = stats ? stats.userProgressCount : 0;

    const createdStr = new Date(book.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return `
      <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid ${book.isBuiltin ? 'var(--ac)' : 'var(--ac2)'};">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; line-height: 1.3;">
              ${book.name}
            </h3>
            <span class="chip ${book.isBuiltin ? 'ok' : 'wn'}" style="white-space: nowrap; font-size: 0.7rem;">
              ${book.isBuiltin ? '📖 Standard' : '📘 Custom'}
            </span>
          </div>

          <p style="margin: 0 0 14px; font-size: 0.85rem; color: var(--mu); line-height: 1.4; min-height: 2.4em;">
            ${book.description || '<em>No description provided</em>'}
          </p>

          <!-- Metrics / Counts -->
          <div style="display: flex; gap: 12px; margin-bottom: 14px; padding: 8px 12px; background: var(--bg); border-radius: 10px; font-size: 0.8rem;">
            <div>
              <span style="color: var(--mu); display: block; font-size: 0.7rem;">Lessons</span>
              <strong style="font-size: 0.95rem;">${lessonCount}</strong>
            </div>
            <div style="border-left: 1px solid var(--ln); padding-left: 12px;">
              <span style="color: var(--mu); display: block; font-size: 0.7rem;">Words</span>
              <strong style="font-size: 0.95rem;">${wordCount}</strong>
            </div>
            <div style="border-left: 1px solid var(--ln); padding-left: 12px;">
              <span style="color: var(--mu); display: block; font-size: 0.7rem;">Practiced</span>
              <strong style="font-size: 0.95rem;">${progressCount}</strong>
            </div>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--ln); font-size: 0.75rem; color: var(--mu);">
            <span>Added ${createdStr}</span>

            <div style="display: flex; gap: 6px;">
              ${
                isOwner && !book.isBuiltin
                  ? `<button class="sm" data-edit-book="${book.id}" title="Edit book name and description">
                      ✏️ Edit
                    </button>
                    <button class="sm" data-delete-book="${book.id}" style="color: var(--no); border-color: var(--no);" title="Delete book">
                      🗑️ Delete
                    </button>`
                  : `<span class="chip" style="font-size: 0.7rem;">Read-only</span>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderActiveModal(): string {
    if (this.activeModal === 'none') return '';

    if (this.activeModal === 'create') {
      return `
        <div class="modal" id="bookModalOverlay" style="display: grid;">
          <div class="box">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>➕</span> Create New Textbook
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Add a new textbook to organize your vocabulary units and custom practice words.
            </p>

            <form id="createBookForm" style="display: grid; gap: 14px;" novalidate>
              <label class="field-label">
                <span>Textbook Title <span class="req">*</span></span>
                <input
                  type="text"
                  id="newBookName"
                  placeholder="e.g. Cambridge C1 Advanced Words"
                  maxlength="80"
                  required
                />
              </label>

              <label class="field-label">
                <span>Description <span style="font-size: 0.75rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="newBookDesc"
                  placeholder="e.g. Focus on phrasal verbs, idioms and collocations"
                  maxlength="200"
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
                <button type="button" id="closeModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitCreateBookBtn">Create Textbook</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'edit' && this.targetBook) {
      return `
        <div class="modal" id="bookModalOverlay" style="display: grid;">
          <div class="box">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>✏️</span> Edit Textbook
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Update title and description for <strong>${this.targetBook.name}</strong>.
            </p>

            <form id="editBookForm" style="display: grid; gap: 14px;" novalidate>
              <label class="field-label">
                <span>Textbook Title <span class="req">*</span></span>
                <input
                  type="text"
                  id="editBookName"
                  value="${this.targetBook.name}"
                  maxlength="80"
                  required
                />
              </label>

              <label class="field-label">
                <span>Description <span style="font-size: 0.75rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="editBookDesc"
                  value="${this.targetBook.description || ''}"
                  maxlength="200"
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
                <button type="button" id="closeModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitEditBookBtn">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'delete' && this.targetBook && this.targetStats) {
      const { lessonCount, wordCount, userProgressCount } = this.targetStats;
      const hasAssociatedData = lessonCount > 0 || wordCount > 0 || userProgressCount > 0;

      return `
        <div class="modal" id="bookModalOverlay" style="display: grid;">
          <div class="box">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
              <span style="font-size: 2rem;">⚠️</span>
              <div>
                <h3 style="margin: 0; font-size: 1.25rem; color: var(--no);">Delete Textbook</h3>
                <p style="margin: 2px 0 0; font-size: 0.85rem; color: var(--mu);">
                  Textbook: <strong>${this.targetBook.name}</strong>
                </p>
              </div>
            </div>

            <!-- Clear Warning & Explanation -->
            <div class="chip no" style="display: block; width: 100%; border-radius: 12px; padding: 12px; font-size: 0.85rem; line-height: 1.5; margin-bottom: 16px;">
              <strong>Warning: This action is permanent and cannot be undone!</strong>
              ${
                hasAssociatedData
                  ? `<p style="margin: 6px 0 0;">
                      This textbook contains <strong>${lessonCount}</strong> lessons, <strong>${wordCount}</strong> vocabulary words, and <strong>${userProgressCount}</strong> of your practice progress records.
                    </p>
                    <p style="margin: 4px 0 0;">
                      Deleting this book will permanently erase all associated lessons, words, and learning history.
                    </p>`
                  : `<p style="margin: 4px 0 0;">
                      This textbook is empty. Deleting it will permanently remove it from your collection.
                    </p>`
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
              <button type="button" id="closeModalBtn">Cancel</button>
              <button
                type="button"
                id="confirmDeleteBookBtn"
                style="background: var(--no); color: #fff; border: 0; font-weight: 600; padding: 9px 16px; border-radius: 12px;"
              >
                Permanently Delete Textbook
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  private bindEvents(): void {
    // Search input
    const searchInput = this.container.querySelector('#bookSearchInput') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.searchQuery = (searchInput.value || '').trim();
      this.render();
      // Restore focus to search input
      const nextSearchInput = this.container.querySelector('#bookSearchInput') as HTMLInputElement | null;
      if (nextSearchInput) {
        nextSearchInput.focus();
        nextSearchInput.setSelectionRange(nextSearchInput.value.length, nextSearchInput.value.length);
      }
    });

    // Clear search
    this.container.querySelector('#clearSearchBtn')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.render();
    });

    // Open Create Modal
    const openCreate = () => {
      this.activeModal = 'create';
      this.modalError = '';
      this.render();
      const input = this.container.querySelector('#newBookName') as HTMLInputElement | null;
      input?.focus();
    };

    this.container.querySelector('#openCreateBookBtn')?.addEventListener('click', openCreate);
    this.container.querySelector('#createFirstBookBtn')?.addEventListener('click', openCreate);

    // Close Modal handler
    const closeModal = () => {
      this.activeModal = 'none';
      this.targetBook = null;
      this.targetStats = null;
      this.modalError = '';
      this.render();
    };

    this.container.querySelector('#closeModalBtn')?.addEventListener('click', closeModal);
    const overlay = this.container.querySelector('#bookModalOverlay');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Submit Create Book Form
    const createForm = this.container.querySelector('#createBookForm') as HTMLFormElement | null;
    createForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = this.container.querySelector('#newBookName') as HTMLInputElement | null;
      const descInput = this.container.querySelector('#newBookDesc') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitCreateBookBtn') as HTMLButtonElement | null;

      const name = (nameInput?.value || '').trim();
      const description = (descInput?.value || '').trim();

      if (!name) {
        this.modalError = 'Please enter a textbook title.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
        }
        await bookService.createBook(this.props.userId, { name, description });
        closeModal();
        await this.loadBooks();
      } catch (err) {
        if (err instanceof ValidationError) {
          this.modalError = err.message;
        } else if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not create textbook. Please try again.';
        }
        this.render();
      }
    });

    // Submit Edit Book Form
    const editForm = this.container.querySelector('#editBookForm') as HTMLFormElement | null;
    editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.targetBook) return;

      const nameInput = this.container.querySelector('#editBookName') as HTMLInputElement | null;
      const descInput = this.container.querySelector('#editBookDesc') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitEditBookBtn') as HTMLButtonElement | null;

      const name = (nameInput?.value || '').trim();
      const description = (descInput?.value || '').trim();

      if (!name) {
        this.modalError = 'Textbook title cannot be empty.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }
        await bookService.updateBook(this.props.userId, this.targetBook.id, { name, description });
        closeModal();
        await this.loadBooks();
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not update textbook.';
        }
        this.render();
      }
    });

    // Confirm Delete Book
    const confirmDeleteBtn = this.container.querySelector('#confirmDeleteBookBtn') as HTMLButtonElement | null;
    confirmDeleteBtn?.addEventListener('click', async () => {
      if (!this.targetBook) return;

      try {
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = 'Deleting...';
        await bookService.deleteBook(this.props.userId, this.targetBook.id);
        closeModal();
        await this.loadBooks();
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not delete textbook.';
        }
        this.render();
      }
    });

    // Delegation for Edit & Delete buttons on cards
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // Edit Click
      const editBtn = target.closest('[data-edit-book]') as HTMLElement | null;
      if (editBtn) {
        const bookId = editBtn.dataset.editBook;
        const book = this.books.find((b) => b.id === bookId);
        if (book) {
          this.targetBook = book;
          this.activeModal = 'edit';
          this.modalError = '';
          this.render();
          const input = this.container.querySelector('#editBookName') as HTMLInputElement | null;
          input?.focus();
        }
        return;
      }

      // Delete Click
      const deleteBtn = target.closest('[data-delete-book]') as HTMLElement | null;
      if (deleteBtn) {
        const bookId = deleteBtn.dataset.deleteBook;
        const book = this.books.find((b) => b.id === bookId);
        if (book) {
          this.targetBook = book;
          this.targetStats = await bookService.getBookStats(this.props.userId, book.id);
          this.activeModal = 'delete';
          this.modalError = '';
          this.render();
        }
        return;
      }
    });
  }
}
