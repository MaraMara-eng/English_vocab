/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { Book, FailedWord, Lesson, PartOfSpeech, UserWordProgress, VocabularyType, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { bookService, BookService } from './bookService.ts';
import { lessonService, LessonService } from './lessonService.ts';
import { BONK1_BOOK_ID, ensureBonkVocabularyLoaded } from './bonkDictionaryLoader.ts';

export interface CreateWordInput {
  en: string;
  hy: string;
  ru?: string;
  definition?: string;
  example?: string;
  partOfSpeech?: PartOfSpeech | string;
  pronunciation?: string;
  type?: VocabularyType;
  page?: string;
  hint?: string;
}

export interface UpdateWordInput {
  en?: string;
  hy?: string;
  ru?: string;
  definition?: string;
  example?: string;
  partOfSpeech?: PartOfSpeech | string;
  pronunciation?: string;
  type?: VocabularyType;
  page?: string;
  hint?: string;
  sourcePage?: string;
  note?: string;
}

export interface WordWithStatus extends VocabularyWord {
  isKnown: boolean;
  streak: number;
  failCount: number;
  lastPracticedAt?: number;
}

export class VocabularyService {
  private db: IndexedDBManager;
  private bookService: BookService;
  private lessonService: LessonService;

  constructor(
    db: IndexedDBManager = dbManager,
    customBookService?: BookService,
    customLessonService?: LessonService
  ) {
    this.db = db;
    this.bookService = customBookService || (db === dbManager ? bookService : new BookService(db));
    this.lessonService = customLessonService || (db === dbManager ? lessonService : new LessonService(db, this.bookService));
  }

  /**
   * Helper to normalize English key for indexing and duplicate checking.
   * Preserves lowercase letters, digits, and apostrophes.
   */
  public normalizeKey(text: string): string {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[\s\-_]+/g, '_')
      .replace(/[^a-z0-9_']/g, '');
  }

  /**
   * Get vocabulary words for a book, optionally filtered by lesson.
   * Enforces that the book is accessible to the user.
   */
  public async getWordsForBookAndLesson(
    userId: string,
    bookId: string,
    lessonNumber?: string
  ): Promise<VocabularyWord[]> {
    if (!userId || !bookId) return [];

    const book = await this.bookService.getBookById(userId, bookId);
    if (!book) return [];

    if (bookId === BONK1_BOOK_ID) {
      await ensureBonkVocabularyLoaded(this.db);
    }

    const allWords = await this.db.query<VocabularyWord>('words', {});
    let bookWords = allWords.filter((w) => w.bookId === bookId);

    if (lessonNumber && lessonNumber.trim() !== '') {
      const cleanLesson = lessonNumber.trim();
      bookWords = bookWords.filter(
        (w) => w.lesson === cleanLesson || w.lessonId === `${bookId}:${cleanLesson}`
      );
    }

    return bookWords;
  }

  /**
   * Retrieve vocabulary words enriched with the user's progress/known status.
   */
  public async getWordsWithStatus(
    userId: string,
    bookId: string,
    lessonNumber?: string
  ): Promise<WordWithStatus[]> {
    const words = await this.getWordsForBookAndLesson(userId, bookId, lessonNumber);
    if (words.length === 0) return [];

    const progressRecords = await this.db.getUserBookProgress(userId, bookId);
    const progressMap = new Map<string, UserWordProgress>();
    progressRecords.forEach((p) => {
      progressMap.set(p.wordKey, p);
      progressMap.set(p.wordId, p);
    });

    return words.map((w) => {
      const p = progressMap.get(w.normalizedEn) || progressMap.get(w.id);
      return {
        ...w,
        isKnown: p ? p.isKnown : false,
        streak: p ? p.streak : 0,
        failCount: p ? p.failCount : 0,
        lastPracticedAt: p ? p.lastPracticedAt : undefined,
      };
    });
  }

  /**
   * Add a new vocabulary word to a lesson within a book.
   * Requirements:
   * 1. Supports English word/phrase, Armenian translation, Russian translation,
   *    definition, example sentence, part of speech, pronunciation.
   * 2. Associates word with correct user, book, and lesson.
   * 3. Prevents duplicate words within the same lesson.
   * 4. Supports Unicode (Armenian & Russian characters).
   * 5. Validates required fields.
   */
  public async addWord(
    userId: string,
    bookId: string,
    lessonNumber: string,
    input: CreateWordInput
  ): Promise<VocabularyWord> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required to add vocabulary.');
    }
    if (!bookId) {
      throw new ValidationError('bookId', 'Book ID is required.');
    }
    const cleanLesson = (lessonNumber || '').trim();
    if (!cleanLesson) {
      throw new ValidationError('lesson', 'Lesson identifier is required.');
    }

    // 1. Verify parent book access and ownership
    const rawBook = await this.db.getById<Book>('books', bookId);
    if (!rawBook) {
      throw new ValidationError('bookId', 'Textbook not found.');
    }
    if (rawBook.isBuiltin || rawBook.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in textbooks cannot be modified.');
    }
    if (rawBook.createdBy !== userId) {
      throw new AuthorizationError('You do not have permission to add words to another user’s textbook.');
    }

    // 2. Validate English word/phrase
    const cleanEn = (input.en || '').trim();
    if (!cleanEn) {
      throw new ValidationError('en', 'English word or phrase is required.');
    }
    if (cleanEn.length > 150) {
      throw new ValidationError('en', 'English text must be under 150 characters.');
    }

    // 3. Validate Armenian translation (Supports full Armenian Unicode: \u0530-\u058F)
    const cleanHy = (input.hy || '').trim();
    if (!cleanHy) {
      throw new ValidationError('hy', 'Armenian translation is required.');
    }
    if (cleanHy.length > 250) {
      throw new ValidationError('hy', 'Armenian translation must be under 250 characters.');
    }

    // 4. Optional Russian translation (Supports full Cyrillic Unicode: \u0400-\u04FF)
    const cleanRu = (input.ru || '').trim();
    if (cleanRu.length > 250) {
      throw new ValidationError('ru', 'Russian translation must be under 250 characters.');
    }

    // 5. English definition & Example
    const cleanDef = (input.definition || '').trim();
    if (cleanDef.length > 500) {
      throw new ValidationError('definition', 'Definition must be under 500 characters.');
    }
    const cleanEx = (input.example || '').trim();
    if (cleanEx.length > 500) {
      throw new ValidationError('example', 'Example sentence must be under 500 characters.');
    }

    // 6. Pronunciation & Part of Speech
    const cleanPron = (input.pronunciation || '').trim();
    if (cleanPron.length > 80) {
      throw new ValidationError('pronunciation', 'Pronunciation must be under 80 characters.');
    }
    const cleanPos = (input.partOfSpeech || '').trim();

    // 7. Check duplicates within the same lesson
    const normalizedKey = this.normalizeKey(cleanEn);
    const existingWords = await this.getWordsForBookAndLesson(userId, bookId, cleanLesson);
    const duplicate = existingWords.some(
      (w) => w.normalizedEn === normalizedKey || w.en.toLowerCase().trim() === cleanEn.toLowerCase()
    );
    if (duplicate) {
      throw new ValidationError(
        'en',
        `The word or phrase "${cleanEn}" already exists in Lesson "${cleanLesson}".`
      );
    }

    const wordId = `${bookId}:${cleanLesson}:${normalizedKey || Date.now()}`;
    const lessonId = `${bookId}:${cleanLesson}`;
    const now = Date.now();

    const newWord: VocabularyWord = {
      id: wordId,
      bookId,
      lessonId,
      lesson: cleanLesson,
      userId,
      en: cleanEn,
      hy: cleanHy,
      ru: cleanRu || undefined,
      definition: cleanDef || undefined,
      example: cleanEx || undefined,
      partOfSpeech: cleanPos || undefined,
      pronunciation: cleanPron || undefined,
      type: input.type || (cleanEn.includes(' ') ? 'phrase' : 'word'),
      page: input.page?.trim() || undefined,
      hint: input.hint?.trim() || undefined,
      normalizedEn: normalizedKey,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    return await this.db.create('words', newWord);
  }

  /**
   * Update an existing vocabulary word.
   */
  public async updateWord(
    userId: string,
    wordId: string,
    updates: UpdateWordInput
  ): Promise<VocabularyWord> {
    if (!userId || !wordId) {
      throw new ValidationError('wordId', 'Word ID and User ID are required.');
    }

    const word = await this.db.getById<VocabularyWord>('words', wordId);
    if (!word) {
      throw new ValidationError('wordId', 'Vocabulary word not found.');
    }

    // Verify book ownership and authorization
    const book = await this.db.getById<Book>('books', word.bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Associated textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in vocabulary words cannot be modified.');
    }
    if (book.createdBy !== userId && word.userId !== userId) {
      throw new AuthorizationError('You do not have permission to modify another user’s vocabulary word.');
    }

    const patch: Partial<VocabularyWord> = {
      updatedAt: Date.now(),
    };

    const oldNormalizedEn = word.normalizedEn;
    let newNormalizedEn = oldNormalizedEn;

    if (updates.en !== undefined) {
      const cleanEn = updates.en.trim();
      if (!cleanEn) {
        throw new ValidationError('en', 'English word or phrase cannot be empty.');
      }
      if (cleanEn.length > 150) {
        throw new ValidationError('en', 'English text must be under 150 characters.');
      }

      newNormalizedEn = this.normalizeKey(cleanEn);
      if (newNormalizedEn !== oldNormalizedEn) {
        // Prevent duplicate words within the same lesson
        const existingInLesson = await this.getWordsForBookAndLesson(userId, word.bookId, word.lesson);
        const isDuplicate = existingInLesson.some(
          (w) =>
            w.id !== wordId &&
            (w.normalizedEn === newNormalizedEn || w.en.toLowerCase().trim() === cleanEn.toLowerCase())
        );
        if (isDuplicate) {
          throw new ValidationError(
            'en',
            `The word or phrase "${cleanEn}" already exists in Lesson "${word.lesson}".`
          );
        }
      }

      patch.en = cleanEn;
      patch.english = cleanEn;
      patch.normalizedEn = newNormalizedEn;
    }

    if (updates.hy !== undefined) {
      const cleanHy = updates.hy.trim();
      if (!cleanHy) {
        throw new ValidationError('hy', 'Armenian translation cannot be empty.');
      }
      if (cleanHy.length > 250) {
        throw new ValidationError('hy', 'Armenian translation must be under 250 characters.');
      }
      patch.hy = cleanHy;
      patch.armenian = cleanHy;
    }

    if (updates.ru !== undefined) {
      const cleanRu = updates.ru.trim();
      if (cleanRu.length > 250) {
        throw new ValidationError('ru', 'Russian translation must be under 250 characters.');
      }
      patch.ru = cleanRu || undefined;
      patch.russian = cleanRu || undefined;
    }

    if (updates.definition !== undefined) {
      const cleanDef = updates.definition.trim();
      if (cleanDef.length > 500) {
        throw new ValidationError('definition', 'Definition must be under 500 characters.');
      }
      patch.definition = cleanDef || undefined;
    }

    if (updates.example !== undefined) {
      const cleanEx = updates.example.trim();
      if (cleanEx.length > 500) {
        throw new ValidationError('example', 'Example sentence must be under 500 characters.');
      }
      patch.example = cleanEx || undefined;
    }

    if (updates.partOfSpeech !== undefined) {
      patch.partOfSpeech = updates.partOfSpeech.trim() || undefined;
    }

    if (updates.pronunciation !== undefined) {
      const cleanPron = updates.pronunciation.trim();
      if (cleanPron.length > 80) {
        throw new ValidationError('pronunciation', 'Pronunciation must be under 80 characters.');
      }
      patch.pronunciation = cleanPron || undefined;
    }

    if (updates.type !== undefined) {
      patch.type = updates.type;
    }

    if (updates.page !== undefined || updates.sourcePage !== undefined) {
      const cleanPage = (updates.page || updates.sourcePage || '').trim();
      patch.page = cleanPage || undefined;
      patch.sourcePage = cleanPage || undefined;
    }

    if (updates.hint !== undefined || updates.note !== undefined) {
      const cleanNote = (updates.hint || updates.note || '').trim();
      patch.hint = cleanNote || undefined;
      patch.note = cleanNote || undefined;
    }

    // 1. Save changes immediately to IndexedDB
    const updatedWord = await this.db.update<VocabularyWord>('words', wordId, patch);

    // 2. Preserve learning history if normalized key changed
    if (newNormalizedEn !== oldNormalizedEn) {
      try {
        const oldProgressId = `${userId}:${word.bookId}:${oldNormalizedEn}`;
        const existingProgress = await this.db.getById<UserWordProgress>(
          'userWordProgress',
          oldProgressId,
          userId
        );
        if (existingProgress) {
          await this.db.delete('userWordProgress', oldProgressId, userId);
          const newProgressId = `${userId}:${word.bookId}:${newNormalizedEn}`;
          await this.db.create<UserWordProgress>(
            'userWordProgress',
            {
              ...existingProgress,
              id: newProgressId,
              wordKey: newNormalizedEn,
              updatedAt: Date.now(),
            },
            userId
          );
        }
      } catch (err) {
        console.warn('Could not migrate userWordProgress key on word update:', err);
      }

      try {
        const oldFailedId = `${userId}:${word.bookId}:${oldNormalizedEn}`;
        const existingFailed = await this.db.getById<FailedWord>(
          'failedWords',
          oldFailedId,
          userId
        );
        if (existingFailed) {
          await this.db.delete('failedWords', oldFailedId, userId);
          const newFailedId = `${userId}:${word.bookId}:${newNormalizedEn}`;
          await this.db.create<FailedWord>(
            'failedWords',
            {
              ...existingFailed,
              id: newFailedId,
              wordKey: newNormalizedEn,
            },
            userId
          );
        }
      } catch (err) {
        console.warn('Could not migrate failedWords key on word update:', err);
      }
    }

    return updatedWord;
  }

  /**
   * Delete a vocabulary word and purge its user progress record.
   */
  public async deleteWord(userId: string, wordId: string): Promise<void> {
    if (!userId || !wordId) {
      throw new ValidationError('wordId', 'Word ID and User ID are required.');
    }

    const word = await this.db.getById<VocabularyWord>('words', wordId);
    if (!word) {
      throw new ValidationError('wordId', 'Vocabulary word not found.');
    }

    const book = await this.db.getById<Book>('books', word.bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Associated textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in vocabulary words cannot be deleted.');
    }
    if (book.createdBy !== userId && word.userId !== userId) {
      throw new AuthorizationError('You do not have permission to delete another user’s vocabulary word.');
    }

    // 1. Delete word from IndexedDB
    await this.db.delete('words', wordId);

    // 2. Cascade delete associated progress record
    const progressId = `${userId}:${word.bookId}:${word.normalizedEn}`;
    try {
      await this.db.delete('userWordProgress', progressId, userId);
    } catch {
      // Ignore if no progress record exists yet
    }

    // 3. Cascade delete associated failed word record
    const failedId = `${userId}:${word.bookId}:${word.normalizedEn}`;
    try {
      await this.db.delete('failedWords', failedId, userId);
    } catch {
      // Ignore
    }
  }

  /**
   * Toggle or set known status for a word for the current user.
   * Saves status in userWordProgress object store in IndexedDB.
   */
  public async setWordKnownStatus(
    userId: string,
    wordId: string,
    isKnown: boolean
  ): Promise<UserWordProgress> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!wordId) {
      throw new ValidationError('wordId', 'Word ID is required.');
    }

    const word = await this.db.getById<VocabularyWord>('words', wordId);
    if (!word) {
      throw new ValidationError('wordId', 'Vocabulary word not found.');
    }

    // Verify user can access this book
    const book = await this.bookService.getBookById(userId, word.bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Textbook not found or inaccessible.');
    }

    const wordKey = word.normalizedEn || this.normalizeKey(word.en);
    const progressId = `${userId}:${word.bookId}:${wordKey}`;
    const now = Date.now();

    const existing = await this.db.getById<UserWordProgress>('userWordProgress', progressId, userId);

    if (existing) {
      const updated: UserWordProgress = {
        ...existing,
        isKnown,
        streak: isKnown ? Math.max(existing.streak, 3) : 0,
        lastPracticedAt: now,
        updatedAt: now,
      };
      return await this.db.update<UserWordProgress>('userWordProgress', progressId, updated, userId);
    } else {
      const newProgress: UserWordProgress = {
        id: progressId,
        userId,
        bookId: word.bookId,
        wordId: word.id,
        wordKey,
        streak: isKnown ? 3 : 0,
        failCount: 0,
        isKnown,
        lastPracticedAt: now,
        updatedAt: now,
      };
      return await this.db.create<UserWordProgress>('userWordProgress', newProgress, userId);
    }
  }

  /**
   * Reset status/progress for a single word.
   */
  public async resetWordStatus(userId: string, wordId: string): Promise<void> {
    if (!userId || !wordId) return;
    const word = await this.db.getById<VocabularyWord>('words', wordId);
    if (!word) return;

    const wordKey = word.normalizedEn || this.normalizeKey(word.en);
    const progressId = `${userId}:${word.bookId}:${wordKey}`;
    const failedId = `${userId}:${word.bookId}:${wordKey}`;

    try {
      await this.db.delete('userWordProgress', progressId, userId);
    } catch {
      // Ignore
    }
    try {
      await this.db.delete('failedWords', failedId, userId);
    } catch {
      // Ignore
    }
  }

  /**
   * Reset all word statuses in a selected lesson.
   */
  public async resetLessonProgress(userId: string, bookId: string, lessonNumber: string): Promise<number> {
    if (!userId || !bookId || !lessonNumber) return 0;
    const words = await this.getWordsForBookAndLesson(userId, bookId, lessonNumber);
    let count = 0;
    for (const w of words) {
      await this.resetWordStatus(userId, w.id);
      count++;
    }
    return count;
  }

  /**
   * Reset all word statuses in a selected book.
   */
  public async resetBookProgress(userId: string, bookId: string): Promise<number> {
    if (!userId || !bookId) return 0;
    const progressRecords = await this.db.getUserBookProgress(userId, bookId);
    const failedRecords = await this.db.getFailedWordsForBook(userId, bookId);
    let count = 0;

    for (const p of progressRecords) {
      await this.db.delete('userWordProgress', p.id, userId);
      count++;
    }
    for (const f of failedRecords) {
      await this.db.delete('failedWords', f.id, userId);
    }
    return count;
  }

  /**
   * Reset all vocabulary progress for the user account.
   */
  public async resetAccountProgress(userId: string): Promise<number> {
    if (!userId) return 0;
    const allProgress = await this.db.query<UserWordProgress>('userWordProgress', {}, userId);
    const allFailed = await this.db.query<FailedWord>('failedWords', {}, userId);
    let count = 0;

    for (const p of allProgress) {
      await this.db.delete('userWordProgress', p.id, userId);
      count++;
    }
    for (const f of allFailed) {
      await this.db.delete('failedWords', f.id, userId);
    }
    return count;
  }
}

export const vocabularyService = new VocabularyService();

