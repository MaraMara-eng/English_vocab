/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppSettings,
  Book,
  FailedWord,
  LearningSession,
  Lesson,
  StoreName,
  USER_SCOPED_STORES,
  User,
  UserWordProgress,
  VocabularyType,
  VocabularyWord,
} from './types.ts';

export class ValidationError extends Error {
  public field: string;
  constructor(field: string, message: string) {
    super(`Validation error for [${field}]: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(`Authorization error: ${message}`);
    this.name = 'AuthorizationError';
  }
}

export const VALID_VOCAB_TYPES: ReadonlySet<VocabularyType> = new Set<VocabularyType>([
  'word',
  'phrase',
  'combination',
  'sentence',
  'synonym',
  'antonym',
  'preposition',
  'colloquial',
]);

export interface PasswordStrengthResult {
  isValid: boolean;
  score: number; // 0 to 4
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  message?: string;
  feedback: string[];
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      score: 0,
      label: 'Too short',
      message: 'Password is required.',
      feedback: ['Enter a password of at least 6 characters.'],
    };
  }

  if (password.length < 6) {
    return {
      isValid: false,
      score: 0,
      label: 'Too short',
      message: 'Password must have at least 6 characters.',
      feedback: ['Password is too short (minimum 6 characters).'],
    };
  }

  let score = 0;
  const feedback: string[] = [];

  if (password.length >= 8) score += 1;
  else feedback.push('Use 8 or more characters for better security.');

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  else feedback.push('Mix uppercase and lowercase letters.');

  if (/\d/.test(password)) score += 1;
  else feedback.push('Add at least one number.');

  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  else feedback.push('Add a special character (e.g. !@#$%^&*).');

  let label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong' = 'Weak';
  if (score >= 4) label = 'Strong';
  else if (score === 3) label = 'Good';
  else if (score === 2) label = 'Fair';
  else label = 'Weak';

  return {
    isValid: true,
    score,
    label,
    feedback,
  };
}

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validateUser(u: Partial<User>): void {
  if (!u.id || typeof u.id !== 'string' || u.id.trim() === '') {
    throw new ValidationError('id', 'User ID must be a non-empty string');
  }
  if (!u.username || typeof u.username !== 'string') {
    throw new ValidationError('username', 'Username is required');
  }
  const cleanUsername = u.username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
    throw new ValidationError(
      'username',
      'Username must be 3-30 characters containing only letters, numbers, _, - or .'
    );
  }
  if (u.email) {
    if (typeof u.email !== 'string' || !validateEmail(u.email)) {
      throw new ValidationError('email', 'Invalid email address format');
    }
  }
  if (!u.passwordHash || typeof u.passwordHash !== 'string' || u.passwordHash.length < 10) {
    throw new ValidationError('passwordHash', 'Valid password hash is required');
  }
  if (!u.salt || typeof u.salt !== 'string' || u.salt.length < 4) {
    throw new ValidationError('salt', 'Cryptographic salt is required');
  }
  if (u.role !== 'teacher' && u.role !== 'student') {
    throw new ValidationError('role', 'Role must be either "teacher" or "student"');
  }
}

export function validateBook(b: Partial<Book>): void {
  if (!b.id || typeof b.id !== 'string' || b.id.trim() === '') {
    throw new ValidationError('id', 'Book ID must be a non-empty string');
  }
  if (!b.name || typeof b.name !== 'string' || b.name.trim() === '') {
    throw new ValidationError('name', 'Book name must be a non-empty string');
  }
  if (typeof b.isBuiltin !== 'boolean') {
    throw new ValidationError('isBuiltin', 'isBuiltin flag must be boolean');
  }
  if (!b.createdBy || typeof b.createdBy !== 'string') {
    throw new ValidationError('createdBy', 'createdBy is required');
  }
}

export function validateLesson(l: Partial<Lesson>): void {
  if (!l.id || typeof l.id !== 'string') {
    throw new ValidationError('id', 'Lesson ID is required');
  }
  if (!l.bookId || typeof l.bookId !== 'string') {
    throw new ValidationError('bookId', 'bookId is required');
  }
  if (l.lessonNumber === undefined || l.lessonNumber === null || String(l.lessonNumber).trim() === '') {
    throw new ValidationError('lessonNumber', 'lessonNumber is required');
  }
  if (!l.name || typeof l.name !== 'string') {
    throw new ValidationError('name', 'Lesson name is required');
  }
}

export function validateWord(w: Partial<VocabularyWord>): void {
  if (!w.id || typeof w.id !== 'string') {
    throw new ValidationError('id', 'Word ID is required');
  }
  if (!w.bookId || typeof w.bookId !== 'string') {
    throw new ValidationError('bookId', 'bookId is required');
  }
  if (!w.en || typeof w.en !== 'string' || w.en.trim() === '') {
    throw new ValidationError('en', 'English text is required');
  }
  if (!w.hy || typeof w.hy !== 'string' || w.hy.trim() === '') {
    if (!w.ru || typeof w.ru !== 'string' || w.ru.trim() === '') {
      throw new ValidationError('hy', 'Armenian translation is required');
    }
  }
  if (!w.type || !VALID_VOCAB_TYPES.has(w.type as VocabularyType)) {
    throw new ValidationError(
      'type',
      `Type must be one of: ${Array.from(VALID_VOCAB_TYPES).join(', ')}`
    );
  }
  if (!w.normalizedEn || typeof w.normalizedEn !== 'string') {
    throw new ValidationError('normalizedEn', 'normalizedEn key is required');
  }
}

export function validateUserWordProgress(p: Partial<UserWordProgress>): void {
  if (!p.id || typeof p.id !== 'string') {
    throw new ValidationError('id', 'Progress ID is required');
  }
  if (!p.userId || typeof p.userId !== 'string' || p.userId.trim() === '') {
    throw new ValidationError('userId', 'userId is required for user progress');
  }
  if (!p.bookId || typeof p.bookId !== 'string') {
    throw new ValidationError('bookId', 'bookId is required');
  }
  if (!p.wordKey || typeof p.wordKey !== 'string') {
    throw new ValidationError('wordKey', 'wordKey is required');
  }
  if (typeof p.streak !== 'number' || p.streak < 0 || !Number.isInteger(p.streak)) {
    throw new ValidationError('streak', 'streak must be a non-negative integer');
  }
  if (typeof p.failCount !== 'number' || p.failCount < 0 || !Number.isInteger(p.failCount)) {
    throw new ValidationError('failCount', 'failCount must be a non-negative integer');
  }
}

export function validateLearningSession(s: Partial<LearningSession>): void {
  if (!s.id || typeof s.id !== 'string') {
    throw new ValidationError('id', 'Session ID is required');
  }
  if (!s.userId || typeof s.userId !== 'string' || s.userId.trim() === '') {
    throw new ValidationError('userId', 'userId is required for learning session');
  }
  if (!s.bookId || typeof s.bookId !== 'string') {
    throw new ValidationError('bookId', 'bookId is required');
  }
  if (typeof s.totalCards !== 'number' || s.totalCards < 0) {
    throw new ValidationError('totalCards', 'totalCards must be non-negative');
  }
  if (typeof s.correctCount !== 'number' || s.correctCount < 0) {
    throw new ValidationError('correctCount', 'correctCount must be non-negative');
  }
  if (typeof s.missCount !== 'number' || s.missCount < 0) {
    throw new ValidationError('missCount', 'missCount must be non-negative');
  }
}

export function validateFailedWord(f: Partial<FailedWord>): void {
  if (!f.id || typeof f.id !== 'string') {
    throw new ValidationError('id', 'FailedWord ID is required');
  }
  if (!f.userId || typeof f.userId !== 'string' || f.userId.trim() === '') {
    throw new ValidationError('userId', 'userId is required for failed word record');
  }
  if (!f.bookId || typeof f.bookId !== 'string') {
    throw new ValidationError('bookId', 'bookId is required');
  }
  if (!f.wordKey || typeof f.wordKey !== 'string') {
    throw new ValidationError('wordKey', 'wordKey is required');
  }
  if (typeof f.remainingReviews !== 'number' || f.remainingReviews < 0) {
    throw new ValidationError('remainingReviews', 'remainingReviews must be non-negative');
  }
}

export function validateAppSettings(cfg: Partial<AppSettings>): void {
  if (!cfg.id || typeof cfg.id !== 'string') {
    throw new ValidationError('id', 'Settings ID is required');
  }
  if (!cfg.userId || typeof cfg.userId !== 'string' || cfg.userId.trim() === '') {
    throw new ValidationError('userId', 'userId is required for app settings');
  }
  if (cfg.theme && !['light', 'dark', 'auto'].includes(cfg.theme)) {
    throw new ValidationError('theme', 'theme must be "light", "dark", or "auto"');
  }
}

export function validateRecordForStore(storeName: StoreName, record: unknown, expectedUserId?: string): void {
  if (!record || typeof record !== 'object') {
    throw new ValidationError('record', `Record for store "${storeName}" must be an object`);
  }

  const rec = record as Record<string, unknown>;

  // Constraint check: User-specific record MUST have userId
  if (USER_SCOPED_STORES.has(storeName)) {
    if (!rec.userId || typeof rec.userId !== 'string' || rec.userId.trim() === '') {
      throw new ValidationError('userId', `Every record in "${storeName}" MUST contain a valid non-empty userId`);
    }

    if (expectedUserId && rec.userId !== expectedUserId) {
      throw new AuthorizationError(
        `Record belongs to user "${rec.userId}", but authenticated user context is "${expectedUserId}"`
      );
    }
  }

  switch (storeName) {
    case 'users':
      validateUser(rec as Partial<User>);
      break;
    case 'books':
      validateBook(rec as Partial<Book>);
      break;
    case 'lessons':
      validateLesson(rec as Partial<Lesson>);
      break;
    case 'words':
      validateWord(rec as Partial<VocabularyWord>);
      break;
    case 'userWordProgress':
      validateUserWordProgress(rec as Partial<UserWordProgress>);
      break;
    case 'learningSessions':
      validateLearningSession(rec as Partial<LearningSession>);
      break;
    case 'failedWords':
      validateFailedWord(rec as Partial<FailedWord>);
      break;
    case 'appSettings':
      validateAppSettings(rec as Partial<AppSettings>);
      break;
    default:
      throw new ValidationError('storeName', `Unknown store name: ${storeName}`);
  }
}
