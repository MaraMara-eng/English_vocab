/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, Lesson } from '../db/types.ts';
import { ValidationError } from '../db/validators.ts';
import { lessonService, LessonStats } from '../services/lessonService.ts';
import { vocabularyService } from '../services/vocabularyService.ts';
import { ReportModal } from './ReportModal.ts';

export interface LessonManagementViewProps {
  userId: string;
  book: Book;
  onLessonSelected?: (lessonNumber: string) => void;
  onLessonsChanged?: () => void;
}

export class LessonManagementView {
  private container: HTMLElement;
  private props: LessonManagementViewProps;
  private lessons: Lesson[] = [];
  private statsCache: Map<string, LessonStats> = new Map();
  private searchQuery: string = '';
  private isLoading: boolean = true;

  // Modal states
  private activeModal: 'none' | 'create' | 'edit' | 'delete' = 'none';
  private targetLesson: Lesson | null = null;
  private targetStats: LessonStats | null = null;
  private modalError: string = '';

  constructor(container: HTMLElement, props: LessonManagementViewProps) {
    this.container = container;
    this.props = props;
    this.loadLessons();
  }

  public async setBook(book: Book): Promise<void> {
    this.props.book = book;
    await this.loadLessons();
  }

  public async loadLessons(): Promise<void> {
    this.isLoading = true;
    this.render();
    try {
      this.lessons = await lessonService.getLessonsForBook(this.props.book.id, this.props.userId);
      const statsList = await Promise.all(
        this.lessons.map((l) => lessonService.getLessonStats(this.props.userId, l.id).catch(() => null))
      );
      this.statsCache.clear();
      statsList.forEach((s) => {
        if (s) this.statsCache.set(s.lesson.id, s);
      });
    } catch (err) {
      console.warn('Failed to load lessons:', err);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private render(): void {
    const isOwner = this.props.book.createdBy === this.props.userId;
    const isBuiltin = this.props.book.isBuiltin;
    const filteredLessons = this.lessons.filter((l) => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return (
        l.name.toLowerCase().includes(q) ||
        l.lessonNumber.toLowerCase().includes(q) ||
        (l.description && l.description.toLowerCase().includes(q))
      );
    });

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <!-- Header & Action Controls -->
        <div class="card" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">📖</span>
                <h3 style="margin: 0; font-size: 1.25rem;">
                  Lessons in "${this.props.book.name}"
                </h3>
                <span class="chip ${isBuiltin ? 'ok' : 'wn'}" style="font-size: 0.7rem;">
                  ${isBuiltin ? 'Standard Curriculum' : 'Custom Textbook'}
                </span>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
                ${this.props.book.description || 'Manage curriculum units, vocabulary lists, and practice sets.'}
              </p>
            </div>

            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <button id="openBookReportBtn" class="sm" style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; padding: 8px 14px;">
                <span>📊</span> Textbook Report
              </button>
              ${
                isOwner && !isBuiltin
                  ? `<button id="openCreateLessonBtn" class="p" style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; padding: 9px 15px;">
                      <span>➕</span> Create Lesson
                    </button>`
                  : ''
              }
            </div>
          </div>

          <!-- Search Filter -->
          <div style="margin-top: 14px;">
            <input
              type="search"
              id="lessonSearchInput"
              placeholder="Search lessons by title, number, or description…"
              value="${this.searchQuery}"
              style="padding: 9px 14px; font-size: 0.88rem; width: 100%; border-radius: 10px;"
            />
          </div>
        </div>

        <!-- Lessons List -->
        ${
          this.isLoading
            ? `<div class="card" style="text-align: center; padding: 36px; color: var(--mu);">
                <div style="font-size: 1.8rem; margin-bottom: 8px;">⏳</div>
                <p style="margin: 0;">Loading lessons for ${this.props.book.name}...</p>
              </div>`
            : filteredLessons.length === 0
            ? `<div class="card" style="text-align: center; padding: 40px; color: var(--mu);">
                <div style="font-size: 2rem; margin-bottom: 8px;">📑</div>
                <p style="margin: 0 0 8px; font-size: 1.05rem; font-weight: 600;">No lessons found</p>
                <p style="margin: 0 0 16px; font-size: 0.85rem;">
                  ${
                    this.searchQuery
                      ? 'No lessons match your search filter.'
                      : 'This textbook currently has no lessons. Create your first lesson to start adding vocabulary!'
                  }
                </p>
                ${
                  this.searchQuery
                    ? `<button id="clearLessonSearchBtn" class="sm">Clear search filter</button>`
                    : isOwner && !isBuiltin
                    ? `<button id="createFirstLessonBtn" class="p sm">➕ Create First Lesson</button>`
                    : ''
                }
              </div>`
            : `<div style="display: flex; flex-direction: column; gap: 10px;">
                ${filteredLessons.map((lesson) => this.renderLessonRow(lesson, isOwner && !isBuiltin)).join('')}
              </div>`
        }

        <!-- Modals Host -->
        <div id="lessonModalsHost">
          ${this.renderActiveModal()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderLessonRow(lesson: Lesson, canEdit: boolean): string {
    const stats = this.statsCache.get(lesson.id);
    const wordCount = stats ? stats.wordCount : 0;

    return `
      <div class="card" style="margin-bottom: 0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; transition: border-color 0.15s;">
        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 240px;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: color-mix(in srgb, var(--ac) 12%, var(--sf)); color: var(--ac); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.95rem; flex-shrink: 0;">
            ${lesson.lessonNumber}
          </div>

          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h4 style="margin: 0; font-size: 1.05rem; font-weight: 700;">
                ${lesson.name}
              </h4>
              <span class="chip" style="font-size: 0.72rem; padding: 2px 8px;">
                ${wordCount} ${wordCount === 1 ? 'word' : 'words'}
              </span>
            </div>
            ${
              lesson.description
                ? `<p style="margin: 3px 0 0; font-size: 0.82rem; color: var(--mu); line-height: 1.3;">
                    ${lesson.description}
                  </p>`
                : ''
            }
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="sm" data-select-lesson="${lesson.lessonNumber}" title="Filter vocabulary by this lesson">
            View Words
          </button>
          <button class="sm" data-lesson-report="${lesson.id}" style="color: var(--ac); border-color: var(--ac);" title="View lesson completion report & PDF">
            📑 Report
          </button>
          ${
            canEdit
              ? `<button class="sm" data-edit-lesson="${lesson.id}" title="Edit lesson title and description">
                  ✏️ Edit
                </button>
                <button class="sm" data-delete-lesson="${lesson.id}" style="color: var(--no); border-color: var(--no);" title="Delete lesson">
                  🗑️ Delete
                </button>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderActiveModal(): string {
    if (this.activeModal === 'none') return '';

    if (this.activeModal === 'create') {
      const nextOrder = this.lessons.length + 1;
      return `
        <div class="modal" id="lessonModalOverlay" style="display: grid;">
          <div class="box">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>➕</span> Create New Lesson
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Add a new lesson or unit to <strong>${this.props.book.name}</strong>.
            </p>

            <form id="createLessonForm" style="display: grid; gap: 14px;" novalidate>
              <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px;">
                <label class="field-label">
                  <span>Lesson Identifier <span class="req">*</span></span>
                  <input
                    type="text"
                    id="newLessonNumber"
                    placeholder="e.g. Unit 1 or 27"
                    value="${nextOrder}"
                    maxlength="30"
                    required
                  />
                </label>

                <label class="field-label">
                  <span>Lesson Title <span class="req">*</span></span>
                  <input
                    type="text"
                    id="newLessonName"
                    placeholder="e.g. Business & Finance Vocabulary"
                    maxlength="100"
                    required
                  />
                </label>
              </div>

              <label class="field-label">
                <span>Description <span style="font-size: 0.75rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="newLessonDesc"
                  placeholder="e.g. Corporate meetings, negotiating contracts, financial terminology"
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
                <button type="button" id="closeLessonModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitCreateLessonBtn">Create Lesson</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'edit' && this.targetLesson) {
      return `
        <div class="modal" id="lessonModalOverlay" style="display: grid;">
          <div class="box">
            <h3 style="margin: 0 0 6px; font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
              <span>✏️</span> Edit Lesson
            </h3>
            <p style="margin: 0 0 16px; font-size: 0.85rem; color: var(--mu);">
              Update title and description for <strong>${this.targetLesson.name}</strong> (${this.targetLesson.lessonNumber}).
            </p>

            <form id="editLessonForm" style="display: grid; gap: 14px;" novalidate>
              <label class="field-label">
                <span>Lesson Title <span class="req">*</span></span>
                <input
                  type="text"
                  id="editLessonName"
                  value="${this.targetLesson.name}"
                  maxlength="100"
                  required
                />
              </label>

              <label class="field-label">
                <span>Description <span style="font-size: 0.75rem; color: var(--mu);">(optional)</span></span>
                <input
                  type="text"
                  id="editLessonDesc"
                  value="${this.targetLesson.description || ''}"
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
                <button type="button" id="closeLessonModalBtn">Cancel</button>
                <button type="submit" class="p" id="submitEditLessonBtn">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'delete' && this.targetLesson) {
      const wordCount = this.targetStats ? this.targetStats.wordCount : 0;
      return `
        <div class="modal" id="lessonModalOverlay" style="display: grid;">
          <div class="box">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
              <span style="font-size: 2rem;">⚠️</span>
              <div>
                <h3 style="margin: 0; font-size: 1.25rem; color: var(--no);">Delete Lesson</h3>
                <p style="margin: 2px 0 0; font-size: 0.85rem; color: var(--mu);">
                  Lesson: <strong>${this.targetLesson.name}</strong> (${this.targetLesson.lessonNumber})
                </p>
              </div>
            </div>

            <!-- Warning Banner -->
            <div class="chip no" style="display: block; width: 100%; border-radius: 12px; padding: 12px; font-size: 0.85rem; line-height: 1.5; margin-bottom: 16px;">
              <strong>Warning: This action is permanent and cannot be undone!</strong>
              ${
                wordCount > 0
                  ? `<p style="margin: 6px 0 0;">
                      This lesson contains <strong>${wordCount}</strong> vocabulary words. Deleting this lesson will permanently erase all of its vocabulary words.
                    </p>`
                  : `<p style="margin: 4px 0 0;">
                      This lesson contains no vocabulary words. Deleting it will remove the unit from this textbook.
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
              <button type="button" id="closeLessonModalBtn">Cancel</button>
              <button
                type="button"
                id="confirmDeleteLessonBtn"
                style="background: var(--no); color: #fff; border: 0; font-weight: 600; padding: 9px 16px; border-radius: 12px;"
              >
                Permanently Delete Lesson
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
    const searchInput = this.container.querySelector('#lessonSearchInput') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.searchQuery = (searchInput.value || '').trim();
      this.render();
      const nextInput = this.container.querySelector('#lessonSearchInput') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    });

    // Clear search
    this.container.querySelector('#clearLessonSearchBtn')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.render();
    });

    // Open Create Modal
    const openCreate = () => {
      this.activeModal = 'create';
      this.modalError = '';
      this.render();
      const nameInput = this.container.querySelector('#newLessonName') as HTMLInputElement | null;
      nameInput?.focus();
    };

    this.container.querySelector('#openCreateLessonBtn')?.addEventListener('click', openCreate);
    this.container.querySelector('#createFirstLessonBtn')?.addEventListener('click', openCreate);

    // Close Modal handler
    const closeModal = () => {
      this.activeModal = 'none';
      this.targetLesson = null;
      this.targetStats = null;
      this.modalError = '';
      this.render();
    };

    this.container.querySelector('#closeLessonModalBtn')?.addEventListener('click', closeModal);
    const overlay = this.container.querySelector('#lessonModalOverlay');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Submit Create Lesson Form
    const createForm = this.container.querySelector('#createLessonForm') as HTMLFormElement | null;
    createForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const numberInput = this.container.querySelector('#newLessonNumber') as HTMLInputElement | null;
      const nameInput = this.container.querySelector('#newLessonName') as HTMLInputElement | null;
      const descInput = this.container.querySelector('#newLessonDesc') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitCreateLessonBtn') as HTMLButtonElement | null;

      const lessonNumber = (numberInput?.value || '').trim();
      const name = (nameInput?.value || '').trim();
      const description = (descInput?.value || '').trim();

      if (!lessonNumber) {
        this.modalError = 'Please provide a lesson identifier.';
        this.render();
        return;
      }
      if (!name) {
        this.modalError = 'Please provide a lesson title.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
        }

        await lessonService.createLesson(this.props.userId, this.props.book.id, {
          lessonNumber,
          name,
          description,
        });

        closeModal();
        await this.loadLessons();
        if (this.props.onLessonsChanged) {
          this.props.onLessonsChanged();
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          this.modalError = err.message;
        } else if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not create lesson.';
        }
        this.render();
      }
    });

    // Submit Edit Lesson Form
    const editForm = this.container.querySelector('#editLessonForm') as HTMLFormElement | null;
    editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.targetLesson) return;

      const nameInput = this.container.querySelector('#editLessonName') as HTMLInputElement | null;
      const descInput = this.container.querySelector('#editLessonDesc') as HTMLInputElement | null;
      const submitBtn = this.container.querySelector('#submitEditLessonBtn') as HTMLButtonElement | null;

      const name = (nameInput?.value || '').trim();
      const description = (descInput?.value || '').trim();

      if (!name) {
        this.modalError = 'Lesson title cannot be empty.';
        this.render();
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }

        await lessonService.updateLesson(this.props.userId, this.targetLesson.id, {
          name,
          description,
        });

        closeModal();
        await this.loadLessons();
        if (this.props.onLessonsChanged) {
          this.props.onLessonsChanged();
        }
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not update lesson.';
        }
        this.render();
      }
    });

    // Confirm Delete Lesson
    const confirmDeleteBtn = this.container.querySelector('#confirmDeleteLessonBtn') as HTMLButtonElement | null;
    confirmDeleteBtn?.addEventListener('click', async () => {
      if (!this.targetLesson) return;

      try {
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = 'Deleting...';
        await lessonService.deleteLesson(this.props.userId, this.targetLesson.id);
        closeModal();
        await this.loadLessons();
        if (this.props.onLessonsChanged) {
          this.props.onLessonsChanged();
        }
      } catch (err) {
        if (err instanceof Error) {
          this.modalError = err.message;
        } else {
          this.modalError = 'Could not delete lesson.';
        }
        this.render();
      }
    });

    // Event delegation for cards: View Words, Edit, Delete
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // View Words Click
      const selectBtn = target.closest('[data-select-lesson]') as HTMLElement | null;
      if (selectBtn) {
        const lessonNum = selectBtn.dataset.selectLesson;
        if (lessonNum && this.props.onLessonSelected) {
          this.props.onLessonSelected(lessonNum);
        }
        return;
      }

      // Edit Click
      const editBtn = target.closest('[data-edit-lesson]') as HTMLElement | null;
      if (editBtn) {
        const lessonId = editBtn.dataset.editLesson;
        const lesson = this.lessons.find((l) => l.id === lessonId);
        if (lesson) {
          this.targetLesson = lesson;
          this.activeModal = 'edit';
          this.modalError = '';
          this.render();
          const nameInput = this.container.querySelector('#editLessonName') as HTMLInputElement | null;
          nameInput?.focus();
        }
        return;
      }

      // Delete Click
      const deleteBtn = target.closest('[data-delete-lesson]') as HTMLElement | null;
      if (deleteBtn) {
        const lessonId = deleteBtn.dataset.deleteLesson;
        const lesson = this.lessons.find((l) => l.id === lessonId);
        if (lesson) {
          this.targetLesson = lesson;
          this.targetStats = await lessonService.getLessonStats(this.props.userId, lesson.id);
          this.activeModal = 'delete';
          this.modalError = '';
          this.render();
        }
        return;
      }

      // Lesson Report Click
      const lessonReportBtn = target.closest('[data-lesson-report]') as HTMLElement | null;
      if (lessonReportBtn) {
        const lessonId = lessonReportBtn.dataset.lessonReport;
        const lesson = this.lessons.find((l) => l.id === lessonId);
        if (lesson) {
          this.openReportModal(lesson);
        }
        return;
      }
    });

    // Textbook Report Click
    const bookReportBtn = this.container.querySelector('#openBookReportBtn');
    bookReportBtn?.addEventListener('click', () => {
      this.openReportModal();
    });
  }

  private openReportModal(lesson?: Lesson): void {
    const host = this.container.querySelector('#lessonModalsHost') as HTMLElement | null;
    if (host) {
      new ReportModal(host, {
        userId: this.props.userId,
        book: this.props.book,
        lesson,
        onClose: () => {
          if (host) host.innerHTML = '';
        },
      });
    }
  }
}

