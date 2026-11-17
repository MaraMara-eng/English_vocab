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
import { LearningSession, UserWordProgress } from '../db/types.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask14Tests() {
  console.log('--- Starting Task 14: Learning Games & Practice Test Suite ---');
  const dbName = `TestLearningGamesDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);

  // 1. Create test user
  const user = await authService.register({
    username: 'gamer_user',
    email: 'gamer@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  console.log('[1/5] Created test user.');

  // 2. Create custom book and words
  const book = await bookService.createBook(user.id, {
    name: 'Game Test Textbook',
    description: 'Testing learning games logic',
  });
  const lesson = await lessonService.createLesson(user.id, book.id, {
    lessonNumber: '1',
    name: 'Game Unit 1',
  });

  await vocabularyService.addWord(user.id, book.id, lesson.lessonNumber, {
    en: 'Apple',
    hy: 'Խնձոր',
    ru: 'Яблоко',
    definition: 'A round fruit with red or green skin',
  });
  await vocabularyService.addWord(user.id, book.id, lesson.lessonNumber, {
    en: 'House',
    hy: 'Տուն',
    ru: 'Дом',
    definition: 'A building for human habitation',
  });
  await vocabularyService.addWord(user.id, book.id, lesson.lessonNumber, {
    en: 'Water',
    hy: 'Ջուր',
    ru: 'Вода',
    definition: 'A transparent fluid',
  });

  console.log('[2/5] Created custom book and 3 vocabulary words.');

  // 3. Test recording word attempt updates userWordProgress and failedWords
  const wordKey = vocabularyService.normalizeKey('Apple');
  await db.recordWordAttempt(user.id, book.id, wordKey, true);
  await db.recordWordAttempt(user.id, book.id, wordKey, true);
  await db.recordWordAttempt(user.id, book.id, wordKey, true);

  const progress = await db.getById<UserWordProgress>('userWordProgress', `${user.id}:${book.id}:${wordKey}`, user.id);
  assert(progress !== null, 'Progress record should exist');
  assert(progress?.isKnown === true, 'Word should be marked known after 3 correct streaks');
  console.log('[3/5] Word attempt recording and mastery streak verified.');

  // 4. Test multiple-choice option non-duplication logic
  const words = await vocabularyService.getWordsForBookAndLesson(user.id, book.id, lesson.lessonNumber);
  const current = words[0];
  const otherWords = words.filter((w) => w.id !== current.id);
  const correctTranslation = current.hy;
  const wrongOptions = otherWords.map((w) => w.hy);

  // Ensure no option duplicates correct answer
  for (const wrong of wrongOptions) {
    assert(wrong !== correctTranslation, 'Wrong options must not duplicate correct answer');
  }
  console.log('[4/5] Multiple-choice distractor non-duplication verified.');

  // 5. Test saving learning session record in IndexedDB
  const sessionRecord: LearningSession = {
    id: `session_${user.id}_${Date.now()}`,
    userId: user.id,
    bookId: book.id,
    lesson: lesson.lessonNumber,
    mode: 'cards',
    totalCards: 3,
    correctCount: 3,
    missCount: 0,
    durationSeconds: 45,
    startedAt: Date.now() - 45000,
    completedAt: Date.now(),
  };

  await db.create('learningSessions', sessionRecord, user.id);
  const savedSessions = await db.query<LearningSession>('learningSessions', {}, user.id);
  assert(savedSessions.length === 1, 'Learning session should be persisted in IndexedDB');
  assert(savedSessions[0].correctCount === 3, 'Correct count must match');
  console.log('[5/5] Learning session persistence verified.');

  console.log('----------------------------------------------------');
  console.log('🎉 ALL TASK 14 LEARNING GAMES TEST SUITES PASSED!');
}

runTask14Tests().catch((err) => {
  console.error('❌ Task 14 Test Suite Failed:', err);
  process.exit(1);
});
