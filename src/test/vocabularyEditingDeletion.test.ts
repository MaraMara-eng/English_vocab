/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { UserWordProgress, VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';
import { VocabularyService } from '../services/vocabularyService.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runVocabularyEditingDeletionTestSuite() {
  console.log('--- Starting Task 10: Vocabulary Editing and Deletion Test Suite ---');
  const dbName = `TestVocabEditDelDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabService = new VocabularyService(db, bookService, lessonService);

  try {
    const userAlice = 'user_alice_editor';
    const userBob = 'user_bob_intruder';

    // 1. Setup custom textbook and lesson for Alice
    console.log('[1/8] Setting up custom textbook and initial words for Alice...');
    await bookService.ensureDefaultBooks();
    const aliceBook = await bookService.createBook(userAlice, {
      name: 'Alice Advanced English',
      description: 'Linguistics and literature study set.',
    });

    const lesson1 = await lessonService.createLesson(userAlice, aliceBook.id, {
      lessonNumber: 'Unit 1',
      name: 'Stylistics & Rhetoric',
      orderIndex: 1,
    });

    const word1 = await vocabService.addWord(userAlice, aliceBook.id, 'Unit 1', {
      en: 'metaphor',
      hy: 'փոխաբերություն',
      ru: 'метафора',
      definition: 'A figure of speech in which a word or phrase is applied to an object or action.',
      example: 'The snow is a white blanket.',
      partOfSpeech: 'noun',
      pronunciation: '/ˈmɛtəfɔːr/',
      type: 'word',
      page: '12',
      hint: 'Rhetorical device',
    });
    assert(Boolean(word1.id), 'Initial word created with ID');
    console.log('  ✓ Initial word created successfully in IndexedDB');

    // 2. Allow users to edit translations, definitions, and example sentences
    console.log('[2/8] Testing editing translations, definitions, and example sentences...');
    const updatedContent = await vocabService.updateWord(userAlice, word1.id, {
      hy: 'փոխաբերություն (այլաբանական իմաստ)',
      ru: 'метафора (переносное значение)',
      definition: 'A rhetorical figure of speech directly referring to one thing by mentioning another.',
      example: 'Her tears were a river flowing down her cheeks.',
    });

    assert(
      updatedContent.hy === 'փոխաբերություն (այլաբանական իմաստ)',
      'Armenian translation updated'
    );
    assert(
      updatedContent.ru === 'метафора (переносное значение)',
      'Russian translation updated'
    );
    assert(
      updatedContent.definition ===
        'A rhetorical figure of speech directly referring to one thing by mentioning another.',
      'Definition updated'
    );
    assert(
      updatedContent.example === 'Her tears were a river flowing down her cheeks.',
      'Example updated'
    );

    // Verify immediately saved to IndexedDB
    const directCheck1 = await db.getById<VocabularyWord>('words', word1.id);
    assert(directCheck1?.hy === 'փոխաբերություն (այլաբանական իմաստ)', 'Saved immediately in IndexedDB');
    console.log('  ✓ Translations, definitions, and examples updated and verified in IndexedDB.');

    // 3. Allow users to update pronunciation, part of speech, type, notes, and pages
    console.log('[3/8] Testing updating pronunciation, part of speech, type, notes, and page numbers...');
    const updatedMetadata = await vocabService.updateWord(userAlice, word1.id, {
      pronunciation: '/ˈmɛtəfər/',
      partOfSpeech: 'noun',
      type: 'phrase',
      page: '15',
      note: 'Key device for literary analysis',
    });

    assert(updatedMetadata.pronunciation === '/ˈmɛtəfər/', 'Pronunciation updated');
    assert(updatedMetadata.type === 'phrase', 'Type updated to phrase');
    assert(updatedMetadata.page === '15', 'Page updated to 15');
    assert(updatedMetadata.note === 'Key device for literary analysis', 'Note updated');
    console.log('  ✓ Pronunciation, part of speech, type, and notes updated successfully.');

    // 4. Preserve the word’s learning history when editing content and renaming
    console.log('[4/8] Testing learning history preservation across word edits...');
    // Mark the word as known and record attempts
    await vocabService.setWordKnownStatus(userAlice, word1.id, true);
    // Directly record an attempt to set streak to 5 and failCount to 2
    const progressId = `${userAlice}:${word1.bookId}:${word1.normalizedEn}`;
    const initialProgress = await db.getById<UserWordProgress>('userWordProgress', progressId, userAlice);
    assert(initialProgress !== null, 'Progress record must exist');
    if (initialProgress) {
      await db.update<UserWordProgress>(
        'userWordProgress',
        progressId,
        { streak: 5, failCount: 2, isKnown: true, lastPracticedAt: Date.now() - 5000 },
        userAlice
      );
    }

    // Now edit the English word itself (rename / fix spelling from "metaphor" to "extended metaphor")
    const renamedWord = await vocabService.updateWord(userAlice, word1.id, {
      en: 'extended metaphor',
    });
    assert(renamedWord.en === 'extended metaphor', 'English word updated');
    assert(renamedWord.normalizedEn === 'extended_metaphor', 'Normalized key updated');

    // Retrieve word with status and verify learning history (streak, failCount, isKnown) is completely preserved!
    const wordsWithStatus = await vocabService.getWordsWithStatus(userAlice, aliceBook.id, 'Unit 1');
    const matchedWord = wordsWithStatus.find((w) => w.id === word1.id);
    assert(matchedWord !== undefined, 'Renamed word found in query');
    assert(matchedWord?.streak === 5, `Streak must be preserved at 5, got ${matchedWord?.streak}`);
    assert(matchedWord?.failCount === 2, `Fail count must be preserved at 2, got ${matchedWord?.failCount}`);
    assert(matchedWord?.isKnown === true, 'isKnown status must remain true');
    console.log('  ✓ Learning history (streak 5, failCount 2, isKnown true) 100% preserved after edit.');

    // 5. Validation and duplicate prevention during editing
    console.log('[5/8] Testing input validation and duplicate prevention during word edits...');
    // Add second word in same lesson
    const word2 = await vocabService.addWord(userAlice, aliceBook.id, 'Unit 1', {
      en: 'hyperbole',
      hy: 'չափազանցություն',
      type: 'word',
    });

    // Attempt to edit word2 to have same English as word1 ("extended metaphor")
    let duplicateRejected = false;
    try {
      await vocabService.updateWord(userAlice, word2.id, { en: 'extended metaphor' });
    } catch (err) {
      if (err instanceof ValidationError) {
        duplicateRejected = true;
      }
    }
    assert(duplicateRejected, 'Duplicate English word in the same lesson must be rejected');

    // Attempt to set empty English text
    let emptyEnRejected = false;
    try {
      await vocabService.updateWord(userAlice, word2.id, { en: '   ' });
    } catch (err) {
      if (err instanceof ValidationError) {
        emptyEnRejected = true;
      }
    }
    assert(emptyEnRejected, 'Empty English text must be rejected');

    // Attempt to set empty Armenian translation
    let emptyHyRejected = false;
    try {
      await vocabService.updateWord(userAlice, word2.id, { hy: '   ' });
    } catch (err) {
      if (err instanceof ValidationError) {
        emptyHyRejected = true;
      }
    }
    assert(emptyHyRejected, 'Empty Armenian translation must be rejected');
    console.log('  ✓ Field validation and duplicate detection verified during editing.');

    // 6. Cross-user modification and built-in protection
    console.log('[6/8] Testing cross-user authorization guards and built-in protection...');
    // User Bob tries to edit User Alice's word
    let bobEditRejected = false;
    try {
      await vocabService.updateWord(userBob, word1.id, { en: 'hacked metaphor' });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        bobEditRejected = true;
      }
    }
    assert(bobEditRejected, 'Bob cannot edit Alice’s word (AuthorizationError)');

    // User Bob tries to delete User Alice's word
    let bobDeleteRejected = false;
    try {
      await vocabService.deleteWord(userBob, word1.id);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        bobDeleteRejected = true;
      }
    }
    assert(bobDeleteRejected, 'Bob cannot delete Alice’s word (AuthorizationError)');

    // Attempting to edit or delete a built-in Bonk 1 word
    let builtinEditRejected = false;
    try {
      await vocabService.updateWord(userAlice, 'bonk1-0001', { en: 'edited first' });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        builtinEditRejected = true;
      }
    }
    assert(builtinEditRejected, 'Standard built-in words cannot be edited');

    let builtinDeleteRejected = false;
    try {
      await vocabService.deleteWord(userAlice, 'bonk1-0001');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        builtinDeleteRejected = true;
      }
    }
    assert(builtinDeleteRejected, 'Standard built-in words cannot be deleted');
    console.log('  ✓ Multi-user isolation and standard curriculum protection strictly enforced.');

    // 7. Deleting individual words with cascading cleanup
    console.log('[7/8] Testing deletion of individual words and cascading progress purge...');
    const wordsBeforeDelete = await vocabService.getWordsForBookAndLesson(userAlice, aliceBook.id, 'Unit 1');
    assert(wordsBeforeDelete.length === 2, 'Lesson contains 2 words before delete');

    // Delete word2 ("hyperbole")
    await vocabService.deleteWord(userAlice, word2.id);

    // Verify word is removed immediately from IndexedDB
    const checkDeleted = await db.getById<VocabularyWord>('words', word2.id);
    assert(checkDeleted === null, 'Deleted word must not exist in IndexedDB');

    // Verify words list updates immediately
    const wordsAfterDelete = await vocabService.getWordsForBookAndLesson(userAlice, aliceBook.id, 'Unit 1');
    assert(wordsAfterDelete.length === 1, 'Lesson contains 1 word after delete');
    assert(wordsAfterDelete[0].id === word1.id, 'Remaining word is word1');

    // Delete word1 and verify its progress record is also cleaned up
    await vocabService.deleteWord(userAlice, word1.id);
    const checkWord1 = await db.getById<VocabularyWord>('words', word1.id);
    assert(checkWord1 === null, 'Word1 deleted from IndexedDB');

    const checkWord1Progress = await db.getById<UserWordProgress>(
      'userWordProgress',
      `${userAlice}:${aliceBook.id}:${word1.normalizedEn}`,
      userAlice
    );
    assert(checkWord1Progress === null, 'Associated progress record purged on word deletion');
    console.log('  ✓ Word deletion and cascading cleanup verified immediately in IndexedDB.');

    // 8. Updating screens: verify stats reflect word edits and deletions
    console.log('[8/8] Testing screen stats updates after edits and deletions...');
    const lessonStats = await lessonService.getLessonStats(userAlice, lesson1.id);
    assert(lessonStats.wordCount === 0, 'Lesson word count updated to 0');

    const bookStats = await bookService.getBookStats(userAlice, aliceBook.id);
    assert(bookStats.wordCount === 0, 'Book word count updated to 0');
    console.log('  ✓ Lesson and book stats accurately reflect updated counts.');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 8 TASK 10 TEST SUITES PASSED! Vocabulary editing and deletion is 100% verified.');
  } finally {
    db.close();
  }
}

runVocabularyEditingDeletionTestSuite().catch((err) => {
  console.error('❌ Task 10 test suite failed:', err);
  process.exit(1);
});
