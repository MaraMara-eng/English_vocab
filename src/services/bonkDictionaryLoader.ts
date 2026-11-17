/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDBManager, dbManager } from '../db/indexedDB.ts';
import { VocabularyType, VocabularyWord } from '../db/types.ts';
import { validateWord } from '../db/validators.ts';

export interface RawBonkWordEntry {
  id: string;
  english: string;
  armenian: string;
  russian: string;
  type: string;
  sourcePage: string;
  lesson: string;
  note?: string;
}

export interface RawBonkDictionary {
  schemaVersion: number;
  source: {
    application: string;
    file: string;
    bookId: string;
    bookName: string;
  };
  fieldDescription?: Record<string, string>;
  totalWords: number;
  words: RawBonkWordEntry[];
}

export const BONK1_BOOK_ID = 'bonk1';
export const BONK1_EXPECTED_COUNT = 2618;
export const BONK1_LESSONS_COUNT = 26;

let cachedRawDictionary: RawBonkDictionary | null = null;
let seedingPromise: Promise<number> | null = null;

/**
 * Normalizes English text into a searchable and deduplicatable alphanumeric key.
 */
export function normalizeBonkKey(text: string): string {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-_]+/g, '_')
    .replace(/[^a-z0-9_']/g, '');
}

/**
 * Dynamically loads and parses the Bonk 1 vocabulary JSON file.
 * Compatible with Vite dev/prod server, PWA offline, file:// contexts, and Node.js test runners.
 */
export async function loadBonkVocabularyJson(): Promise<RawBonkDictionary> {
  if (cachedRawDictionary) {
    return cachedRawDictionary;
  }

  // 1. In Node.js testing environment, read directly from the filesystem
  const isNode =
    typeof process !== 'undefined' &&
    process.versions &&
    Boolean(process.versions.node);

  if (isNode) {
    try {
      // Dynamic import to avoid bundling 'fs' in browser builds
      const fs = await import('fs');
      const path = await import('path');
      const candidates = [
        path.resolve(process.cwd(), 'public/vocab-quest-vocabulary.json'),
        path.resolve(process.cwd(), 'public/assets/aistudio/vocab-quest-vocabulary_89e785ae.json'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const rawText = fs.readFileSync(candidate, 'utf-8');
          const parsed = JSON.parse(rawText) as RawBonkDictionary;
          cachedRawDictionary = parsed;
          return parsed;
        }
      }
    } catch (nodeErr) {
      console.warn('Node.js filesystem load failed, falling back to fetch:', nodeErr);
    }
  }

  // 2. In browser environment, fetch dynamically via HTTP/HTTPS/PWA cache
  const urlCandidates = [
    '/vocab-quest-vocabulary.json',
    './vocab-quest-vocabulary.json',
    'vocab-quest-vocabulary.json',
    '/assets/aistudio/vocab-quest-vocabulary_89e785ae.json',
  ];

  let lastError: Error | null = null;

  for (const url of urlCandidates) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const parsed = (await response.json()) as RawBonkDictionary;
        if (parsed && Array.isArray(parsed.words)) {
          cachedRawDictionary = parsed;
          return parsed;
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(
    `Failed to dynamically load Bonk 1 vocabulary dictionary (vocab-quest-vocabulary.json). ` +
      (lastError ? lastError.message : 'File not accessible.')
  );
}

/**
 * Maps a raw Bonk 1 JSON entry to a validated VocabularyWord record,
 * preserving all original metadata and fields without alteration.
 */
export function mapRawEntryToVocabularyWord(raw: RawBonkWordEntry): VocabularyWord {
  const cleanLesson = String(raw.lesson || '').trim();
  const word: VocabularyWord = {
    id: raw.id, // e.g. "bonk1-0001"
    bookId: BONK1_BOOK_ID,
    lessonId: `${BONK1_BOOK_ID}:${cleanLesson}`,
    lesson: cleanLesson,
    en: raw.english,
    hy: raw.armenian,
    ru: raw.russian || undefined,
    // Explicit field preservation as requested by user
    english: raw.english,
    armenian: raw.armenian,
    russian: raw.russian || undefined,
    type: (raw.type as VocabularyType) || 'word',
    sourcePage: raw.sourcePage,
    page: raw.sourcePage,
    note: raw.note || undefined,
    hint: raw.note || undefined,
    normalizedEn: normalizeBonkKey(raw.english),
    createdBy: 'system',
    createdAt: 1700000000000,
  };

  validateWord(word);
  return word;
}

/**
 * Ensures that the complete 2,618 Bonk 1 vocabulary entries are loaded and stored in IndexedDB.
 * Completely idempotent: running this multiple times or refreshing the app will NEVER duplicate entries.
 */
export async function ensureBonkVocabularyLoaded(
  db: IndexedDBManager = dbManager
): Promise<{ count: number; wasSeeded: boolean }> {
  // Query existing Bonk 1 words in IndexedDB
  const existingWords = await db.query<VocabularyWord>('words', {});
  const existingBonkWords = existingWords.filter((w) => w.bookId === BONK1_BOOK_ID);

  if (existingBonkWords.length >= BONK1_EXPECTED_COUNT) {
    return { count: existingBonkWords.length, wasSeeded: false };
  }

  // Use a mutex promise to prevent concurrent duplicate seedings
  if (seedingPromise) {
    const count = await seedingPromise;
    return { count, wasSeeded: true };
  }

  seedingPromise = (async () => {
    try {
      const dictionary = await loadBonkVocabularyJson();
      if (!dictionary || !Array.isArray(dictionary.words)) {
        throw new Error('Invalid dictionary JSON format: "words" array missing');
      }

      const wordsToInsert: VocabularyWord[] = dictionary.words.map(mapRawEntryToVocabularyWord);

      // Perform fast batch insertion in a single transaction
      await db.bulkPut('words', wordsToInsert);

      return wordsToInsert.length;
    } finally {
      seedingPromise = null;
    }
  })();

  const seededCount = await seedingPromise;
  return { count: seededCount, wasSeeded: true };
}
