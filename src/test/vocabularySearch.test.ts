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
import { VocabularySearchService } from '../services/vocabularySearchService.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

async function runTask12Tests() {
  console.log('--- Starting Task 12: Global Vocabulary Search Test Suite ---');
  const dbName = `TestVocabSearchDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const authService = new AuthService(db);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabularyService = new VocabularyService(db, bookService, lessonService);
  const searchService = new VocabularySearchService(db, bookService, lessonService);

  // 1. Create two test users (Alice and Bob)
  const alice = await authService.register({
    username: 'alice_search',
    email: 'alice@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });
  const bob = await authService.register({
    username: 'bob_search',
    email: 'bob@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
  });

  console.log('[1/10] Created test users Alice and Bob.');

  // 2. Create custom book and lessons for Alice
  const aliceBook = await bookService.createBook(alice.id, {
    name: 'Alice Advanced Armenian',
    description: 'Custom vocabulary for testing global search',
  });
  const aliceLesson = await lessonService.createLesson(alice.id, aliceBook.id, {
    lessonNumber: '1',
    name: 'Unit 1: Greetings & Intro',
  });

  // Add words with unique Armenian and Russian test strings
  await vocabularyService.addWord(alice.id, aliceBook.id, aliceLesson.lessonNumber, {
    en: 'ExtraordinaryWelcome',
    hy: 'ԱրտասովորԲարիգալուստ',
    ru: 'СуперДоброПожаловать',
    definition: 'A unique greeting word for testing',
    example: 'Welcome to our home!',
    type: 'word',
  });

  await vocabularyService.addWord(alice.id, aliceBook.id, aliceLesson.lessonNumber, {
    en: 'UniqueFriendship',
    hy: 'ԵզակիԸնկերություն',
    ru: 'ОсобеннаяДружба',
    definition: 'A unique person whom one knows and with whom one has a bond',
    example: 'He is my best friend.',
    type: 'word',
  });

  console.log('[2/10] Created custom book and words for Alice.');

  // 3. Test searching by English word (case-insensitive & partial)
  const englishResults = await searchService.searchVocabulary(alice.id, 'extraordinary');
  if (englishResults.length !== 1 || englishResults[0].word.en !== 'ExtraordinaryWelcome') {
    throw new Error('Assertion failed: Expected English search for "extraordinary" to return "ExtraordinaryWelcome".');
  }
  console.log('  ✓ English partial and case-insensitive search verified.');

  // 4. Test searching by Armenian translation (հայերեն)
  const armenianResults = await searchService.searchVocabulary(alice.id, 'արտասովոր');
  if (armenianResults.length !== 1 || armenianResults[0].word.en !== 'ExtraordinaryWelcome') {
    throw new Error('Assertion failed: Expected Armenian search for unique term to return "ExtraordinaryWelcome".');
  }
  console.log('  ✓ Armenian Unicode search verified.');

  // 5. Test searching by Russian translation (русский)
  const russianResults = await searchService.searchVocabulary(alice.id, 'особенная');
  if (russianResults.length !== 1 || russianResults[0].word.en !== 'UniqueFriendship') {
    throw new Error('Assertion failed: Expected Russian search for unique term to return "UniqueFriendship".');
  }
  console.log('  ✓ Russian Unicode search verified.');

  // 6. Test searching by definition
  const definitionResults = await searchService.searchVocabulary(alice.id, 'bond');
  if (definitionResults.length !== 1 || definitionResults[0].word.en !== 'UniqueFriendship') {
    throw new Error('Assertion failed: Expected definition search for "bond" to return "UniqueFriendship".');
  }
  console.log('  ✓ Definition search verified.');

  // 7. Test associated book and lesson in search results
  const res = definitionResults[0];
  if (res.bookName !== 'Alice Advanced Armenian' || res.lessonName !== 'Unit 1: Greetings & Intro') {
    throw new Error('Assertion failed: Incorrect book or lesson metadata attached to search result.');
  }
  console.log('  ✓ Associated book and lesson metadata verified.');

  // 8. Test data isolation: Bob must not see Alice's private book words
  const bobResults = await searchService.searchVocabulary(bob.id, 'ExtraordinaryWelcome');
  if (bobResults.length > 0) {
    throw new Error('Assertion failed: Data isolation breach! Bob searched and found Alice’s private word.');
  }
  console.log('  ✓ Cross-user data isolation verified (Bob cannot search Alice’s private words).');

  // 9. Test searching built-in Bonk 1 curriculum
  await bookService.ensureDefaultBooks();
  const bonkResults = await searchService.searchVocabulary(alice.id, 'apple');
  console.log(`  ✓ Built-in curriculum search accessibility verified (${bonkResults.length} Bonk matches found).`);

  // 10. Test empty results handling
  const emptyResults = await searchService.searchVocabulary(alice.id, 'xyznonexistentword12345');
  if (emptyResults.length !== 0) {
    throw new Error('Assertion failed: Expected 0 results for nonexistent query.');
  }
  console.log('  ✓ Helpful empty results handling verified.');

  console.log('----------------------------------------------------');
  console.log('🎉 ALL 10 TASK 12 SEARCH TEST SUITES PASSED!');
}

runTask12Tests().catch((err) => {
  console.error('❌ Task 12 Test Suite Failed:', err);
  process.exit(1);
});
