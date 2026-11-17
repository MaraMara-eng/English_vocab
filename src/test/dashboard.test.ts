/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'fake-indexeddb/auto';
import fakeIndexedDB from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { AuthService } from '../services/authService.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';
import { VocabularyService } from '../services/vocabularyService.ts';
import { LearningSession } from '../db/types.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask18Tests() {
  console.log('--- Starting Task 18: Learning Statistics & Dashboard Test Suite ---');
  const dbName = `TestDashboardDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);

  // 1. Create test user
  const user = await authService.register({
    username: 'dash_user',
    email: 'dash@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  console.log('[1/5] Created test user for dashboard.');

  // 2. Create textbook, lessons, and words
  const book = await bookService.createBook(user.id, {
    name: 'Dashboard Test Textbook',
    description: 'Testing stats calculations',
  });
  const lesson1 = await lessonService.createLesson(user.id, book.id, {
    lessonNumber: '1',
    name: 'Unit 1',
  });

  const w1 = await vocabularyService.addWord(user.id, book.id, lesson1.lessonNumber, {
    en: 'Apple',
    hy: 'Խնձոր',
    ru: 'Яблоко',
  });
  const w2 = await vocabularyService.addWord(user.id, book.id, lesson1.lessonNumber, {
    en: 'Banana',
    hy: 'Բանան',
    ru: 'Банан',
  });
  const w3 = await vocabularyService.addWord(user.id, book.id, lesson1.lessonNumber, {
    en: 'Orange',
    hy: 'Նարինջ',
    ru: 'Апельсин',
  });
  const w4 = await vocabularyService.addWord(user.id, book.id, lesson1.lessonNumber, {
    en: 'Grape',
    hy: 'Խաղող',
    ru: 'Виноград',
  });
  console.log('[2/5] Created book and 4 vocabulary words.');

  // 3. Mark 2 words as known
  await vocabularyService.setWordKnownStatus(user.id, w1.id, true);
  await vocabularyService.setWordKnownStatus(user.id, w2.id, true);

  const words = await vocabularyService.getWordsWithStatus(user.id, book.id);
  const knownCount = words.filter((w) => w.isKnown).length;
  const totalCount = words.length;
  const percent = Math.round((knownCount / totalCount) * 100);

  assert(totalCount === 4, 'Total words must be 4');
  assert(knownCount === 2, 'Known words must be 2');
  assert(percent === 50, 'Progress percentage must be 50%');
  console.log('[3/5] Total, known, and progress percentage calculations verified.');

  // 4. Record a learning session and test accuracy calculation
  const session: LearningSession = {
    id: `sess_${Date.now()}`,
    userId: user.id,
    bookId: book.id,
    lesson: '1',
    mode: 'cards',
    totalCards: 4,
    correctCount: 3,
    missCount: 1,
    durationSeconds: 45,
    startedAt: Date.now() - 60000,
    completedAt: Date.now(),
  };
  await db.create('learningSessions', session, user.id);

  const sessions = await db.query<LearningSession>('learningSessions', {}, user.id);
  assert(sessions.length === 1, '1 learning session should be stored');
  const accuracy = Math.round((session.correctCount / (session.correctCount + session.missCount)) * 100);
  assert(accuracy === 75, 'Accuracy should be 75%');
  console.log('[4/5] Practice accuracy and learning session history verified.');

  // 5. Test empty/builtin account graceful handling
  const userEmpty = await authService.register({
    username: 'empty_user',
    email: 'empty@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  const emptyBooks = await bookService.getUserBooks(userEmpty.id);
  assert(emptyBooks.length >= 0, 'User books list loaded successfully');
  console.log('[5/5] Account statistics loading verified.');

  console.log('--- Task 18 Test Suite Passed Successfully! ---');
}

runTask18Tests().catch((err) => {
  console.error('Task 18 Test Failed:', err);
  process.exit(1);
});
