/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'fake-indexeddb/auto';
import { SpeechService } from '../services/speechService.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTask13Tests() {
  console.log('--- Starting Task 13: Pronunciation & Voice Practice Test Suite ---');
  const speechService = new SpeechService();

  // 1. Test speech synthesis support check
  const synthSupported = speechService.isSynthesisSupported();
  console.log(`  [1/6] Speech synthesis supported: ${synthSupported}`);

  // 2. Test speech recognition support check
  const recognitionSupported = speechService.isRecognitionSupported();
  console.log(`  [2/6] Speech recognition supported in Node test environment: ${recognitionSupported}`);

  // 3. Test speech evaluation / comparison function
  const exactEval = speechService.evaluateSpeech('Welcome to our home!', 'Welcome to our home!');
  assert(exactEval.isMatch === true, 'Exact match should be true');
  assert(exactEval.similarityScore === 100, 'Exact match score should be 100');
  console.log('  [3/6] Exact speech evaluation verified.');

  // 4. Test fuzzy / partial speech evaluation
  const fuzzyEval = speechService.evaluateSpeech('welcome home', 'Welcome to our home!');
  assert(fuzzyEval.similarityScore > 40, 'Fuzzy match score should be > 40');
  console.log('  [4/6] Fuzzy / partial speech evaluation verified.');

  // 5. Test mismatch evaluation
  const badEval = speechService.evaluateSpeech('apple banana orange', 'Welcome to our home!');
  assert(badEval.isMatch === false, 'Mismatch evaluation should be false');
  assert(badEval.similarityScore < 50, 'Mismatch score should be low');
  console.log('  [5/6] Mismatch evaluation verified.');

  // 6. Test offline fallback handling for speech recognition when unsupported in Node / headless env
  const listenResult = await speechService.listen('Test word', 100);
  assert(listenResult.error !== undefined, 'Should return error or timeout gracefully when recognition unsupported in Node');
  console.log('  [6/6] Graceful unsupported browser / timeout fallback verified.');

  console.log('----------------------------------------------------');
  console.log('🎉 ALL TASK 13 PRONUNCIATION & VOICE PRACTICE TESTS PASSED!');
}

runTask13Tests().catch((err) => {
  console.error('❌ Task 13 Test Suite Failed:', err);
  process.exit(1);
});
