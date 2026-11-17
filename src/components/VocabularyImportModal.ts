/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, Lesson } from '../db/types.ts';
import { bookService } from '../services/bookService.ts';
import { lessonService } from '../services/lessonService.ts';
import {
  ColumnMapping,
  DuplicateAction,
  ImportPreviewResult,
  TargetColumnField,
  vocabularyImportService,
} from '../services/vocabularyImportService.ts';

export interface VocabularyImportModalProps {
  userId: string;
  defaultBookId?: string;
  defaultLessonNumber?: string;
  onImportCompleted: (result: { imported: number; updated: number; skipped: number }) => void;
  onClose: () => void;
}

export class VocabularyImportModal {
  private container: HTMLElement;
  private props: VocabularyImportModalProps;

  // State
  private step: 'source' | 'preview' | 'complete' = 'source';
  private userBooks: Book[] = [];
  private selectedBookId: string = '';
  private bookLessons: Lesson[] = [];
  private selectedLessonNumber: string = '';
  private isCreatingNewLesson: boolean = false;
  private newLessonNumber: string = '';

  private activeMethod: 'csv' | 'xlsx' | 'paste' = 'csv';
  private pastedText: string = '';
  private rawGrid: string[][] = [];
  private previewResult: ImportPreviewResult | null = null;
  private duplicateAction: DuplicateAction = 'skip';

  private isLoading: boolean = false;
  private errorMessage: string = '';
  private importSummary: { imported: number; updated: number; skipped: number } | null = null;

