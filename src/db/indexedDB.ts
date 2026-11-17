/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppSettings,
  Book,
  FailedWord,
  FullDatabaseBackup,
  LearningSession,
  Lesson,
  StoreEntityMap,
  StoreName,
  USER_SCOPED_STORES,
  User,
  UserDataBackup,
  UserWordProgress,
  VocabularyWord,
} from './types.ts';
import { AuthorizationError, ValidationError, validateRecordForStore } from './validators.ts';

export const DB_NAME = 'VocabQuestDB';
export const DB_VERSION = 1;

export class DatabaseError extends Error {
  public originalError?: unknown;
  constructor(message: string, originalError?: unknown) {
    super(`DatabaseError: ${message}`);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

/**
 * Initialize object stores and indexes without destroying existing data.
 */
export function setupSchema(db: IDBDatabase, _oldVersion: number, _newVersion: number | null): void {
  // 1. Users store
  if (!db.objectStoreNames.contains('users')) {
    const userStore = db.createObjectStore('users', { keyPath: 'id' });
    userStore.createIndex('username', 'username', { unique: true });
    userStore.createIndex('email', 'email', { unique: false });
    userStore.createIndex('role', 'role', { unique: false });
    userStore.createIndex('createdAt', 'createdAt', { unique: false });
  }

  // 2. Books store
  if (!db.objectStoreNames.contains('books')) {
    const bookStore = db.createObjectStore('books', { keyPath: 'id' });
    bookStore.createIndex('name', 'name', { unique: false });
    bookStore.createIndex('isBuiltin', 'isBuiltin', { unique: false });
    bookStore.createIndex('createdBy', 'createdBy', { unique: false });
  }

  // 3. Lessons store
  if (!db.objectStoreNames.contains('lessons')) {
    const lessonStore = db.createObjectStore('lessons', { keyPath: 'id' });
    lessonStore.createIndex('bookId', 'bookId', { unique: false });
    lessonStore.createIndex('lessonNumber', 'lessonNumber', { unique: false });
    lessonStore.createIndex('bookId_lessonNumber', ['bookId', 'lessonNumber'], { unique: true });
  }

  // 4. Vocabulary Words store
  if (!db.objectStoreNames.contains('words')) {
    const wordStore = db.createObjectStore('words', { keyPath: 'id' });
    wordStore.createIndex('bookId', 'bookId', { unique: false });
    wordStore.createIndex('lesson', 'lesson', { unique: false });
    wordStore.createIndex('bookId_lesson', ['bookId', 'lesson'], { unique: false });
    wordStore.createIndex('type', 'type', { unique: false });
    wordStore.createIndex('normalizedEn', 'normalizedEn', { unique: false });
  }

  // 5. User Word Progress store (User-scoped)
  if (!db.objectStoreNames.contains('userWordProgress')) {
    const progStore = db.createObjectStore('userWordProgress', { keyPath: 'id' });
    progStore.createIndex('userId', 'userId', { unique: false });
    progStore.createIndex('userId_bookId', ['userId', 'bookId'], { unique: false });
    progStore.createIndex('userId_wordId', ['userId', 'wordId'], { unique: true });
    progStore.createIndex('userId_isKnown', ['userId', 'isKnown'], { unique: false });
    progStore.createIndex('userId_bookId_isKnown', ['userId', 'bookId', 'isKnown'], { unique: false });
  }

  // 6. Learning Sessions store (User-scoped)
  if (!db.objectStoreNames.contains('learningSessions')) {
    const sessionStore = db.createObjectStore('learningSessions', { keyPath: 'id' });
    sessionStore.createIndex('userId', 'userId', { unique: false });
    sessionStore.createIndex('userId_bookId', ['userId', 'bookId'], { unique: false });
    sessionStore.createIndex('userId_startedAt', ['userId', 'startedAt'], { unique: false });
  }

  // 7. Failed Words store (User-scoped)
  if (!db.objectStoreNames.contains('failedWords')) {
    const failedStore = db.createObjectStore('failedWords', { keyPath: 'id' });
    failedStore.createIndex('userId', 'userId', { unique: false });
    failedStore.createIndex('userId_bookId', ['userId', 'bookId'], { unique: false });
    failedStore.createIndex('userId_wordId', ['userId', 'wordId'], { unique: true });
  }

  // 8. Application Settings store (User-scoped)
  if (!db.objectStoreNames.contains('appSettings')) {
    const settingsStore = db.createObjectStore('appSettings', { keyPath: 'id' });
    settingsStore.createIndex('userId', 'userId', { unique: true });
  }
}

export interface QueryOptions {
  indexName?: string;
  range?: IDBKeyRange | IDBValidKey;
  direction?: IDBCursorDirection;
  limit?: number;
  offset?: number;
  filter?: (item: unknown) => boolean;
}

export const getKeyRange = (): typeof IDBKeyRange => {
  if (typeof IDBKeyRange !== 'undefined') return IDBKeyRange;
  if (typeof window !== 'undefined' && window.IDBKeyRange) return window.IDBKeyRange;
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange) {
    return (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange;
  }
  throw new Error('IDBKeyRange is not available in this environment');
};

/**
 * Reusable IndexedDB repository with connection management, user-scoping, and transactions.
 */
export class IndexedDBManager {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly version: number;
  private readonly idbFactory: IDBFactory;

  constructor(dbName = DB_NAME, version = DB_VERSION, customFactory?: IDBFactory) {
    this.dbName = dbName;
    this.version = version;
    this.idbFactory =
      customFactory ||
      (typeof window !== 'undefined' ? window.indexedDB : (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB);
  }

  public async open(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (!this.idbFactory) {
      throw new DatabaseError('IndexedDB API is not supported in this runtime environment.');
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.idbFactory.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        setupSchema(db, event.oldVersion, event.newVersion);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.close();
        };
        resolve(this.db);
      };

      request.onerror = () => {
        reject(new DatabaseError('Failed to open database', request.error));
      };

      request.onblocked = () => {
        console.warn('Database open blocked: please close other tabs running the application');
      };
    });
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public async deleteDatabase(): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const req = this.idbFactory.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new DatabaseError('Failed to delete database', req.error));
      req.onblocked = () => resolve();
    });
  }

  // --- Core Transaction Runner ---
  private async withStore<T>(
    storeName: StoreName,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let isSettled = false;
      const safeResolve = (val: T) => {
        if (!isSettled) {
          isSettled = true;
          resolve(val);
        }
      };
      const safeReject = (err: unknown) => {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        let resultPromise: Promise<T> | T;
        try {
          resultPromise = callback(store, tx);
          // Attach error handler so promise rejections are handled properly
          Promise.resolve(resultPromise).catch((err) => {
            safeReject(err);
          });
        } catch (err) {
          safeReject(err);
          return;
        }

        tx.oncomplete = async () => {
          try {
            safeResolve(await resultPromise);
          } catch (err) {
            safeReject(err);
          }
        };

        tx.onerror = (event) => {
          if (typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          if (!isSettled) {
            safeReject(new DatabaseError(`Transaction on "${storeName}" failed`, tx.error || event));
          }
        };

        tx.onabort = (event) => {
          if (typeof event?.preventDefault === 'function') {
            event.preventDefault();
          }
          if (!isSettled) {
            safeReject(new DatabaseError(`Transaction on "${storeName}" was aborted`, tx.error));
          }
        };
      } catch (err) {
        safeReject(new DatabaseError(`Failed to initiate transaction on "${storeName}"`, err));
      }
    });
  }

  // ==========================================
  // Generic Reusable CRUD Operations
  // ==========================================

  /**
   * Create a new record in the specified store.
   * If the store is user-scoped, currentUser is required and enforced.
   */
  public async create<T extends { id: string } = any>(
    storeName: StoreName,
    record: T,
    currentUser?: string
  ): Promise<T> {
    validateRecordForStore(storeName, record, currentUser);

    return this.withStore(storeName, 'readwrite', (store) => {
      return new Promise<T>((resolve, reject) => {
        const req = store.add(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (event) => {
          if (typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
          }
          if (req.error && req.error.name === 'ConstraintError') {
            reject(
              new ValidationError(
                'id',
                `A record with unique constraint matching "${record.id}" already exists in "${storeName}"`
              )
            );
          } else {
            reject(new DatabaseError(`Failed to insert record into "${storeName}"`, req.error));
          }
        };
      });
    });
  }

  /**
   * Bulk insert or update records within a single transaction.
   * High performance for initial vocabulary dictionary seeding.
   */
  public async bulkPut<T extends { id: string } = any>(
    storeName: StoreName,
    records: T[]
  ): Promise<number> {
    if (records.length === 0) return 0;
    return this.withStore(storeName, 'readwrite', (store) => {
      return new Promise<number>((resolve, reject) => {
        let count = 0;
        let hasError = false;
        for (const record of records) {
          const req = store.put(record);
          req.onsuccess = () => {
            count++;
            if (count === records.length && !hasError) {
              resolve(count);
            }
          };
          req.onerror = (event) => {
            hasError = true;
            if (typeof event.preventDefault === 'function') event.preventDefault();
            reject(new DatabaseError(`Failed in bulkPut on "${storeName}" at item ${record.id}`, req.error));
          };
        }
      });
    });
  }

  /**
   * Count records in a store or index.
   */
  public async count(
    storeName: StoreName,
    options?: { indexName?: string; range?: IDBKeyRange | IDBValidKey }
  ): Promise<number> {
    return this.withStore(storeName, 'readonly', (store) => {
      return new Promise<number>((resolve, reject) => {
        const target = options?.indexName ? store.index(options.indexName) : store;
        const req = options?.range !== undefined ? target.count(options.range) : target.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new DatabaseError(`Failed to count records in "${storeName}"`, req.error));
      });
    });
  }

  /**
   * Read a record by ID.
   * If the store is user-scoped, enforces that the record belongs to currentUser.
   */
  public async getById<T = any>(
    storeName: StoreName,
    id: string,
    currentUser?: string
  ): Promise<T | null> {
    return this.withStore(storeName, 'readonly', (store) => {
      return new Promise<T | null>((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => {
          const result = req.result as T | undefined;
          if (!result) {
            resolve(null);
            return;
          }

          // User-scoping enforcement
          if (USER_SCOPED_STORES.has(storeName)) {
            const rec = result as unknown as { userId?: string };
            if (!currentUser || rec.userId !== currentUser) {
              // Return null so callers cannot detect existence of other users' records
              resolve(null);
              return;
            }
          }

          resolve(result);
        };
        req.onerror = () => reject(new DatabaseError(`Failed to get record "${id}" from "${storeName}"`, req.error));
      });
    });
  }

  /**
   * Query records from a store.
   * For user-scoped stores, queries are strictly constrained to the authenticated user.
   */
  public async query<T = any>(
    storeName: StoreName,
    options: QueryOptions = {},
    currentUser?: string
  ): Promise<T[]> {
    const isUserScoped = USER_SCOPED_STORES.has(storeName);
    if (isUserScoped && !currentUser) {
      throw new AuthorizationError(`Cannot query user-scoped store "${storeName}" without an authenticated userId.`);
    }

    return this.withStore(storeName, 'readonly', (store) => {
      return new Promise<T[]>((resolve, reject) => {
        const results: T[] = [];
        let source: IDBObjectStore | IDBIndex = store;

        // If user-scoped and no custom index requested, use userId index for maximum performance
        let effectiveRange = options.range;
        if (isUserScoped && !options.indexName) {
          source = store.index('userId');
          effectiveRange = getKeyRange().only(currentUser);
        } else if (options.indexName) {
          source = store.index(options.indexName);
        }

        let skipped = 0;
        const offset = options.offset || 0;
        const limit = options.limit || Infinity;

        const req = source.openCursor(effectiveRange, options.direction || 'next');

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(results);
            return;
          }

          const value = cursor.value as T;
          const rec = value as unknown as { userId?: string };

          // Strict boundary check: never leak records of other users
          if (isUserScoped && rec.userId !== currentUser) {
            cursor.continue();
            return;
          }

          // Custom in-memory filter
          if (!options.filter || options.filter(value)) {
            if (skipped < offset) {
              skipped++;
            } else if (results.length < limit) {
              results.push(value);
            } else {
              resolve(results);
              return;
            }
          }

          cursor.continue();
        };

        req.onerror = () => reject(new DatabaseError(`Query on "${storeName}" failed`, req.error));
      });
    });
  }

  /**
   * Update an existing record.
   * Merges partial updates, runs validation, and enforces user boundaries.
   */
  public async update<T = any>(
    storeName: StoreName,
    id: string,
    updates: Record<string, any>,
    currentUser?: string
  ): Promise<T> {
    return this.withStore(storeName, 'readwrite', (store) => {
      return new Promise<T>((resolve, reject) => {
        const getReq = store.get(id);

        getReq.onsuccess = () => {
          const existing = getReq.result as T | undefined;
          if (!existing) {
            reject(new DatabaseError(`Cannot update: record with ID "${id}" was not found in "${storeName}"`));
            return;
          }

          // Enforce ownership
          if (USER_SCOPED_STORES.has(storeName)) {
            const rec = existing as unknown as { userId?: string };
            if (!currentUser || rec.userId !== currentUser) {
              reject(
                new AuthorizationError(
                  `Unauthorized: authenticated user "${currentUser}" cannot update record belonging to "${rec.userId}"`
                )
              );
              return;
            }
          }

          const merged = { ...existing, ...updates, id } as T;

          try {
            validateRecordForStore(storeName, merged, currentUser);
          } catch (valErr) {
            reject(valErr);
            return;
          }

          const putReq = store.put(merged);
          putReq.onsuccess = () => resolve(merged);
          putReq.onerror = () => reject(new DatabaseError(`Failed to update record "${id}" in "${storeName}"`, putReq.error));
        };

        getReq.onerror = () => reject(new DatabaseError(`Failed to retrieve record "${id}" for update`, getReq.error));
      });
    });
  }

  /**
   * Delete a record by ID.
   * If the store is user-scoped, ensures the record belongs to currentUser.
   */
  public async delete(
    storeName: StoreName,
    id: string,
    currentUser?: string
  ): Promise<boolean> {
    return this.withStore(storeName, 'readwrite', (store) => {
      return new Promise<boolean>((resolve, reject) => {
        if (USER_SCOPED_STORES.has(storeName)) {
          const getReq = store.get(id);
          getReq.onsuccess = () => {
            const existing = getReq.result as { userId?: string } | undefined;
            if (!existing) {
              resolve(false);
              return;
            }

            if (!currentUser || existing.userId !== currentUser) {
              reject(
                new AuthorizationError(
                  `Unauthorized: authenticated user "${currentUser}" cannot delete record belonging to "${existing.userId}"`
                )
              );
              return;
            }

            const delReq = store.delete(id);
            delReq.onsuccess = () => resolve(true);
            delReq.onerror = () => reject(new DatabaseError(`Failed to delete "${id}" from "${storeName}"`, delReq.error));
          };
          getReq.onerror = () => reject(new DatabaseError(`Failed to check record before deletion`, getReq.error));
        } else {
          const delReq = store.delete(id);
          delReq.onsuccess = () => resolve(true);
          delReq.onerror = () => reject(new DatabaseError(`Failed to delete "${id}" from "${storeName}"`, delReq.error));
        }
      });
    });
  }

  // ==========================================
  // High-Level Domain Methods (User-Scoped)
  // ==========================================

  /**
   * Upsert user word progress when a word is practiced.
   */
  public async recordWordAttempt(
    userId: string,
    bookId: string,
    wordKey: string,
    isCorrect: boolean
  ): Promise<UserWordProgress> {
    if (!userId || !bookId || !wordKey) {
      throw new ValidationError('params', 'userId, bookId, and wordKey are required');
    }

    const progressId = `${userId}:${bookId}:${wordKey}`;
    const failedId = `${userId}:${bookId}:${wordKey}`;
    const now = Date.now();

    const existing = await this.getById<UserWordProgress>('userWordProgress', progressId, userId);

    let streak = existing ? existing.streak : 0;
    let failCount = existing ? existing.failCount : 0;

    if (isCorrect) {
      streak += 1;
    } else {
      streak = 0;
      failCount += 1;
    }

    const isKnown = streak >= 3;

    const record: UserWordProgress = {
      id: progressId,
      userId,
      bookId,
      wordId: `${bookId}:${wordKey}`,
      wordKey,
      streak,
      failCount,
      isKnown,
      lastPracticedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await this.update('userWordProgress', progressId, record, userId);
    } else {
      await this.create('userWordProgress', record, userId);
    }

    // Update failedWords pool:
    if (!isCorrect) {
      const existingFailed = await this.getById<FailedWord>('failedWords', failedId, userId);
      const failedRecord: FailedWord = {
        id: failedId,
        userId,
        bookId,
        wordId: `${bookId}:${wordKey}`,
        wordKey,
        remainingReviews: 2, // Must be answered correctly 2 times to be removed
        totalMisses: existingFailed ? existingFailed.totalMisses + 1 : 1,
        lastMissedAt: now,
      };
      if (existingFailed) {
        await this.update('failedWords', failedId, failedRecord, userId);
      } else {
        await this.create('failedWords', failedRecord, userId);
      }
    } else {
      const existingFailed = await this.getById<FailedWord>('failedWords', failedId, userId);
      if (existingFailed) {
        if (existingFailed.remainingReviews <= 1) {
          await this.delete('failedWords', failedId, userId);
        } else {
          await this.update(
            'failedWords',
            failedId,
            { remainingReviews: existingFailed.remainingReviews - 1 },
            userId
          );
        }
      }
    }

    return record;
  }

  /**
   * Retrieve all progress for a given user and book.
   */
  public async getUserBookProgress(userId: string, bookId: string): Promise<UserWordProgress[]> {
    return this.query<UserWordProgress>(
      'userWordProgress',
      {
        indexName: 'userId_bookId',
        range: getKeyRange().only([userId, bookId]),
      },
      userId
    );
  }

  /**
   * Retrieve all failed words for a given user and book.
   */
  public async getFailedWordsForBook(userId: string, bookId: string): Promise<FailedWord[]> {
    return this.query<FailedWord>(
      'failedWords',
      {
        indexName: 'userId_bookId',
        range: getKeyRange().only([userId, bookId]),
      },
      userId
    );
  }

  /**
   * Clear all failed words for a user (or for a specific book).
   */
  public async clearFailedWords(userId: string, bookId?: string): Promise<number> {
    const list = bookId
      ? await this.getFailedWordsForBook(userId, bookId)
      : await this.query<FailedWord>('failedWords', {}, userId);

    for (const item of list) {
      await this.delete('failedWords', item.id, userId);
    }
    return list.length;
  }

  /**
   * Delete a user account and all associated data across all stores:
   * Books, Lessons, Words, Progress, Sessions, Failed words, Settings, and User record.
   * Strictly preserves data belonging to other users and system builtin content.
   */
  public async deleteUserAccount(userId: string): Promise<{
    deletedCounts: {
      user: number;
      books: number;
      lessons: number;
      words: number;
      progress: number;
      sessions: number;
      failedWords: number;
      settings: number;
    };
  }> {
    if (!userId) {
      throw new ValidationError('userId', 'userId is required for account deletion');
    }

    const counts = {
      user: 0,
      books: 0,
      lessons: 0,
      words: 0,
      progress: 0,
      sessions: 0,
      failedWords: 0,
      settings: 0,
    };

    // 1. Delete word progress for this user
    const progressList = await this.query<UserWordProgress>('userWordProgress', {}, userId);
    for (const prog of progressList) {
      if (prog.userId === userId) {
        await this.delete('userWordProgress', prog.id, userId);
        counts.progress++;
      }
    }

    // 2. Delete learning sessions for this user
    const sessionList = await this.query<LearningSession>('learningSessions', {}, userId);
    for (const sess of sessionList) {
      if (sess.userId === userId) {
        await this.delete('learningSessions', sess.id, userId);
        counts.sessions++;
      }
    }

    // 3. Delete failed words for this user
    const failedList = await this.query<FailedWord>('failedWords', {}, userId);
    for (const failed of failedList) {
      if (failed.userId === userId) {
        await this.delete('failedWords', failed.id, userId);
        counts.failedWords++;
      }
    }

    // 4. Delete personal application settings for this user
    const settingsList = await this.query<AppSettings>('appSettings', {}, userId);
    for (const s of settingsList) {
      if (s.userId === userId) {
        await this.delete('appSettings', s.id, userId);
        counts.settings++;
      }
    }
    // Also ensure default settings ID is cleared if present
    const defaultSettingsId = `settings:${userId}`;
    const defaultSettings = await this.getById<AppSettings>('appSettings', defaultSettingsId, userId);
    if (defaultSettings) {
      await this.delete('appSettings', defaultSettingsId, userId);
      counts.settings++;
    }

    // 5. Delete custom books created by this user (never builtin books)
    const allBooks = await this.query<Book>('books', {});
    const userBooks = allBooks.filter((b) => b.createdBy === userId && !b.isBuiltin);
    const userBookIds = new Set(userBooks.map((b) => b.id));
    for (const book of userBooks) {
      await this.delete('books', book.id);
      counts.books++;
    }

    // 6. Delete lessons associated with the user's custom books
    if (userBookIds.size > 0) {
      const allLessons = await this.query<Lesson>('lessons', {});
      const userLessons = allLessons.filter((l) => userBookIds.has(l.bookId));
      for (const lesson of userLessons) {
        await this.delete('lessons', lesson.id);
        counts.lessons++;
      }
    }

    // 7. Delete vocabulary words associated with user's books or created by user
    const allWords = await this.query<VocabularyWord>('words', {});
    const userWords = allWords.filter(
      (w) =>
        userBookIds.has(w.bookId) ||
        (w.createdBy === userId && w.createdBy !== 'system')
    );
    for (const word of userWords) {
      await this.delete('words', word.id);
      counts.words++;
    }

    // 8. Delete the user record from the users store
    const userExists = await this.getById<User>('users', userId);
    if (userExists) {
      await this.delete('users', userId);
      counts.user++;
    }

    return { deletedCounts: counts };
  }

  /**
   * Get application settings for a user (or create default).
   */
  public async getSettings(userId: string): Promise<AppSettings> {
    const id = `settings:${userId}`;
    const existing = await this.getById<AppSettings>('appSettings', id, userId);
    if (existing) {
      return existing;
    }

    const defaultSettings: AppSettings = {
      id,
      userId,
      selectedBookId: 'bonk1',
      selectedLesson: '',
      voiceMode: false,
      theme: 'auto',
      soundEnabled: true,
      updatedAt: Date.now(),
    };

    return this.create('appSettings', defaultSettings, userId);
  }

  /**
   * Save application settings for a user.
   */
  public async saveSettings(userId: string, settings: Partial<AppSettings>): Promise<AppSettings> {
    const id = `settings:${userId}`;
    const existing = await this.getById<AppSettings>('appSettings', id, userId);

    if (existing) {
      return this.update(
        'appSettings',
        id,
        { ...settings, updatedAt: Date.now() },
        userId
      );
    }

    const newRecord: AppSettings = {
      id,
      userId,
      selectedBookId: settings.selectedBookId || 'bonk1',
      selectedLesson: settings.selectedLesson || '',
      voiceMode: !!settings.voiceMode,
      theme: settings.theme || 'auto',
      soundEnabled: settings.soundEnabled !== undefined ? settings.soundEnabled : true,
      updatedAt: Date.now(),
    };

    return this.create('appSettings', newRecord, userId);
  }

  // ==========================================
  // Backup: Local Export & Import
  // ==========================================

  /**
   * Export all data for a specific user as a portable backup object.
   */
  public async exportUserData(userId: string): Promise<UserDataBackup> {
    if (!userId) {
      throw new ValidationError('userId', 'userId is required for export');
    }

    const user = await this.getById<User>('users', userId);
    const progress = await this.query<UserWordProgress>('userWordProgress', {}, userId);
    const sessions = await this.query<LearningSession>('learningSessions', {}, userId);
    const failedWords = await this.query<FailedWord>('failedWords', {}, userId);
    const settings = await this.getById<AppSettings>('appSettings', `settings:${userId}`, userId);

    return {
      version: DB_VERSION,
      exportedAt: Date.now(),
      userId,
      user: user || undefined,
      progress,
      sessions,
      failedWords,
      settings: settings || undefined,
    };
  }

  /**
   * Import and restore data for a specific user from backup.
   * Enforces that all imported records are tagged and scoped to the target userId.
   */
  public async importUserData(userId: string, backup: UserDataBackup): Promise<{ importedCount: number }> {
    if (!userId) {
      throw new ValidationError('userId', 'Target userId is required for import');
    }
    if (!backup || typeof backup !== 'object') {
      throw new ValidationError('backup', 'Invalid backup payload');
    }

    let count = 0;

    // 1. Settings
    if (backup.settings) {
      const sanitizedSettings: AppSettings = {
        ...backup.settings,
        id: `settings:${userId}`,
        userId,
        updatedAt: Date.now(),
      };
      const existing = await this.getById<AppSettings>('appSettings', sanitizedSettings.id, userId);
      if (existing) {
        await this.update('appSettings', sanitizedSettings.id, sanitizedSettings, userId);
      } else {
        await this.create('appSettings', sanitizedSettings, userId);
      }
      count++;
    }

    // 2. Progress
    if (Array.isArray(backup.progress)) {
      for (const p of backup.progress) {
        const item: UserWordProgress = {
          ...p,
          id: `${userId}:${p.bookId}:${p.wordKey}`,
          userId,
          updatedAt: Date.now(),
        };
        const existing = await this.getById<UserWordProgress>('userWordProgress', item.id, userId);
        if (existing) {
          await this.update('userWordProgress', item.id, item, userId);
        } else {
          await this.create('userWordProgress', item, userId);
        }
        count++;
      }
    }

    // 3. Failed words
    if (Array.isArray(backup.failedWords)) {
      for (const f of backup.failedWords) {
        const item: FailedWord = {
          ...f,
          id: `${userId}:${f.bookId}:${f.wordKey}`,
          userId,
        };
        const existing = await this.getById<FailedWord>('failedWords', item.id, userId);
        if (existing) {
          await this.update('failedWords', item.id, item, userId);
        } else {
          await this.create('failedWords', item, userId);
        }
        count++;
      }
    }

    // 4. Sessions
    if (Array.isArray(backup.sessions)) {
      for (const s of backup.sessions) {
        const item: LearningSession = {
          ...s,
          id: s.id.includes(userId) ? s.id : `${userId}_${s.id}`,
          userId,
        };
        const existing = await this.getById<LearningSession>('learningSessions', item.id, userId);
        if (existing) {
          await this.update('learningSessions', item.id, item, userId);
        } else {
          await this.create('learningSessions', item, userId);
        }
        count++;
      }
    }

    return { importedCount: count };
  }

  /**
   * Export the complete local database.
   */
  public async exportFullDatabase(): Promise<FullDatabaseBackup> {
    const getAll = async <T>(storeName: StoreName): Promise<T[]> => {
      return this.withStore(storeName, 'readonly', (store) => {
        return new Promise<T[]>((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result as T[]);
          req.onerror = () => reject(req.error);
        });
      });
    };

    const users = await getAll<User>('users');
    const books = await getAll<Book>('books');
    const lessons = await getAll<Lesson>('lessons');
    const words = await getAll<VocabularyWord>('words');
    const userWordProgress = await getAll<UserWordProgress>('userWordProgress');
    const learningSessions = await getAll<LearningSession>('learningSessions');
    const failedWords = await getAll<FailedWord>('failedWords');
    const appSettings = await getAll<AppSettings>('appSettings');

    return {
      version: DB_VERSION,
      exportedAt: Date.now(),
      appVersion: '2.0.0',
      data: {
        users,
        books,
        lessons,
        words,
        userWordProgress,
        learningSessions,
        failedWords,
        appSettings,
      },
    };
  }

  /**
   * Restore the complete local database from a full backup.
   */
  public async importFullDatabase(backup: FullDatabaseBackup): Promise<{ totalImported: number }> {
    if (!backup || !backup.data) {
      throw new ValidationError('backup', 'Invalid full database backup payload');
    }

    const { users, books, lessons, words, userWordProgress, learningSessions, failedWords, appSettings } =
      backup.data;

    let total = 0;

    const putAll = async <T extends { id: string }>(
      storeName: StoreName,
      items?: T[]
    ): Promise<void> => {
      if (!items || !items.length) return;
      await this.withStore(storeName, 'readwrite', (store) => {
        return new Promise<void>((resolve, reject) => {
          for (const item of items) {
            validateRecordForStore(storeName, item);
            store.put(item);
            total++;
          }
          resolve();
        });
      });
    };

    await putAll('users', users);
    await putAll('books', books);
    await putAll('lessons', lessons);
    await putAll('words', words);
    await putAll('userWordProgress', userWordProgress);
    await putAll('learningSessions', learningSessions);
    await putAll('failedWords', failedWords);
    await putAll('appSettings', appSettings);

    return { totalImported: total };
  }
}

// Global default singleton instance
export const dbManager = new IndexedDBManager();
