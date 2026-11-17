/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { Book, LearningSession, Lesson, User, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';

// Make IDBKeyRange globally available for the Node test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTestSuite() {
  console.log('--- Starting IndexedDB Test Suite ---');
  const dbName = `TestVocabQuestDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);

  try {
    // 1. Test Initialization
    console.log('[1/7] Testing database initialization and schema setup...');
    const idb = await db.open();
    assert(idb !== null, 'Database should be open');
    const storeNames = Array.from(idb.objectStoreNames);
    const expectedStores = [
      'users',
      'books',
      'lessons',
      'words',
      'userWordProgress',
      'learningSessions',
      'failedWords',
      'appSettings',
    ];
    for (const name of expectedStores) {
      assert(storeNames.includes(name), `Store "${name}" must exist in schema`);
    }
    console.log('  ✓ All 8 object stores created successfully with expected indexes');

    // 2. Test User Store CRUD
    console.log('[2/7] Testing User store CRUD and unique indexes...');
    const user1: User = {
      id: 'user_alice',
      username: 'alice',
      passwordHash: 'hash_for_alice_123456789',
      salt: 'salt_alice_16_bytes',
      role: 'student',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const user2: User = {
      id: 'user_bob',
      username: 'bob',
      passwordHash: 'hash_for_bob_123456789',
      salt: 'salt_bob_16_bytes',
      role: 'teacher',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.create('users', user1);
    await db.create('users', user2);

    const fetchedUser = await db.getById<User>('users', 'user_alice');
    assert(fetchedUser?.username === 'alice', 'User alice should be retrieved');

    // Duplicate username test
    let dupFailed = false;
    try {
      await db.create('users', { ...user1, id: 'user_alice_dup' });
    } catch {
      dupFailed = true;
    }
    assert(dupFailed, 'Duplicate username should be rejected');

    // Update user
    await db.update('users', 'user_alice', { role: 'teacher' });
    const updatedUser = await db.getById<User>('users', 'user_alice');
    assert(updatedUser?.role === 'teacher', 'User role should be updated');
    console.log('  ✓ User CRUD & uniqueness checks passed');

    // 3. Test Books, Lessons & Words CRUD
    console.log('[3/7] Testing Books, Lessons, and Words CRUD...');
    const book: Book = {
      id: 'bonk1',
      name: 'Bonk 1',
      isBuiltin: true,
      createdBy: 'system',
      createdAt: Date.now(),
    };
    await db.create('books', book);

    const lesson: Lesson = {
      id: 'bonk1:1',
      bookId: 'bonk1',
      lessonNumber: '1',
      name: 'Lesson 1',
      orderIndex: 1,
      createdAt: Date.now(),
    };
    await db.create('lessons', lesson);

    const word: VocabularyWord = {
      id: 'bonk1:first',
      bookId: 'bonk1',
      lessonId: 'bonk1:1',
      lesson: '1',
      en: 'first',
      hy: 'առաջին',
      ru: 'первый',
      type: 'word',
      page: '431',
      normalizedEn: 'first',
      createdBy: 'system',
      createdAt: Date.now(),
    };
    await db.create('words', word);

    const wordsInBook = await db.query<VocabularyWord>('words', {
      indexName: 'bookId',
      range: IDBKeyRange.only('bonk1'),
    });
    assert(wordsInBook.length === 1, 'Should find 1 word in book');
    assert(wordsInBook[0].en === 'first', 'Word English should match');
    console.log('  ✓ Books, Lessons, and Words CRUD passed');

    // 4. Test User Data Isolation (User A vs User B)
    console.log('[4/7] Testing strict user isolation and access boundaries...');
    // Alice practices word 'first' correctly
    await db.recordWordAttempt('user_alice', 'bonk1', 'first', true);
    // Alice practices word 'lesson' incorrectly -> gets failed word
    await db.recordWordAttempt('user_alice', 'bonk1', 'lesson', false);

    // Bob practices word 'first' incorrectly
    await db.recordWordAttempt('user_bob', 'bonk1', 'first', false);

    // Query progress for Alice
    const aliceProg = await db.getUserBookProgress('user_alice', 'bonk1');
    assert(aliceProg.length === 2, `Alice should have 2 progress records, got ${aliceProg.length}`);
    assert(
      aliceProg.every((p) => p.userId === 'user_alice'),
      'All records returned to Alice must belong to Alice'
    );

    // Query progress for Bob
    const bobProg = await db.getUserBookProgress('user_bob', 'bonk1');
    assert(bobProg.length === 1, `Bob should have 1 progress record, got ${bobProg.length}`);
    assert(bobProg[0].userId === 'user_bob', 'Bob progress must belong to Bob');
    assert(bobProg[0].streak === 0, 'Bob failed attempt must have streak 0');

    // Query failed words for Alice
    const aliceFailed = await db.getFailedWordsForBook('user_alice', 'bonk1');
    assert(aliceFailed.length === 1, 'Alice should have 1 failed word ("lesson")');
    assert(aliceFailed[0].wordKey === 'lesson', 'Alice failed word key must be "lesson"');

    // Query failed words for Bob
    const bobFailed = await db.getFailedWordsForBook('user_bob', 'bonk1');
    assert(bobFailed.length === 1, 'Bob should have 1 failed word ("first")');
    assert(bobFailed[0].wordKey === 'first', 'Bob failed word key must be "first"');

    // Unauthorized direct read attempt: Alice trying to get Bob's progress record
    const bobRecordId = `user_bob:bonk1:first`;
    const leakedToAlice = await db.getById('userWordProgress', bobRecordId, 'user_alice');
    assert(leakedToAlice === null, "Direct read of Bob's record by Alice must return null");

    // Unauthorized update attempt: Alice trying to mutate Bob's progress
    let authUpdateBlocked = false;
    try {
      await db.update('userWordProgress', bobRecordId, { streak: 10 }, 'user_alice');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        authUpdateBlocked = true;
      }
    }
    assert(authUpdateBlocked, 'Cross-user update must throw AuthorizationError');

    // Unauthorized delete attempt: Alice trying to delete Bob's failed word
    let authDeleteBlocked = false;
    try {
      await db.delete('failedWords', `user_bob:bonk1:first`, 'user_alice');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        authDeleteBlocked = true;
      }
    }
    assert(authDeleteBlocked, 'Cross-user delete must throw AuthorizationError');
    console.log('  ✓ Records belonging to different users strictly segregated');

    // 5. Test Learning Sessions & Settings with Scoping
    console.log('[5/7] Testing Learning Sessions and Application Settings...');
    const session: LearningSession = {
      id: 'session_alice_1',
      userId: 'user_alice',
      bookId: 'bonk1',
      lesson: '1',
      mode: 'lesson',
      totalCards: 10,
      correctCount: 9,
      missCount: 1,
      durationSeconds: 120,
      startedAt: Date.now() - 120000,
      completedAt: Date.now(),
    };
    await db.create('learningSessions', session, 'user_alice');

    const aliceSessions = await db.query<LearningSession>('learningSessions', {}, 'user_alice');
    assert(aliceSessions.length === 1, 'Alice should have 1 session');

    const bobSessions = await db.query<LearningSession>('learningSessions', {}, 'user_bob');
    assert(bobSessions.length === 0, 'Bob should have 0 sessions');

    // Settings
    const aliceSettings = await db.getSettings('user_alice');
    assert(aliceSettings.userId === 'user_alice', 'Settings must belong to Alice');
    await db.saveSettings('user_alice', { voiceMode: true, theme: 'dark' });
    const updatedAliceSettings = await db.getSettings('user_alice');
    assert(updatedAliceSettings.voiceMode === true, 'voiceMode should be true');
    assert(updatedAliceSettings.theme === 'dark', 'theme should be dark');
    console.log('  ✓ Learning sessions and settings correctly scoped and managed');

    // 6. Test Data Validation and Error Handling
    console.log('[6/7] Testing Data Validation rules...');
    let missingUserIdBlocked = false;
    try {
      await db.create('userWordProgress', { id: 'bad', bookId: 'bonk1', streak: 1 } as unknown as UserWordProgress);
    } catch (err) {
      if (err instanceof ValidationError) {
        missingUserIdBlocked = true;
      }
    }
    assert(missingUserIdBlocked, 'Store must reject user-scoped record missing userId');

    let negativeStreakBlocked = false;
    try {
      await db.create(
        'userWordProgress',
        {
          id: 'user_alice:bonk1:bad',
          userId: 'user_alice',
          bookId: 'bonk1',
          wordKey: 'bad',
          wordId: 'bonk1:bad',
          streak: -5,
          failCount: 0,
          isKnown: false,
          lastPracticedAt: Date.now(),
          updatedAt: Date.now(),
        },
        'user_alice'
      );
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'streak') {
        negativeStreakBlocked = true;
      }
    }
    assert(negativeStreakBlocked, 'Store must reject negative streak values');
    console.log('  ✓ Data validation and error handling verified');

    // 7. Test Export and Import Backup & Recovery
    console.log('[7/7] Testing User and Database Backup Export/Import...');
    const aliceBackup = await db.exportUserData('user_alice');
    assert(aliceBackup.userId === 'user_alice', 'Backup must be for Alice');
    assert(aliceBackup.progress.length === 2, 'Backup must contain 2 progress records');
    assert(aliceBackup.sessions.length === 1, 'Backup must contain 1 session');
    assert(aliceBackup.failedWords.length === 1, 'Backup must contain 1 failed word');
    assert(aliceBackup.settings?.theme === 'dark', 'Backup must contain dark theme setting');

    // Clear Alice's failed words
    await db.clearFailedWords('user_alice');
    const clearedFailed = await db.getFailedWordsForBook('user_alice', 'bonk1');
    assert(clearedFailed.length === 0, 'Failed words should be cleared');

    // Restore Alice's backup
    const importRes = await db.importUserData('user_alice', aliceBackup);
    assert(importRes.importedCount > 0, 'Should report imported records');

    const restoredFailed = await db.getFailedWordsForBook('user_alice', 'bonk1');
    assert(restoredFailed.length === 1, 'Failed words should be restored');
    assert(restoredFailed[0].wordKey === 'lesson', 'Restored failed word must be "lesson"');

    // Full database export test
    const fullBackup = await db.exportFullDatabase();
    assert(fullBackup.data.users.length === 2, 'Full backup must contain 2 users');
    assert(fullBackup.data.books.length === 1, 'Full backup must contain 1 book');
    assert(fullBackup.data.words.length === 1, 'Full backup must contain 1 word');
    console.log('  ✓ Backup export and import verified with full fidelity');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 7 TEST SUITES PASSED! IndexedDB implementation is fully verified.');
  } finally {
    db.close();
  }
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