  constructor(container: HTMLElement, props: VocabularyImportModalProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    this.isLoading = true;
    this.render();
    try {
      const allBooks = await bookService.getUserBooks(this.props.userId);
      // Filter out read-only built-in books (e.g. bonk1) because users cannot modify curriculum
      this.userBooks = allBooks.filter((b) => !b.isBuiltin && b.createdBy === this.props.userId);

      if (this.userBooks.length > 0) {
        const preferredBook =
          this.userBooks.find((b) => b.id === this.props.defaultBookId) || this.userBooks[0];
        this.selectedBookId = preferredBook.id;
        await this.loadLessonsForBook(this.selectedBookId);
      }
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to initialize import modal.';
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private async loadLessonsForBook(bookId: string): Promise<void> {
    if (!bookId) {
      this.bookLessons = [];
      this.selectedLessonNumber = '';
      return;
    }
    this.bookLessons = await lessonService.getLessonsForBook(bookId, this.props.userId);
    if (this.bookLessons.length > 0) {
      const preferredLesson =
        this.bookLessons.find((l) => l.lessonNumber === this.props.defaultLessonNumber) ||
        this.bookLessons[0];
      this.selectedLessonNumber = preferredLesson.lessonNumber;
      this.isCreatingNewLesson = false;
    } else {
      this.selectedLessonNumber = '';
      this.isCreatingNewLesson = true;
      this.newLessonNumber = 'Unit 1';
    }
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="modal" id="vocabImportModalOverlay" style="display: grid; z-index: 100;">
        <div class="box" style="max-width: 860px; width: 95vw; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; padding: 0;">
          
          <!-- Modal Header -->
          <div style="padding: 16px 22px; border-bottom: 1px solid var(--ln); display: flex; justify-content: space-between; align-items: center; background: color-mix(in srgb, var(--bg) 40%, var(--sf));">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.4rem;">📥</span>
              <div>
                <h3 style="margin: 0; font-size: 1.25rem;">Import Vocabulary</h3>
                <p style="margin: 2px 0 0; font-size: 0.8rem; color: var(--mu);">
                  ${
                    this.step === 'source'
                      ? 'Step 1: Choose destination and import method'
                      : this.step === 'preview'
                      ? 'Step 2: Map columns and verify entries before saving'
                      : 'Step 3: Import Complete'
                  }
                </p>
              </div>
            </div>
            <button type="button" id="closeImportModalBtn" style="background: transparent; border: 0; font-size: 1.25rem; cursor: pointer; color: var(--mu); padding: 4px 8px;">✕</button>
          </div>

          <!-- Modal Body (Scrollable) -->
          <div style="padding: 22px; overflow-y: auto; flex: 1;">
            ${
              this.errorMessage
                ? `<div class="chip no" style="display: block; padding: 10px 14px; margin-bottom: 16px; font-size: 0.88rem;">
                    ⚠️ ${this.errorMessage}
                  </div>`
                : ''
            }

            ${
              this.isLoading
                ? `<div style="text-align: center; padding: 48px; color: var(--mu);">
                    <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                    <p style="margin: 0; font-weight: 600;">Processing vocabulary data...</p>
                  </div>`
                : this.step === 'source'
                ? this.renderSourceStep()
                : this.step === 'preview'
                ? this.renderPreviewStep()
                : this.renderCompleteStep()
            }
          </div>

          <!-- Modal Footer -->
          <div style="padding: 14px 22px; border-top: 1px solid var(--ln); background: color-mix(in srgb, var(--bg) 30%, var(--sf)); display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
            ${this.renderFooterButtons()}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderSourceStep(): string {
    if (this.userBooks.length === 0) {
      return `
        <div style="text-align: center; padding: 36px 16px; color: var(--mu);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">📚</div>
          <h4 style="margin: 0 0 8px; color: var(--tx); font-size: 1.15rem;">Custom Textbook Required</h4>
          <p style="margin: 0 0 16px; font-size: 0.88rem; max-width: 480px; margin-inline: auto;">
            The standard curriculum (Bonk 1) is protected and read-only. Please create a custom textbook first to import your own vocabulary.
          </p>
          <button type="button" id="createBookFromImportBtn" class="p sm">➕ Go to Textbooks to Create One</button>
        </div>
      `;
    }

    const effectiveLesson = this.isCreatingNewLesson ? this.newLessonNumber : this.selectedLessonNumber;

    return `
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <!-- Destination Selection -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; background: var(--bg); padding: 14px 18px; border-radius: 14px; border: 1px solid var(--ln);">
          <!-- Target Book -->
          <label class="field-label">
            <span style="font-weight: 700;">Target Textbook <span class="req">*</span></span>
            <select id="importTargetBookSel" style="border-radius: 10px;">
              ${this.userBooks
                .map(
                  (b) =>
                    `<option value="${b.id}" ${b.id === this.selectedBookId ? 'selected' : ''}>${b.name}</option>`
                )
                .join('')}
            </select>
          </label>

          <!-- Target Lesson -->
          <label class="field-label">
            <span style="font-weight: 700;">Target Lesson / Unit <span class="req">*</span></span>
            ${
              this.isCreatingNewLesson
                ? `<div style="display: flex; gap: 6px;">
                    <input
                      type="text"
                      id="importNewLessonInput"
                      placeholder="e.g. Unit 1 or Lesson 5"
                      value="${this.newLessonNumber}"
                      style="flex: 1; border-radius: 10px;"
                    />
                    <button type="button" id="cancelNewLessonBtn" class="sm" title="Choose existing lesson">Existing</button>
                  </div>`
                : `<div style="display: flex; gap: 6px;">
                    <select id="importTargetLessonSel" style="flex: 1; border-radius: 10px;">
                      ${this.bookLessons
                        .map(
                          (l) =>
                            `<option value="${l.lessonNumber}" ${l.lessonNumber === this.selectedLessonNumber ? 'selected' : ''}>${l.name || 'Lesson ' + l.lessonNumber}</option>`
                        )
                        .join('')}
                    </select>
                    <button type="button" id="promptNewLessonBtn" class="sm" title="Create new lesson for import">➕ New</button>
                  </div>`
            }
          </label>
        </div>

        <!-- Import Methods Tabs -->
        <div>
          <label class="field-label" style="margin-bottom: 8px;">
            <span style="font-weight: 700;">Select Import Method</span>
          </label>
          <div class="tabs" style="margin-bottom: 14px; display: inline-flex;">
            <button type="button" id="tabMethodCsv" class="${this.activeMethod === 'csv' ? 'on' : ''}">
              📄 CSV / TSV File
            </button>
            <button type="button" id="tabMethodXlsx" class="${this.activeMethod === 'xlsx' ? 'on' : ''}">
              📊 Excel (.xlsx / .xls)
            </button>
            <button type="button" id="tabMethodPaste" class="${this.activeMethod === 'paste' ? 'on' : ''}">
              📋 Paste Text
            </button>
          </div>

          <!-- Method 1: CSV / TSV Upload -->
          ${
            this.activeMethod === 'csv'
              ? `
            <div style="border: 2px dashed var(--ln); border-radius: 14px; padding: 32px 20px; text-align: center; background: color-mix(in srgb, var(--bg) 50%, var(--sf));">
              <div style="font-size: 2.2rem; margin-bottom: 8px;">📄</div>
              <h4 style="margin: 0 0 6px; font-size: 1.05rem;">Choose a CSV or TSV file</h4>
              <p style="margin: 0 0 16px; font-size: 0.82rem; color: var(--mu);">
                Supports comma, tab, or semicolon separated files with Armenian & Russian characters.
              </p>
              <input type="file" id="importCsvFileInput" accept=".csv,.tsv,.txt" style="display: none;" />
              <button type="button" id="triggerCsvUploadBtn" class="p sm">Browse CSV File</button>
              <span id="selectedCsvFileName" style="display: block; margin-top: 10px; font-size: 0.85rem; color: var(--ac); font-weight: 600;"></span>
            </div>
          `
              : ''
          }

          <!-- Method 2: XLSX Upload -->
          ${
            this.activeMethod === 'xlsx'
              ? `
            <div style="border: 2px dashed var(--ln); border-radius: 14px; padding: 32px 20px; text-align: center; background: color-mix(in srgb, var(--bg) 50%, var(--sf));">
              <div style="font-size: 2.2rem; margin-bottom: 8px;">📊</div>
              <h4 style="margin: 0 0 6px; font-size: 1.05rem;">Choose an Excel Spreadsheet (.xlsx / .xls)</h4>
              <p style="margin: 0 0 16px; font-size: 0.82rem; color: var(--mu);">
                Processed locally in your browser with zero server uploads or internet requirements.
              </p>
              <input type="file" id="importXlsxFileInput" accept=".xlsx,.xls" style="display: none;" />
              <button type="button" id="triggerXlsxUploadBtn" class="p sm">Browse Excel File</button>
              <span id="selectedXlsxFileName" style="display: block; margin-top: 10px; font-size: 0.85rem; color: var(--ac); font-weight: 600;"></span>
            </div>
          `
              : ''
          }

          <!-- Method 3: Paste Text -->
          ${
            this.activeMethod === 'paste'
              ? `
            <div>
              <textarea
                id="importPastedTextArea"
                rows="8"
                placeholder="Paste tab-separated, comma-separated, or pipe-separated words here...&#10;&#10;Example:&#10;serendipity	հաջող պատահականություն	счастливая случайность	happy chance&#10;epiphany	հայտնություն	прозрение	sudden revelation"
                style="width: 100%; border-radius: 12px; font-family: monospace; font-size: 0.85rem; padding: 12px; line-height: 1.4;"
              >${this.pastedText}</textarea>
              <p style="margin: 6px 0 0; font-size: 0.78rem; color: var(--mu);">
                💡 Tip: You can copy cells directly from Google Sheets or Excel and paste them above.
              </p>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderPreviewStep(): string {
    if (!this.previewResult) return '';

    const { headers, columnMappings, rows, validCount, invalidCount, duplicateCount } =
      this.previewResult;

    const selectedCount = rows.filter((r) => r.selectedForImport).length;
    const allSelected = rows.length > 0 && rows.every((r) => r.selectedForImport);

    const availableFields: { id: TargetColumnField; label: string }[] = [
      { id: 'en', label: 'English Word / Phrase' },
      { id: 'hy', label: 'Armenian Translation (Հայերեն)' },
      { id: 'ru', label: 'Russian Translation (Русский)' },
      { id: 'definition', label: 'English Definition' },
      { id: 'example', label: 'Example Sentence' },
      { id: 'pronunciation', label: 'Pronunciation (IPA)' },
      { id: 'partOfSpeech', label: 'Part of Speech' },
      { id: 'type', label: 'Entry Type' },
      { id: 'page', label: 'Page Number' },
      { id: 'note', label: 'Pedagogical Note / Hint' },
      { id: 'none', label: '✕ Skip this column' },
    ];

    return `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Target & Strategy Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--bg); padding: 12px 16px; border-radius: 12px; border: 1px solid var(--ln); font-size: 0.88rem;">
          <div>
            Target: <strong>${this.userBooks.find((b) => b.id === this.selectedBookId)?.name || 'Textbook'}</strong> • <em>Lesson: ${this.selectedLessonNumber}</em>
          </div>

          <!-- Duplicate Handling Strategy -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-weight: 600; font-size: 0.82rem; color: var(--mu);">When duplicate detected:</span>
            <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.82rem;">
              <input type="radio" name="dupStrategy" value="skip" ${this.duplicateAction === 'skip' ? 'checked' : ''} />
              <span>Skip duplicate</span>
            </label>
            <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.82rem;">
              <input type="radio" name="dupStrategy" value="update" ${this.duplicateAction === 'update' ? 'checked' : ''} />
              <span>Update existing</span>
            </label>
          </div>
        </div>

        <!-- Stats Chips Bar -->
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <span class="chip" style="font-size: 0.78rem;">
            Total Rows: <strong>${rows.length}</strong>
          </span>
          <span class="chip ok" style="font-size: 0.78rem;">
            ✓ Valid Ready: <strong>${validCount}</strong>
          </span>
          ${
            duplicateCount > 0
              ? `<span class="chip wn" style="font-size: 0.78rem;">
                  ⚠️ Duplicates: <strong>${duplicateCount}</strong>
                </span>`
              : ''
          }
          ${
            invalidCount > 0
              ? `<span class="chip no" style="font-size: 0.78rem;">
                  ✕ Invalid: <strong>${invalidCount}</strong>
                </span>`
              : ''
          }
          <span style="margin-left: auto; font-size: 0.82rem; color: var(--tx); font-weight: 600;">
            Selected to Import: ${selectedCount}
          </span>
        </div>

        <!-- Column Mapping Controls -->
        <div class="card" style="margin-bottom: 0; padding: 14px;">
          <h4 style="margin: 0 0 10px; font-size: 0.95rem; font-weight: 700; color: var(--tx);">
            Detected Columns & Field Mapping
          </h4>
          <p style="margin: 0 0 12px; font-size: 0.8rem; color: var(--mu);">
            Adjust dropdowns if automatic column detection requires correction:
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
            ${columnMappings
              .map(
                (col) => `
              <div style="background: var(--bg); padding: 8px 12px; border-radius: 10px; border: 1px solid var(--ln);">
                <div style="font-size: 0.75rem; color: var(--mu); margin-bottom: 4px; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                  ${col.headerName}
                </div>
                <select class="column-mapping-select" data-col-idx="${col.columnIndex}" style="width: 100%; font-size: 0.8rem; padding: 5px 8px; border-radius: 8px;">
                  ${availableFields
                    .map(
                      (f) =>
                        `<option value="${f.id}" ${f.id === col.field ? 'selected' : ''}>${f.label}</option>`
                    )
                    .join('')}
                </select>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Interactive Preview Table -->
        <div style="overflow-x: auto; border: 1px solid var(--ln); border-radius: 12px; max-height: 380px;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.84rem;">
            <thead style="position: sticky; top: 0; background: color-mix(in srgb, var(--bg) 95%, var(--sf)); z-index: 2; border-bottom: 2px solid var(--ln);">
              <tr>
                <th style="padding: 10px 12px; width: 44px; text-align: center;">
                  <input type="checkbox" id="toggleAllRowsCheckbox" ${allSelected ? 'checked' : ''} title="Select/Deselect all rows" />
                </th>
                <th style="padding: 10px 10px; width: 45px;">#</th>
                <th style="padding: 10px 12px; width: 95px;">Status</th>
                <th style="padding: 10px 12px;">English</th>
                <th style="padding: 10px 12px;">Armenian</th>
                <th style="padding: 10px 12px;">Russian</th>
                <th style="padding: 10px 12px;">Definition / Example</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r, idx) => `
                <tr style="border-bottom: 1px solid var(--ln); background: ${!r.isValid ? 'color-mix(in srgb, var(--no) 8%, var(--sf))' : r.isDuplicate ? 'color-mix(in srgb, var(--wn) 8%, var(--sf))' : idx % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--bg) 40%, transparent)'};">
                  <!-- Checkbox -->
                  <td style="padding: 8px 12px; text-align: center;">
                    <input
                      type="checkbox"
                      class="row-select-checkbox"
                      data-row-idx="${idx}"
                      ${r.selectedForImport ? 'checked' : ''}
                      ${!r.isValid ? 'disabled' : ''}
                    />
                  </td>

                  <!-- Row Number -->
                  <td style="padding: 8px 10px; color: var(--mu); font-size: 0.75rem;">
                    ${r.rowNumber}
                  </td>

                  <!-- Status Chip -->
                  <td style="padding: 8px 12px;">
                    ${
                      !r.isValid
                        ? `<span class="chip no" style="font-size: 0.68rem; padding: 2px 6px;">✕ Invalid</span>`
                        : r.isDuplicate
                        ? `<span class="chip wn" style="font-size: 0.68rem; padding: 2px 6px;">⚠️ Duplicate</span>`
                        : `<span class="chip ok" style="font-size: 0.68rem; padding: 2px 6px;">✓ Ready</span>`
                    }
                  </td>

                  <!-- English & Phonetics -->
                  <td style="padding: 8px 12px; font-weight: 600; color: var(--tx);">
                    <div>${r.mappedValues.en || '<em style="color: var(--no); font-size: 0.75rem;">[Empty]</em>'}</div>
                    ${
                      r.mappedValues.pronunciation
                        ? `<span style="font-size: 0.72rem; color: var(--mu); font-family: monospace;">${r.mappedValues.pronunciation}</span>`
                        : ''
                    }
                    ${
                      r.validationErrors.length > 0
                        ? `<div style="color: var(--no); font-size: 0.72rem; margin-top: 2px;">${r.validationErrors.join(' • ')}</div>`
                        : ''
                    }
                    ${
                      r.duplicateReason
                        ? `<div style="color: var(--wn); font-size: 0.72rem; margin-top: 2px;">${r.duplicateReason}</div>`
                        : ''
                    }
                  </td>

                  <!-- Armenian -->
                  <td style="padding: 8px 12px; font-weight: 500;">
                    ${r.mappedValues.hy || '<em style="color: var(--mu); font-size: 0.75rem;">—</em>'}
                  </td>

                  <!-- Russian -->
                  <td style="padding: 8px 12px; color: var(--mu);">
                    ${r.mappedValues.ru || '<em style="font-size: 0.75rem;">—</em>'}
                  </td>

                  <!-- Definition & Example -->
                  <td style="padding: 8px 12px; font-size: 0.78rem; max-width: 220px; line-height: 1.35;">
                    ${r.mappedValues.definition ? `<div>${r.mappedValues.definition}</div>` : ''}
                    ${r.mappedValues.example ? `<div style="color: var(--mu); font-style: italic;">"${r.mappedValues.example}"</div>` : ''}
                    ${!r.mappedValues.definition && !r.mappedValues.example ? '<em style="color: var(--mu); font-size: 0.72rem;">—</em>' : ''}
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderCompleteStep(): string {
    if (!this.importSummary) return '';

    return `
      <div style="text-align: center; padding: 36px 16px;">
        <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
        <h3 style="margin: 0 0 8px; font-size: 1.4rem; color: var(--tx);">
          Import Completed Successfully!
        </h3>
        <p style="margin: 0 0 24px; color: var(--mu); font-size: 0.9rem;">
          Your vocabulary entries have been saved directly to IndexedDB.
        </p>

        <!-- Stats Grid -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; max-width: 520px; margin: 0 auto 24px;">
          <div style="background: var(--bg); padding: 16px; border-radius: 14px; border: 1px solid var(--ln);">
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--ok);">${this.importSummary.imported}</div>
            <div style="font-size: 0.8rem; color: var(--mu); margin-top: 4px;">Words Added</div>
          </div>

          <div style="background: var(--bg); padding: 16px; border-radius: 14px; border: 1px solid var(--ln);">
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--ac);">${this.importSummary.updated}</div>
            <div style="font-size: 0.8rem; color: var(--mu); margin-top: 4px;">Words Updated</div>
          </div>

          <div style="background: var(--bg); padding: 16px; border-radius: 14px; border: 1px solid var(--ln);">
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--mu);">${this.importSummary.skipped}</div>
            <div style="font-size: 0.8rem; color: var(--mu); margin-top: 4px;">Rows Skipped</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderFooterButtons(): string {
    if (this.step === 'source') {
      return `
        <button type="button" id="cancelImportModalBtn">Cancel</button>
        <button type="button" id="proceedToPreviewBtn" class="p" ${this.userBooks.length === 0 ? 'disabled' : ''}>
          Parse & Preview Data →
        </button>
      `;
    }

    if (this.step === 'preview') {
      const selectedCount = this.previewResult
        ? this.previewResult.rows.filter((r) => r.selectedForImport).length
        : 0;

      return `
        <button type="button" id="backToSourceBtn">← Back to Source</button>
        <button type="button" id="cancelImportModalBtn">Cancel</button>
        <button type="button" id="executeImportBtn" class="p" ${selectedCount === 0 ? 'disabled' : ''}>
          Confirm & Import ${selectedCount} ${selectedCount === 1 ? 'Word' : 'Words'}
        </button>
      `;
    }

    // Complete Step
    return `
      <button type="button" id="finishImportBtn" class="p">
        Done & View Vocabulary
      </button>
    `;
  }

  private bindEvents(): void {
    // Close / Cancel buttons
    this.container.querySelector('#closeImportModalBtn')?.addEventListener('click', () => {
      this.props.onClose();
    });
    this.container.querySelector('#cancelImportModalBtn')?.addEventListener('click', () => {
      this.props.onClose();
    });

    // Create Book Prompt button
    this.container.querySelector('#createBookFromImportBtn')?.addEventListener('click', () => {
      this.props.onClose();
    });

    // Target Book change
    const bookSel = this.container.querySelector('#importTargetBookSel') as HTMLSelectElement | null;
    bookSel?.addEventListener('change', async (e) => {
      this.selectedBookId = (e.target as HTMLSelectElement).value;
      await this.loadLessonsForBook(this.selectedBookId);
      this.render();
    });

    // Target Lesson change
    const lessonSel = this.container.querySelector('#importTargetLessonSel') as HTMLSelectElement | null;
    lessonSel?.addEventListener('change', (e) => {
      this.selectedLessonNumber = (e.target as HTMLSelectElement).value;
    });

    // New Lesson Prompt button
    this.container.querySelector('#promptNewLessonBtn')?.addEventListener('click', () => {
      this.isCreatingNewLesson = true;
      this.newLessonNumber = `Unit ${this.bookLessons.length + 1}`;
      this.render();
    });

    // Cancel New Lesson button
    this.container.querySelector('#cancelNewLessonBtn')?.addEventListener('click', () => {
      this.isCreatingNewLesson = false;
      this.render();
    });

    // New Lesson Input
    const newLessonInput = this.container.querySelector('#importNewLessonInput') as HTMLInputElement | null;
    newLessonInput?.addEventListener('input', () => {
      this.newLessonNumber = (newLessonInput.value || '').trim();
    });

    // Method Tabs
    this.container.querySelector('#tabMethodCsv')?.addEventListener('click', () => {
      this.activeMethod = 'csv';
      this.render();
    });
    this.container.querySelector('#tabMethodXlsx')?.addEventListener('click', () => {
      this.activeMethod = 'xlsx';
      this.render();
    });
    this.container.querySelector('#tabMethodPaste')?.addEventListener('click', () => {
      this.activeMethod = 'paste';
      this.render();
    });

    // CSV File Upload trigger
    const csvFileInput = this.container.querySelector('#importCsvFileInput') as HTMLInputElement | null;
    this.container.querySelector('#triggerCsvUploadBtn')?.addEventListener('click', () => {
      csvFileInput?.click();
    });

    csvFileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const nameLabel = this.container.querySelector('#selectedCsvFileName');
      if (nameLabel) nameLabel.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

      try {
        const text = await file.text();
        this.rawGrid = vocabularyImportService.parseDelimitedText(text);
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : 'Could not read CSV file.';
        this.render();
      }
    });

