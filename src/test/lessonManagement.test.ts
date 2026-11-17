/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { VocabularyWord } from '../db/types.ts';
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

async function runLessonManagementTestSuite() {
  console.log('--- Starting Task 8: Lesson Management Test Suite ---');
  const dbName = `TestLessonsDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db);
  const vocabService = new VocabularyService(db);

  try {
    const userA = 'user_alice';
    const userB = 'user_bob';

    // 1. Built-in book & default lessons
    console.log('[1/8] Verifying default lessons in built-in textbook...');
    await bookService.ensureDefaultBooks();
    const bonkLessons = await lessonService.ensureDefaultBonkLessons();
    assert(bonkLessons.length === 26, `bonk1 should have 26 default lessons, got ${bonkLessons.length}`);
    assert(bonkLessons[0].bookId === 'bonk1', 'bonk1 lesson has bookId "bonk1"');
    console.log('  ✓ Standard curriculum lessons initialized correctly');

    // 2. Allow users to create lessons inside a selected book with bookId and userId association
    console.log('[2/8] Testing lesson creation inside custom book...');
    const aliceBook = await bookService.createBook(userA, {
      name: 'Alice Academic GRE',
      description: 'Graduate level vocabulary lists and roots.',
    });

    const lesson1 = await lessonService.createLesson(userA, aliceBook.id, {
      lessonNumber: 'Unit 1',
      name: 'Verbal Reasoning & Epistemology',
      description: 'Philosophical vocabulary and cognitive rhetoric.',
      orderIndex: 1,
    });

    assert(lesson1.id === `${aliceBook.id}:Unit 1`, 'Lesson ID formatted as `${bookId}:${lessonNumber}`');
    assert(lesson1.bookId === aliceBook.id, 'Lesson correctly associated with parent bookId');
    assert(lesson1.userId === userA, 'Lesson correctly associated with userId');
    assert(lesson1.name === 'Verbal Reasoning & Epistemology', 'Lesson name saved properly');
    assert(Boolean(lesson1.description?.includes('Philosophical')), 'Lesson description saved properly');
    console.log('  ✓ Lesson created successfully with bookId and userId association');

    // 3. Prevent duplicate lesson numbers within the same book
    console.log('[3/8] Testing uniqueness validation of lesson numbers...');
    let caughtDuplicate = false;
    try {
      await lessonService.createLesson(userA, aliceBook.id, {
        lessonNumber: 'Unit 1',
        name: 'Another Unit 1',
      });
    } catch (err) {
      if (err instanceof ValidationError) caughtDuplicate = true;
    }
    assert(caughtDuplicate, 'Creating a lesson with existing number should throw ValidationError');
    console.log('  ✓ Duplicate lesson numbers prevented');

    // 4. Allow users to edit lesson names and descriptions
    console.log('[4/8] Testing lesson update functionality...');
    const updatedLesson = await lessonService.updateLesson(userA, lesson1.id, {
      name: 'Verbal Reasoning & Advanced Epistemology',
      description: 'Updated comprehensive rhetoric syllabus.',
    });
    assert(
      updatedLesson.name === 'Verbal Reasoning & Advanced Epistemology',
      'Lesson name updated successfully'
    );
    assert(
      updatedLesson.description === 'Updated comprehensive rhetoric syllabus.',
      'Lesson description updated successfully'
    );
    console.log('  ✓ Lesson name and description updated successfully');

    // 5. Display lessons belonging only to the selected book
    console.log('[5/8] Testing book-scoped lesson filtering...');
    const lesson2 = await lessonService.createLesson(userA, aliceBook.id, {
      lessonNumber: 'Unit 2',
      name: 'Scientific Nomenclature',
      orderIndex: 2,
    });

    const aliceBookLessons = await lessonService.getLessonsForBook(aliceBook.id);
    assert(aliceBookLessons.length === 2, `Alice book should have exactly 2 lessons, found ${aliceBookLessons.length}`);
    assert(aliceBookLessons.every((l) => l.bookId === aliceBook.id), 'All returned lessons belong to aliceBook');

    const bonkBookLessons = await lessonService.getLessonsForBook('bonk1');
    assert(bonkBookLessons.length === 26, 'bonk1 still has 26 lessons');
    assert(!bonkBookLessons.some((l) => l.id === lesson1.id), 'bonk1 does not contain Alice lessons');
    console.log('  ✓ Lessons belonging only to the selected book are returned');

    // 6. User Scoping & Permissions Isolation (Prevent access to lessons belonging to other users)
    console.log('[6/8] Testing user privacy and cross-user modification protection...');
    // Bob cannot create a lesson in Alice's book
    let bobBlockedCreate = false;
    try {
      await lessonService.createLesson(userB, aliceBook.id, {
        lessonNumber: 'Unit 3',
        name: 'Bob Intrusion',
      });
    } catch (err) {
      if (err instanceof AuthorizationError) bobBlockedCreate = true;
    }
    assert(bobBlockedCreate, 'Bob should be forbidden from creating lessons in Alice book');

    // Bob cannot edit Alice's lesson
    let bobBlockedEdit = false;
    try {
      await lessonService.updateLesson(userB, lesson1.id, {
        name: 'Bob Hacked Lesson',
      });
    } catch (err) {
      if (err instanceof AuthorizationError) bobBlockedEdit = true;
    }
    assert(bobBlockedEdit, 'Bob should be forbidden from updating Alice lesson');

    // Bob cannot delete Alice's lesson
    let bobBlockedDelete = false;
    try {
      await lessonService.deleteLesson(userB, lesson1.id);
    } catch (err) {
      if (err instanceof AuthorizationError) bobBlockedDelete = true;
    }
    assert(bobBlockedDelete, 'Bob should be forbidden from deleting Alice lesson');

    // Bob querying lessons for Alice's private book with userId scoping gets empty array
    const bobQueriedLessons = await lessonService.getLessonsForBook(aliceBook.id, userB);
    assert(bobQueriedLessons.length === 0, 'Bob querying Alice book lessons returns empty array (zero data leakage)');

    // Neither user can delete or edit standard bonk1 lessons
    let bonkProtected = false;
    try {
      await lessonService.deleteLesson(userA, 'bonk1:1');
    } catch (err) {
      if (err instanceof AuthorizationError) bonkProtected = true;
    }
    assert(bonkProtected, 'Standard bonk1 lesson cannot be deleted');
    console.log('  ✓ Strict user data separation and authorization verified');

    // 7. Vocabulary list updating when selected lesson changes
    console.log('[7/8] Testing vocabulary list filtering by selected book and lesson...');
    // Seed vocabulary words in lesson 1 and lesson 2
    const word1: VocabularyWord = {
      id: `${aliceBook.id}:epistemic`,
      bookId: aliceBook.id,
      lessonId: lesson1.id,
      lesson: lesson1.lessonNumber,
      en: 'epistemic',
      hy: 'իմացաբանական',
      ru: 'эпистемический',
      type: 'word',
      normalizedEn: 'epistemic',
      createdBy: userA,
      createdAt: Date.now(),
    };
    const word2: VocabularyWord = {
      id: `${aliceBook.id}:heuristics`,
      bookId: aliceBook.id,
      lessonId: lesson1.id,
      lesson: lesson1.lessonNumber,
      en: 'heuristics',
      hy: 'էվրիստիկա',
      ru: 'эвристика',
      type: 'word',
      normalizedEn: 'heuristics',
      createdBy: userA,
      createdAt: Date.now(),
    };
    const word3: VocabularyWord = {
      id: `${aliceBook.id}:symbiosis`,
      bookId: aliceBook.id,
      lessonId: lesson2.id,
      lesson: lesson2.lessonNumber,
      en: 'symbiosis',
      hy: 'սիմբիոզ',
      ru: 'симбиоз',
      type: 'word',
      normalizedEn: 'symbiosis',
      createdBy: userA,
      createdAt: Date.now(),
    };

    await db.create('words', word1);
    await db.create('words', word2);
    await db.create('words', word3);

    // Filter by whole book (All lessons)
    const allWordsInBook = await vocabService.getWordsForBookAndLesson(userA, aliceBook.id);
    assert(allWordsInBook.length === 3, `Expected 3 total words in book, got ${allWordsInBook.length}`);

    // Filter by Lesson 1
    const lesson1Words = await vocabService.getWordsForBookAndLesson(userA, aliceBook.id, lesson1.lessonNumber);
    assert(lesson1Words.length === 2, `Expected 2 words in Unit 1, got ${lesson1Words.length}`);
    assert(lesson1Words.some((w) => w.en === 'epistemic') && lesson1Words.some((w) => w.en === 'heuristics'), 'Unit 1 words match');

    // Filter by Lesson 2
    const lesson2Words = await vocabService.getWordsForBookAndLesson(userA, aliceBook.id, lesson2.lessonNumber);
    assert(lesson2Words.length === 1, `Expected 1 word in Unit 2, got ${lesson2Words.length}`);
    assert(lesson2Words[0].en === 'symbiosis', 'Unit 2 word matches');
    console.log('  ✓ Vocabulary updates dynamically when selecting different lessons');

    // 8. Delete lesson with cascade deletion of vocabulary words & settings reset
    console.log('[8/8] Testing lesson deletion with vocabulary cascade purge...');
    // Inspect stats before deletion
    const stats = await lessonService.getLessonStats(userA, lesson1.id);
    assert(stats.wordCount === 2, `Lesson 1 stats should report 2 words, got ${stats.wordCount}`);

    // Set active lesson in settings
    await db.saveSettings(userA, { selectedLesson: lesson1.lessonNumber });

    // Perform deletion
    const deleteResult = await lessonService.deleteLesson(userA, lesson1.id);
    assert(deleteResult.deletedCounts.lesson === 1, 'Reported 1 lesson deleted');
    assert(deleteResult.deletedCounts.words === 2, 'Reported 2 cascade-deleted vocabulary words');

    // Check lesson is gone
    const lessonsAfter = await lessonService.getLessonsForBook(aliceBook.id);
    assert(lessonsAfter.length === 1, 'Only 1 lesson remaining in Alice book');
    assert(lessonsAfter[0].id === lesson2.id, 'Remaining lesson is Unit 2');

    // Check vocabulary words are purged
    const remainingWords = await vocabService.getWordsForBookAndLesson(userA, aliceBook.id);
    assert(remainingWords.length === 1, 'Only 1 vocabulary word remaining in textbook');
    assert(remainingWords[0].id === word3.id, 'Remaining word is symbiosis');

    // Check user settings reset
    const updatedSettings = await db.getSettings(userA);
    assert(updatedSettings.selectedLesson === '', 'Selected lesson reset to empty after active lesson deleted');
    console.log('  ✓ Lesson deletion and vocabulary cascade purge verified');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 8 TASK 8 TEST CASES PASSED! Lesson management is fully verified.');
  } finally {
    db.close();
  }
}

runLessonManagementTestSuite().catch((err) => {
  console.error('❌ Lesson management test suite failed:', err);
  process.exit(1);
});
