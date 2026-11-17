/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as XLSX from 'xlsx';
import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { Book, Lesson, PartOfSpeech, VocabularyType, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { bookService, BookService } from './bookService.ts';
import { lessonService, LessonService } from './lessonService.ts';
import { vocabularyService, VocabularyService } from './vocabularyService.ts';

export type TargetColumnField =
  | 'en'
  | 'hy'
  | 'ru'
  | 'definition'
  | 'example'
  | 'partOfSpeech'
  | 'pronunciation'
  | 'type'
  | 'page'
  | 'note'
  | 'none';

export type DuplicateAction = 'skip' | 'update';

export interface ColumnMapping {
  columnIndex: number;
  headerName: string;
  field: TargetColumnField;
}

export interface ParsedImportRow {
  rowNumber: number;
  originalValues: string[];
  mappedValues: {
    en: string;
    hy: string;
    ru?: string;
    definition?: string;
    example?: string;
    partOfSpeech?: string;
    pronunciation?: string;
    type?: VocabularyType;
    page?: string;
    note?: string;
  };
  isValid: boolean;
  validationErrors: string[];
  isDuplicate: boolean;
  duplicateReason?: string;
  existingWordId?: string;
  selectedForImport: boolean;
}

export interface ImportPreviewResult {
  hasHeaderRow: boolean;
  headers: string[];
  columnMappings: ColumnMapping[];
  rows: ParsedImportRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
}

export interface ExecuteImportResult {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  totalProcessed: number;
  importedWords: VocabularyWord[];
}

export class VocabularyImportService {
  private db: IndexedDBManager;
  private bookService: BookService;
  private lessonService: LessonService;
  private vocabService: VocabularyService;

  constructor(
    db: IndexedDBManager = dbManager,
    customBookService?: BookService,
    customLessonService?: LessonService,
    customVocabService?: VocabularyService
  ) {
    this.db = db;
    this.bookService = customBookService || (db === dbManager ? bookService : new BookService(db));
    this.lessonService =
      customLessonService || (db === dbManager ? lessonService : new LessonService(db, this.bookService));
    this.vocabService =
      customVocabService ||
      (db === dbManager ? vocabularyService : new VocabularyService(db, this.bookService, this.lessonService));
  }

  /**
   * Parse CSV, TSV, or delimiter-separated text safely with support for quotes and Unicode.
   */
  public parseDelimitedText(text: string): string[][] {
    if (!text || !text.trim()) return [];

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const result: string[][] = [];

    // Detect delimiter from first non-empty line
    const sampleLine = lines.find((l) => l.trim().length > 0) || '';
    let delimiter = ',';
    if (sampleLine.includes('\t')) delimiter = '\t';
    else if (sampleLine.includes(';') && !sampleLine.includes(',')) delimiter = ';';
    else if (sampleLine.includes('|') && !sampleLine.includes(',')) delimiter = '|';

    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;

      const row: string[] = [];
      let inQuotes = false;
      let currentValue = '';

      for (let i = 0; i < rawLine.length; i++) {
        const char = rawLine[i];
        if (char === '"') {
          if (inQuotes && rawLine[i + 1] === '"') {
            currentValue += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          row.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      row.push(currentValue.trim());

      // Only add non-empty rows
      if (row.some((cell) => cell.length > 0)) {
        result.push(row);
      }
    }

    return result;
  }

  /**
   * Parse XLSX binary buffer using locally bundled SheetJS.
   */
  public parseXlsxBuffer(buffer: ArrayBuffer | Uint8Array): string[][] {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];

    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) return [];

    // Convert sheet to array of rows
    const rawData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    const rows: string[][] = [];
    for (const rawRow of rawData) {
      if (Array.isArray(rawRow)) {
        const cleanRow = rawRow.map((cell) => String(cell !== undefined && cell !== null ? cell : '').trim());
        if (cleanRow.some((c) => c.length > 0)) {
          rows.push(cleanRow);
        }
      }
    }

    return rows;
  }

  /**
   * Detect whether row 0 represents column headers or direct vocabulary data.
   */
  public isHeaderRow(firstRow: string[]): boolean {
    if (!firstRow || firstRow.length === 0) return false;

    const headerKeywords = [
      'english',
      'armenian',
      'russian',
      'definition',
      'example',
      'pronunciation',
      'part of speech',
      'pos',
      'word',
      'translation',
      'type',
      'term',
      'phrase',
      'note',
      'hint',
      'page',
      'հայերեն',
      'русский',
      'թարգմանություն',
    ];

    const matchCount = firstRow.filter((cell) => {
      const lower = cell.toLowerCase().trim();
      return headerKeywords.some((keyword) => lower === keyword || lower.includes(keyword));
    }).length;

    return matchCount >= 1;
  }

  /**
   * Heuristic to automatically map column indexes to vocabulary fields.
   */
  public detectColumnMappings(headers: string[], sampleRows: string[][]): ColumnMapping[] {
    const mappings: ColumnMapping[] = [];
    const assignedFields = new Set<TargetColumnField>();

    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const header = (headers[colIdx] || '').toLowerCase().trim();
      let field: TargetColumnField = 'none';

      // 1. Header label regex match
      if (!assignedFields.has('en') && /^(english|en|word|term|vocabulary|phrase|eng)$/i.test(header)) {
        field = 'en';
      } else if (!assignedFields.has('hy') && /^(armenian|hy|arm|հայերեն|թարգմանություն|hayeren|armenian_translation)$/i.test(header)) {
        field = 'hy';
      } else if (!assignedFields.has('ru') && /^(russian|ru|rus|русский|перевод|russkiy|russian_translation)$/i.test(header)) {
        field = 'ru';
      } else if (!assignedFields.has('definition') && /^(definition|def|meaning|սահմանում|определение|description)$/i.test(header)) {
        field = 'definition';
      } else if (!assignedFields.has('example') && /^(example|sentence|ex|sample|օրինակ|пример)$/i.test(header)) {
        field = 'example';
      } else if (!assignedFields.has('pronunciation') && /^(pronunciation|pron|ipa|phonetic|transcription)$/i.test(header)) {
        field = 'pronunciation';
      } else if (!assignedFields.has('partOfSpeech') && /^(part_of_speech|pos|partofspeech|speech)$/i.test(header)) {
        field = 'partOfSpeech';
      } else if (!assignedFields.has('type') && /^(type|entry_type|category)$/i.test(header)) {
        field = 'type';
      } else if (!assignedFields.has('page') && /^(page|source_page|sourcepage|p)$/i.test(header)) {
        field = 'page';
      } else if (!assignedFields.has('note') && /^(note|hint|notes)$/i.test(header)) {
        field = 'note';
      }

      // 2. Character-script heuristics if headers were generic (e.g. "Column 1", "Col A")
      if (field === 'none' && sampleRows.length > 0) {
        const sampleColValues = sampleRows
          .map((r) => r[colIdx] || '')
          .filter((v) => v.length > 0)
          .slice(0, 5);

        const hasArmenianChars = sampleColValues.some((v) => /[\u0530-\u058F]/.test(v));
        const hasCyrillicChars = sampleColValues.some((v) => /[\u0400-\u04FF]/.test(v));
        const isAsciiWord = sampleColValues.some((v) => /^[a-zA-Z\s'-]+$/.test(v));

        if (!assignedFields.has('hy') && hasArmenianChars) {
          field = 'hy';
        } else if (!assignedFields.has('ru') && hasCyrillicChars) {
          field = 'ru';
        } else if (!assignedFields.has('en') && isAsciiWord) {
          field = 'en';
        }
      }

      // 3. Fallback default order: 0: en, 1: hy, 2: ru, 3: def, 4: ex
      if (field === 'none') {
        if (colIdx === 0 && !assignedFields.has('en')) field = 'en';
        else if (colIdx === 1 && !assignedFields.has('hy')) field = 'hy';
        else if (colIdx === 2 && !assignedFields.has('ru')) field = 'ru';
        else if (colIdx === 3 && !assignedFields.has('definition')) field = 'definition';
        else if (colIdx === 4 && !assignedFields.has('example')) field = 'example';
      }

      if (field !== 'none') {
        assignedFields.add(field);
      }

      mappings.push({
        columnIndex: colIdx,
        headerName: headers[colIdx] || `Column ${colIdx + 1}`,
        field,
      });
    }

    return mappings;
  }

  /**
   * Process and validate all parsed rows against existing database records for preview.
   */
  public async prepareImportPreview(
    userId: string,
    bookId: string,
    lessonNumber: string,
    rawGrid: string[][],
    customMappings?: ColumnMapping[]
  ): Promise<ImportPreviewResult> {
    if (!rawGrid || rawGrid.length === 0) {
      return {
        hasHeaderRow: false,
        headers: [],
        columnMappings: [],
        rows: [],
        totalRows: 0,
        validCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
      };
    }

    // 1. Check existing words in this book and lesson for duplicate detection
    const existingWords = await this.vocabService.getWordsForBookAndLesson(userId, bookId, lessonNumber);
    const existingByNormalized = new Map<string, VocabularyWord>();
    const existingByEn = new Map<string, VocabularyWord>();

    for (const w of existingWords) {
      existingByNormalized.set(w.normalizedEn, w);
      existingByEn.set(w.en.toLowerCase().trim(), w);
    }

    // 2. Determine headers and data rows
    const firstRow = rawGrid[0];
    const hasHeaders = this.isHeaderRow(firstRow);
    const headers = hasHeaders
      ? firstRow
      : Array.from({ length: Math.max(...rawGrid.map((r) => r.length)) }, (_, i) => `Column ${i + 1}`);

    const dataRows = hasHeaders ? rawGrid.slice(1) : rawGrid;

    // 3. Setup mappings
    const columnMappings = customMappings || this.detectColumnMappings(headers, dataRows.slice(0, 10));

    // Create lookup: field -> columnIndex
    const fieldToCol = new Map<TargetColumnField, number>();
    for (const m of columnMappings) {
      if (m.field !== 'none') {
        fieldToCol.set(m.field, m.columnIndex);
      }
    }

    // 4. Validate each data row
    const parsedRows: ParsedImportRow[] = [];
    const seenNormalizedInBatch = new Set<string>();

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    dataRows.forEach((rowValues, idx) => {
      const rowNum = (hasHeaders ? 2 : 1) + idx;
      const getVal = (f: TargetColumnField): string => {
        const c = fieldToCol.get(f);
        return c !== undefined && rowValues[c] !== undefined ? String(rowValues[c]).trim() : '';
      };

      const en = getVal('en');
      const hy = getVal('hy');
      const ru = getVal('ru');
      const definition = getVal('definition');
      const example = getVal('example');
      const partOfSpeech = getVal('partOfSpeech');
      const pronunciation = getVal('pronunciation');
      const rawType = getVal('type').toLowerCase();
      const page = getVal('page');
      const note = getVal('note');

      let type: VocabularyType = 'word';
      if (
        rawType === 'phrase' ||
        rawType === 'combination' ||
        rawType === 'sentence' ||
        rawType === 'synonym' ||
        rawType === 'antonym' ||
        rawType === 'preposition' ||
        rawType === 'colloquial'
      ) {
        type = rawType as VocabularyType;
      } else if (en.includes(' ')) {
        type = 'phrase';
      }

      const errors: string[] = [];

      // Validation Rules
      if (!en) {
        errors.push('English word or phrase is required.');
      } else if (en.length > 150) {
        errors.push('English text must be under 150 characters.');
      }

      if (!hy && !ru) {
        errors.push('At least an Armenian or Russian translation is required.');
      }
      if (hy && hy.length > 250) {
        errors.push('Armenian translation must be under 250 characters.');
      }
      if (ru && ru.length > 250) {
        errors.push('Russian translation must be under 250 characters.');
      }
      if (definition && definition.length > 500) {
        errors.push('Definition must be under 500 characters.');
      }
      if (example && example.length > 500) {
        errors.push('Example sentence must be under 500 characters.');
      }
      if (pronunciation && pronunciation.length > 80) {
        errors.push('Pronunciation must be under 80 characters.');
      }

      // Duplicate Check
      let isDuplicate = false;
      let duplicateReason: string | undefined = undefined;
      let existingWordId: string | undefined = undefined;

      if (en) {
        const normalizedKey = this.vocabService.normalizeKey(en);
        const lowerEn = en.toLowerCase();

        const existingDbWord = existingByNormalized.get(normalizedKey) || existingByEn.get(lowerEn);
        if (existingDbWord) {
          isDuplicate = true;
          duplicateReason = `Already exists in Lesson ${lessonNumber} (Word: "${existingDbWord.en}")`;
          existingWordId = existingDbWord.id;
        } else if (seenNormalizedInBatch.has(normalizedKey)) {
          isDuplicate = true;
          duplicateReason = `Duplicate within this import file ("${en}")`;
        }

        seenNormalizedInBatch.add(normalizedKey);
      }

      const isValid = errors.length === 0;
      if (!isValid) invalidCount++;
      else if (isDuplicate) duplicateCount++;
      else validCount++;

      parsedRows.push({
        rowNumber: rowNum,
        originalValues: rowValues,
        mappedValues: {
          en,
          hy,
          ru: ru || undefined,
          definition: definition || undefined,
          example: example || undefined,
          partOfSpeech: partOfSpeech || undefined,
          pronunciation: pronunciation || undefined,
          type,
          page: page || undefined,
          note: note || undefined,
        },
        isValid,
        validationErrors: errors,
        isDuplicate,
        duplicateReason,
        existingWordId,
        selectedForImport: isValid && !isDuplicate, // default: select valid non-duplicates
      });
    });

    return {
      hasHeaderRow: hasHeaders,
      headers,
      columnMappings,
      rows: parsedRows,
      totalRows: parsedRows.length,
      validCount,
      invalidCount,
      duplicateCount,
    };
  }

  /**
   * Commit the verified imported rows into IndexedDB.
   * Handles duplicates according to selected DuplicateAction ('skip' or 'update').
   */
  public async executeImport(
    userId: string,
    bookId: string,
    lessonNumber: string,
    rows: ParsedImportRow[],
    duplicateAction: DuplicateAction = 'skip'
  ): Promise<ExecuteImportResult> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required to import vocabulary.');
    }
    if (!bookId) {
      throw new ValidationError('bookId', 'Target textbook is required.');
    }
    const cleanLesson = (lessonNumber || '').trim();
    if (!cleanLesson) {
      throw new ValidationError('lesson', 'Target lesson is required.');
    }

    // 1. Verify parent book access & ownership
    const book = await this.db.getById<Book>('books', bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Target textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in textbooks cannot be modified.');
    }
    if (book.createdBy !== userId) {
      throw new AuthorizationError('You do not have permission to import vocabulary into another user’s textbook.');
    }

    // 2. Ensure target lesson exists (or create if custom book)
    const existingLessons = await this.lessonService.getLessonsForBook(bookId, userId);
    let targetLesson = existingLessons.find(
      (l) => l.lessonNumber.toLowerCase() === cleanLesson.toLowerCase()
    );

    if (!targetLesson) {
      targetLesson = await this.lessonService.createLesson(userId, bookId, {
        lessonNumber: cleanLesson,
        name: `Lesson ${cleanLesson}`,
        orderIndex: existingLessons.length + 1,
      });
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const wordsToInsert: VocabularyWord[] = [];
    const importedWordsResult: VocabularyWord[] = [];

    const now = Date.now();

    for (const row of rows) {
      // Skip if unchecked or invalid
      if (!row.selectedForImport || !row.isValid) {
        skippedCount++;
        continue;
      }

      // Handle duplicate entries
      if (row.isDuplicate) {
        if (duplicateAction === 'skip') {
          skippedCount++;
          continue;
        } else if (duplicateAction === 'update' && row.existingWordId) {
          // Update existing word record in IndexedDB
          try {
            const updated = await this.vocabService.updateWord(userId, row.existingWordId, {
              en: row.mappedValues.en,
              hy: row.mappedValues.hy,
              ru: row.mappedValues.ru,
              definition: row.mappedValues.definition,
              example: row.mappedValues.example,
              partOfSpeech: row.mappedValues.partOfSpeech,
              pronunciation: row.mappedValues.pronunciation,
              type: row.mappedValues.type,
              page: row.mappedValues.page,
              note: row.mappedValues.note,
            });
            updatedCount++;
            importedWordsResult.push(updated);
          } catch (err) {
            console.warn('Failed to update duplicate word during import:', err);
            skippedCount++;
          }
          continue;
        }
      }

      // Create new vocabulary word
      const normalizedKey = this.vocabService.normalizeKey(row.mappedValues.en);
      const wordId = `${bookId}:${cleanLesson}:${normalizedKey || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const lessonId = `${bookId}:${cleanLesson}`;

      const newWord: VocabularyWord = {
        id: wordId,
        bookId,
        lessonId,
        lesson: cleanLesson,
        userId,
        en: row.mappedValues.en,
        hy: row.mappedValues.hy,
        ru: row.mappedValues.ru || undefined,
        english: row.mappedValues.en,
        armenian: row.mappedValues.hy,
        russian: row.mappedValues.ru || undefined,
        definition: row.mappedValues.definition || undefined,
        example: row.mappedValues.example || undefined,
        partOfSpeech: row.mappedValues.partOfSpeech || undefined,
        pronunciation: row.mappedValues.pronunciation || undefined,
        type: row.mappedValues.type || 'word',
        page: row.mappedValues.page || undefined,
        sourcePage: row.mappedValues.page || undefined,
        hint: row.mappedValues.note || undefined,
        note: row.mappedValues.note || undefined,
        normalizedEn: normalizedKey,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };

      wordsToInsert.push(newWord);
    }

    // Fast bulk insertion into IndexedDB in a single transaction
    if (wordsToInsert.length > 0) {
      await this.db.bulkPut('words', wordsToInsert);
      importedCount += wordsToInsert.length;
      importedWordsResult.push(...wordsToInsert);
    }

    return {
      importedCount,
      updatedCount,
      skippedCount,
      totalProcessed: rows.length,
      importedWords: importedWordsResult,
    };
  }
}

export const vocabularyImportService = new VocabularyImportService();
