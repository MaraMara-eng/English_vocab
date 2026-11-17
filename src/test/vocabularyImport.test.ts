/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDBKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import * as XLSX from 'xlsx';
import { IndexedDBManager } from '../db/indexedDB.ts';
import { VocabularyWord } from '../db/types.ts';
import { AuthorizationError, ValidationError } from '../db/validators.ts';
import { BookService } from '../services/bookService.ts';
import { LessonService } from '../services/lessonService.ts';
import {
  ColumnMapping,
  VocabularyImportService,
} from '../services/vocabularyImportService.ts';
import { VocabularyService } from '../services/vocabularyService.ts';

// Make IDBKeyRange globally available for the test runner
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runVocabularyImportTestSuite() {
  console.log('--- Starting Task 11: Vocabulary Import Test Suite ---');
  const dbName = `TestVocabImportDB_${Date.now()}`;
  const db = new IndexedDBManager(dbName, 1, fakeIndexedDB);
  const bookService = new BookService(db);
  const lessonService = new LessonService(db, bookService);
  const vocabService = new VocabularyService(db, bookService, lessonService);
  const importService = new VocabularyImportService(db, bookService, lessonService, vocabService);

  try {
    const userAlice = 'user_alice_importer';
    const userBob = 'user_bob_viewer';

    // 1. Setup user custom textbook and lesson
    console.log('[1/9] Setting up user custom textbook and lesson for Alice...');
    await bookService.ensureDefaultBooks();
    const aliceBook = await bookService.createBook(userAlice, {
      name: 'Alice Vocabulary Collection',
      description: 'Import testing textbook',
    });

    const lesson1 = await lessonService.createLesson(userAlice, aliceBook.id, {
      lessonNumber: 'Unit 1',
      name: 'Lesson 1',
      orderIndex: 1,
    });
    console.log('  ✓ Custom book and lesson created successfully');

    // 2. CSV parsing with delimiters, quotes, and Armenian/Russian Unicode
    console.log('[2/9] Testing CSV and TSV parsing with Unicode and quoted text...');
    const csvContent = `English,Armenian,Russian,Definition,Example
"serendipity","հաջող պատահականություն","счастливая случайность","Finding valuable things unexpectedly","A serendipity encounter changed his life."
"epiphany","հայտնություն","прозрение","A sudden insight or realization","She had an epiphany while walking in the park."
"quaint","հետաքրքիր, հնաոճ","причудливый","Attractively unusual or old-fashioned","They stayed in a quaint country cottage."`;

    const parsedCsv = importService.parseDelimitedText(csvContent);
    assert(parsedCsv.length === 4, `Expected 4 rows (1 header + 3 data), got ${parsedCsv.length}`);
    assert(parsedCsv[0][0] === 'English', 'Header English parsed');
    assert(parsedCsv[1][0] === 'serendipity', 'Word 1 en parsed');
    assert(parsedCsv[1][1] === 'հաջող պատահականություն', 'Word 1 hy parsed');
    assert(parsedCsv[1][2] === 'счастливая случайность', 'Word 1 ru parsed');
    assert(parsedCsv[3][1] === 'հետաքրքիր, հնաոճ', 'Armenian with comma inside quotes parsed without split');

    // Test TSV format (Tab-separated)
    const tsvContent = `word\tarmenian\trussian\napple\tխնձոր\tяблоко\npear\tտանձ\tгруша`;
    const parsedTsv = importService.parseDelimitedText(tsvContent);
    assert(parsedTsv.length === 3, 'TSV parsed with 3 rows');
    assert(parsedTsv[1][1] === 'խնձոր', 'TSV Armenian word parsed');
    console.log('  ✓ CSV and TSV parsed with full Unicode fidelity and quote handling.');

    // 3. XLSX parsing using local SheetJS library
    console.log('[3/9] Testing local XLSX spreadsheet parsing (binary buffer)...');
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Word', 'Armenian', 'Russian', 'Part of Speech'],
      ['eloquent', 'ճարտասան', 'красноречивый', 'adjective'],
      ['resilience', 'տոկունություն', 'стойкость', 'noun'],
      ['wanderlust', 'ճամփորդասիրություն', 'тяга к странствиям', 'noun'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'VocabularySheet');
    const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const parsedXlsx = importService.parseXlsxBuffer(xlsxBuffer);
    assert(parsedXlsx.length === 4, `Expected 4 rows from XLSX, got ${parsedXlsx.length}`);
    assert(parsedXlsx[0][0] === 'Word', 'XLSX header Word parsed');
    assert(parsedXlsx[1][0] === 'eloquent', 'XLSX word eloquent parsed');
    assert(parsedXlsx[1][1] === 'ճարտասան', 'XLSX Armenian word parsed');
    assert(parsedXlsx[1][2] === 'красноречивый', 'XLSX Russian word parsed');
    console.log('  ✓ XLSX parsed completely offline using local SheetJS library.');

    // 4. Automatic column header detection
    console.log('[4/9] Testing automatic column header detection...');
    const detectedMappings = importService.detectColumnMappings(
      ['Term', 'Հայերեն Թարգմանություն', 'Russian Translation', 'Meaning', 'Sample Sentence'],
      []
    );
    assert(detectedMappings[0].field === 'en', 'Term mapped to English');
    assert(detectedMappings[1].field === 'hy', 'Հայերեն mapped to Armenian');
    assert(detectedMappings[2].field === 'ru', 'Russian mapped to Russian');
    assert(detectedMappings[3].field === 'definition', 'Meaning mapped to Definition');
    assert(detectedMappings[4].field === 'example', 'Sample Sentence mapped to Example');
    console.log('  ✓ Column headers automatically detected from diverse keywords.');

    // 5. Preview, row validation, and duplicate detection
    console.log('[5/9] Testing import preview, row validation, and duplicate detection...');
    // Seed an initial word in lesson 1: "serendipity"
    await vocabService.addWord(userAlice, aliceBook.id, 'Unit 1', {
      en: 'serendipity',
      hy: 'պատահական հաջողություն',
      type: 'word',
    });

    const importGridWithIssues = [
      ['English', 'Armenian', 'Russian', 'Definition'],
      ['serendipity', 'հաջող պատահականություն', 'счастливая случайность', 'Pre-existing duplicate'],
      ['', 'առանց անգլերենի', 'без английского', 'Invalid: Missing English'],
      ['solitude', '', '', 'Invalid: Missing translation'],
      ['epiphany', 'հայտնություն', 'прозрение', 'Valid entry 1'],
      ['epiphany', 'նորից հայտնություն', 'снова прозрение', 'Intra-batch duplicate'],
      ['ineffable', 'անասելի', 'невыразимый', 'Valid entry 2'],
    ];

    const preview = await importService.prepareImportPreview(
      userAlice,
      aliceBook.id,
      'Unit 1',
      importGridWithIssues
    );

    assert(preview.totalRows === 6, `Expected 6 data rows, got ${preview.totalRows}`);
    assert(preview.validCount === 2, `Expected 2 valid unique rows, got ${preview.validCount}`);
    assert(preview.invalidCount === 2, `Expected 2 invalid rows, got ${preview.invalidCount}`);
    assert(preview.duplicateCount === 2, `Expected 2 duplicate rows, got ${preview.duplicateCount}`);

    // Check row 1: Existing duplicate
    const rowDuplicate1 = preview.rows[0];
    assert(rowDuplicate1.isDuplicate === true, 'Row 0 is flagged as duplicate');
    assert(
      Boolean(rowDuplicate1.duplicateReason && rowDuplicate1.duplicateReason.includes('Already exists')),
      'Duplicate reason mentions already exists'
    );

    // Check row 2: Missing English
    const rowInvalid1 = preview.rows[1];
    assert(rowInvalid1.isValid === false, 'Row 1 is invalid');
    assert(
      rowInvalid1.validationErrors.some((e) => e.includes('English word')),
      'Invalid reason reports missing English'
    );

    // Check row 3: Missing Translations
    const rowInvalid2 = preview.rows[2];
    assert(rowInvalid2.isValid === false, 'Row 2 is invalid');
    assert(
      rowInvalid2.validationErrors.some((e) => e.includes('Armenian or Russian')),
      'Invalid reason reports missing translation'
    );
    console.log('  ✓ Row validation and duplicate detection verified in preview.');

    // 6. Manual column mapping override
    console.log('[6/9] Testing manual column mapping override...');
    // Suppose columns were: [Armenian, English] without headers
    const reversedData = [
      ['գիրք', 'book'],
      ['գրիչ', 'pen'],
    ];
    const customMappings: ColumnMapping[] = [
      { columnIndex: 0, headerName: 'Col 1', field: 'hy' },
      { columnIndex: 1, headerName: 'Col 2', field: 'en' },
    ];
    const remappedPreview = await importService.prepareImportPreview(
      userAlice,
      aliceBook.id,
      'Unit 1',
      reversedData,
      customMappings
    );
    assert(remappedPreview.rows[0].mappedValues.en === 'book', 'Custom mapping correctly assigns English');
    assert(remappedPreview.rows[0].mappedValues.hy === 'գիրք', 'Custom mapping correctly assigns Armenian');
    console.log('  ✓ Manual column mapping overrides verified.');

    // 7. Execute import with "skip" duplicate strategy
    console.log('[7/9] Testing executing import with "skip" duplicates strategy...');
    const resultSkip = await importService.executeImport(
      userAlice,
      aliceBook.id,
      'Unit 1',
      preview.rows,
      'skip'
    );

    assert(resultSkip.importedCount === 2, `Expected 2 imported words, got ${resultSkip.importedCount}`);
    assert(resultSkip.updatedCount === 0, `Expected 0 updated words, got ${resultSkip.updatedCount}`);
    assert(resultSkip.skippedCount === 4, `Expected 4 skipped rows (2 invalid + 2 dups), got ${resultSkip.skippedCount}`);

    // Verify imported words exist in database
    const allWords = await vocabService.getWordsForBookAndLesson(userAlice, aliceBook.id, 'Unit 1');
    assert(allWords.some((w) => w.en === 'epiphany'), 'Imported word "epiphany" exists in DB');
    assert(allWords.some((w) => w.en === 'ineffable'), 'Imported word "ineffable" exists in DB');
    console.log('  ✓ Import with "skip" strategy executed cleanly.');

    // 8. Execute import with "update" duplicate strategy
    console.log('[8/9] Testing executing import with "update" duplicates strategy...');
    const updateImportRows = [
      {
        rowNumber: 1,
        originalValues: ['serendipity', 'հաջող պատահականություն (թարմացված)', 'счастливая случайность (обновлено)'],
        mappedValues: {
          en: 'serendipity',
          hy: 'հաջող պատահականություն (թարմացված)',
          ru: 'счастливая случайность (обновлено)',
          definition: 'Updated definition from import',
          type: 'word' as const,
        },
        isValid: true,
        validationErrors: [],
        isDuplicate: true,
        existingWordId: allWords.find((w) => w.en === 'serendipity')?.id,
        selectedForImport: true,
      },
    ];

    const resultUpdate = await importService.executeImport(
      userAlice,
      aliceBook.id,
      'Unit 1',
      updateImportRows,
      'update'
    );

    assert(resultUpdate.updatedCount === 1, 'Expected 1 updated word');
    const checkUpdated = await db.getById<VocabularyWord>('words', updateImportRows[0].existingWordId!);
    assert(
      checkUpdated?.hy === 'հաջող պատահականություն (թարմացված)',
      'Existing word updated with imported Armenian'
    );
    assert(
      checkUpdated?.definition === 'Updated definition from import',
      'Existing word updated with imported Definition'
    );
    console.log('  ✓ Import with "update" duplicate strategy executed cleanly.');

    // 9. Authorization guards: prevent importing into built-in books or other users' books
    console.log('[9/9] Testing authorization guards on import...');
    // Attempt to import into built-in Bonk 1 book
    let builtinImportRejected = false;
    try {
      await importService.executeImport(userAlice, 'bonk1', '1', preview.rows, 'skip');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        builtinImportRejected = true;
      }
    }
    assert(builtinImportRejected, 'Standard built-in books cannot be imported into (AuthorizationError)');

    // User Bob tries to import words into Alice's textbook
    let crossUserImportRejected = false;
    try {
      await importService.executeImport(userBob, aliceBook.id, 'Unit 1', preview.rows, 'skip');
    } catch (err) {
      if (err instanceof AuthorizationError) {
        crossUserImportRejected = true;
      }
    }
    assert(crossUserImportRejected, 'User Bob cannot import into Alice’s textbook (AuthorizationError)');
    console.log('  ✓ Authorization guards and multi-user data isolation verified.');

    console.log('----------------------------------------------------');
    console.log('🎉 ALL 9 TASK 11 TEST SUITES PASSED! Vocabulary import is 100% verified.');
  } finally {
    db.close();
  }
}

runVocabularyImportTestSuite().catch((err) => {
  console.error('❌ Task 11 test suite failed:', err);
  process.exit(1);
});
