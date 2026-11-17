/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager, getKeyRange } from '../db/indexedDB.ts';
import { User, UserRole } from '../db/types.ts';
import {
  PasswordStrengthResult,
  ValidationError,
  validateEmail,
  validatePasswordStrength,
} from '../db/validators.ts';
import { SessionManager, sessionManager, UserSession } from './sessionManager.ts';

export interface RegistrationRequest {
  username: string;
  password: string;
  passwordConfirm: string;
  email?: string;
  rememberMe?: boolean;
}

export interface AuthSession {
  user: User;
  token: string;
  signedInAt: number;
}

/**
 * Convert Uint8Array to Base64 string in browser or Node.js.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * Convert Base64 string to Uint8Array.
 */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Cryptographic helper generating a secure 16-byte random salt.
 */
export function generateSalt(): string {
  const cryptoObj =
    typeof crypto !== 'undefined'
      ? crypto
      : (globalThis as unknown as { crypto: Crypto }).crypto;

  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (crypto.getRandomValues) is not available');
  }

  const saltBytes = new Uint8Array(16);
  cryptoObj.getRandomValues(saltBytes);
  return bytesToBase64(saltBytes);
}

/**
 * PBKDF2 password derivation using Web Crypto API:
 * SHA-256 with 100,000 iterations for secure local storage.
 */
export async function hashPassword(password: string, saltBase64: string): Promise<string> {
  const cryptoObj =
    typeof crypto !== 'undefined'
      ? crypto
      : (globalThis as unknown as { crypto: Crypto }).crypto;

  const subtle = cryptoObj?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available');
  }

  const encoder = new TextEncoder();
  const passwordKey = await subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const saltBytes = base64ToBytes(saltBase64);

  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  );

  return bytesToBase64(new Uint8Array(derivedBits));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Authentication Service managing registration, password security,
 * and isolated workspace initialization.
 */
export class AuthService {
  private readonly db: IndexedDBManager;
  private readonly sessionMgr: SessionManager;
  private currentUser: User | null = null;

  constructor(
    db: IndexedDBManager = dbManager,
    sessionMgr: SessionManager = sessionManager
  ) {
    this.db = db;
    this.sessionMgr = sessionMgr;
  }

  public getSessionManager(): SessionManager {
    return this.sessionMgr;
  }

  public getCurrentUser(): User | null {
    return this.sessionMgr.getCurrentUser() || this.currentUser;
  }

  public getCurrentSession(): UserSession | null {
    return this.sessionMgr.getCurrentSession();
  }

  public setCurrentUser(user: User | null): void {
    this.currentUser = user;
    if (user) {
      this.sessionMgr.createSession(user, true);
    } else {
      this.sessionMgr.clearSession();
    }
  }

  public async restoreSession() {
    const res = await this.sessionMgr.validateAndRestoreSession();
    if (res.valid) {
      this.currentUser = res.user;
    } else {
      this.currentUser = null;
    }
    return res;
  }

  public checkPasswordStrength(password: string): PasswordStrengthResult {
    return validatePasswordStrength(password);
  }

  /**
   * Register a new user in the local IndexedDB database.
   * Performs validation, checks duplicates, generates salt + PBKDF2 hash,
   * assigns role, and provisions the user's isolated workspace settings.
   */
  public async register(request: RegistrationRequest): Promise<User> {
    // 1. Username validation
    if (!request.username || typeof request.username !== 'string') {
      throw new ValidationError('username', 'Username is required');
    }
    const cleanUsername = request.username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
      throw new ValidationError(
        'username',
        'Username must be between 3 and 30 characters and contain only letters, numbers, _, - or .'
      );
    }

    // 2. Email validation (if provided)
    let cleanEmail: string | undefined = undefined;
    if (request.email && request.email.trim()) {
      cleanEmail = request.email.trim().toLowerCase();
      if (!validateEmail(cleanEmail)) {
        throw new ValidationError('email', 'Please enter a valid email address (e.g., student@example.com)');
      }
    }

    // 3. Password matching
    if (!request.password) {
      throw new ValidationError('password', 'Password is required');
    }
    if (request.password !== request.passwordConfirm) {
      throw new ValidationError('passwordConfirm', 'Passwords do not match');
    }

    // 4. Password strength validation
    const strength = validatePasswordStrength(request.password);
    if (!strength.isValid) {
      throw new ValidationError('password', strength.message || 'Password does not meet minimum strength requirements');
    }

    // 5. Check duplicate username in IndexedDB
    let existingUsers: User[] = [];
    try {
      existingUsers = await this.db.query<User>('users', {
        indexName: 'username',
        range: getKeyRange().only(cleanUsername),
      });
    } catch {
      // Fallback query if index range unsupported
      existingUsers = await this.db.query<User>('users', {});
    }
    const usernameTaken = existingUsers.some(
      (u) => u.username.toLowerCase() === cleanUsername
    );
    if (usernameTaken) {
      throw new ValidationError('username', `The username "${cleanUsername}" is already taken.`);
    }

