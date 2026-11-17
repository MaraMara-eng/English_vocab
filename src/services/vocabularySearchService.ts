/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { Book, Lesson, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { bookService, BookService } from './bookService.ts';
import { lessonService, LessonService } from './lessonService.ts';

export interface GlobalSearchResult {
  word: VocabularyWord;
  bookId: string;
  bookName: string;
  bookIsBuiltin: boolean;
  lessonId: string;
  lessonNumber: string;
  lessonName: string;
  isKnown: boolean;
  streak: number;
  failCount: number;
  matchedFields: ('english' | 'armenian' | 'russian' | 'definition')[];
  matchScore: number;
}

export interface SearchOptions {
  bookId?: string;
  filterStatus?: 'all' | 'known' | 'learning';
  limit?: number;
}

export class VocabularySearchService {
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
    this.lessonService =
      customLessonService || (db === dbManager ? lessonService : new LessonService(db, this.bookService));
  }

  /**
   * Search across all books and lessons accessible to the specified user.
   * Strictly enforces data isolation so other users' books and vocabulary are never searched or returned.
   */
  public async searchVocabulary(
    userId: string,
    rawQuery: string,
    options: SearchOptions = {}
  ): Promise<GlobalSearchResult[]> {
    if (!userId) return [];

    const query = (rawQuery || '').trim().toLocaleLowerCase();

    // 1. Fetch all books accessible to the current user (built-in + owned custom books)
    const accessibleBooks = await this.bookService.getUserBooks(userId);
    if (accessibleBooks.length === 0) return [];

    const bookMap = new Map<string, Book>();
    accessibleBooks.forEach((b) => bookMap.set(b.id, b));

    // Optional filter by a specific book
    const targetBookIds = options.bookId
      ? options.bookId === 'all'
        ? Array.from(bookMap.keys())
        : [options.bookId]
      : Array.from(bookMap.keys());

    // 2. Load all lessons for accessible books to resolve lesson titles
    const allLessons = await this.db.query<Lesson>('lessons', {});
    const lessonMap = new Map<string, Lesson>();
    allLessons.forEach((l) => {
      if (bookMap.has(l.bookId)) {
        lessonMap.set(`${l.bookId}:${l.lessonNumber}`, l);
        lessonMap.set(l.id, l);
      }
    });

    // 3. Load all vocabulary words and filter strictly to user's accessible books
    const allWords = await this.db.query<VocabularyWord>('words', {});
    const candidateWords = allWords.filter((w) => {
      if (!targetBookIds.includes(w.bookId)) return false;
      const book = bookMap.get(w.bookId);
      if (!book) return false;

      // Crucial data isolation guard:
      // If book is not builtin and not created by 'system', it MUST belong to userId
      if (!book.isBuiltin && book.createdBy !== 'system' && book.createdBy !== userId) {
        return false;
      }
      // If word has a userId assigned on a custom book, it must match current user
      if (w.userId && w.userId !== userId && !book.isBuiltin && book.createdBy !== 'system') {
        return false;
      }
      return true;
    });

    // 4. Load user's learning progress for status indicators
    const userProgress = await this.db.query<UserWordProgress>('userWordProgress', {}, userId);
    const progressMap = new Map<string, UserWordProgress>();
    userProgress.forEach((p) => {
      progressMap.set(`${p.bookId}:${p.wordKey}`, p);
      progressMap.set(`${p.bookId}:${p.wordId}`, p);
    });

    // If query is empty, return initial slice or empty array based on caller preference
    if (!query) {
      if (options.filterStatus && options.filterStatus !== 'all') {
        // Allow browsing by status even without text query
        return candidateWords
          .map((w) => this.enrichWordResult(w, bookMap, lessonMap, progressMap, [], 0))
          .filter((res) => {
            if (options.filterStatus === 'known') return res.isKnown;
            if (options.filterStatus === 'learning') return !res.isKnown;
            return true;
          })
          .slice(0, options.limit || 50);
      }
      return [];
    }

    const tokens = query.split(/\s+/).filter(Boolean);

    // 5. Evaluate matches across English, Armenian, Russian, and Definition
    const results: GlobalSearchResult[] = [];

    for (const word of candidateWords) {
      const en = (word.english || word.en || '').trim().toLocaleLowerCase();
      const hy = (word.armenian || word.hy || '').trim().toLocaleLowerCase();
      const ru = (word.russian || word.ru || '').trim().toLocaleLowerCase();
      const def = (word.definition || '').trim().toLocaleLowerCase();

      const matchedFields: ('english' | 'armenian' | 'russian' | 'definition')[] = [];
      let score = 0;

      // Exact matches (highest relevance)
      if (en === query) {
        matchedFields.push('english');
        score += 120;
      } else if (en.startsWith(query)) {
        matchedFields.push('english');
        score += 70;
      } else if (en.includes(query)) {
        matchedFields.push('english');
        score += 40;
      }

      if (hy === query) {
        if (!matchedFields.includes('armenian')) matchedFields.push('armenian');
        score += 110;
      } else if (hy.startsWith(query)) {
        if (!matchedFields.includes('armenian')) matchedFields.push('armenian');
        score += 65;
      } else if (hy.includes(query)) {
        if (!matchedFields.includes('armenian')) matchedFields.push('armenian');
        score += 35;
      }

      if (ru) {
        if (ru === query) {
          if (!matchedFields.includes('russian')) matchedFields.push('russian');
          score += 100;
        } else if (ru.startsWith(query)) {
          if (!matchedFields.includes('russian')) matchedFields.push('russian');
          score += 60;
        } else if (ru.includes(query)) {
          if (!matchedFields.includes('russian')) matchedFields.push('russian');
          score += 30;
        }
      }

      if (def) {
        if (def === query) {
          if (!matchedFields.includes('definition')) matchedFields.push('definition');
          score += 80;
        } else if (def.includes(query)) {
          if (!matchedFields.includes('definition')) matchedFields.push('definition');
          score += 25;
        }
      }

      // If multi-token query and no full phrase match, check if all tokens match across the fields
      if (matchedFields.length === 0 && tokens.length > 1) {
        const allTokensMatch = tokens.every((token) => {
          let tokenMatched = false;
          if (en.includes(token)) {
            if (!matchedFields.includes('english')) matchedFields.push('english');
            tokenMatched = true;
          }
          if (hy.includes(token)) {
            if (!matchedFields.includes('armenian')) matchedFields.push('armenian');
            tokenMatched = true;
          }
          if (ru && ru.includes(token)) {
            if (!matchedFields.includes('russian')) matchedFields.push('russian');
            tokenMatched = true;
          }
          if (def && def.includes(token)) {
            if (!matchedFields.includes('definition')) matchedFields.push('definition');
            tokenMatched = true;
          }
          return tokenMatched;
        });

        if (allTokensMatch) {
          score += 20 * tokens.length;
        } else {
          // Incomplete token match, discard
          continue;
        }
      }

      if (matchedFields.length > 0) {
        const enriched = this.enrichWordResult(word, bookMap, lessonMap, progressMap, matchedFields, score);

        // Apply status filter if specified
        if (options.filterStatus === 'known' && !enriched.isKnown) {
          continue;
        }
        if (options.filterStatus === 'learning' && enriched.isKnown) {
          continue;
        }

        results.push(enriched);
      }
    }

    // 6. Sort results by relevance score descending, then alphabetically by English word
    results.sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return a.word.en.localeCompare(b.word.en);
    });

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  private enrichWordResult(
    word: VocabularyWord,
    bookMap: Map<string, Book>,
    lessonMap: Map<string, Lesson>,
    progressMap: Map<string, UserWordProgress>,
    matchedFields: ('english' | 'armenian' | 'russian' | 'definition')[],
    score: number
  ): GlobalSearchResult {
    const book = bookMap.get(word.bookId);
    const bookName = book ? book.name : word.bookId;
    const bookIsBuiltin = Boolean(book?.isBuiltin || book?.createdBy === 'system');

    const cleanLessonNum = String(word.lesson || '').trim();
    const lessonKey1 = `${word.bookId}:${cleanLessonNum}`;
    const lessonKey2 = word.lessonId;
    const lesson = lessonMap.get(lessonKey1) || (lessonKey2 ? lessonMap.get(lessonKey2) : undefined);

    const lessonName = lesson ? lesson.name : `Lesson ${cleanLessonNum || '1'}`;

    // Lookup user progress
    const normKey = word.normalizedEn || (word.en || '').toLowerCase().trim();
    const progress =
      progressMap.get(`${word.bookId}:${normKey}`) ||
      progressMap.get(`${word.bookId}:${word.id}`) ||
      progressMap.get(word.id);

    return {
      word,
      bookId: word.bookId,
      bookName,
      bookIsBuiltin,
      lessonId: word.lessonId,
      lessonNumber: cleanLessonNum || '1',
      lessonName,
      isKnown: progress ? progress.isKnown : false,
      streak: progress ? progress.streak : 0,
      failCount: progress ? progress.failCount : 0,
      matchedFields,
      matchScore: score,
    };
  }
}

export const vocabularySearchService = new VocabularySearchService();
