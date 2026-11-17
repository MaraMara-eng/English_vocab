/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { User } from '../db/types.ts';
import { ValidationError, validatePasswordStrength } from '../db/validators.ts';
import { AuthService, hashPassword } from '../services/authService.ts';

// Make IDBKeyRange globally available for the Node test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAuthTestSuite() {
  console.log('--- Starting User Registration & Auth Test Suite ---');
  const dbName = `TestAuthDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const auth = new AuthService(db);

  try {
    // 1. Password Strength Validation Tests
    console.log('[1/7] Testing password strength validation logic...');
    const tooShort = validatePasswordStrength('abc');
    assert(!tooShort.isValid, 'Password < 6 chars must be invalid');
    assert(tooShort.score === 0, 'Password < 6 chars should have score 0');

    const simple = validatePasswordStrength('abcdef');
    assert(simple.isValid, '6 character basic password is valid but weak');
    assert(simple.label === 'Weak', 'Simple 6-char should be Weak');

    const strong = validatePasswordStrength('P@ssw0rd!Secure2026');
    assert(strong.isValid, 'Complex password must be valid');
    assert(strong.score >= 3, 'Complex password should have high score');
    console.log('  ✓ Password strength validation accurate with scores and labels');

    // 2. Field Validation & Error Messages
    console.log('[2/7] Testing registration input validation & error reporting...');
    
    // Test missing username
    let missingUserErr = false;
    try {
      await auth.register({
        username: '',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'username') {
        missingUserErr = true;
      }
    }
    assert(missingUserErr, 'Should reject empty username with ValidationError');

    // Test invalid characters in username
    let invalidCharErr = false;
    try {
      await auth.register({
        username: 'user@name!',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'username') {
        invalidCharErr = true;
      }
    }
    assert(invalidCharErr, 'Should reject invalid characters in username');

    // Test password confirmation mismatch
    let mismatchErr = false;
    try {
      await auth.register({
        username: 'anna_smith',
        password: 'Password123!',
        passwordConfirm: 'Password456!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'passwordConfirm') {
        mismatchErr = true;
      }
    }
    assert(mismatchErr, 'Should reject mismatched password confirmation');

    // Test invalid email format
    let invalidEmailErr = false;
    try {
      await auth.register({
        username: 'anna_smith',
        email: 'not-an-email',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'email') {
        invalidEmailErr = true;
      }
    }
    assert(invalidEmailErr, 'Should reject malformed email address');
    console.log('  ✓ Validation error boundaries and field messages verified');

    // 3. User Registration & First-User Teacher Role
    console.log('[3/7] Testing successful user registration & role assignment...');
    const user1 = await auth.register({
      username: 'teacher_anna',
      email: 'anna@example.com',
      password: 'StrongPassword123!',
      passwordConfirm: 'StrongPassword123!',
    });

    assert(user1.username === 'teacher_anna', 'Username must match normalized input');
    assert(user1.role === 'teacher', 'First created user must be assigned "teacher" role');
    assert(user1.email === 'anna@example.com', 'Email must be stored');
    assert(user1.id === 'user_teacher_anna', 'User ID must be properly formatted');
    assert(!!user1.salt, 'User must have a cryptographically random salt');
    assert(!!user1.passwordHash, 'User must have a PBKDF2 hash');

    // Verify plaintext password is NEVER stored
    assert(!('password' in (user1 as unknown as Record<string, unknown>)), 'Plaintext password must NOT exist on user object');
    const storedRecord = await db.getById<User>('users', user1.id);
    assert(storedRecord !== null, 'User record must exist in IndexedDB users store');
    assert(!('password' in (storedRecord as unknown as Record<string, unknown>)), 'Plaintext password must NOT exist in IndexedDB');
    
    // Verify PBKDF2 hash computation with stored salt
    const verifyHash = await hashPassword('StrongPassword123!', user1.salt);
    assert(verifyHash === user1.passwordHash, 'Stored hash must match PBKDF2 derived bits');

    // Second user should be a student
    const user2 = await auth.register({
      username: 'student_bob',
      email: 'bob@example.com',
      password: 'BobSecurePassword99!',
      passwordConfirm: 'BobSecurePassword99!',
    });
    assert(user2.role === 'student', 'Subsequent user must be assigned "student" role');
    assert(user2.salt !== user1.salt, 'Each user must have a unique random salt');
    console.log('  ✓ Registration successful: passwords securely hashed with PBKDF2 & unique salts');

    // 4. Duplicate Username & Email Prevention
    console.log('[4/7] Testing duplicate username & email rejection...');
    let dupUserBlocked = false;
    try {
      await auth.register({
        username: 'teacher_anna', // same username
        password: 'AnotherPassword123!',
        passwordConfirm: 'AnotherPassword123!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'username') {
        dupUserBlocked = true;
      }
    }
    assert(dupUserBlocked, 'Must reject duplicate username');

    let dupEmailBlocked = false;
    try {
      await auth.register({
        username: 'new_person',
        email: 'anna@example.com', // same email as user1
        password: 'AnotherPassword123!',
        passwordConfirm: 'AnotherPassword123!',
      });
    } catch (err) {
      if (err instanceof ValidationError && err.field === 'email') {
        dupEmailBlocked = true;
      }
    }
    assert(dupEmailBlocked, 'Must reject duplicate email address');
    console.log('  ✓ Duplicate username and email prevention fully enforced');

    // 5. User Login & Credential Verification
    console.log('[5/7] Testing authentication / login with created credentials...');
    // Login with wrong password
    let wrongPassBlocked = false;
    try {
      await auth.login('teacher_anna', 'WrongPassword123');
    } catch (err) {
      if (err instanceof ValidationError) {
        wrongPassBlocked = true;
      }
    }
    assert(wrongPassBlocked, 'Login must reject incorrect password');

    // Login with nonexistent user
    let unknownUserBlocked = false;
    try {
      await auth.login('nonexistent_user', 'SomePassword123!');
    } catch (err) {
      if (err instanceof ValidationError) {
        unknownUserBlocked = true;
      }
    }
    assert(unknownUserBlocked, 'Login must reject nonexistent username');

    // Valid login
    const loggedInUser = await auth.login('teacher_anna', 'StrongPassword123!');
    assert(loggedInUser.id === user1.id, 'Logged in user ID must match registered ID');
    assert(auth.getCurrentUser()?.id === user1.id, 'AuthService state must record current user');
    console.log('  ✓ User authentication and login credential verification passed');

    // 6. Independent Local Workspace Verification
    console.log('[6/7] Testing independent local workspace provisioning...');
    const annaSettings = await db.getSettings(user1.id);
    const bobSettings = await db.getSettings(user2.id);
    assert(annaSettings.userId === user1.id, 'Anna settings must have userId = user1.id');
    assert(bobSettings.userId === user2.id, 'Bob settings must have userId = user2.id');

    // Mutate Anna's settings and verify Bob is unaffected
    await db.saveSettings(user1.id, { theme: 'dark', voiceMode: true });
    const annaUpdated = await db.getSettings(user1.id);
    const bobUnchanged = await db.getSettings(user2.id);
    assert(annaUpdated.theme === 'dark', "Anna's theme should be dark");
    assert(bobUnchanged.theme === 'auto', "Bob's theme must remain default 'auto'");
    console.log('  ✓ Each registered user possesses an isolated local workspace');

    // 7. Logout & Session Cleanup
    console.log('[7/7] Testing logout cleanup...');
    auth.logout();
    assert(auth.getCurrentUser() === null, 'Current user must be null after logout');
    console.log('  ✓ Logout properly clears session state');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 7 AUTH TEST SUITES PASSED! Local registration & auth is fully verified.');
  } finally {
    db.close();
  }
}

runAuthTestSuite().catch((err) => {
  console.error('❌ Auth test suite failed:', err);
  process.exit(1);
});
