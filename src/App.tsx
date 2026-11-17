/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { AuthView } from './components/AuthView.ts';
import { WorkspaceView } from './components/WorkspaceView.ts';
import { User } from './db/types.ts';
import { authService } from './services/authService.ts';

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionNotice, setSessionNotice] = useState<string | undefined>(undefined);
  const [noticeType, setNoticeType] = useState<'warning' | 'success'>('warning');

  // Restore authenticated session on mount (refresh / startup)
  useEffect(() => {
    async function checkSession() {
      try {
        const restoreRes = await authService.restoreSession();
        if (restoreRes.valid) {
          setCurrentUser(restoreRes.user);
        } else if (restoreRes.reason === 'expired') {
          setSessionNotice(restoreRes.message);
          setNoticeType('warning');
        }
      } catch (err) {
        console.warn('Session restoration failed:', err);
      } finally {
        setLoading(false);
      }
    }
    checkSession();
  }, []);

  // Mount appropriate vanilla component whenever currentUser or notice changes
  useEffect(() => {
    if (loading || !containerRef.current) return;

    // Clear previous view completely to prevent any residual DOM elements
    containerRef.current.innerHTML = '';

    if (currentUser) {
      new WorkspaceView(containerRef.current, {
        user: currentUser,
        onLogout: () => {
          authService.logout();
          setSessionNotice(undefined);
          setCurrentUser(null);
        },
        onSwitchAccount: (targetUser) => {
          // Zero data leakage: complete reset and mount with target user
          setCurrentUser(targetUser);
        },
        onAccountDeleted: (message) => {
          // Account deletion callback: clear state and show confirmation message
          setSessionNotice(message);
          setNoticeType('success');
          setCurrentUser(null);
        },
      });
    } else {
      new AuthView(containerRef.current, {
        noticeMessage: sessionNotice,
        noticeType: noticeType,
        onSuccess: (user) => {
          setSessionNotice(undefined);
          setCurrentUser(user);
        },
      });
    }
  }, [currentUser, loading, sessionNotice, noticeType]);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: 'var(--mu)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📖</div>
          <p>Verifying session & loading Vocab Quest...</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} />;
}
