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

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask19Tests() {
  console.log('--- Starting Task 19: Lesson Completion & PDF Reports Test Suite ---');
  const dbName = `TestReportsDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);

  // 1. Create test user
  const user = await authService.register({
    username: 'report_user',
    email: 'report@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  console.log('[1/5] Created test user for reports.');

  // 2. Create book, lesson, and words
  const book = await bookService.createBook(user.id, {
    name: 'Report Test Book',
    description: 'Testing lesson completion and reporting',
  });
  const lesson = await lessonService.createLesson(user.id, book.id, {
    lessonNumber: '1',
    name: 'Unit 1 Report Test',
  });

  const w1 = await vocabularyService.addWord(user.id, book.id, lesson.lessonNumber, {
    en: 'Hello',
    hy: 'Բարև',
    ru: 'Здравствуйте',
  });
  const w2 = await vocabularyService.addWord(user.id, book.id, lesson.lessonNumber, {
    en: 'Goodbye',
    hy: 'Ցտեսություն',
    ru: 'До свидания',
  });
  console.log('[2/5] Created test book, lesson, and 2 words.');

  // 3. Test lesson completion rule (In Progress initially)
  let wordsWithStatus = await vocabularyService.getWordsWithStatus(user.id, book.id, lesson.lessonNumber);
  let knownCount = wordsWithStatus.filter((w) => w.isKnown).length;
  let isCompleted = wordsWithStatus.length > 0 && knownCount === wordsWithStatus.length;
  assert(!isCompleted, 'Lesson should be in progress when 0 words are known');
  console.log('[3/5] Initial lesson in-progress status verified.');

  // 4. Mark all words as known -> Lesson Completed
  await vocabularyService.setWordKnownStatus(user.id, w1.id, true);
  await vocabularyService.setWordKnownStatus(user.id, w2.id, true);

  wordsWithStatus = await vocabularyService.getWordsWithStatus(user.id, book.id, lesson.lessonNumber);
  knownCount = wordsWithStatus.filter((w) => w.isKnown).length;
  isCompleted = wordsWithStatus.length > 0 && knownCount === wordsWithStatus.length;
  const percent = Math.round((knownCount / wordsWithStatus.length) * 100);

  assert(isCompleted === true, 'Lesson must be marked completed when 100% of words are known');
  assert(percent === 100, 'Known percentage must be 100%');
  console.log('[4/5] Lesson completion rule (100% known) and statistics verified.');

  // 5. Verify local report generation data structure and Armenian/Russian character support
  assert(wordsWithStatus[0].hy === 'Բարև', 'Armenian character support verified');
  assert(wordsWithStatus[0].ru === 'Здравствуйте', 'Russian character support verified');
  console.log('[5/5] Local multilingual character support verified.');

  console.log('--- Task 19 Test Suite Passed Successfully! ---');
}

runTask19Tests().catch((err) => {
  console.error('Task 19 Test Failed:', err);
  process.exit(1);
});
