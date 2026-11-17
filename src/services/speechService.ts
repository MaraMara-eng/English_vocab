/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SpeechRecognitionResultSummary {
  transcript: string;
  expectedText: string;
  similarityScore: number; // 0 to 100
  isMatch: boolean;
  error?: string;
}

export class SpeechService {
  private synth: SpeechSynthesis | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public isSynthesisSupported(): boolean {
    return Boolean(this.synth);
  }

  public isRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }

  /**
   * Get available English voices from SpeechSynthesis.
   */
  public async getEnglishVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!this.synth) return [];

    let voices = this.synth.getVoices();
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        if (!this.synth) {
          resolve();
          return;
        }
        const handler = () => {
          voices = this.synth?.getVoices() || [];
          this.synth?.removeEventListener('voiceschanged', handler);
          resolve();
        };
        this.synth.addEventListener('voiceschanged', handler);
        // Fallback timeout in case voiceschanged never fires
        setTimeout(resolve, 300);
      });
      voices = this.synth?.getVoices() || [];
    }

    return voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  }

  /**
   * Pronounce English text using SpeechSynthesis.
   */
  public async speak(text: string, voiceURI?: string, rate: number = 1.0): Promise<void> {
    if (!this.synth) {
      throw new Error('Speech synthesis is not supported in this browser.');
    }

    const cleanText = (text || '').trim();
    if (!cleanText) return;

    // Cancel any active speech
    this.synth.cancel();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      if (voiceURI) {
        const voices = this.synth?.getVoices() || [];
        const match = voices.find((v) => v.voiceURI === voiceURI);
        if (match) {
          utterance.voice = match;
        }
      } else {
        // Pick best English voice if available
        const voices = this.synth?.getVoices() || [];
        const enVoice = voices.find((v) => v.lang.startsWith('en-US') || v.lang.startsWith('en-GB'));
        if (enVoice) {
          utterance.voice = enVoice;
        }
      }

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error('Speech synthesis error: ' + String(e.error)));

      this.synth?.speak(utterance);
    });
  }

  /**
   * Stop any active speech synthesis.
   */
  public stop(): void {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  /**
   * Compare recognized speech transcript with expected text.
   */
  public evaluateSpeech(transcript: string, expected: string): { similarityScore: number; isMatch: boolean } {
    const cleanTranscript = (transcript || '')
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, '')
      .trim();

    const cleanExpected = (expected || '')
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, '')
      .trim();

    if (!cleanTranscript || !cleanExpected) {
      return { similarityScore: 0, isMatch: false };
    }

    if (cleanTranscript === cleanExpected) {
      return { similarityScore: 100, isMatch: true };
    }

    // Check token overlap (Jaccard similarity)
    const tTokens = new Set(cleanTranscript.split(/\s+/));
    const eTokens = new Set(cleanExpected.split(/\s+/));

    let intersection = 0;
    tTokens.forEach((t) => {
      if (eTokens.has(t)) intersection++;
    });

    const union = new Set([...tTokens, ...eTokens]).size;
    const jaccard = union === 0 ? 0 : (intersection / union) * 100;

    // Levenshtein distance ratio
    const distance = this.levenshteinDistance(cleanTranscript, cleanExpected);
    const maxLen = Math.max(cleanTranscript.length, cleanExpected.length);
    const levenshteinScore = maxLen === 0 ? 100 : Math.max(0, ((maxLen - distance) / maxLen) * 100);

    const score = Math.round((jaccard * 0.4) + (levenshteinScore * 0.6));
    const isMatch = score >= 75 || cleanTranscript.includes(cleanExpected) || cleanExpected.includes(cleanTranscript);

    return {
      similarityScore: Math.min(100, Math.max(0, score)),
      isMatch,
    };
  }

  /**
   * Listen to user speech via Web Speech API (SpeechRecognition).
   */
  public listen(expectedText: string, timeoutMs: number = 7000): Promise<SpeechRecognitionResultSummary> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({
          transcript: '',
          expectedText,
          similarityScore: 0,
          isMatch: false,
          error: 'Speech recognition is not available in non-browser environment.',
        });
        return;
      }

      const win = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      };

      const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognitionCtor) {
        resolve({
          transcript: '',
          expectedText,
          similarityScore: 0,
          isMatch: false,
          error: 'Speech recognition is not supported in this browser. Please use the text typing alternative.',
        });
        return;
      }

      try {
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              recognition.stop();
            } catch {
              // Ignore
            }
            resolve({
              transcript: '',
              expectedText,
              similarityScore: 0,
              isMatch: false,
              error: 'Listening timed out. No speech detected.',
            });
          }
        }, timeoutMs);

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          const transcript = event.results?.[0]?.[0]?.transcript || '';
          const evaluation = this.evaluateSpeech(transcript, expectedText);

          resolve({
            transcript,
            expectedText,
            similarityScore: evaluation.similarityScore,
            isMatch: evaluation.isMatch,
          });
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          let errorMsg = 'Speech recognition error (' + event.error + ').';
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            errorMsg = 'Microphone permission denied. Please allow microphone access in your browser settings.';
          } else if (event.error === 'no-speech') {
            errorMsg = 'No speech was detected. Please try speaking closer to your microphone.';
          }

          resolve({
            transcript: '',
            expectedText,
            similarityScore: 0,
            isMatch: false,
            error: errorMsg,
          });
        };

        recognition.onend = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({
              transcript: '',
              expectedText,
              similarityScore: 0,
              isMatch: false,
              error: 'Speech recognition ended without result.',
            });
          }
        };

        recognition.start();
      } catch (err) {
        resolve({
          transcript: '',
          expectedText,
          similarityScore: 0,
          isMatch: false,
          error: 'Could not start microphone: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
    });
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(
              matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1 // deletion
            )
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
}

// Type definitions for browser Web Speech API
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

export const speechService = new SpeechService();
