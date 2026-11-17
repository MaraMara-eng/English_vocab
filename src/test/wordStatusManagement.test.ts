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
import { UserWordProgress } from '../db/types.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask17Tests() {
  console.log('--- Starting Task 17: Word Status Management & Reset Options Test Suite ---');
  const dbName = `TestWordStatusDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);

  // 1. Create test users
  const userA = await authService.register({
    username: 'reset_alice',
    email: 'reset_alice@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  const userB = await authService.register({
    username: 'reset_bob',
    email: 'reset_bob@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  console.log('[1/6] Created test users.');

  // 2. Create books, lessons, and words for Alice
  const bookA = await bookService.createBook(userA.id, {
    name: 'Reset Test Book',
    description: 'Testing progress reset logic',
  });
  const lesson1 = await lessonService.createLesson(userA.id, bookA.id, {
    lessonNumber: '1',
    name: 'Unit 1',
  });
  const lesson2 = await lessonService.createLesson(userA.id, bookA.id, {
    lessonNumber: '2',
    name: 'Unit 2',
  });

  const word1 = await vocabularyService.addWord(userA.id, bookA.id, lesson1.lessonNumber, {
    en: 'Cat',
    hy: 'Կատու',
    ru: 'Кошка',
  });
  const word2 = await vocabularyService.addWord(userA.id, bookA.id, lesson1.lessonNumber, {
    en: 'Dog',
    hy: 'Շուն',
    ru: 'Собака',
  });
  const word3 = await vocabularyService.addWord(userA.id, bookA.id, lesson2.lessonNumber, {
    en: 'Bird',
    hy: 'Թռչուն',
    ru: 'Птица',
  });
  console.log('[2/6] Created test book, lessons, and 3 words.');

  // 3. Mark words as known
  await vocabularyService.setWordKnownStatus(userA.id, word1.id, true);
  await vocabularyService.setWordKnownStatus(userA.id, word2.id, true);
  await vocabularyService.setWordKnownStatus(userA.id, word3.id, true);

  let progressList = await db.getUserBookProgress(userA.id, bookA.id);
  assert(progressList.length === 3, 'All 3 words should have progress records');
  assert(progressList.every((p) => p.isKnown), 'All words should be marked known');
  console.log('[3/6] Word known status setting verified.');

  // 4. Test resetting status of an individual word
  await vocabularyService.resetWordStatus(userA.id, word1.id);
  const prog1 = await db.getById<UserWordProgress>('userWordProgress', `${userA.id}:${bookA.id}:${word1.normalizedEn}`, userA.id);
  assert(prog1 === null, 'Individual word progress should be deleted on reset');
  console.log('[4/6] Individual word status reset verified.');

  // 5. Test resetting all word statuses in a selected lesson
  await vocabularyService.setWordKnownStatus(userA.id, word1.id, true); // restore word1
  await vocabularyService.resetLessonProgress(userA.id, bookA.id, lesson1.lessonNumber);
  const lesson1Words = await vocabularyService.getWordsForBookAndLesson(userA.id, bookA.id, lesson1.lessonNumber);
  for (const w of lesson1Words) {
    const p = await db.getById<UserWordProgress>('userWordProgress', `${userA.id}:${bookA.id}:${w.normalizedEn}`, userA.id);
    assert(p === null, 'Lesson progress should be fully reset');
  }
  // Lesson 2 progress should still exist
  const prog3 = await db.getById<UserWordProgress>('userWordProgress', `${userA.id}:${bookA.id}:${word3.normalizedEn}`, userA.id);
  assert(prog3 !== null && prog3.isKnown, 'Other lessons progress must remain unaffected');
  console.log('[5/6] Lesson progress reset verified.');

  // 6. Test resetting entire book progress and account progress without deleting vocabulary content
  await vocabularyService.resetBookProgress(userA.id, bookA.id);
  const bookProgressAfter = await db.getUserBookProgress(userA.id, bookA.id);
  assert(bookProgressAfter.length === 0, 'Book progress should be completely reset');

  // Verify vocabulary words, lessons, and book still exist (content is not deleted)
  const allWordsAfter = await vocabularyService.getWordsForBookAndLesson(userA.id, bookA.id);
  assert(allWordsAfter.length === 3, 'Vocabulary words content must NOT be deleted when resetting progress');
  console.log('[6/6] Book progress reset and vocabulary content preservation verified.');

  console.log('--- Task 17 Test Suite Passed Successfully! ---');
}

runTask17Tests().catch((err) => {
  console.error('Task 17 Test Failed:', err);
  process.exit(1);
});
