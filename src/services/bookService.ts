/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { Book, FailedWord, Lesson, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { ensureBonkVocabularyLoaded } from './bonkDictionaryLoader.ts';

export interface CreateBookInput {
  name: string;
  description?: string;
}

export interface UpdateBookInput {
  name?: string;
  description?: string;
}

export interface BookStats {
  book: Book;
  lessonCount: number;
  wordCount: number;
  userProgressCount: number;
}

export const BUILTIN_BOOK_BONK1: Book = {
  id: 'bonk1',
  name: 'Bonk Volume 1',
  description: 'Trilingual English, Armenian, and Russian vocabulary curriculum from Bonk Volume 1 (Lessons 1–26).',
  isBuiltin: true,
  createdBy: 'system',
  createdAt: 1700000000000,
};

export class BookService {
  private db: IndexedDBManager;

  constructor(db: IndexedDBManager = dbManager) {
    this.db = db;
  }

  /**
   * Seed the default built-in textbook if it doesn't already exist.
   */
  public async ensureDefaultBooks(): Promise<void> {
    try {
      const existing = await this.db.getById<Book>('books', BUILTIN_BOOK_BONK1.id);
      if (!existing) {
        await this.db.create('books', BUILTIN_BOOK_BONK1);
      }
      // Dynamically load and cache the Bonk 1 dictionary
      await ensureBonkVocabularyLoaded(this.db);
    } catch (err) {
      console.warn('Failed to ensure default books:', err);
    }
  }

  /**
   * Retrieve all books available to a user:
   * - System built-in books (available to everyone)
   * - Custom books created exclusively by this user
   *
   * Crucially excludes books created by other users (Rule 6).
   */
  public async getUserBooks(userId: string): Promise<Book[]> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required to fetch books.');
    }

    await this.ensureDefaultBooks();

    const allBooks = await this.db.query<Book>('books', {});
    // Filter strictly: either created by current user or is a public builtin book
    const userBooks = allBooks.filter(
      (b) => b.isBuiltin || b.createdBy === userId || b.createdBy === 'system'
    );

    // Sort: built-in first, then by creation date ascending
    userBooks.sort((a, b) => {
      if (a.isBuiltin && !b.isBuiltin) return -1;
      if (!a.isBuiltin && b.isBuiltin) return 1;
      return a.createdAt - b.createdAt;
    });

    return userBooks;
  }

  /**
   * Get a single book by ID, enforcing user access boundaries.
   * Returns null if book belongs to another user.
   */
  public async getBookById(userId: string, bookId: string): Promise<Book | null> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!bookId) {
      return null;
    }

    const book = await this.db.getById<Book>('books', bookId);
    if (!book) return null;

    // Check ownership boundary
    if (!book.isBuiltin && book.createdBy !== 'system' && book.createdBy !== userId) {
      return null; // Don't leak existence of other users' private books
    }

    return book;
  }

  /**
   * Create a new custom book for a user.
   */
  public async createBook(userId: string, input: CreateBookInput): Promise<Book> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required to create a book.');
    }

    const name = (input.name || '').trim();
    if (!name) {
      throw new ValidationError('name', 'Book title cannot be empty.');
    }
    if (name.length > 80) {
      throw new ValidationError('name', 'Book title must be under 80 characters.');
    }

    const description = (input.description || '').trim();

    // Check for duplicate title among user's own books
    const userBooks = await this.getUserBooks(userId);
    const hasDuplicate = userBooks.some(
      (b) => b.name.toLowerCase() === name.toLowerCase() && b.createdBy === userId
    );
    if (hasDuplicate) {
      throw new ValidationError('name', `You already have a textbook named "${name}".`);
    }

    // Slugify name for clean ID
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 24);

    const bookId = `book_${userId}_${slug || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const newBook: Book = {
      id: bookId,
      name,
      description: description || undefined,
      isBuiltin: false,
      createdBy: userId,
      createdAt: now,
    };

    return await this.db.create('books', newBook);
  }

  /**
   * Edit book name and description.
   * Only the owner of the book can edit it; built-in books cannot be edited.
   */
  public async updateBook(userId: string, bookId: string, updates: UpdateBookInput): Promise<Book> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!bookId) {
      throw new ValidationError('bookId', 'Book ID is required.');
    }

    const book = await this.db.getById<Book>('books', bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Textbook not found.');
    }

    // Authorization checks
    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('System built-in textbooks cannot be modified.');
    }
    if (book.createdBy !== userId) {
      throw new AuthorizationError('You do not have permission to modify another user’s textbook.');
    }

    const patch: Partial<Book> = {};

    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (!cleanName) {
        throw new ValidationError('name', 'Book title cannot be empty.');
      }
      if (cleanName.length > 80) {
        throw new ValidationError('name', 'Book title must be under 80 characters.');
      }

      // Check duplicate among user's other books
      const userBooks = await this.getUserBooks(userId);
      const isDuplicate = userBooks.some(
        (b) => b.id !== bookId && b.name.toLowerCase() === cleanName.toLowerCase() && b.createdBy === userId
      );
      if (isDuplicate) {
        throw new ValidationError('name', `You already have a textbook named "${cleanName}".`);
      }

      patch.name = cleanName;
    }

    if (updates.description !== undefined) {
      patch.description = updates.description.trim() || undefined;
    }

    return await this.db.update<Book>('books', bookId, patch);
  }

  /**
   * Get detailed statistics for a book:
   * Count of lessons, words, and user practice progress records.
   * Used for safety warnings prior to deletion.
   */
  public async getBookStats(userId: string, bookId: string): Promise<BookStats> {
    const book = await this.getBookById(userId, bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Textbook not found or inaccessible.');
    }

    // Query lessons for this book
    const allLessons = await this.db.query<Lesson>('lessons', {});
    const bookLessons = allLessons.filter((l) => l.bookId === bookId);

    // Query words for this book
    const allWords = await this.db.query<VocabularyWord>('words', {});
    const bookWords = allWords.filter((w) => w.bookId === bookId);

    // Query user progress records for this book
    const userProgress = await this.db.getUserBookProgress(userId, bookId);

    return {
      book,
      lessonCount: bookLessons.length,
      wordCount: bookWords.length,
      userProgressCount: userProgress.length,
    };
  }

  /**
   * Delete a book and safely cascade-delete its associated lessons, words, and progress.
   * Ensures:
   * - Cannot delete built-in books.
   * - Cannot delete another user's books.
   * - Cleanly removes all associated lessons, vocabulary words, and user progress.
   */
  public async deleteBook(
    userId: string,
    bookId: string
  ): Promise<{
    deletedCounts: {
      book: number;
      lessons: number;
      words: number;
      progress: number;
      failedWords: number;
    };
  }> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required.');
    }
    if (!bookId) {
      throw new ValidationError('bookId', 'Book ID is required.');
    }

    const book = await this.db.getById<Book>('books', bookId);
    if (!book) {
      throw new ValidationError('bookId', 'Textbook not found.');
    }

    if (book.isBuiltin || book.createdBy === 'system') {
      throw new AuthorizationError('System built-in textbooks cannot be deleted.');
    }
    if (book.createdBy !== userId) {
      throw new AuthorizationError('You do not have permission to delete another user’s textbook.');
    }

    const counts = {
      book: 0,
      lessons: 0,
      words: 0,
      progress: 0,
      failedWords: 0,
    };

    // 1. Delete all words in this book
    const allWords = await this.db.query<VocabularyWord>('words', {});
    const wordsInBook = allWords.filter((w) => w.bookId === bookId);
    for (const w of wordsInBook) {
      await this.db.delete('words', w.id);
      counts.words++;
    }

    // 2. Delete all lessons in this book
    const allLessons = await this.db.query<Lesson>('lessons', {});
    const lessonsInBook = allLessons.filter((l) => l.bookId === bookId);
    for (const l of lessonsInBook) {
      await this.db.delete('lessons', l.id);
      counts.lessons++;
    }

    // 3. Delete word progress for this book
    const allProgress = await this.db.query<UserWordProgress>('userWordProgress', {}, userId);
    const progressInBook = allProgress.filter((p) => p.bookId === bookId && p.userId === userId);
    for (const p of progressInBook) {
      await this.db.delete('userWordProgress', p.id, userId);
      counts.progress++;
    }

    // 4. Delete failed words for this book
    const failedList = await this.db.getFailedWordsForBook(userId, bookId);
    for (const f of failedList) {
      await this.db.delete('failedWords', f.id, userId);
      counts.failedWords++;
    }

    // 5. Delete the book record itself
    await this.db.delete('books', bookId);
    counts.book = 1;

    // 6. If this book was selected in settings, fallback to bonk1
    try {
      const settings = await this.db.getSettings(userId);
      if (settings.selectedBookId === bookId) {
        await this.db.saveSettings(userId, { selectedBookId: 'bonk1', selectedLesson: '' });
      }
    } catch {
      // Ignore settings update failure
    }

    return { deletedCounts: counts };
  }
}

export const bookService = new BookService();
