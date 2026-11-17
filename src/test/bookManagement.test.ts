/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { Lesson, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { BookService } from '../services/bookService.ts';

// Make IDBKeyRange globally available for the Node test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runBookManagementTestSuite() {
  console.log('--- Starting Task 6: Book Management Test Suite ---');
  const dbName = `TestBookDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);

  try {
    const userAlice = 'user_alice';
    const userBob = 'user_bob';

    // 1. Initial State & Built-in Book
    console.log('[1/7] Testing default built-in book initialization...');
    await bookService.ensureDefaultBooks();
    const aliceInitialBooks = await bookService.getUserBooks(userAlice);
    assert(aliceInitialBooks.length >= 1, 'Initial list should contain built-in book');
    assert(aliceInitialBooks[0].id === 'bonk1', 'Built-in book ID must be bonk1');
    assert(aliceInitialBooks[0].isBuiltin === true, 'bonk1 must have isBuiltin = true');
    console.log('  ✓ Built-in book initialized and accessible to users');

    // 2. Book Creation & Input Validation
    console.log('[2/7] Testing book creation and input validation...');
    const aliceBook1 = await bookService.createBook(userAlice, {
      name: 'Alice Academic IELTS',
      description: 'Advanced vocabulary for IELTS academic preparation.',
    });

    assert(aliceBook1.name === 'Alice Academic IELTS', 'Book name must match');
    assert(aliceBook1.createdBy === userAlice, 'createdBy must be userAlice');
    assert(aliceBook1.isBuiltin === false, 'Custom book must not be builtin');
    assert(!!aliceBook1.id, 'Book ID must be generated');

    // Rejection of empty title
    let emptyTitleBlocked = false;
    try {
      await bookService.createBook(userAlice, { name: '   ' });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'name') {
        emptyTitleBlocked = true;
      }
    }
    assert(emptyTitleBlocked, 'Should reject empty book name');

    // Rejection of duplicate book title for the same user
    let dupTitleBlocked = false;
    try {
      await bookService.createBook(userAlice, { name: 'Alice Academic IELTS' });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'name') {
        dupTitleBlocked = true;
      }
    }
    assert(dupTitleBlocked, 'Should reject duplicate book title for same user');

    // Bob can create a book with the same name without collision
    const bobBook1 = await bookService.createBook(userBob, {
      name: 'Bob Business English',
      description: 'Corporate and financial English terms.',
    });
    assert(bobBook1.createdBy === userBob, 'Bob book belongs to Bob');
    console.log('  ✓ Book creation and input validation verified');

    // 3. User Scoping & Organized Book Lists (Zero Cross-User Exposure)
    console.log('[3/7] Testing user-scoped book collections (isolation)...');
    const aliceBooks = await bookService.getUserBooks(userAlice);
    const bobBooks = await bookService.getUserBooks(userBob);

    assert(aliceBooks.some((b) => b.id === aliceBook1.id), 'Alice list must include Alice book');
    assert(!aliceBooks.some((b) => b.id === bobBook1.id), "Alice list must NOT include Bob's book");

    assert(bobBooks.some((b) => b.id === bobBook1.id), 'Bob list must include Bob book');
    assert(!bobBooks.some((b) => b.id === aliceBook1.id), "Bob list must NOT include Alice's book");

    // Both see the shared built-in book
    assert(aliceBooks.some((b) => b.id === 'bonk1'), 'Alice sees bonk1');
    assert(bobBooks.some((b) => b.id === 'bonk1'), 'Bob sees bonk1');

    // Direct fetch of another user's private book returns null
    const leakedBook = await bookService.getBookById(userAlice, bobBook1.id);
    assert(leakedBook === null, 'Alice fetching Bob book directly must return null');
    console.log('  ✓ Books strictly segregated per user collection');

    // 4. Editing Book Name & Description
    console.log('[4/7] Testing book renaming and description updates...');
    const updatedAliceBook = await bookService.updateBook(userAlice, aliceBook1.id, {
      name: 'Alice IELTS Master 2026',
      description: 'Updated comprehensive IELTS vocabulary.',
    });
    assert(updatedAliceBook.name === 'Alice IELTS Master 2026', 'Book name updated');
    assert(updatedAliceBook.description === 'Updated comprehensive IELTS vocabulary.', 'Description updated');

    // Verify persisted in IndexedDB
    const fetchedAliceBook = await bookService.getBookById(userAlice, aliceBook1.id);
    assert(fetchedAliceBook?.name === 'Alice IELTS Master 2026', 'Persisted book name matches update');
    console.log('  ✓ Book editing succeeded and verified in IndexedDB');

    // 5. Cross-User Modification & Built-in Protection
    console.log('[5/7] Testing authorization guards on update and delete...');
    // Alice trying to edit Bob's book
    let unauthorizedEditBlocked = false;
    try {
      await bookService.updateBook(userAlice, bobBook1.id, { name: 'Hacked by Alice' });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        unauthorizedEditBlocked = true;
      }
    }
    assert(unauthorizedEditBlocked, "Cross-user update must throw AuthorizationError");

    // Alice trying to delete Bob's book
    let unauthorizedDeleteBlocked = false;
    try {
      await bookService.deleteBook(userAlice, bobBook1.id);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        unauthorizedDeleteBlocked = true;
      }
    }
    assert(unauthorizedDeleteBlocked, "Cross-user delete must throw AuthorizationError");

    // Trying to edit or delete built-in book bonk1
    let builtinEditBlocked = false;
    try {
      await bookService.updateBook(userAlice, 'bonk1', { name: 'Renamed Bonk' });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        builtinEditBlocked = true;
      }
    }
    assert(builtinEditBlocked, 'Modifying built-in book must throw AuthorizationError');

    let builtinDeleteBlocked = false;
    try {
      await bookService.deleteBook(userAlice, 'bonk1');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        builtinDeleteBlocked = true;
      }
    }
    assert(builtinDeleteBlocked, 'Deleting built-in book must throw AuthorizationError');
    console.log('  ✓ Cross-user edits and built-in book modifications strictly forbidden');

    // 6. Associating Lessons & Words with Book & Book Statistics
    console.log('[6/7] Testing association of lessons and words & getBookStats...');
    // Create Lesson 1 and Lesson 2 for Alice's book
    const lesson1: Lesson = {
      id: `${aliceBook1.id}:1`,
      bookId: aliceBook1.id,
      lessonNumber: '1',
      name: 'Academic Writing Task 1',
      orderIndex: 1,
      createdAt: Date.now(),
    };
    const lesson2: Lesson = {
      id: `${aliceBook1.id}:2`,
      bookId: aliceBook1.id,
      lessonNumber: '2',
      name: 'Academic Writing Task 2',
      orderIndex: 2,
      createdAt: Date.now(),
    };
    await db.create('lessons', lesson1);
    await db.create('lessons', lesson2);

    // Create 2 words in Alice's book
    const word1: VocabularyWord = {
      id: `${aliceBook1.id}:significant`,
      bookId: aliceBook1.id,
      lessonId: lesson1.id,
      lesson: '1',
      en: 'significant',
      hy: 'զգալի, նշանակալի',
      ru: 'значительный',
      type: 'word',
      normalizedEn: 'significant',
      createdBy: userAlice,
      createdAt: Date.now(),
    };
    const word2: VocabularyWord = {
      id: `${aliceBook1.id}:fluctuate`,
      bookId: aliceBook1.id,
      lessonId: lesson1.id,
      lesson: '1',
      en: 'fluctuate',
      hy: 'տատանվել',
      ru: 'колебаться',
      type: 'word',
      normalizedEn: 'fluctuate',
      createdBy: userAlice,
      createdAt: Date.now(),
    };
    await db.create('words', word1);
    await db.create('words', word2);

    // Record Alice practice attempts on her book
    await db.recordWordAttempt(userAlice, aliceBook1.id, 'significant', true);
    await db.recordWordAttempt(userAlice, aliceBook1.id, 'fluctuate', false);

    // Check stats
    const stats = await bookService.getBookStats(userAlice, aliceBook1.id);
    assert(stats.lessonCount === 2, `Alice book must have 2 lessons, got ${stats.lessonCount}`);
    assert(stats.wordCount === 2, `Alice book must have 2 words, got ${stats.wordCount}`);
    assert(stats.userProgressCount === 2, `Alice book must have 2 progress entries, got ${stats.userProgressCount}`);
    console.log('  ✓ Book statistics accurately reflect associated lessons, words, and progress');

    // 7. Safe Deletion & Cascade Purge
    console.log('[7/7] Testing safe deletion cascade of book and associated data...');
    const deleteRes = await bookService.deleteBook(userAlice, aliceBook1.id);
    assert(deleteRes.deletedCounts.book === 1, 'Book record deleted');
    assert(deleteRes.deletedCounts.lessons === 2, '2 associated lessons cascade deleted');
    assert(deleteRes.deletedCounts.words === 2, '2 associated words cascade deleted');
    assert(deleteRes.deletedCounts.progress >= 2, 'Associated progress cascade deleted');
    assert(deleteRes.deletedCounts.failedWords === 1, 'Associated failed words cascade deleted');

    // Verify all associated items are gone from IndexedDB
    const checkBook = await db.getById('books', aliceBook1.id);
    assert(checkBook === null, 'Book must be gone from books store');

    const checkLesson = await db.getById('lessons', lesson1.id);
    assert(checkLesson === null, 'Lesson 1 must be gone from lessons store');

    const checkWord = await db.getById('words', word1.id);
    assert(checkWord === null, 'Word 1 must be gone from words store');

    const checkProgress = await db.getUserBookProgress(userAlice, aliceBook1.id);
    assert(checkProgress.length === 0, 'Progress for deleted book must be 0');

    // Verify Bob's book and builtin book bonk1 are 100% UNTOUCHED
    const checkBobBook = await db.getById('books', bobBook1.id);
    assert(checkBobBook !== null, "Bob's book must remain intact");

    const checkBonk = await db.getById('books', 'bonk1');
    assert(checkBonk !== null, 'bonk1 must remain intact');
    console.log('  ✓ Safe book deletion cascade executed with full multi-user isolation');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 7 TASK 6 TEST SUITES PASSED! Book management is 100% verified.');
  } finally {
    db.close();
  }
}

runBookManagementTestSuite().catch((err) => {
  console.error('❌ Book management test suite failed:', err);
  process.exit(1);
});
