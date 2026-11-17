/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { dbManager, IndexedDBManager } from '../db/indexedDB.ts';
import { User, UserRole } from '../db/types.ts';
import { bytesToBase64 } from './authService.ts';

export interface UserSession {
  userId: string;
  username: string;
  role: UserRole;
  token: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  rememberMe: boolean;
}

export type SessionValidationResult =
  | { valid: true; user: User; session: UserSession }
  | { valid: false; reason: 'no_session' | 'expired' | 'invalid_user' | 'corrupt_data'; message: string };

export const SESSION_STORAGE_KEY = 'vq:session';
export const LAST_USER_KEY = 'vq:last_user';

// Session duration: 7 days if rememberMe, 24 hours if temporary
export const SESSION_DURATION_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_DURATION_TEMPORARY_MS = 24 * 60 * 60 * 1000;

export class SessionManager {
  private currentSession: UserSession | null = null;
  private currentUser: User | null = null;
  private db: IndexedDBManager;

  constructor(db: IndexedDBManager = dbManager) {
    this.db = db;
  }

  /**
   * Cryptographically generate a secure random session token.
   */
  public generateSessionToken(): string {
    const cryptoObj =
      typeof crypto !== 'undefined'
        ? crypto
        : (globalThis as unknown as { crypto: Crypto }).crypto;

    if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
      // Fallback for non-crypto environments in tests
      return 'token_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    const tokenBytes = new Uint8Array(24);
    cryptoObj.getRandomValues(tokenBytes);
    return bytesToBase64(tokenBytes);
  }

  /**
   * Create and persist a new user session upon successful login or registration.
   */
  public createSession(user: User, rememberMe: boolean = true): UserSession {
    const now = Date.now();
    const duration = rememberMe ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_TEMPORARY_MS;
    const session: UserSession = {
      userId: user.id,
      username: user.username,
      role: user.role,
      token: this.generateSessionToken(),
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + duration,
      rememberMe,
    };

    this.currentSession = session;
    this.currentUser = user;

    this.saveSessionToStorage(session);
    this.saveLastUser(user.username);

    return session;
  }

  /**
   * Save session to browser storage safely (handles exceptions in restricted iframes).
   */
  private saveSessionToStorage(session: UserSession): void {
    try {
      const json = JSON.stringify(session);
      if (session.rememberMe) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SESSION_STORAGE_KEY, json);
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } else {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(SESSION_STORAGE_KEY, json);
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }
    } catch {
      // Storage unavailable or quota exceeded
    }
  }

  /**
   * Remove session from browser storage.
   */
  private removeSessionFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable
    }
  }

  /**
   * Store last authenticated username for quick pre-filling.
   */
  public saveLastUser(username: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_USER_KEY, username);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Retrieve last authenticated username if present.
   */
  public getLastUser(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(LAST_USER_KEY) || '';
      }
    } catch {
      // Ignore
    }
    return '';
  }

  /**
   * Validate and restore active session on page refresh or startup.
   * Handles expired sessions, corrupt tokens, and accounts deleted from IndexedDB.
   */
  public async validateAndRestoreSession(): Promise<SessionValidationResult> {
    let sessionData: UserSession | null = null;

    try {
      let raw: string | null = null;
      if (typeof sessionStorage !== 'undefined') {
        raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      }
      if (!raw && typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(SESSION_STORAGE_KEY);
      }

      if (!raw) {
        return { valid: false, reason: 'no_session', message: 'No active session.' };
      }

      sessionData = JSON.parse(raw);
    } catch {
      this.clearSession();
      return { valid: false, reason: 'corrupt_data', message: 'Session data is corrupt.' };
    }

    if (!sessionData || !sessionData.userId || !sessionData.token || !sessionData.expiresAt) {
      this.clearSession();
      return { valid: false, reason: 'corrupt_data', message: 'Session structure is invalid.' };
    }

    const now = Date.now();
    // Check if session has expired
    if (now > sessionData.expiresAt) {
      this.clearSession();
      return {
        valid: false,
        reason: 'expired',
        message: 'Your login session has expired. Please sign in again to continue.',
      };
    }

    // Verify user record actually exists in IndexedDB
    try {
      const user = await this.db.getById<User>('users', sessionData.userId);
      if (!user) {
        this.clearSession();
        return {
          valid: false,
          reason: 'invalid_user',
          message: 'The account associated with this session no longer exists.',
        };
      }

      // Refresh sliding session window
      const duration = sessionData.rememberMe ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_TEMPORARY_MS;
      sessionData.lastActiveAt = now;
      sessionData.expiresAt = now + duration;
      sessionData.role = user.role; // sync role in case teacher updated it

      this.currentSession = sessionData;
      this.currentUser = user;
      this.saveSessionToStorage(sessionData);

      return { valid: true, user, session: sessionData };
    } catch (err) {
      this.clearSession();
      return {
        valid: false,
        reason: 'invalid_user',
        message: 'Unable to verify session against local database.',
      };
    }
  }

  /**
   * Terminate active session and clear in-memory and local storage state.
   */
  public clearSession(): void {
    this.currentSession = null;
    this.currentUser = null;
    this.removeSessionFromStorage();

    // Cancel any active browser speech synthesis
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Check if a valid authenticated user session currently exists.
   */
  public isAuthenticated(): boolean {
    if (!this.currentSession || !this.currentUser) {
      return false;
    }
    return Date.now() <= this.currentSession.expiresAt;
  }

  /**
   * Get active authenticated user, or null if unauthenticated.
   */
  public getCurrentUser(): User | null {
    if (!this.isAuthenticated()) {
      return null;
    }
    return this.currentUser;
  }

  /**
   * Get active session object.
   */
  public getCurrentSession(): UserSession | null {
    if (!this.isAuthenticated()) {
      return null;
    }
    return this.currentSession;
  }

  /**
   * Touch session to update activity and extend sliding expiration.
   */
  public touchSession(): void {
    if (this.currentSession) {
      const now = Date.now();
      const duration = this.currentSession.rememberMe ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_TEMPORARY_MS;
      this.currentSession.lastActiveAt = now;
      this.currentSession.expiresAt = now + duration;
      this.saveSessionToStorage(this.currentSession);
    }
  }

  /**
   * Guard a screen or operation: throws if user is not authenticated.
   */
  public assertAuthenticated(screenName: string = 'this screen'): User {
    const user = this.getCurrentUser();
    if (!user) {
      throw new Error(`Authentication required: Please sign in to access ${screenName}.`);
    }
    return user;
  }

  /**
   * Guard a teacher-only screen or operation: throws if user is not a teacher.
   */
  public assertTeacher(screenName: string = 'this management screen'): User {
    const user = this.assertAuthenticated(screenName);
    if (user.role !== 'teacher') {
      throw new Error(`Access denied: Only teachers can access ${screenName}.`);
    }
    return user;
  }
}

export const sessionManager = new SessionManager();
