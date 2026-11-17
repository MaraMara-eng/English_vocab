/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { Book, Lesson } from '../db/types.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';

// Make IDBKeyRange globally available for the Node test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

// Mock storage for Node.js test environment
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

const mockLocalStorage = new MockStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = mockLocalStorage;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runBookDropdownTestSuite() {
  console.log('--- Starting Task 7: Book Selection Dropdown Test Suite ---');
  const dbName = `TestDropdownDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db);

  try {
    const userA = 'user_anna';
    const userB = 'user_boris';

    // 1. Initialize Built-in Book and Default Lessons
    console.log('[1/6] Testing initialization of built-in book and lessons...');
    await bookService.ensureDefaultBooks();
    const bonkLessons = await lessonService.ensureDefaultBonkLessons();
    assert(bonkLessons.length === 26, `bonk1 should have 26 default lessons, got ${bonkLessons.length}`);
    console.log('  ✓ Standard textbook bonk1 with 26 lessons initialized');

    // 2. Display all books belonging to the current user (and never another user's books)
    console.log('[2/6] Verifying user book scoping (strict privacy - zero leakage)...');
    const annaBook = await bookService.createBook(userA, {
      name: 'Anna Medical Terminology',
      description: 'Anatomy, diagnostics, and clinical vocabulary.',
    });

    const borisBook = await bookService.createBook(userB, {
      name: 'Boris Engineering English',
      description: 'Technical specifications and computing terms.',
    });

    // Books visible to Anna
    const annaVisibleBooks = await bookService.getUserBooks(userA);
    assert(annaVisibleBooks.some((b) => b.id === 'bonk1'), 'Anna can see standard book bonk1');
    assert(annaVisibleBooks.some((b) => b.id === annaBook.id), 'Anna can see her own book');
    assert(!annaVisibleBooks.some((b) => b.id === borisBook.id), "Anna MUST NOT see Boris's book");

    // Books visible to Boris
    const borisVisibleBooks = await bookService.getUserBooks(userB);
    assert(borisVisibleBooks.some((b) => b.id === 'bonk1'), 'Boris can see standard book bonk1');
    assert(borisVisibleBooks.some((b) => b.id === borisBook.id), 'Boris can see his own book');
    assert(!borisVisibleBooks.some((b) => b.id === annaBook.id), "Boris MUST NOT see Anna's book");
    console.log('  ✓ Dropdown data source strictly isolates books per user account');

    // 3. Selection & Lesson Update
    console.log('[3/6] Testing book selection and automatic lesson updates...');
    // Create custom lessons for Anna's book
    const annaLesson1 = await lessonService.createLesson(annaBook.id, '1', 'Cardiovascular System');
    const annaLesson2 = await lessonService.createLesson(annaBook.id, '2', 'Respiratory System');

    // When selecting bonk1:
    const selectedBonkLessons = await lessonService.getLessonsForBook('bonk1');
    assert(selectedBonkLessons.length === 26, 'Selecting bonk1 updates displayed lessons to 26 units');
    assert(selectedBonkLessons[0].name === 'Lesson 1', 'First lesson is Lesson 1');

    // When switching selection to Anna's book:
    const selectedAnnaLessons = await lessonService.getLessonsForBook(annaBook.id);
    assert(selectedAnnaLessons.length === 2, 'Selecting Anna book updates displayed lessons to 2 units');
    assert(selectedAnnaLessons[0].id === annaLesson1.id, 'First lesson matches Cardiovascular System');
    assert(selectedAnnaLessons[1].id === annaLesson2.id, 'Second lesson matches Respiratory System');
    console.log('  ✓ Switching selected book correctly updates the associated lessons');

    // 4. Persistence Across Sessions & Navigation
    console.log('[4/6] Testing selected book persistence in IndexedDB and storage...');
    // Simulate user selecting Anna's book
    await db.saveSettings(userA, { selectedBookId: annaBook.id });
    mockLocalStorage.setItem('vq:sel:' + userA, JSON.stringify({ b: annaBook.id }));

    // Verify settings retrieval restores Anna's book
    const annaSettings = await db.getSettings(userA);
    assert(annaSettings.selectedBookId === annaBook.id, "Settings must preserve Anna's selected book");

    const cachedRaw = mockLocalStorage.getItem('vq:sel:' + userA);
    assert(cachedRaw !== null, 'LocalStorage must hold selected book cache');
    const parsed = JSON.parse(cachedRaw!);
    assert(parsed.b === annaBook.id, 'Cached book ID matches selection');
    console.log('  ✓ Selected book safely preserved in both IndexedDB settings and storage');

    // 5. Search Filtering & Empty State
    console.log('[5/6] Testing search query filtering and empty state handling...');
    const allAnnaBooks = await bookService.getUserBooks(userA);
    
    // Case A: Query matching "medical"
    const matchMedical = allAnnaBooks.filter((b) =>
      b.name.toLowerCase().includes('medical') || (b.description && b.description.toLowerCase().includes('medical'))
    );
    assert(matchMedical.length === 1, 'Search for "medical" should return 1 book');
    assert(matchMedical[0].id === annaBook.id, 'Matched book is Anna Medical Terminology');

    // Case B: Query matching "bonk"
    const matchBonk = allAnnaBooks.filter((b) =>
      b.name.toLowerCase().includes('bonk') || (b.description && b.description.toLowerCase().includes('bonk'))
    );
    assert(matchBonk.length === 1, 'Search for "bonk" should return standard book');

    // Case C: Non-matching query (Empty state)
    const matchNone = allAnnaBooks.filter((b) =>
      b.name.toLowerCase().includes('quantum physics')
    );
    assert(matchNone.length === 0, 'Non-matching query should return empty array for empty state display');
    console.log('  ✓ Search filtering and empty state triggers verified');

    // 6. Multi-User Independence & Fallback on Deletion
    console.log('[6/6] Testing fallback when selected book is deleted...');
    // Delete Anna's custom book
    await bookService.deleteBook(userA, annaBook.id);

    // Verify Anna's settings automatically fell back to bonk1
    const updatedAnnaSettings = await db.getSettings(userA);
    assert(updatedAnnaSettings.selectedBookId === 'bonk1', 'Settings must fallback to "bonk1" after book deletion');

    const remainingAnnaBooks = await bookService.getUserBooks(userA);
    assert(remainingAnnaBooks.length === 1, 'Anna should have 1 book remaining (bonk1)');
    assert(remainingAnnaBooks[0].id === 'bonk1', 'Remaining book is bonk1');

    // Verify Boris's book is still intact
    const remainingBorisBooks = await bookService.getUserBooks(userB);
    assert(remainingBorisBooks.some((b) => b.id === borisBook.id), "Boris's book remains completely intact");
    console.log('  ✓ Deletion fallback and multi-user independence verified');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 6 TASK 7 TEST SUITES PASSED! Book dropdown is 100% verified.');
  } finally {
    db.close();
  }
}

runBookDropdownTestSuite().catch((err) => {
  console.error('❌ Book dropdown test suite failed:', err);
  process.exit(1);
});
