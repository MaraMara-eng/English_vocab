/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { Book, Lesson, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { bookService, BookService } from './bookService.ts';

export interface CreateLessonInput {
  lessonNumber: string;
  name: string;
  description?: string;
  orderIndex?: number;
}

export interface UpdateLessonInput {
  name?: string;
  description?: string;
  orderIndex?: number;
}

export interface LessonStats {
  lesson: Lesson;
  wordCount: number;
}

export class LessonService {
  private db: IndexedDBManager;
  private bookService: BookService;

  constructor(db: IndexedDBManager = dbManager, customBookService?: BookService) {
    this.db = db;
    this.bookService = customBookService || (db === dbManager ? bookService : new BookService(db));
  }

  /**
   * Ensure default lessons 1–26 exist for the built-in textbook bonk1.
   */
  public async ensureDefaultBonkLessons(): Promise<Lesson[]> {
    const existing = await this.getLessonsForBook('bonk1');
    if (existing.length >= 26) {
      return existing;
    }

    const createdLessons: Lesson[] = [];
    const now = Date.now();

    for (let i = 1; i <= 26; i++) {
      const lessonNumber = String(i);
      const lessonId = `bonk1:${lessonNumber}`;
      const existingLesson = existing.find((l) => l.lessonNumber === lessonNumber);

      if (!existingLesson) {
        const newLesson: Lesson = {
          id: lessonId,
          bookId: 'bonk1',
          lessonNumber,
          name: `Lesson ${lessonNumber}`,
          description: `Standard vocabulary unit ${lessonNumber}`,
          orderIndex: i,
          createdAt: now,
        };
        try {
          await this.db.create('lessons', newLesson);
          createdLessons.push(newLesson);
        } catch {
          // Ignore if already created concurrently
        }
      } else {
        createdLessons.push(existingLesson);
      }
    }

    return await this.getLessonsForBook('bonk1');
  }

  /**
   * Get all lessons belonging strictly to a specific book, sorted in order.
   * If a userId is provided, verifies that the user has permission to access the book.
   */
  public async getLessonsForBook(bookId: string, userId?: string): Promise<Lesson[]> {
    if (!bookId) return [];

    if (userId) {
      const book = await this.bookService.getBookById(userId, bookId);
      if (!book) {
        return []; // Inaccessible book, return empty to prevent data leaks
      }
    }

    const allLessons = await this.db.query<Lesson>('lessons', {});
    const bookLessons = allLessons.filter((l) => l.bookId === bookId);

    // Natural sort: orderIndex first, then numeric lessonNumber, then string comparison
    bookLessons.sort((a, b) => {
      if (a.orderIndex !== undefined && b.orderIndex !== undefined && a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      const numA = parseFloat(a.lessonNumber);
      const numB = parseFloat(b.lessonNumber);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
      }
      return a.lessonNumber.localeCompare(b.lessonNumber, undefined, { numeric: true });
    });

    return bookLessons;
  }

  /**
   * Get a single lesson by ID with user ownership / access verification.
   */
  public async getLessonById(userId: string, lessonId: string): Promise<Lesson | null> {
    if (!userId || !lessonId) return null;

    const lesson = await this.db.getById<Lesson>('lessons', lessonId);
    if (!lesson) return null;

    // Verify book access
    const book = await this.bookService.getBookById(userId, lesson.bookId);
    if (!book) return null;

    return lesson;
  }

  /**
   * Create a new lesson inside a selected book.
   * Requirements:
   * - Only book owners can add lessons to custom books.
   * - Standard curriculum (bonk1) is read-only.
   * - Associates lesson with bookId and userId.
   * - Validates lesson number uniqueness within the book.
   */
  public async createLesson(
    userIdOrBookId: string,
    bookIdOrLessonNumber: string,
    inputOrName?: CreateLessonInput | string,
    orderIndex?: number
  ): Promise<Lesson> {
    let userId: string = '';
    let bookId: string = '';
    let input: CreateLessonInput;

    // Detect if called with legacy (bookId, lessonNumber, name?, orderIndex?)
    if (typeof inputOrName === 'string' || inputOrName === undefined) {
      bookId = userIdOrBookId;
      const lessonNumber = bookIdOrLessonNumber;
      const name = inputOrName || `Lesson ${lessonNumber}`;
      input = { lessonNumber, name, orderIndex };
      // Retrieve book to find createdBy user if custom book
      const book = await this.db.getById<Book>('books', bookId);
      userId = book ? book.createdBy : 'system';
    } else {
      userId = userIdOrBookId;
      bookId = bookIdOrLessonNumber;
      input = inputOrName;
    }

    if (!userId) {
      throw new ValidationError('userId', 'User ID is required to create a lesson.');
    }
    if (!bookId) {
      throw new ValidationError('bookId', 'Book ID is required to create a lesson.');
    }

    // Verify book existence and user ownership
    const book = await this.db.getById<Book>('books', bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in textbooks cannot be modified.');
    }
    if (userId !== 'system' && book.createdBy !== userId) {
      throw new AuthorizationError('You do not have permission to add lessons to another user’s textbook.');
    }

    const cleanNumber = (input.lessonNumber || '').trim();
    if (!cleanNumber) {
      throw new ValidationError('lessonNumber', 'Lesson number or identifier is required.');
    }
    if (cleanNumber.length > 30) {
      throw new ValidationError('lessonNumber', 'Lesson number must be under 30 characters.');
    }

    const cleanName = (input.name || '').trim();
    if (!cleanName) {
      throw new ValidationError('name', 'Lesson title is required.');
    }
    if (cleanName.length > 100) {
      throw new ValidationError('name', 'Lesson title must be under 100 characters.');
    }

    const cleanDesc = (input.description || '').trim();

    // Check for duplicate lessonNumber in this book
    const existingLessons = await this.getLessonsForBook(bookId);
    const hasDuplicate = existingLessons.some(
      (l) => l.lessonNumber.toLowerCase() === cleanNumber.toLowerCase()
    );
    if (hasDuplicate) {
      throw new ValidationError(
        'lessonNumber',
        `A lesson with identifier "${cleanNumber}" already exists in this textbook.`
      );
    }

    const lessonId = `${bookId}:${cleanNumber}`;
    const assignedOrder = input.orderIndex ?? (existingLessons.length + 1);
    const now = Date.now();

    const newLesson: Lesson = {
      id: lessonId,
      bookId,
      userId,
      lessonNumber: cleanNumber,
      name: cleanName,
      description: cleanDesc || undefined,
      orderIndex: assignedOrder,
      createdAt: now,
      updatedAt: now,
    };

    return await this.db.create('lessons', newLesson);
  }

  /**
   * Update lesson title and description.
   * Requirements:
   * - Only the book/lesson owner can update it.
   * - Standard built-in lessons are read-only.
   */
  public async updateLesson(
    userId: string,
    lessonId: string,
    updates: UpdateLessonInput
  ): Promise<Lesson> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!lessonId) {
      throw new ValidationError('lessonId', 'Lesson ID is required.');
    }

    const lesson = await this.db.getById<Lesson>('lessons', lessonId);
    if (!lesson) {
      throw new ValidationError('lessonId', 'Lesson not found.');
    }

    // Check parent book permissions
    const book = await this.db.getById<Book>('books', lesson.bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Associated textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in lessons cannot be modified.');
    }
    if (book.createdBy !== userId && lesson.userId !== userId) {
      throw new AuthorizationError('You do not have permission to edit this lesson.');
    }

    const patch: Partial<Lesson> = {
      updatedAt: Date.now(),
    };

    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (!cleanName) {
        throw new ValidationError('name', 'Lesson title cannot be empty.');
      }
      if (cleanName.length > 100) {
        throw new ValidationError('name', 'Lesson title must be under 100 characters.');
      }
      patch.name = cleanName;
    }

    if (updates.description !== undefined) {
      patch.description = updates.description.trim() || undefined;
    }

    if (updates.orderIndex !== undefined && !isNaN(updates.orderIndex)) {
      patch.orderIndex = updates.orderIndex;
    }

    return await this.db.update<Lesson>('lessons', lessonId, patch);
  }

  /**
   * Get stats for a lesson (e.g. word count) for warnings and UI summaries.
   */
  public async getLessonStats(userId: string, lessonId: string): Promise<LessonStats> {
    const lesson = await this.getLessonById(userId, lessonId);
    if (!lesson) {
      throw new ValidationError('lessonId', 'Lesson not found or inaccessible.');
    }

    const allWords = await this.db.query<VocabularyWord>('words', {});
    const wordsInLesson = allWords.filter(
      (w) =>
        w.lessonId === lesson.id ||
        (w.bookId === lesson.bookId && w.lesson === lesson.lessonNumber)
    );

    return {
      lesson,
      wordCount: wordsInLesson.length,
    };
  }

  /**
   * Delete a lesson.
   * Requirements:
   * - Cannot delete built-in lessons.
   * - Cannot delete lessons belonging to other users.
   * - Cascade-deletes all associated vocabulary words.
   * - Resets active lesson selection if this was the selected lesson.
   */
  public async deleteLesson(
    userId: string,
    lessonId: string
  ): Promise<{ deletedCounts: { lesson: number; words: number } }> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!lessonId) {
      throw new ValidationError('lessonId', 'Lesson ID is required.');
    }

    const lesson = await this.db.getById<Lesson>('lessons', lessonId);
    if (!lesson) {
      throw new ValidationError('lessonId', 'Lesson not found.');
    }

    // Verify parent book ownership
    const book = await this.db.getById<Book>('books', lesson.bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Associated textbook not found.');
    }
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('Standard built-in lessons cannot be deleted.');
    }
    if (book.createdBy !== userId && lesson.userId !== userId) {
      throw new AuthorizationError('You do not have permission to delete this lesson.');
    }

    const counts = {
      lesson: 0,
      words: 0,
    };

    // 1. Cascade-delete associated vocabulary words
    const allWords = await this.db.query<VocabularyWord>('words', {});
    const wordsInLesson = allWords.filter(
      (w) =>
        w.lessonId === lesson.id ||
        (w.bookId === lesson.bookId && w.lesson === lesson.lessonNumber)
    );

    for (const word of wordsInLesson) {
      await this.db.delete('words', word.id);
      counts.words++;
    }

    // 2. Delete the lesson record itself
    await this.db.delete('lessons', lesson.id);
    counts.lesson = 1;

    // 3. Reset selectedLesson setting if it pointed to this deleted lesson
    try {
      const settings = await this.db.getSettings(userId);
      if (
        settings.selectedLesson === lesson.lessonNumber ||
        settings.selectedLesson === lesson.id
      ) {
        await this.db.saveSettings(userId, { selectedLesson: '' });
      }
    } catch {
      // Ignore settings sync failure
    }

    return { deletedCounts: counts };
  }
}

export const lessonService = new LessonService();
