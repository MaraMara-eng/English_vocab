/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { Book, LearningSession, Lesson, User, UserWordProgress, VocabularyWord } from '../db/types.ts';
import { ValidationError } from '../db/validators.ts';
import { AuthService } from '../services/authService.ts';
import { SESSION_STORAGE_KEY, SessionManager } from '../services/sessionManager.ts';

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
const mockSessionStorage = new MockStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = mockLocalStorage;
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = mockSessionStorage;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAccountDeletionTestSuite() {
  console.log('--- Starting Task 5: Account Deletion Test Suite ---');
  const dbName = `TestDeletionDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const sessionMgr = new SessionManager(db);
  const auth = new AuthService(db, sessionMgr);

  try {
    // 1. Setup Built-in System Book
    console.log('[1/6] Setting up system content and two test accounts (User A & User B)...');
    const builtinBook: Book = {
      id: 'bonk1',
      name: 'Bonk 1 (Builtin)',
      isBuiltin: true,
      createdBy: 'system',
      createdAt: Date.now(),
    };
    await db.create('books', builtinBook);

    // Register User A (Dave)
    const userA = await auth.register({
      username: 'dave_student',
      email: 'dave@example.com',
      password: 'DavePassword2026!',
      passwordConfirm: 'DavePassword2026!',
    });

    // Register User B (Emma)
    const userB = await auth.register({
      username: 'emma_student',
      email: 'emma@example.com',
      password: 'EmmaPassword2026!',
      passwordConfirm: 'EmmaPassword2026!',
    });

    assert(userA.id === 'user_dave_student', 'User A ID is correct');
    assert(userB.id === 'user_emma_student', 'User B ID is correct');
    console.log('  ✓ Two independent user accounts created');

    // 2. Populate complete data sets for both User A and User B
    console.log('[2/6] Populating Books, Lessons, Words, Progress, Sessions, and Settings for both users...');
    
    // User A's custom book, lesson, and word
    const daveBook: Book = {
      id: 'book_dave_ielts',
      name: 'Dave IELTS Vocab',
      isBuiltin: false,
      createdBy: userA.id,
      createdAt: Date.now(),
    };
    await db.create('books', daveBook);

    const daveLesson: Lesson = {
      id: 'book_dave_ielts:1',
      bookId: 'book_dave_ielts',
      lessonNumber: '1',
      name: 'Academic Words',
      orderIndex: 1,
      createdAt: Date.now(),
    };
    await db.create('lessons', daveLesson);

    const daveWord: VocabularyWord = {
      id: 'book_dave_ielts:analyze',
      bookId: 'book_dave_ielts',
      lessonId: 'book_dave_ielts:1',
      lesson: '1',
      en: 'analyze',
      hy: 'վերլուծել',
      ru: 'анализировать',
      type: 'word',
      normalizedEn: 'analyze',
      createdBy: userA.id,
      createdAt: Date.now(),
    };
    await db.create('words', daveWord);

    // User A practice attempts and sessions
    await db.recordWordAttempt(userA.id, 'book_dave_ielts', 'analyze', true);
    await db.recordWordAttempt(userA.id, 'bonk1', 'difficult_word', false); // failed word
    const daveSession: LearningSession = {
      id: `sess_${userA.id}_1`,
      userId: userA.id,
      bookId: 'book_dave_ielts',
      mode: 'lesson',
      totalCards: 15,
      correctCount: 14,
      missCount: 1,
      durationSeconds: 120,
      startedAt: Date.now() - 100000,
      completedAt: Date.now(),
    };
    await db.create('learningSessions', daveSession, userA.id);
    await db.saveSettings(userA.id, { theme: 'dark', voiceMode: true });

    // User B's custom book, lesson, word, progress, session, settings
    const emmaBook: Book = {
      id: 'book_emma_medical',
      name: 'Emma Medical English',
      isBuiltin: false,
      createdBy: userB.id,
      createdAt: Date.now(),
    };
    await db.create('books', emmaBook);

    const emmaWord: VocabularyWord = {
      id: 'book_emma_medical:prescription',
      bookId: 'book_emma_medical',
      lessonId: 'none',
      lesson: '1',
      en: 'prescription',
      hy: 'դեղատոմս',
      ru: 'рецепт',
      type: 'word',
      normalizedEn: 'prescription',
      createdBy: userB.id,
      createdAt: Date.now(),
    };
    await db.create('words', emmaWord);

    await db.recordWordAttempt(userB.id, 'book_emma_medical', 'prescription', true);
    await db.recordWordAttempt(userB.id, 'bonk1', 'grammar_term', false); // User B failed word
    const emmaSession: LearningSession = {
      id: `sess_${userB.id}_1`,
      userId: userB.id,
      bookId: 'book_emma_medical',
      mode: 'lesson',
      totalCards: 20,
      correctCount: 20,
      missCount: 0,
      durationSeconds: 180,
      startedAt: Date.now() - 50000,
      completedAt: Date.now(),
    };
    await db.create('learningSessions', emmaSession, userB.id);
    await db.saveSettings(userB.id, { theme: 'light', voiceMode: false });

    // Verify initial states before deletion
    const daveProgBefore = await db.getUserBookProgress(userA.id, 'book_dave_ielts');
    const emmaProgBefore = await db.getUserBookProgress(userB.id, 'book_emma_medical');
    assert(daveProgBefore.length === 1, 'Dave must have 1 progress entry');
    assert(emmaProgBefore.length === 1, 'Emma must have 1 progress entry');
    console.log('  ✓ Data sets for both users populated and verified');

    // 3. Password Confirmation Enforcement
    console.log('[3/6] Testing password confirmation requirements for account deletion...');
    // Login as Dave
    await auth.login('dave_student', 'DavePassword2026!');
    assert(sessionMgr.isAuthenticated(), 'Dave is authenticated');

    // Attempt deletion with empty password
    let emptyPassBlocked = false;
    try {
      await auth.deleteAccount(userA.id, '');
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'password') {
        emptyPassBlocked = true;
      }
    }
    assert(emptyPassBlocked, 'Account deletion must be rejected when password confirmation is empty');

    // Attempt deletion with incorrect password
    let wrongPassBlocked = false;
    try {
      await auth.deleteAccount(userA.id, 'WrongPassword123');
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'password') {
        wrongPassBlocked = true;
      }
    }
    assert(wrongPassBlocked, 'Account deletion must be rejected when password confirmation is incorrect');

    // Verify Dave was NOT deleted on wrong password
    const daveStillExists = await db.getById<User>('users', userA.id);
    assert(daveStillExists !== null, 'Dave must still exist after failed deletion attempt');
    console.log('  ✓ Password confirmation strictly required and validated before deletion');

    // 4. Successful Account Deletion of User A
    console.log('[4/6] Executing account deletion with valid password confirmation...');
    const deleteResult = await auth.deleteAccount(userA.id, 'DavePassword2026!');
    assert(deleteResult.success === true, 'deleteAccount must return success: true');
    assert(deleteResult.deletedCounts.user === 1, 'Exactly 1 user record deleted');
    assert(deleteResult.deletedCounts.books === 1, 'Dave custom book deleted');
    assert(deleteResult.deletedCounts.lessons === 1, 'Dave custom lesson deleted');
    assert(deleteResult.deletedCounts.words === 1, 'Dave custom word deleted');
    assert(deleteResult.deletedCounts.progress >= 2, 'Dave progress records deleted');
    assert(deleteResult.deletedCounts.sessions === 1, 'Dave session deleted');
    assert(deleteResult.deletedCounts.failedWords === 1, 'Dave failed word deleted');
    assert(deleteResult.deletedCounts.settings >= 1, 'Dave settings deleted');
    console.log('  ✓ Cascade deletion returned expected deletion counts');

    // 5. Verification of User A Complete Removal
    console.log('[5/6] Verifying all data for User A is completely erased...');
    const checkDaveUser = await db.getById<User>('users', userA.id);
    assert(checkDaveUser === null, 'User A record must be null in users store');

    const checkDaveBook = await db.getById<Book>('books', 'book_dave_ielts');
    assert(checkDaveBook === null, 'User A custom book must be deleted');

    const checkDaveLesson = await db.getById<Lesson>('lessons', 'book_dave_ielts:1');
    assert(checkDaveLesson === null, 'User A custom lesson must be deleted');

    const checkDaveWord = await db.getById<VocabularyWord>('words', 'book_dave_ielts:analyze');
    assert(checkDaveWord === null, 'User A custom word must be deleted');

    const checkDaveProgress = await db.query<UserWordProgress>('userWordProgress', {}, userA.id);
    assert(checkDaveProgress.length === 0, 'User A progress records must be 0');

    const checkDaveSessions = await db.query<LearningSession>('learningSessions', {}, userA.id);
    assert(checkDaveSessions.length === 0, 'User A learning sessions must be 0');

    const checkDaveFailed = await db.query('failedWords', {}, userA.id);
    assert(checkDaveFailed.length === 0, 'User A failed words must be 0');

    // Verify session cleanup
    assert(!sessionMgr.isAuthenticated(), 'User session must be logged out after deletion');
    assert(sessionMgr.getCurrentUser() === null, 'Current user must be null after deletion');
    assert(mockLocalStorage.getItem(SESSION_STORAGE_KEY) === null, 'Session item must be purged from storage');
    console.log('  ✓ User A account and all associated data completely purged');

    // 6. Strict Data Separation: Verify User B and System Data Are Untouched
    console.log('[6/6] Verifying User B and Built-in System data remain 100% intact...');
    
    // User B user record
    const checkEmmaUser = await db.getById<User>('users', userB.id);
    assert(checkEmmaUser !== null, 'User B record must still exist');
    assert(checkEmmaUser?.username === 'emma_student', 'User B username intact');

    // User B custom book
    const checkEmmaBook = await db.getById<Book>('books', 'book_emma_medical');
    assert(checkEmmaBook !== null, 'User B custom book must remain intact');
    assert(checkEmmaBook?.createdBy === userB.id, 'User B book owner unchanged');

    // User B custom word
    const checkEmmaWord = await db.getById<VocabularyWord>('words', 'book_emma_medical:prescription');
    assert(checkEmmaWord !== null, 'User B custom word must remain intact');

    // User B progress
    const checkEmmaProgress = await db.getUserBookProgress(userB.id, 'book_emma_medical');
    assert(checkEmmaProgress.length === 1, 'User B progress records must remain intact');

    // User B failed words
    const checkEmmaFailed = await db.getFailedWordsForBook(userB.id, 'bonk1');
    assert(checkEmmaFailed.length === 1, 'User B failed words must remain intact');
    assert(checkEmmaFailed[0].wordKey === 'grammar_term', 'User B failed word key is grammar_term');

    // User B sessions
    const checkEmmaSessions = await db.query<LearningSession>('learningSessions', {}, userB.id);
    assert(checkEmmaSessions.length === 1, 'User B learning sessions must remain intact');

    // User B settings
    const checkEmmaSettings = await db.getSettings(userB.id);
    assert(checkEmmaSettings.userId === userB.id, 'User B settings intact');
    assert(checkEmmaSettings.theme === 'light', 'User B theme intact');

    // System builtin book
    const checkSystemBook = await db.getById<Book>('books', 'bonk1');
    assert(checkSystemBook !== null, 'Built-in system book "bonk1" must NEVER be deleted');
    assert(checkSystemBook?.isBuiltin === true, 'Built-in flag preserved');

    // Verify User B can log in and use workspace normally
    const emmaLogin = await auth.login('emma_student', 'EmmaPassword2026!');
    assert(emmaLogin.id === userB.id, 'User B can successfully log in after User A deletion');
    assert(sessionMgr.isAuthenticated(), 'User B session established');
    console.log('  ✓ User B and system records remain strictly segregated and completely intact');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 6 TASK 5 TEST SUITES PASSED! Account deletion is 100% verified.');
  } finally {
    db.close();
  }
}

runAccountDeletionTestSuite().catch((err) => {
  console.error('❌ Account deletion test suite failed:', err);
  process.exit(1);
});
