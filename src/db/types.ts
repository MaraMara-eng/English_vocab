/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'teacher' | 'student';

export interface User {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
}

export interface Book {
  id: string;
  name: string;
  isBuiltin: boolean;
  createdBy: string; // 'system' or userId
  createdAt: number;
  description?: string;
}

export interface Lesson {
  id: string; // `${bookId}:${lessonNumber}`
  bookId: string;
  userId?: string;
  lessonNumber: string;
  name: string;
  description?: string;
  orderIndex: number;
  createdAt: number;
  updatedAt?: number;
}

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'preposition'
  | 'conjunction'
  | 'interjection'
  | 'idiom'
  | 'phrase'
  | 'other';

export type VocabularyType =
  | 'word'
  | 'phrase'
  | 'combination'
  | 'sentence'
  | 'synonym'
  | 'antonym'
  | 'preposition'
  | 'colloquial';

export interface VocabularyWord {
  id: string; // `${bookId}:${lessonNumber}:${normalizedKey}` or `${bookId}:${normalizedKey}`
  bookId: string;
  lessonId: string;
  lesson: string;
  userId?: string; // ID of the user who owns or created this word
  en: string; // English word or phrase
  hy: string; // Armenian translation
  ru?: string; // Russian translation (optional)
  english?: string; // Original field from Bonk 1 JSON
  armenian?: string; // Original field from Bonk 1 JSON
  russian?: string; // Original field from Bonk 1 JSON
  definition?: string; // English definition
  example?: string; // Example sentence
  partOfSpeech?: PartOfSpeech | string; // Part of speech if available
  pronunciation?: string; // Pronunciation or phonetic transcription (e.g. /ɪɡˈzæmpəl/)
  type: VocabularyType;
  page?: string;
  sourcePage?: string; // Original field from Bonk 1 JSON
  hint?: string;
  note?: string; // Original field from Bonk 1 JSON
  normalizedEn: string;
  createdBy: string; // 'system' or userId
  createdAt: number;
  updatedAt?: number;
}

export interface UserWordProgress {
  id: string; // `${userId}:${bookId}:${wordKey}`
  userId: string;
  bookId: string;
  wordId: string;
  wordKey: string;
  streak: number; // consecutive correct answers
  failCount: number; // total times missed
  isKnown: boolean; // streak >= 3
  lastPracticedAt: number;
  updatedAt: number;
}

export type SessionMode = 'lesson' | 'book' | 'failed' | 'cards' | 'match';

export interface LearningSession {
  id: string;
  userId: string;
  bookId: string;
  lesson?: string;
  mode: SessionMode;
  totalCards: number;
  correctCount: number;
  missCount: number;
  durationSeconds: number;
  startedAt: number;
  completedAt: number;
}

export interface FailedWord {
  id: string; // `${userId}:${bookId}:${wordKey}`
  userId: string;
  bookId: string;
  wordId: string;
  wordKey: string;
  remainingReviews: number; // decrements on correct answer, e.g., starts at 2
  totalMisses: number;
  lastMissedAt: number;
}

export interface AppSettings {
  id: string; // `settings:${userId}`
  userId: string;
  selectedBookId: string;
  selectedLesson: string;
  voiceMode: boolean;
  theme: 'light' | 'dark' | 'auto';
  soundEnabled: boolean;
  updatedAt: number;
}

export type StoreName =
  | 'users'
  | 'books'
  | 'lessons'
  | 'words'
  | 'userWordProgress'
  | 'learningSessions'
  | 'failedWords'
  | 'appSettings';

export interface StoreEntityMap {
  users: User;
  books: Book;
  lessons: Lesson;
  words: VocabularyWord;
  userWordProgress: UserWordProgress;
  learningSessions: LearningSession;
  failedWords: FailedWord;
  appSettings: AppSettings;
}

export const USER_SCOPED_STORES: ReadonlySet<StoreName> = new Set<StoreName>([
  'userWordProgress',
  'learningSessions',
  'failedWords',
  'appSettings',
]);

export interface UserDataBackup {
  version: number;
  exportedAt: number;
  userId: string;
  user?: User;
  progress: UserWordProgress[];
  sessions: LearningSession[];
  failedWords: FailedWord[];
  settings?: AppSettings;
}

export interface FullDatabaseBackup {
  version: number;
  exportedAt: number;
  appVersion: string;
  data: {
    users: User[];
    books: Book[];
    lessons: Lesson[];
    words: VocabularyWord[];
    userWordProgress: UserWordProgress[];
    learningSessions: LearningSession[];
    failedWords: FailedWord[];
    appSettings: AppSettings[];
  };
}
