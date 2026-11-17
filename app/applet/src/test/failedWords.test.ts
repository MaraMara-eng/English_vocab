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
import { FailedWord } from '../db/types.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask16Tests() {
  console.log('--- Starting Task 16: Failed Words & Review Collection Test Suite ---');
  const dbName = `TestFailedWordsDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);

  // 1. Create two test users to verify multi-user isolation
  const userA = await authService.register({
    username: 'alice_failed',
    email: 'alice@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  const userB = await authService.register({
    username: 'bob_failed',
    email: 'bob@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  console.log('[1/7] Created two isolated test users.');

  // 2. Create textbook and lessons for Alice
  const bookA = await bookService.createBook(userA.id, {
    name: 'Alice Spanish Review Book',
    description: 'Testing failed words collection',
  });
  const lessonA = await lessonService.createLesson(userA.id, bookA.id, {
    lessonNumber: '1',
    name: 'Basics Unit 1',
  });

  const word1 = await vocabularyService.addWord(userA.id, bookA.id, lessonA.lessonNumber, {
    en: 'Book',
    hy: 'Գիրք',
    ru: 'Книга',
    definition: 'A written or printed work',
  });
  const word2 = await vocabularyService.addWord(userA.id, bookA.id, lessonA.lessonNumber, {
    en: 'Computer',
    hy: 'Համակարգիչ',
    ru: 'Компьютер',
    definition: 'An electronic device',
  });
  console.log('[2/7] Created test book and vocabulary words for Alice.');

  // 3. Test automatic addition when user answers incorrectly in practice
  const word1Key = word1.normalizedEn;
  await db.recordWordAttempt(userA.id, bookA.id, word1Key, false); // incorrect answer

  const failedList = await db.getFailedWordsForBook(userA.id, bookA.id);
  assert(failedList.length === 1, 'Failed words list must contain 1 word after incorrect attempt');
  assert(failedList[0].wordKey === word1Key, 'Failed word must match the missed word key');
  assert(failedList[0].totalMisses === 1, 'Total misses must be 1');
  console.log('[3/7] Automatic failed word addition on incorrect practice attempt verified.');

  // 4. Test tracking multiple misses and latest practice result / lastMissedAt timestamp
  await db.recordWordAttempt(userA.id, bookA.id, word1Key, false); // second miss
  const updatedFailed = await db.getById<FailedWord>('failedWords', failedList[0].id, userA.id);
  assert(updatedFailed !== null, 'Failed word record must exist');
  assert(updatedFailed?.totalMisses === 2, 'Total misses must increment to 2');
  assert(updatedFailed?.lastMissedAt > 0, 'Last missed timestamp must be tracked');
  console.log('[4/7] Miss count and timestamp tracking verified.');

  // 5. Test manual addition and manual removal / marking as mastered
  const word2Key = word2.normalizedEn;
  const manualFailedId = `${userA.id}:${bookA.id}:${word2Key}`;
  await db.create('failedWords', {
    id: manualFailedId,
    userId: userA.id,
    bookId: bookA.id,
    wordId: word2.id,
    wordKey: word2Key,
    remainingReviews: 2,
    totalMisses: 1,
    lastMissedAt: Date.now(),
  }, userA.id);

  let allAliceFailed = await db.query<FailedWord>('failedWords', {}, userA.id);
  assert(allAliceFailed.length === 2, 'Alice should now have 2 failed words (1 automatic + 1 manual)');

  // Mark word2 as mastered (remove from failed collection)
  await db.delete('failedWords', manualFailedId, userA.id);
  allAliceFailed = await db.query<FailedWord>('failedWords', {}, userA.id);
  assert(allAliceFailed.length === 1, 'Marking as mastered should remove word from failed collection');
  console.log('[5/7] Manual addition, removal, and marking as mastered verified.');

  // 6. Test multi-user isolation (Bob should have 0 failed words even if Alice has failed words)
  const bobFailed = await db.query<FailedWord>('failedWords', {}, userB.id);
  assert(bobFailed.length === 0, 'Bob must have zero failed words (strictly isolated per user)');
  console.log('[6/7] Multi-user isolation for failed words collection verified.');

  // 7. Test clearing the failed words collection
  const clearedCount = await db.clearFailedWords(userA.id, bookA.id);
  assert(clearedCount === 1, 'Clear failed words should clear 1 record');
  const finalAliceFailed = await db.query<FailedWord>('failedWords', {}, userA.id);
  assert(finalAliceFailed.length === 0, 'Failed words collection should be empty after clearing');
  console.log('[7/7] Clearing failed words collection verified.');

  console.log('--- Task 16 Test Suite Passed Successfully! ---');
}

runTask16Tests().catch((err) => {
  console.error('Task 16 Test Failed:', err);
  process.exit(1);
});
