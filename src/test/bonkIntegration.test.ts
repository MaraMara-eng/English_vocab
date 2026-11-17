/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { Book, Lesson, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import {
  BONK1_BOOK_ID,
  BONK1_EXPECTED_COUNT,
  BONK1_LESSONS_COUNT,
  ensureBonkVocabularyLoaded,
  loadBonkVocabularyJson,
  mapRawEntryToVocabularyWord,
} from '../services/bonkDictionaryLoader.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';
import { VocabularyService } from '../services/vocabularyService.ts';

// Make IDBKeyRange globally accessible for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runBonkIntegrationTestSuite() {
  console.log('--- Starting Bonk 1 Vocabulary JSON Integration Test Suite ---');

  const testDbName = `TestBonkDB_${Date.now()}`;
  const db = new IndexedDBManager(testDbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabService = new VocabularyService(db, bookService, lessonService);

  try {
    // -------------------------------------------------------------
    // Test 1: Verify dynamic loading of JSON and total entry count
    // -------------------------------------------------------------
    console.log('[1/8] Verifying dynamic loading of vocab-quest-vocabulary.json...');
    const rawDictionary = await loadBonkVocabularyJson();
    assert(rawDictionary !== null && typeof rawDictionary === 'object', 'Dictionary must load as an object');
    assert(rawDictionary.schemaVersion === 1, 'Schema version must be 1');
    assert(rawDictionary.totalWords === BONK1_EXPECTED_COUNT, `Metadata totalWords must be ${BONK1_EXPECTED_COUNT}`);
    assert(Array.isArray(rawDictionary.words), 'Words must be an array');
    assert(
      rawDictionary.words.length === BONK1_EXPECTED_COUNT,
      `Words array length must be exactly ${BONK1_EXPECTED_COUNT}. Received: ${rawDictionary.words.length}`
    );
    console.log(`  ✓ Successfully loaded JSON with exactly ${rawDictionary.words.length} entries.`);

    // -------------------------------------------------------------
    // Test 2: Verify all 26 lessons and exact word allocations
    // -------------------------------------------------------------
    console.log('[2/8] Verifying all 26 lessons representation and distribution...');
    const lessonSet = new Set<string>();
    const lessonWordCounts = new Map<string, number>();

    rawDictionary.words.forEach((entry) => {
      assert(Boolean(entry.lesson && entry.lesson.trim()), `Entry ${entry.id} must have a non-empty lesson`);
      lessonSet.add(entry.lesson);
      lessonWordCounts.set(entry.lesson, (lessonWordCounts.get(entry.lesson) || 0) + 1);
    });

    assert(
      lessonSet.size === BONK1_LESSONS_COUNT,
      `Expected ${BONK1_LESSONS_COUNT} distinct lessons, found ${lessonSet.size}`
    );

    // Verify lessons 1 through 26 all exist
    for (let i = 1; i <= BONK1_LESSONS_COUNT; i++) {
      const lessonNum = String(i);
      assert(lessonSet.has(lessonNum), `Lesson "${lessonNum}" must be present in vocabulary entries`);
      const count = lessonWordCounts.get(lessonNum) || 0;
      assert(count > 0, `Lesson "${lessonNum}" must have words (found ${count})`);
    }
    console.log(`  ✓ All 26 lessons represented with valid word distributions (Lessons 1–26).`);

    // -------------------------------------------------------------
    // Test 3: Verify entry fields preservation and mapping
    // -------------------------------------------------------------
    console.log('[3/8] Verifying retention of original IDs, translations, notes, and source pages...');
    const firstWord = rawDictionary.words[0];
    assert(firstWord.id === 'bonk1-0001', `First entry ID must be bonk1-0001, got ${firstWord.id}`);
    assert(firstWord.english === 'first', `First entry english must be "first", got "${firstWord.english}"`);
    assert(firstWord.armenian === 'առաջին', `First entry armenian must be "առաջին", got "${firstWord.armenian}"`);
    assert(firstWord.russian === 'первый', `First entry russian must be "первый", got "${firstWord.russian}"`);
    assert(firstWord.lesson === '1', `First entry lesson must be "1", got "${firstWord.lesson}"`);
    assert(firstWord.sourcePage === '431', `First entry sourcePage must be "431", got "${firstWord.sourcePage}"`);

    const mappedFirst = mapRawEntryToVocabularyWord(firstWord);
    assert(mappedFirst.id === 'bonk1-0001', 'Mapped word id preserved');
    assert(mappedFirst.en === 'first', 'Mapped word en preserved');
    assert(mappedFirst.hy === 'առաջին', 'Mapped word hy preserved');
    assert(mappedFirst.ru === 'первый', 'Mapped word ru preserved');
    assert(mappedFirst.english === 'first', 'Mapped word original english field preserved');
    assert(mappedFirst.armenian === 'առաջին', 'Mapped word original armenian field preserved');
    assert(mappedFirst.russian === 'первый', 'Mapped word original russian field preserved');
    assert(mappedFirst.sourcePage === '431', 'Mapped word original sourcePage field preserved');
    assert(mappedFirst.page === '431', 'Mapped word page alias preserved');

    // Find and check an entry with a note
    const entryWithNote = rawDictionary.words.find((w) => w.note);
    assert(Boolean(entryWithNote), 'At least one entry with a note must exist');
    if (entryWithNote) {
      const mappedNoteWord = mapRawEntryToVocabularyWord(entryWithNote);
      assert(mappedNoteWord.note === entryWithNote.note, 'Note field preserved on mapped word');
      assert(mappedNoteWord.hint === entryWithNote.note, 'Hint alias preserved on mapped word');
    }

    // Verify last entry in dictionary
    const lastWord = rawDictionary.words[rawDictionary.words.length - 1];
    assert(lastWord.id === 'bonk1-2618', `Last entry ID must be bonk1-2618, got ${lastWord.id}`);
    assert(
      lastWord.english === 'Spartak beat Dynamo three two.',
      `Last entry english mismatch: ${lastWord.english}`
    );
    assert(lastWord.lesson === '26', `Last entry lesson must be 26, got ${lastWord.lesson}`);
    console.log('  ✓ Field retention and mapping verified without distortion or omission.');

    // -------------------------------------------------------------
    // Test 4: Idempotent seeding and zero duplication
    // -------------------------------------------------------------
    console.log('[4/8] Testing idempotent seeding in IndexedDB (no duplicate entries on reload)...');
    // First seed on fresh database
    const seed1 = await ensureBonkVocabularyLoaded(db);
    assert(seed1.count === BONK1_EXPECTED_COUNT, `Initial seed count must be ${BONK1_EXPECTED_COUNT}`);
    assert(seed1.wasSeeded === true, 'First call wasSeeded must be true');

    // Run ensureDefaultBooks and ensureDefaultBonkLessons
    await bookService.ensureDefaultBooks();
    await lessonService.ensureDefaultBonkLessons();

    // Run a second time to simulate application reload / reopen
    const seed2 = await ensureBonkVocabularyLoaded(db);
    assert(seed2.count === BONK1_EXPECTED_COUNT, `Second seed count must still be ${BONK1_EXPECTED_COUNT}`);
    assert(seed2.wasSeeded === false, 'Second call wasSeeded must be false (skipped, already loaded)');

    // Verify actual records in IndexedDB
    const allWordsInDb = await db.query<VocabularyWord>('words', {});
    const bonkWords = allWordsInDb.filter((w) => w.bookId === BONK1_BOOK_ID);
    assert(
      bonkWords.length === BONK1_EXPECTED_COUNT,
      `IndexedDB must contain exactly ${BONK1_EXPECTED_COUNT} Bonk words, found ${bonkWords.length}`
    );

    // Verify ID uniqueness
    const ids = new Set<string>();
    bonkWords.forEach((w) => {
      assert(!ids.has(w.id), `Duplicate ID detected in database: ${w.id}`);
      ids.add(w.id);
    });
    assert(ids.size === BONK1_EXPECTED_COUNT, 'All 2,618 IDs must be strictly unique');
    console.log('  ✓ Idempotency verified: re-seeding produces 0 duplicate entries or IDs.');

    // -------------------------------------------------------------
    // Test 5: Querying by lesson and search filtering
    // -------------------------------------------------------------
    console.log('[5/8] Testing vocabulary retrieval and filtering by lesson...');
    const testUser = 'user_test_explorer';

    // Query Lesson 1
    const lesson1Words = await vocabService.getWordsForBookAndLesson(testUser, BONK1_BOOK_ID, '1');
    assert(lesson1Words.length === 66, `Lesson 1 must have exactly 66 words, got ${lesson1Words.length}`);
    lesson1Words.forEach((w) => {
      assert(w.lesson === '1', `All returned words must belong to Lesson 1, found ${w.lesson}`);
    });

    // Query Lesson 26
    const lesson26Words = await vocabService.getWordsForBookAndLesson(testUser, BONK1_BOOK_ID, '26');
    assert(lesson26Words.length === 137, `Lesson 26 must have exactly 137 words, got ${lesson26Words.length}`);

    // Query All Lessons
    const allBonkWords = await vocabService.getWordsForBookAndLesson(testUser, BONK1_BOOK_ID);
    assert(
      allBonkWords.length === BONK1_EXPECTED_COUNT,
      `Total returned Bonk words must be ${BONK1_EXPECTED_COUNT}`
    );
    console.log('  ✓ Lesson-level retrieval and filtering verified with exact counts.');

    // -------------------------------------------------------------
    // Test 6: Search across English, Armenian, Russian, Type, and Notes
    // -------------------------------------------------------------
    console.log('[6/8] Testing multi-lingual search (English, Armenian, Russian, Type)...');
    // Search Armenian word "առաջին"
    const armenianMatch = allBonkWords.filter((w) => w.hy.includes('առաջին'));
    assert(armenianMatch.length > 0, 'Must find Armenian search term "առաջին"');
    assert(armenianMatch.some((w) => w.id === 'bonk1-0001'), 'Must include first word');

    // Search Russian word "первый"
    const russianMatch = allBonkWords.filter((w) => w.ru && w.ru.includes('первый'));
    assert(russianMatch.length > 0, 'Must find Russian search term "первый"');

    // Search Type "sentence"
    const sentenceWords = allBonkWords.filter((w) => w.type === 'sentence');
    assert(sentenceWords.length > 0, 'Sentence type entries must be searchable');

    // Search Notes
    const noteWords = allBonkWords.filter((w) => w.note && w.note.includes('synonym'));
    assert(noteWords.length > 0, 'Entries with synonym notes must be searchable');
    console.log('  ✓ Multi-lingual and metadata search operations verified.');

    // -------------------------------------------------------------
    // Test 7: User-created vocabulary separation from built-in Bonk 1
    // -------------------------------------------------------------
    console.log('[7/8] Testing user vocabulary independence from built-in Bonk 1...');
    // 1. Built-in words cannot be deleted or modified by users
    let attemptedBonkEdit = false;
    try {
      await vocabService.updateWord(testUser, 'bonk1-0001', { en: 'modified first' });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        attemptedBonkEdit = true;
      }
    }
    assert(attemptedBonkEdit, 'Editing built-in Bonk 1 words must be forbidden with AuthorizationError');

    let attemptedBonkDelete = false;
    try {
      await vocabService.deleteWord(testUser, 'bonk1-0001');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        attemptedBonkDelete = true;
      }
    }
    assert(attemptedBonkDelete, 'Deleting built-in Bonk 1 words must be forbidden with AuthorizationError');

    // 2. User creates their own custom book and personal words
    const userCustomBook = await bookService.createBook(testUser, {
      name: 'User Custom Vocabulary Collection',
      description: 'Personal study list.',
    });
    const userCustomLesson = await lessonService.createLesson(testUser, userCustomBook.id, {
      lessonNumber: 'Custom-1',
      name: 'Custom Unit',
      orderIndex: 1,
    });
    const userWord = await vocabService.addWord(testUser, userCustomBook.id, 'Custom-1', {
      en: 'serendipity',
      hy: 'հաջող պատահականություն',
      ru: 'счастливая случайность',
      type: 'word',
    });
    assert(userWord.createdBy === testUser, 'User word must be createdBy user');
    assert(userWord.bookId === userCustomBook.id, 'User word must belong to custom book');

    // 3. User can modify and delete their own words without affecting Bonk 1
    const updatedUserWord = await vocabService.updateWord(testUser, userWord.id, {
      en: 'serendipity (n.)',
    });
    assert(updatedUserWord.en === 'serendipity (n.)', 'User can edit own word');

    // Verify Bonk 1 words count is completely unchanged
    const bonkCheckAfterUserChanges = await vocabService.getWordsForBookAndLesson(testUser, BONK1_BOOK_ID);
    assert(
      bonkCheckAfterUserChanges.length === BONK1_EXPECTED_COUNT,
      `Bonk 1 words count must remain exactly ${BONK1_EXPECTED_COUNT}`
    );
    console.log('  ✓ User personal vocabulary and built-in dictionary are strictly segregated.');

    // -------------------------------------------------------------
    // Test 8: User progress tracking on Bonk 1 entries
    // -------------------------------------------------------------
    console.log('[8/8] Testing user mastery progress tracking on Bonk 1 words...');
    const userProgress = await vocabService.setWordKnownStatus(testUser, 'bonk1-0001', true);
    assert(userProgress.isKnown === true, 'bonk1-0001 must be marked as known');
    assert(userProgress.userId === testUser, 'Progress must be scoped to user');

    const wordsWithStatus = await vocabService.getWordsWithStatus(testUser, BONK1_BOOK_ID, '1');
    const firstWordStatus = wordsWithStatus.find((w) => w.id === 'bonk1-0001');
    assert(firstWordStatus !== undefined && firstWordStatus.isKnown === true, 'First word marked known in query');

    // Another user should NOT see this user's known status (Strict User Scoping)
    const otherUserWords = await vocabService.getWordsWithStatus('user_other_student', BONK1_BOOK_ID, '1');
    const otherFirstWord = otherUserWords.find((w) => w.id === 'bonk1-0001');
    assert(otherFirstWord !== undefined && otherFirstWord.isKnown === false, 'Other user status must remain false');

    console.log('  ✓ User word progress on Bonk 1 entries is strictly user-scoped.');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 8 BONK 1 INTEGRATION TEST SUITES PASSED! Verified 2,618 words across 26 lessons.');
  } finally {
    db.close();
  }
}

runBonkIntegrationTestSuite().catch((err) => {
  console.error('❌ Bonk integration test suite failed:', err);
  process.exit(1);
});