    // XLSX File Upload trigger
    const xlsxFileInput = this.container.querySelector('#importXlsxFileInput') as HTMLInputElement | null;
    this.container.querySelector('#triggerXlsxUploadBtn')?.addEventListener('click', () => {
      xlsxFileInput?.click();
    });

    xlsxFileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const nameLabel = this.container.querySelector('#selectedXlsxFileName');
      if (nameLabel) nameLabel.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

      try {
        const buffer = await file.arrayBuffer();
        this.rawGrid = vocabularyImportService.parseXlsxBuffer(buffer);
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : 'Could not read Excel file.';
        this.render();
      }
    });

    // Paste Text Area
    const pasteArea = this.container.querySelector('#importPastedTextArea') as HTMLTextAreaElement | null;
    pasteArea?.addEventListener('input', () => {
      this.pastedText = pasteArea.value;
      this.rawGrid = vocabularyImportService.parseDelimitedText(this.pastedText);
    });

    // Proceed to Preview Button
    this.container.querySelector('#proceedToPreviewBtn')?.addEventListener('click', async () => {
      this.errorMessage = '';

      const targetLesson = this.isCreatingNewLesson ? this.newLessonNumber : this.selectedLessonNumber;
      if (!targetLesson || !targetLesson.trim()) {
        this.errorMessage = 'Please select or enter a target lesson identifier.';
        this.render();
        return;
      }
      this.selectedLessonNumber = targetLesson.trim();

      if (this.activeMethod === 'paste' && this.pastedText.trim()) {
        this.rawGrid = vocabularyImportService.parseDelimitedText(this.pastedText);
      }

      if (!this.rawGrid || this.rawGrid.length === 0) {
        this.errorMessage = 'Please provide vocabulary data via file upload or paste text.';
        this.render();
        return;
      }

      this.isLoading = true;
      this.render();

      try {
        this.previewResult = await vocabularyImportService.prepareImportPreview(
          this.props.userId,
          this.selectedBookId,
          this.selectedLessonNumber,
          this.rawGrid
        );
        this.step = 'preview';
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : 'Failed to parse import preview.';
      } finally {
        this.isLoading = false;
        this.render();
      }
    });

    // Back to Source Button
    this.container.querySelector('#backToSourceBtn')?.addEventListener('click', () => {
      this.step = 'source';
      this.errorMessage = '';
      this.render();
    });

    // Duplicate Strategy Radios
    const dupRadios = this.container.querySelectorAll<HTMLInputElement>('input[name="dupStrategy"]');
    dupRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        this.duplicateAction = radio.value as DuplicateAction;
        // If "update" is selected, automatically select valid duplicates for import
        if (this.previewResult) {
          this.previewResult.rows.forEach((r) => {
            if (r.isValid && r.isDuplicate) {
              r.selectedForImport = this.duplicateAction === 'update';
            }
          });
          this.render();
        }
      });
    });

    // Column Mapping Selects
    const mapSelects = this.container.querySelectorAll<HTMLSelectElement>('.column-mapping-select');
    mapSelects.forEach((sel) => {
      sel.addEventListener('change', async () => {
        if (!this.previewResult) return;
        const colIdx = parseInt(sel.dataset.colIdx || '0', 10);
        const newField = sel.value as TargetColumnField;

        const updatedMappings = [...this.previewResult.columnMappings];
        const match = updatedMappings.find((m) => m.columnIndex === colIdx);
        if (match) {
          match.field = newField;
        }

        this.isLoading = true;
        this.render();
        try {
          this.previewResult = await vocabularyImportService.prepareImportPreview(
            this.props.userId,
            this.selectedBookId,
            this.selectedLessonNumber,
            this.rawGrid,
            updatedMappings
          );
        } catch (err) {
          this.errorMessage = err instanceof Error ? err.message : 'Failed to update column mappings.';
        } finally {
          this.isLoading = false;
          this.render();
        }
      });
    });

    // Toggle All Rows Checkbox
    const toggleAllCheckbox = this.container.querySelector('#toggleAllRowsCheckbox') as HTMLInputElement | null;
    toggleAllCheckbox?.addEventListener('change', () => {
      if (!this.previewResult) return;
      const checked = toggleAllCheckbox.checked;
      this.previewResult.rows.forEach((r) => {
        if (r.isValid) {
          r.selectedForImport = checked;
        }
      });
      this.render();
    });

    // Individual Row Select Checkbox
    const rowCheckboxes = this.container.querySelectorAll<HTMLInputElement>('.row-select-checkbox');
    rowCheckboxes.forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!this.previewResult) return;
        const rowIdx = parseInt(cb.dataset.rowIdx || '0', 10);
        const targetRow = this.previewResult.rows[rowIdx];
        if (targetRow && targetRow.isValid) {
          targetRow.selectedForImport = cb.checked;
          this.render();
        }
      });
    });

    // Execute Import Button
    this.container.querySelector('#executeImportBtn')?.addEventListener('click', async () => {
      if (!this.previewResult) return;

      this.isLoading = true;
      this.render();

      try {
        const result = await vocabularyImportService.executeImport(
          this.props.userId,
          this.selectedBookId,
          this.selectedLessonNumber,
          this.previewResult.rows,
          this.duplicateAction
        );

        this.importSummary = {
          imported: result.importedCount,
          updated: result.updatedCount,
          skipped: result.skippedCount,
        };
        this.step = 'complete';
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : 'Import execution failed.';
      } finally {
        this.isLoading = false;
        this.render();
      }
    });

    // Finish Import Button
    this.container.querySelector('#finishImportBtn')?.addEventListener('click', () => {
      if (this.importSummary) {
        this.props.onImportCompleted(this.importSummary);
      }
      this.props.onClose();
    });
  }
}
