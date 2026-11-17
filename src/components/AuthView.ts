/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from '../db/types.ts';
import { ValidationError, validateEmail, validatePasswordStrength } from '../db/validators.ts';
import { authService, RegistrationRequest } from '../services/authService.ts';

export interface AuthViewProps {
  onSuccess: (user: User) => void;
  initialMode?: 'in' | 'up';
  noticeMessage?: string;
  noticeType?: 'warning' | 'success';
}

export class AuthView {
  private container: HTMLElement;
  private props: AuthViewProps;
  private mode: 'in' | 'up';
  private isSubmitting: boolean = false;

  constructor(container: HTMLElement, props: AuthViewProps) {
    this.container = container;
    this.props = props;
    this.mode = props.initialMode || 'in';
    this.render();
  }

  public setMode(mode: 'in' | 'up'): void {
    this.mode = mode;
    this.render();
  }

  private render(): void {
    const isSignup = this.mode === 'up';

    let lastUser = '';
    try {
      lastUser = localStorage.getItem('vt:last') || '';
    } catch {
      // Ignore localStorage access restrictions
    }

    const isSuccessNotice = this.props.noticeType === 'success';

    this.container.innerHTML = `
      <div class="auth-container">
        <div class="auth-box card">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <div style="font-size: 2rem;">📖</div>
            <div>
              <h1 style="margin: 0; font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, var(--ac), var(--ac2)); -webkit-background-clip: text; background-clip: text; color: transparent;">
                Vocab Quest
              </h1>
              <p style="margin: 2px 0 0; font-size: 0.85rem; color: var(--mu);">
                Trilingual Vocabulary Learning Studio
              </p>
            </div>
          </div>

          ${
            this.props.noticeMessage
              ? `<div class="chip ${isSuccessNotice ? 'ok' : 'wn'}" style="width: 100%; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.4;">
                  <span>${isSuccessNotice ? '✓' : '⚠️'}</span>
                  <span>${this.props.noticeMessage}</span>
                </div>`
              : ''
          }

          <div style="margin: 16px 0 18px;">
            <div class="seg" style="width: 100%; display: grid; grid-template-columns: 1fr 1fr;">
              <button type="button" id="tabLogin" class="${!isSignup ? 'on' : ''}">Sign in</button>
              <button type="button" id="tabRegister" class="${isSignup ? 'on' : ''}">Create account</button>
            </div>
          </div>

          <form id="authForm" style="display: grid; gap: 14px;" novalidate>
            <!-- Username Field -->
            <label class="field-label">
              <span>Username <span class="req">*</span></span>
              <input
                id="authUsername"
                type="text"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
                placeholder="e.g. anna"
                value="${!isSignup && lastUser ? lastUser : ''}"
                required
              />
              <span id="usernameHint" style="font-size: 0.75rem; color: var(--mu);">
                3–30 characters (letters, numbers, _, - or .)
              </span>
            </label>

            <!-- Optional Email Field (for Registration) -->
            <div id="emailWrapper" style="${isSignup ? '' : 'display: none;'}">
              <label class="field-label">
                <span>Email address <span style="font-size: 0.75rem; color: var(--mu);">(optional)</span></span>
                <input
                  id="authEmail"
                  type="email"
                  autocomplete="email"
                  placeholder="e.g. anna@example.com"
                />
                <span id="emailHint" style="font-size: 0.75rem; color: var(--mu);">
                  For account identification & local backup exports
                </span>
              </label>
            </div>

            <!-- Password Field -->
            <label class="field-label">
              <span>Password <span class="req">*</span></span>
              <input
                id="authPassword"
                type="password"
                autocomplete="${isSignup ? 'new-password' : 'current-password'}"
                placeholder="${isSignup ? 'At least 6 characters' : 'Enter your password'}"
                required
              />
            </label>

            <!-- Live Password Strength Meter (for Registration) -->
            <div id="strengthContainer" style="${isSignup ? '' : 'display: none;'}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 0.75rem;">
                <span style="color: var(--mu);">Password strength:</span>
                <span id="strengthLabel" style="font-weight: 600;">None</span>
              </div>
              <div class="bar">
                <i id="strengthBar" style="width: 0%; background-color: var(--ln);"></i>
              </div>
              <div id="strengthCriteria" style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; font-size: 0.7rem;">
                <span id="critLength" class="chip">6+ characters</span>
                <span id="critUpper" class="chip">Uppercase</span>
                <span id="critLower" class="chip">Lowercase</span>
                <span id="critNumber" class="chip">Number</span>
                <span id="critSpecial" class="chip">Symbol</span>
              </div>
            </div>

            <!-- Password Confirmation Field (for Registration) -->
            <div id="confirmPasswordWrapper" style="${isSignup ? '' : 'display: none;'}">
              <label class="field-label">
                <span>Confirm password <span class="req">*</span></span>
                <input
                  id="authConfirmPassword"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Repeat your password"
                />
              </label>
              <div id="confirmMatchMsg" style="margin-top: 4px; font-size: 0.75rem; display: none;"></div>
            </div>

            <!-- Keep Me Signed In -->
            <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--mu); cursor: pointer; user-select: none; margin: 2px 0;">
              <input
                id="authRememberMe"
                type="checkbox"
                checked
                style="width: 16px; height: 16px; accent-color: var(--ac); cursor: pointer;"
              />
              <span>Remember me on this device (7 days)</span>
            </label>

            <!-- Error Banner -->
            <div id="authErrorBanner" class="chip no" style="display: none; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.4;">
            </div>

            <!-- Success Banner -->
            <div id="authSuccessBanner" class="chip ok" style="display: none; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.4;">
            </div>

            <!-- Submit Button -->
            <button
              type="submit"
              id="authSubmitBtn"
              class="p"
              style="width: 100%; padding: 12px; font-size: 1rem; border-radius: 14px; margin-top: 4px;"
            >
              ${isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <!-- Local-First Notice -->
          <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--ln); text-align: center;">
            <p style="margin: 0; font-size: 0.8rem; color: var(--mu); line-height: 1.4;">
              💾 <strong>Offline & Local:</strong> Accounts and progress are securely stored in your browser's IndexedDB. The first account created becomes the teacher.
            </p>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const tabLogin = this.container.querySelector('#tabLogin') as HTMLButtonElement | null;
    const tabRegister = this.container.querySelector('#tabRegister') as HTMLButtonElement | null;
    const form = this.container.querySelector('#authForm') as HTMLFormElement | null;
    const usernameInput = this.container.querySelector('#authUsername') as HTMLInputElement | null;
    const emailInput = this.container.querySelector('#authEmail') as HTMLInputElement | null;
    const passwordInput = this.container.querySelector('#authPassword') as HTMLInputElement | null;
    const confirmInput = this.container.querySelector('#authConfirmPassword') as HTMLInputElement | null;

    tabLogin?.addEventListener('click', () => this.setMode('in'));
    tabRegister?.addEventListener('click', () => this.setMode('up'));

    // Real-time password strength updates when in registration mode
    passwordInput?.addEventListener('input', () => {
      if (this.mode === 'up') {
        this.updatePasswordStrengthDisplay(passwordInput.value);
        this.checkPasswordMatch();
      }
    });

    confirmInput?.addEventListener('input', () => {
      if (this.mode === 'up') {
        this.checkPasswordMatch();
      }
    });

    // Clear errors on field editing
    [usernameInput, emailInput, passwordInput, confirmInput].forEach((input) => {
      input?.addEventListener('input', () => this.clearError());
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
  }

  private updatePasswordStrengthDisplay(password: string): void {
    const strength = validatePasswordStrength(password);
    const bar = this.container.querySelector('#strengthBar') as HTMLElement | null;
    const label = this.container.querySelector('#strengthLabel') as HTMLElement | null;
    const critLength = this.container.querySelector('#critLength') as HTMLElement | null;
    const critUpper = this.container.querySelector('#critUpper') as HTMLElement | null;
    const critLower = this.container.querySelector('#critLower') as HTMLElement | null;
    const critNumber = this.container.querySelector('#critNumber') as HTMLElement | null;
    const critSpecial = this.container.querySelector('#critSpecial') as HTMLElement | null;

    if (!bar || !label) return;

    if (!password) {
      bar.style.width = '0%';
      bar.className = '';
      label.textContent = 'None';
      label.style.color = 'var(--mu)';
      return;
    }

    const percentage = Math.min(100, Math.max(20, (strength.score / 4) * 100));
    bar.style.width = `${percentage}%`;

    bar.className = '';
    if (strength.label === 'Weak') {
      bar.classList.add('strength-weak');
      label.textContent = 'Weak (Needs more variety)';
      label.style.color = 'var(--no)';
    } else if (strength.label === 'Fair') {
      bar.classList.add('strength-fair');
      label.textContent = 'Fair';
      label.style.color = 'var(--wn)';
    } else if (strength.label === 'Good') {
      bar.classList.add('strength-good');
      label.textContent = 'Good';
      label.style.color = '#3b82f6';
    } else if (strength.label === 'Strong') {
      bar.classList.add('strength-strong');
      label.textContent = 'Strong ✓';
      label.style.color = 'var(--ok)';
    }

    // Update criteria chips
    const hasLen = password.length >= 6;
    const hasUp = /[A-Z]/.test(password);
    const hasLow = /[a-z]/.test(password);
    const hasNum = /[0-9]/.test(password);
    const hasSym = /[^a-zA-Z0-9]/.test(password);

    this.toggleChip(critLength, hasLen);
    this.toggleChip(critUpper, hasUp);
    this.toggleChip(critLower, hasLow);
    this.toggleChip(critNumber, hasNum);
    this.toggleChip(critSpecial, hasSym);
  }

  private toggleChip(el: HTMLElement | null, active: boolean): void {
    if (!el) return;
    if (active) {
      el.classList.add('ok');
      el.classList.remove('no');
    } else {
      el.classList.remove('ok');
    }
  }

  private checkPasswordMatch(): void {
    const password = (this.container.querySelector('#authPassword') as HTMLInputElement)?.value || '';
    const confirm = (this.container.querySelector('#authConfirmPassword') as HTMLInputElement)?.value || '';
    const msgEl = this.container.querySelector('#confirmMatchMsg') as HTMLElement | null;

    if (!msgEl) return;

    if (!confirm) {
      msgEl.style.display = 'none';
      return;
    }

    msgEl.style.display = 'block';
    if (password === confirm) {
      msgEl.textContent = '✓ Passwords match';
      msgEl.style.color = 'var(--ok)';
    } else {
      msgEl.textContent = '✕ Passwords do not match';
      msgEl.style.color = 'var(--no)';
    }
  }

  private showError(message: string): void {
    const errorBanner = this.container.querySelector('#authErrorBanner') as HTMLElement | null;
    const successBanner = this.container.querySelector('#authSuccessBanner') as HTMLElement | null;
    if (successBanner) successBanner.style.display = 'none';

    if (errorBanner) {
      errorBanner.textContent = message;
      errorBanner.style.display = 'block';
    }
  }

  private showSuccess(message: string): void {
    const errorBanner = this.container.querySelector('#authErrorBanner') as HTMLElement | null;
    const successBanner = this.container.querySelector('#authSuccessBanner') as HTMLElement | null;
    if (errorBanner) errorBanner.style.display = 'none';

    if (successBanner) {
      successBanner.textContent = message;
      successBanner.style.display = 'block';
    }
  }

  private clearError(): void {
    const errorBanner = this.container.querySelector('#authErrorBanner') as HTMLElement | null;
    if (errorBanner) {
      errorBanner.style.display = 'none';
      errorBanner.textContent = '';
    }
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting) return;

    const usernameInput = this.container.querySelector('#authUsername') as HTMLInputElement;
    const emailInput = this.container.querySelector('#authEmail') as HTMLInputElement;
    const passwordInput = this.container.querySelector('#authPassword') as HTMLInputElement;
    const confirmInput = this.container.querySelector('#authConfirmPassword') as HTMLInputElement;
    const submitBtn = this.container.querySelector('#authSubmitBtn') as HTMLButtonElement;

    const username = (usernameInput?.value || '').trim();
    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';
    const confirmPassword = confirmInput?.value || '';

    this.clearError();

    // Client-side quick validation before cryptographic hashing
    if (!username) {
      this.showError('Please enter a username.');
      usernameInput?.focus();
      return;
    }

    if (!password) {
      this.showError('Please enter your password.');
      passwordInput?.focus();
      return;
    }

    if (this.mode === 'up') {
      if (email && !validateEmail(email)) {
        this.showError('Please enter a valid email address.');
        emailInput?.focus();
        return;
      }

      if (password !== confirmPassword) {
        this.showError('Passwords do not match. Please verify both fields.');
        confirmInput?.focus();
        return;
      }

      const strength = validatePasswordStrength(password);
      if (!strength.isValid) {
        this.showError(strength.message || 'Password must be at least 6 characters long.');
        passwordInput?.focus();
        return;
      }
    }

    try {
      this.isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = this.mode === 'up' ? 'Creating account...' : 'Signing in...';
      }

      const rememberMe = (this.container.querySelector('#authRememberMe') as HTMLInputElement)?.checked ?? true;

      if (this.mode === 'up') {
        const req: RegistrationRequest = {
          username,
          email: email || undefined,
          password,
          passwordConfirm: confirmPassword,
          rememberMe,
        };

        const newUser = await authService.register(req);
        this.showSuccess(`Welcome, ${newUser.username}! Account created as ${newUser.role}. Logging in...`);

        // Notify parent callback to launch workspace
        setTimeout(() => {
          this.props.onSuccess(newUser);
        }, 500);
      } else {
        const user = await authService.login(username, password, rememberMe);
        this.showSuccess(`Signed in as ${user.username}. Loading workspace...`);

        setTimeout(() => {
          this.props.onSuccess(user);
        }, 400);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        this.showError(err.message);
      } else if (err instanceof Error) {
        this.showError(err.message);
      } else {
        this.showError('An unexpected authentication error occurred. Please try again.');
      }
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = this.mode === 'up' ? 'Create account' : 'Sign in';
      }
    }
  }
}
