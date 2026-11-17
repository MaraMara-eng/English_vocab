/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VocabularyWord } from '../db/types.ts';
import { speechService, SpeechRecognitionResultSummary } from '../services/speechService.ts';

export interface PronunciationPracticeModalProps {
  word: VocabularyWord;
  onClose: () => void;
  onPracticed?: (wordId: string, success: boolean) => void;
}

export class PronunciationPracticeModal {
  private container: HTMLElement;
  private props: PronunciationPracticeModalProps;
  private voices: SpeechSynthesisVoice[] = [];
  private selectedVoiceURI: string = '';
  private playbackRate: number = 1.0;
  private isListening: boolean = false;
  private practiceResult: SpeechRecognitionResultSummary | null = null;
  private useTextFallback: boolean = false;
  private typedFallbackInput: string = '';

  constructor(container: HTMLElement, props: PronunciationPracticeModalProps) {
    this.container = container;
    this.props = props;
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.voices = await speechService.getEnglishVoices();
      if (this.voices.length > 0) {
        this.selectedVoiceURI = this.voices[0].voiceURI;
      }
    } catch {
      // Ignore
    }
    this.render();
  }

  private render(): void {
    const { word } = this.props;
    const isSynthesisSupported = speechService.isSynthesisSupported();
    const isRecognitionSupported = speechService.isRecognitionSupported();

    this.container.innerHTML = `
      <div class="modal" style="display: grid; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; place-items: center; padding: 20px;">
        <div class="box" style="width: 100%; max-width: 560px; background: var(--sf); border-radius: 18px; padding: 24px; box-shadow: var(--sh); position: relative; max-height: 90vh; overflow-y: auto;">
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.5rem;">🗣️</span>
                <h3 style="margin: 0; font-size: 1.3rem; color: var(--tx);">Pronunciation & Voice Practice</h3>
              </div>
              <p style="margin: 4px 0 0; color: var(--mu); font-size: 0.85rem;">
                Practice speaking and listening to master your pronunciation.
              </p>
            </div>
            <button type="button" id="closePracticeModalBtn" style="background: transparent; border: 0; font-size: 1.2rem; cursor: pointer; color: var(--mu); padding: 4px;" title="Close">✕</button>
          </div>

          <!-- Word Display Card -->
          <div style="background: color-mix(in srgb, var(--ac) 8%, var(--bg)); border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 20px; border: 1px solid var(--ln);">
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--tx); margin-bottom: 6px;">
              ${word.en}
            </div>
            <div style="display: flex; justify-content: center; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;">
              ${word.type ? `<span class="chip" style="font-size: 0.72rem; text-transform: uppercase;">${word.type}</span>` : ''}
              ${word.pronunciation ? `<span style="font-family: monospace; font-size: 0.85rem; color: var(--mu);">${word.pronunciation}</span>` : ''}
              ${word.partOfSpeech ? `<span class="chip" style="font-size: 0.72rem;">${word.partOfSpeech}</span>` : ''}
            </div>

            <!-- Translations -->
            <div style="font-size: 1.05rem; font-weight: 600; color: var(--tx); margin-bottom: 4px;">
              🇦🇲 ${word.hy}
            </div>
            ${word.ru ? `<div style="font-size: 0.95rem; color: var(--mu);">🇷🇺 ${word.ru}</div>` : ''}

            ${word.example ? `
              <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--ln); font-size: 0.9rem; color: var(--mu); font-style: italic;">
                "${word.example}"
              </div>
            ` : ''}
          </div>

          <!-- Section 1: Text-to-Speech (Pronunciation) -->
          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px; font-size: 1rem; color: var(--tx); display: flex; align-items: center; gap: 6px;">
              <span>🔊</span> 1. Listen & Replay Pronunciation
            </h4>
            
            ${!isSynthesisSupported ? `
              <div class="chip no" style="display: block; padding: 10px; border-radius: 10px; font-size: 0.85rem;">
                Speech synthesis is not supported in this browser.
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button type="button" id="speakWordBtn" class="p" style="flex: 1; padding: 10px 16px; font-weight: 600; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>🔊</span> Pronounce Word
                  </button>
                  ${word.example ? `
                    <button type="button" id="speakExampleBtn" class="sm" style="flex: 1; padding: 10px 16px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                      <span>💬</span> Pronounce Example
                    </button>
                  ` : ''}
                </div>

                <!-- Voice options & Rate -->
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 0.85rem; color: var(--mu);">
                  <div style="flex: 1; min-width: 180px;">
                    <label style="display: block; margin-bottom: 3px;">Voice:</label>
                    <select id="voiceSelect" style="width: 100%; padding: 6px 10px; font-size: 0.82rem; border-radius: 8px;">
                      ${this.voices.length === 0 ? '<option value="">Default English Voice</option>' : ''}
                      ${this.voices.map((v) => `<option value="${v.voiceURI}" ${this.selectedVoiceURI === v.voiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label style="display: block; margin-bottom: 3px;">Speed:</label>
                    <div style="display: flex; gap: 4px;">
                      <button type="button" class="sm rate-btn ${this.playbackRate === 0.75 ? 'on' : ''}" data-rate="0.75" style="padding: 5px 10px; font-size: 0.78rem;">0.75x</button>
                      <button type="button" class="sm rate-btn ${this.playbackRate === 1.0 ? 'on' : ''}" data-rate="1.0" style="padding: 5px 10px; font-size: 0.78rem;">Normal</button>
                    </div>
                  </div>
                </div>
              </div>
            `}
          </div>

          <!-- Section 2: Speech Recognition / Voice Practice -->
          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; font-size: 1rem; color: var(--tx); display: flex; align-items: center; gap: 6px;">
                <span>🎤</span> 2. Speaking Practice
              </h4>
              ${isRecognitionSupported ? `
                <button type="button" id="togglePracticeModeBtn" class="sm" style="font-size: 0.75rem;">
                  ${this.useTextFallback ? 'Switch to Microphone' : 'Switch to Text Typing'}
                </button>
              ` : ''}
            </div>

            ${!isRecognitionSupported || this.useTextFallback ? `
              <!-- Text-based alternative / simulator fallback -->
              <div style="background: var(--bg); border-radius: 12px; padding: 14px; border: 1px solid var(--ln);">
                <p style="margin: 0 0 8px; font-size: 0.85rem; color: var(--mu);">
                  ${!isRecognitionSupported ? 'Speech recognition is not supported in this browser. Use the text simulator below to check pronunciation alignment:' : 'Text simulator active:'}
                </p>
                <div style="display: flex; gap: 8px;">
                  <input
                    type="text"
                    id="typedFallbackInput"
                    placeholder="Type the word or sentence here..."
                    value="${this.typedFallbackInput}"
                    style="flex: 1; padding: 9px 12px; font-size: 0.9rem; border-radius: 10px;"
                  />
                  <button type="button" id="checkTypedBtn" class="p" style="padding: 9px 16px; font-weight: 600; border-radius: 10px;">
                    Check
                  </button>
                </div>
              </div>
            ` : `
              <!-- Live Microphone Voice Practice -->
              <div style="background: var(--bg); border-radius: 12px; padding: 16px; text-align: center; border: 1px solid var(--ln);">
                ${this.isListening ? `
                  <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 10px;">
                    <div style="font-size: 2.2rem; animation: pulse 1.2s infinite;">🔴</div>
                    <div style="font-weight: 600; font-size: 0.95rem; color: var(--tx);">Listening... Speak clearly into your microphone!</div>
                    <div style="font-size: 0.8rem; color: var(--mu);">Say: "${word.en}"</div>
                  </div>
                ` : `
                  <button type="button" id="startListeningBtn" class="p" style="width: 100%; padding: 12px 20px; font-size: 1rem; font-weight: 600; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; background: var(--ac); color: #fff; border: 0;">
                    <span>🎤</span> Start Speaking Practice
                  </button>
                  <p style="margin: 8px 0 0; font-size: 0.78rem; color: var(--mu);">
                    Microphone permission will be requested on-demand. Audio is processed locally in your browser.
                  </p>
                `}
              </div>
            `}

            <!-- Result Feedback Box -->
            ${this.practiceResult ? `
              <div style="margin-top: 14px; padding: 14px; border-radius: 12px; background: ${this.practiceResult.isMatch ? 'color-mix(in srgb, var(--ok) 15%, var(--sf))' : 'color-mix(in srgb, var(--no) 12%, var(--sf))'}; border: 1px solid ${this.practiceResult.isMatch ? 'var(--ok)' : 'var(--no)'};">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                  <span style="font-size: 1.2rem;">${this.practiceResult.isMatch ? '✅' : '⚠️'}</span>
                  <span style="font-weight: 700; font-size: 0.95rem; color: var(--tx);">
                    ${this.practiceResult.isMatch ? 'Excellent Pronunciation Match!' : 'Almost! Try again'}
                  </span>
                  <span class="chip" style="margin-left: auto; font-size: 0.75rem; font-weight: 700;">
                    Score: ${this.practiceResult.similarityScore}%
                  </span>
                </div>

                ${this.practiceResult.transcript ? `
                  <div style="font-size: 0.88rem; color: var(--tx); margin-top: 4px;">
                    Recognized speech: <strong style="font-style: italic;">"${this.practiceResult.transcript}"</strong>
                  </div>
                ` : ''}

                ${this.practiceResult.error ? `
                  <div style="font-size: 0.85rem; color: var(--no); margin-top: 4px;">
                    ${this.practiceResult.error}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>

          <!-- Footer Actions -->
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--ln);">
            <button type="button" id="closePracticeModalFooterBtn" style="padding: 9px 18px; border-radius: 10px; font-size: 0.9rem;">
              Close
            </button>
          </div>

        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const closeModal = () => {
      speechService.stop();
      this.container.innerHTML = '';
      this.props.onClose();
    };

    this.container.querySelector('#closePracticeModalBtn')?.addEventListener('click', closeModal);
    this.container.querySelector('#closePracticeModalFooterBtn')?.addEventListener('click', closeModal);

    // Close on background click
    this.container.querySelector('.modal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal')) {
        closeModal();
      }
    });

    // Speak word
    this.container.querySelector('#speakWordBtn')?.addEventListener('click', async () => {
      try {
        await speechService.speak(this.props.word.en, this.selectedVoiceURI, this.playbackRate);
      } catch (err) {
        console.warn('Speech synthesis error:', err);
      }
    });

    // Speak example
    this.container.querySelector('#speakExampleBtn')?.addEventListener('click', async () => {
      if (this.props.word.example) {
        try {
          await speechService.speak(this.props.word.example, this.selectedVoiceURI, this.playbackRate);
        } catch (err) {
          console.warn('Speech synthesis error:', err);
        }
      }
    });

    // Voice select
    const voiceSelect = this.container.querySelector('#voiceSelect') as HTMLSelectElement | null;
    voiceSelect?.addEventListener('change', (e) => {
      this.selectedVoiceURI = (e.target as HTMLSelectElement).value;
    });

    // Rate buttons
    this.container.querySelectorAll('.rate-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const rate = parseFloat((e.currentTarget as HTMLElement).dataset.rate || '1.0');
        this.playbackRate = rate;
        this.render();
      });
    });

    // Toggle fallback mode
    this.container.querySelector('#togglePracticeModeBtn')?.addEventListener('click', () => {
      this.useTextFallback = !this.useTextFallback;
      this.practiceResult = null;
      this.render();
    });

    // Start microphone listening
    this.container.querySelector('#startListeningBtn')?.addEventListener('click', async () => {
      this.isListening = true;
      this.practiceResult = null;
      this.render();

      const result = await speechService.listen(this.props.word.en);
      this.isListening = false;
      this.practiceResult = result;
      this.render();

      if (result.isMatch && this.props.onPracticed) {
        this.props.onPracticed(this.props.word.id, true);
      }
    });

    // Text fallback check
    const typedInput = this.container.querySelector('#typedFallbackInput') as HTMLInputElement | null;
    typedInput?.addEventListener('input', (e) => {
      this.typedFallbackInput = (e.target as HTMLInputElement).value;
    });

    this.container.querySelector('#checkTypedBtn')?.addEventListener('click', () => {
      const val = this.typedFallbackInput.trim();
      const evaluation = speechService.evaluateSpeech(val, this.props.word.en);
      this.practiceResult = {
        transcript: val,
        expectedText: this.props.word.en,
        similarityScore: evaluation.similarityScore,
        isMatch: evaluation.isMatch,
      };
      this.render();

      if (evaluation.isMatch && this.props.onPracticed) {
        this.props.onPracticed(this.props.word.id, true);
      }
    });

    typedInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.container.querySelector('#checkTypedBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
  }
}
