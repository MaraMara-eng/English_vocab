/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { ValidationError } from '../db/validators.ts';
import { AuthService } from '../services/authService.ts';
import {
  SESSION_STORAGE_KEY,
  SessionManager,
  UserSession,
} from '../services/sessionManager.ts';

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

// Attach mock storage to globalThis
const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = mockLocalStorage;
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = mockSessionStorage;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runSessionTestSuite() {
  console.log('--- Starting Task 4: Login, Logout & Session Management Test Suite ---');
  const dbName = `TestSessionDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const sessionMgr = new SessionManager(db);
  const auth = new AuthService(db, sessionMgr);

  try {
    // 1. User Registration & Initial Login
    console.log('[1/8] Testing registered user login and password verification...');
    const teacher = await auth.register({
      username: 'ms_clara',
      email: 'clara@school.edu',
      password: 'ClaraTeacher2026!',
      passwordConfirm: 'ClaraTeacher2026!',
    });
    assert(teacher.username === 'ms_clara', 'Registered user matches username');
    assert(teacher.role === 'teacher', 'First user is teacher');

    // Sign out to test fresh login
    auth.logout();
    assert(!auth.getCurrentUser(), 'User must be null after logout');
    assert(!sessionMgr.isAuthenticated(), 'Should be unauthenticated after logout');

    // Test Login with valid credentials
    const loggedIn = await auth.login('ms_clara', 'ClaraTeacher2026!');
    assert(loggedIn.id === teacher.id, 'Logged in user ID matches');
    assert(sessionMgr.isAuthenticated(), 'SessionManager must report authenticated');
    assert(sessionMgr.getCurrentUser()?.id === teacher.id, 'Current user must be Clara');
    assert(!!sessionMgr.getCurrentSession()?.token, 'A valid session token must exist');
    console.log('  ✓ Password verification and login credentials succeed');

    // 2. Invalid Credentials & Clear Error Messages
    console.log('[2/8] Testing error handling for invalid credentials...');
    let wrongPassThrown = false;
    let wrongPassMsg = '';
    try {
      await auth.login('ms_clara', 'IncorrectPassword123');
    } catch (err) {
      if (err instanceof ValidationError) {
        wrongPassThrown = true;
        wrongPassMsg = err.message;
      }
    }
    assert(wrongPassThrown, 'Should throw ValidationError on incorrect password');
    assert(wrongPassMsg.toLowerCase().includes('invalid'), 'Error message must clearly inform invalid credentials');

    let unknownUserThrown = false;
    try {
      await auth.login('ghost_user', 'AnyPassword123!');
    } catch (err) {
      if (err instanceof ValidationError) {
        unknownUserThrown = true;
      }
    }
    assert(unknownUserThrown, 'Should throw ValidationError for nonexistent username');
    console.log('  ✓ Clear validation errors on invalid credentials verified');

    // 3. Session Maintenance & Storage Persistence
    console.log('[3/8] Testing session maintenance in storage...');
    const activeSession = sessionMgr.getCurrentSession();
    assert(activeSession !== null, 'Active session must be present');
    if (!activeSession) throw new Error('Active session unexpectedly null');
    assert(activeSession.userId === teacher.id, 'Session userId matches Clara');
    assert(activeSession.expiresAt > Date.now(), 'Session expiration must be in the future');

    // Verify session data was serialized to storage
    const storedRaw = mockLocalStorage.getItem(SESSION_STORAGE_KEY);
    assert(storedRaw !== null, 'Session must be written to localStorage');
    const parsed = JSON.parse(storedRaw!) as UserSession;
    assert(parsed.token === activeSession?.token, 'Stored token must match memory token');
    console.log('  ✓ Session state accurately maintained and synchronized in storage');

    // 4. Session Restoration on Refresh / Startup
    console.log('[4/8] Testing session restoration after reload...');
    // Create new manager instance referencing same storage & db (simulating page reload)
    const freshSessionMgr = new SessionManager(db);
    const restoreResult = await freshSessionMgr.validateAndRestoreSession();
    assert(restoreResult.valid === true, 'Session should be successfully restored');
    if (restoreResult.valid) {
      assert(restoreResult.user.id === teacher.id, 'Restored user must be Clara');
      assert(restoreResult.session.userId === teacher.id, 'Restored session must be for Clara');
    }
    assert(freshSessionMgr.isAuthenticated(), 'Restored session manager must be authenticated');
    console.log('  ✓ Active session correctly restored from storage on app reload');

    // 5. Protected Screens & Authorization Guards
    console.log('[5/8] Testing route protection and role authorization guards...');
    // Register a student account
    const student = await auth.register({
      username: 'sam_student',
      password: 'SamStudent2026!',
      passwordConfirm: 'SamStudent2026!',
    });
    assert(student.role === 'student', 'Sam is a student');

    // When logged in as student:
    assert(sessionMgr.assertAuthenticated('practice screen').id === student.id, 'Student can access practice');
    let teacherOnlyBlocked = false;
    try {
      sessionMgr.assertTeacher('management tab');
    } catch {
      teacherOnlyBlocked = true;
    }
    assert(teacherOnlyBlocked, 'Student must be blocked from accessing teacher-only management screen');

    // When logged out:
    auth.logout();
    let unauthBlocked = false;
    try {
      sessionMgr.assertAuthenticated('protected dashboard');
    } catch {
      unauthBlocked = true;
    }
    assert(unauthBlocked, 'Unauthenticated user must be blocked from protected screens');
    console.log('  ✓ Screen access guards and role authorizations properly enforced');

    // 6. Logout Complete Session Purge
    console.log('[6/8] Testing that logout thoroughly purges session...');
    await auth.login('ms_clara', 'ClaraTeacher2026!');
    assert(sessionMgr.isAuthenticated(), 'Clara is authenticated');
    auth.logout();

    assert(!sessionMgr.isAuthenticated(), 'isAuthenticated must be false after logout');
    assert(sessionMgr.getCurrentUser() === null, 'Current user must be null after logout');
    assert(sessionMgr.getCurrentSession() === null, 'Current session must be null after logout');
    assert(mockLocalStorage.getItem(SESSION_STORAGE_KEY) === null, 'Session item must be deleted from storage');
    assert(mockSessionStorage.getItem(SESSION_STORAGE_KEY) === null, 'Session item must be deleted from session storage');
    console.log('  ✓ Logout thoroughly purges active session from both memory and disk storage');

    // 7. Switching Accounts Without Data Leakage
    console.log('[7/8] Testing account switching data segregation (Zero Leakage)...');
    // Login as Clara and create Clara's private progress and settings
    await auth.login('ms_clara', 'ClaraTeacher2026!');
    await db.saveSettings(teacher.id, { theme: 'dark', voiceMode: true });
    await db.recordWordAttempt(teacher.id, 'bonk1', 'clara_secret_word', true);

    // Switch to Sam
    auth.switchAccount(student);
    assert(sessionMgr.getCurrentUser()?.id === student.id, 'Active user is now Sam');

    // Verify Sam's settings are isolated
    const samSettings = await db.getSettings(student.id);
    assert(samSettings.theme === 'auto', "Sam's theme must not inherit Clara's 'dark' theme");
    assert(samSettings.voiceMode === false, "Sam's voiceMode must be default false");

    // Verify Sam's progress queries return zero Clara words
    const samProg = await db.getUserBookProgress(student.id, 'bonk1');
    assert(samProg.length === 0, "Sam must have 0 progress entries, no leak from Clara");

    // Ensure Sam cannot query Clara's progress
    const leakAttempt = await db.getById('userWordProgress', `${teacher.id}:bonk1:clara_secret_word`, student.id);
    assert(leakAttempt === null, "Direct query of Clara's progress by Sam returns null");
    console.log('  ✓ Switching accounts completely isolates state with zero cross-user exposure');

    // 8. Safe Handling of Expired & Invalid Sessions
    console.log('[8/8] Testing handling of expired, corrupt, and deleted-user sessions...');
    sessionMgr.clearSession();

    // Test A: Expired session
    const expiredSession: UserSession = {
      userId: teacher.id,
      username: teacher.username,
      role: teacher.role,
      token: 'expired_token_123',
      createdAt: Date.now() - 1000000,
      lastActiveAt: Date.now() - 1000000,
      expiresAt: Date.now() - 5000, // expired 5 seconds ago
      rememberMe: true,
    };
    mockLocalStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expiredSession));

    const expiredResult = await sessionMgr.validateAndRestoreSession();
    assert(expiredResult.valid === false, 'Expired session must be rejected');
    if (!expiredResult.valid) {
      assert(expiredResult.reason === 'expired', 'Reason must be expired');
    }
    assert(mockLocalStorage.getItem(SESSION_STORAGE_KEY) === null, 'Expired session must be purged from storage');

    // Test B: Corrupt session JSON
    mockLocalStorage.setItem(SESSION_STORAGE_KEY, '{corrupt_json: invalid!@#');
    const corruptResult = await sessionMgr.validateAndRestoreSession();
    assert(corruptResult.valid === false, 'Corrupted session must be rejected safely');
    if (!corruptResult.valid) {
      assert(corruptResult.reason === 'corrupt_data', 'Reason must be corrupt_data');
    }

    // Test C: Valid session format, but user account was deleted from IndexedDB
    const phantomSession: UserSession = {
      userId: 'user_deleted_person',
      username: 'deleted_person',
      role: 'student',
      token: 'phantom_token',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + 100000,
      rememberMe: true,
    };
    mockLocalStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(phantomSession));

    const phantomResult = await sessionMgr.validateAndRestoreSession();
    assert(phantomResult.valid === false, 'Deleted-user session must be rejected');
    if (!phantomResult.valid) {
      assert(phantomResult.reason === 'invalid_user', 'Reason must be invalid_user');
    }
    assert(mockLocalStorage.getItem(SESSION_STORAGE_KEY) === null, 'Invalid user session must be purged');
    console.log('  ✓ Expired, corrupt, and phantom sessions handled safely without crash');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 8 TASK 4 TEST SUITES PASSED! Session management is 100% verified.');
  } finally {
    db.close();
  }
}

runSessionTestSuite().catch((err) => {
  console.error('❌ Session test suite failed:', err);
  process.exit(1);
});
