/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VocabularyWord } from '../db/types.ts';

export interface ExplanationResult {
  title: string;
  correctAnswerText: string;
  correctTranslationText: string;
  explanation: string;
  exampleSentence?: string;
  comparisonNote?: string;
  partOfSpeech?: string;
}

export class ExplanationService {
  /**
   * Generates a concise, educational explanation for an incorrect answer
   * using 100% local database information (definitions, notes, translations, part of speech).
   */
  public generateExplanation(
    correctWord: VocabularyWord,
    userWrongAnswer?: string
  ): ExplanationResult {
    const en = correctWord.en;
    const hy = correctWord.hy;
    const ru = correctWord.ru;
    const def = correctWord.definition;
    const example = correctWord.example;
    const note = correctWord.note || correctWord.hint;
    const pos = correctWord.partOfSpeech;
    const type = correctWord.type;

    let explanation = `The correct English term for "${hy}" is "${en}".`;

    if (def) {
      explanation += ` Definition: ${def}`;
    } else if (note) {
      explanation += ` Usage note: ${note}`;
    } else if (pos) {
      explanation += ` This is a ${pos} (${type || 'word'}).`;
    } else {
      explanation += ` Make sure to review the spelling and translation carefully.`;
    }

    let comparisonNote: string | undefined = undefined;
    if (userWrongAnswer && userWrongAnswer.trim() !== '') {
      const cleanWrong = userWrongAnswer.trim();
      if (cleanWrong.toLowerCase() !== en.toLowerCase()) {
        comparisonNote = `You answered "${cleanWrong}". Note that "${en}" specifically translates to Armenian "${hy}"${ru ? ' and Russian "' + ru + '"' : ''}.`;
      }
    }

    return {
      title: 'Review & Explanation',
      correctAnswerText: en,
      correctTranslationText: ru ? `${hy} • ${ru}` : hy,
      explanation,
      exampleSentence: example,
      comparisonNote,
      partOfSpeech: pos ? String(pos) : undefined,
    };
  }
}

export const explanationService = new ExplanationService();