    // 6. Check duplicate email in IndexedDB (if email provided)
    if (cleanEmail) {
      const allUsers = await this.db.query<User>('users', {});
      const emailTaken = allUsers.some(
        (u) => u.email && u.email.toLowerCase() === cleanEmail
      );
      if (emailTaken) {
        throw new ValidationError('email', `An account with email "${cleanEmail}" already exists.`);
      }
    }

    // 7. Check if this is the first registered user
    const totalUsers = await this.db.query<User>('users', {});
    const isFirstUser = totalUsers.length === 0;
    const role: UserRole = isFirstUser ? 'teacher' : 'student';

    // 8. Generate salt and hash with PBKDF2 (never plain text)
    const salt = generateSalt();
    const passwordHash = await hashPassword(request.password, salt);

    const now = Date.now();
    const userId = `user_${cleanUsername}`;

    const newUser: User = {
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      salt,
      role,
      createdAt: now,
      updatedAt: now,
    };

    // 9. Save user record in IndexedDB
    await this.db.create('users', newUser);

    // 10. Initialize the user's independent workspace settings
    await this.db.getSettings(userId);

    // 11. Create persistent authenticated session
    this.sessionMgr.createSession(newUser, request.rememberMe ?? true);
    this.currentUser = newUser;

    return newUser;
  }

  /**
   * Authenticate a registered user against IndexedDB.
   */
  public async login(
    username: string,
    password: string,
    rememberMe: boolean = true
  ): Promise<User> {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) {
      throw new ValidationError('username', 'Username is required');
    }
    if (!password) {
      throw new ValidationError('password', 'Password is required');
    }

    let matches: User[] = [];
    try {
      matches = await this.db.query<User>('users', {
        indexName: 'username',
        range: getKeyRange().only(cleanUsername),
      });
    } catch {
      matches = await this.db.query<User>('users', {});
    }
    const user = matches.find((u) => u.username.toLowerCase() === cleanUsername);

    if (!user) {
      throw new ValidationError('credentials', 'Invalid username or password');
    }

    const testHash = await hashPassword(password, user.salt);
    const isValid = secureCompare(testHash, user.passwordHash);

    if (!isValid) {
      throw new ValidationError('credentials', 'Invalid username or password');
    }

    // Update last signed in timestamp
    const updated = await this.db.update<User>(
      'users',
      user.id,
      { updatedAt: Date.now() }
    );

    // Establish active local session
    this.sessionMgr.createSession(updated, rememberMe);
    this.currentUser = updated;
    return updated;
  }

  /**
   * Securely terminate active session and clean up memory and storage.
   */
  public logout(): void {
    this.sessionMgr.clearSession();
    this.currentUser = null;
  }

  /**
   * Switch between accounts safely without data leakage between workspaces.
   */
  public switchAccount(targetUser: User): void {
    this.logout();
    this.sessionMgr.createSession(targetUser, true);
    this.currentUser = targetUser;
  }

  /**
   * Permanently delete a user account and all associated data.
   * Requires password confirmation to verify ownership before deletion.
   * Terminates active session and clears local storage if current user is deleted.
   */
  public async deleteAccount(
    userId: string,
    passwordConfirm: string
  ): Promise<{
    success: boolean;
    deletedCounts: {
      user: number;
      books: number;
      lessons: number;
      words: number;
      progress: number;
      sessions: number;
      failedWords: number;
      settings: number;
    };
  }> {
    if (!userId) {
      throw new ValidationError('userId', 'User ID is required for account deletion');
    }
    if (!passwordConfirm) {
      throw new ValidationError('password', 'Please enter your password to confirm account deletion.');
    }

    const user = await this.db.getById<User>('users', userId);
    if (!user) {
      throw new ValidationError('user', 'Account not found.');
    }

    // Verify password confirmation against stored PBKDF2 hash
    const testHash = await hashPassword(passwordConfirm, user.salt);
    const isPasswordValid = secureCompare(testHash, user.passwordHash);

    if (!isPasswordValid) {
      throw new ValidationError('password', 'Incorrect password. Account deletion was not performed.');
    }

    // Cascade delete user data across all object stores
    const res = await this.db.deleteUserAccount(userId);

    // If deleting the active user session, log out completely
    if (this.currentUser?.id === userId || this.sessionMgr.getCurrentUser()?.id === userId) {
      this.logout();
    }

    // Clear remembered username if it matches deleted account
    if (this.sessionMgr.getLastUser() === user.username) {
      this.sessionMgr.saveLastUser('');
    }

    return {
      success: true,
      deletedCounts: res.deletedCounts,
    };
  }
}

export const authService = new AuthService();
