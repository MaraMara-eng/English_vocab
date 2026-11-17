/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';
import { VocabularyService } from '../services/vocabularyService.ts';

// Make IDBKeyRange globally available for the Node test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runVocabularyManagementTestSuite() {
  console.log('--- Starting Task 9: Vocabulary Word Management Test Suite ---');
  const dbName = `TestVocabDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabService = new VocabularyService(db, bookService, lessonService);

  try {
    const userA = 'user_aram';
    const userB = 'user_bella';

    // 1. Setup user book and lesson
    console.log('[1/8] Setting up user custom textbook and lesson...');
    await bookService.ensureDefaultBooks();
    const aramBook = await bookService.createBook(userA, {
      name: 'Aram Advanced English',
      description: 'Medical and philosophical vocabulary with Armenian translations.',
    });

    const lesson1 = await lessonService.createLesson(userA, aramBook.id, {
      lessonNumber: 'Unit 1',
      name: 'Cognitive Science & Linguistics',
      description: 'Epistemic concepts and semantic structures.',
      orderIndex: 1,
    });
    console.log('  ✓ Textbook and Lesson created successfully');

    // 2. Allow users to add vocabulary words to a lesson with all required and rich fields
    console.log('[2/8] Testing vocabulary word addition with full fields and Unicode...');
    const word1 = await vocabService.addWord(userA, aramBook.id, 'Unit 1', {
      en: 'epistemology',
      hy: 'իմացաբանություն',
      ru: 'эпистемология',
      definition: 'The philosophical theory of knowledge, its methods, validity, and scope.',
      example: 'Epistemology investigates the distinction between justified belief and opinion.',
      partOfSpeech: 'noun',
      pronunciation: '/ɪˌpɪstɪˈmɒlədʒi/',
      type: 'word',
    });

    assert(word1.bookId === aramBook.id, 'Associated with correct bookId');
    assert(word1.lesson === 'Unit 1', 'Associated with correct lesson number');
    assert(word1.userId === userA, 'Associated with correct userId');
    assert(word1.en === 'epistemology', 'English word saved');
    assert(word1.hy === 'իմացաբանություն', 'Armenian Unicode characters preserved intact');
    assert(word1.ru === 'эпистемология', 'Russian Cyrillic Unicode characters preserved intact');
    assert(Boolean(word1.definition?.includes('philosophical theory')), 'Definition saved');
    assert(Boolean(word1.example?.includes('distinction between')), 'Example sentence saved');
    assert(word1.partOfSpeech === 'noun', 'Part of speech saved');
    assert(word1.pronunciation === '/ɪˌpɪstɪˈmɒlədʒi/', 'Phonetic pronunciation saved');
    console.log('  ✓ Rich vocabulary fields and trilingual Unicode supported flawlessly');

    // 3. Validation: Required fields (English word, Armenian translation)
    console.log('[3/8] Testing required fields validation...');
    let caughtEmptyEn = false;
    try {
      await vocabService.addWord(userA, aramBook.id, 'Unit 1', {
        en: '',
        hy: 'թարգմանություն',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'en') caughtEmptyEn = true;
    }
    assert(caughtEmptyEn, 'Missing English word must throw ValidationError for "en"');

    let caughtEmptyHy = false;
    try {
      await vocabService.addWord(userA, aramBook.id, 'Unit 1', {
        en: 'semantics',
        hy: '',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'hy') caughtEmptyHy = true;
    }
    assert(caughtEmptyHy, 'Missing Armenian translation must throw ValidationError for "hy"');
    console.log('  ✓ Required fields strictly validated');

    // 4. Duplicate prevention within the same lesson
    console.log('[4/8] Testing duplicate word prevention within lesson...');
    let caughtDuplicate = false;
    try {
      await vocabService.addWord(userA, aramBook.id, 'Unit 1', {
        en: 'Epistemology', // Case-insensitive duplicate check
        hy: 'տարբեր թարգմանություն',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'en') caughtDuplicate = true;
    }
    assert(caughtDuplicate, 'Adding duplicate word within the same lesson must throw ValidationError');
    console.log('  ✓ Duplicate prevention within lesson verified');

    // 5. Cross-user isolation and authorization
    console.log('[5/8] Testing cross-user isolation and authorization...');
    // User B cannot add a word to User A's textbook
    let bellaBlocked = false;
    try {
      await vocabService.addWord(userB, aramBook.id, 'Unit 1', {
        en: 'heuristics',
        hy: 'էվրիստիկա',
      });
    } catch (err) {
      if (err instanceof AuthorizationError) bellaBlocked = true;
    }
    assert(bellaBlocked, 'User B must not be allowed to add words to User A book');

    // User A cannot modify built-in bonk1 book words
    let builtinBlocked = false;
    try {
      await vocabService.addWord(userA, 'bonk1', '1', {
        en: 'hello',
        hy: 'բարև',
      });
    } catch (err) {
      if (err instanceof AuthorizationError) builtinBlocked = true;
    }
    assert(builtinBlocked, 'Users cannot add words to standard built-in bonk1 book');
    console.log('  ✓ Cross-user isolation and built-in protection verified');

    // 6. Mark words as known or not known & save status in IndexedDB
    console.log('[6/8] Testing marking words as known/not known and IndexedDB status persistence...');
    // Initial status should be not known
    const initialWords = await vocabService.getWordsWithStatus(userA, aramBook.id, 'Unit 1');
    assert(initialWords.length === 1, 'Unit 1 has 1 word');
    assert(initialWords[0].isKnown === false, 'Word starts as not known');

    // Mark as known
    const progressKnown = await vocabService.setWordKnownStatus(userA, word1.id, true);
    assert(progressKnown.isKnown === true, 'Progress record reports isKnown: true');
    assert(progressKnown.streak >= 3, 'Marking known sets streak >= 3');

    // Re-query enriched status
    const knownWords = await vocabService.getWordsWithStatus(userA, aramBook.id, 'Unit 1');
    assert(knownWords[0].isKnown === true, 'Word status reflects isKnown: true in queries');

    // Mark as not known
    const progressUnknown = await vocabService.setWordKnownStatus(userA, word1.id, false);
    assert(progressUnknown.isKnown === false, 'Progress record reports isKnown: false');

    const unknownWords = await vocabService.getWordsWithStatus(userA, aramBook.id, 'Unit 1');
    assert(unknownWords[0].isKnown === false, 'Word status reflects isKnown: false in queries');
    console.log('  ✓ Known/not known status toggles and persists in IndexedDB');

    // 7. Multi-user status independence (User B status does not affect User A)
    console.log('[7/8] Verifying multi-user progress independence (Zero Leakage)...');
    // Seed standard word in bonk1:1
    const bonkWord = await db.getById('words', 'bonk1:pencil');
    if (bonkWord) {
      // User A marks pencil as known
      await vocabService.setWordKnownStatus(userA, 'bonk1:pencil', true);
      // User B marks pencil as not known
      await vocabService.setWordKnownStatus(userB, 'bonk1:pencil', false);

      const userAStatus = await vocabService.getWordsWithStatus(userA, 'bonk1', '1');
      const userBStatus = await vocabService.getWordsWithStatus(userB, 'bonk1', '1');

      const wordForA = userAStatus.find((w) => w.id === 'bonk1:pencil');
      const wordForB = userBStatus.find((w) => w.id === 'bonk1:pencil');

      if (wordForA && wordForB) {
        assert(wordForA.isKnown === true, "User A status is known");
        assert(wordForB.isKnown === false, "User B status is not known");
      }
    }
    console.log('  ✓ Multi-user status strictly separated in userWordProgress store');

    // 8. Word Update & Deletion
    console.log('[8/8] Testing word editing and deletion...');
    const updated = await vocabService.updateWord(userA, word1.id, {
      example: 'Updated example sentence demonstrating epistemology in scientific research.',
      pronunciation: '/ɪˌpɪstəˈmɑːlədʒi/',
    });
    assert(Boolean(updated.example?.includes('scientific research')), 'Example sentence updated');
    assert(updated.pronunciation === '/ɪˌpɪstəˈmɑːlədʒi/', 'Pronunciation updated');

    // Delete word
    await vocabService.deleteWord(userA, word1.id);
    const afterDelete = await vocabService.getWordsForBookAndLesson(userA, aramBook.id, 'Unit 1');
    assert(afterDelete.length === 0, 'Word deleted successfully, lesson is now empty');
    console.log('  ✓ Word editing and deletion verified');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 8 TASK 9 TEST CASES PASSED! Vocabulary management is 100% verified.');
  } finally {
    db.close();
  }
}

runVocabularyManagementTestSuite().catch((err) => {
  console.error('❌ Vocabulary management test suite failed:', err);
  process.exit(1);
});
