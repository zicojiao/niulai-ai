'use client';

import { useEffect, useRef } from 'react';
import CowCallController from './CowCallController';
import '@/src/cow.css';

const ENTRY_AUDIO_SRC = '/niulai-voice/niulai-mom.mp3';

export default function CowExperience() {
  const entryAudioStarted = useRef(false);

  useEffect(() => {
    void import('@/src/cow/main');
  }, []);

  useEffect(() => {
    if (entryAudioStarted.current) return;

    const audio = new Audio(ENTRY_AUDIO_SRC);
    audio.preload = 'auto';

    let disposed = false;
    let playAttempt: Promise<void> | null = null;

    const removeFallbackListeners = () => {
      window.removeEventListener('pointerdown', startAudio);
      window.removeEventListener('keydown', startAudio);
    };

    const installFallbackListeners = () => {
      window.addEventListener('pointerdown', startAudio, { passive: true });
      window.addEventListener('keydown', startAudio);
    };

    const startAudio = () => {
      if (disposed || entryAudioStarted.current || playAttempt) return;

      try {
        playAttempt = audio.play();
      } catch {
        playAttempt = null;
        installFallbackListeners();
        return;
      }

      void playAttempt
        .then(() => {
          entryAudioStarted.current = true;
          removeFallbackListeners();
        })
        .catch(() => {
          playAttempt = null;
          if (!disposed) installFallbackListeners();
        });
    };

    startAudio();

    return () => {
      disposed = true;
      removeFallbackListeners();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  return (
    <main id="cow-app">
      <canvas id="cow-scene" aria-label="会说话的 3D 小牛「牛来」" />

      <header className="cow-masthead">
        <p className="cow-kicker">一头会说话的小黄牛</p>
        <h1 className="cow-title" lang="zh-Hans">
          牛来
        </h1>
        <p className="cow-romanised">Niu Lai</p>
        <p className="cow-blurb">
          打开麦克风，直接跟它聊。
        </p>
      </header>

      <CowCallController />

      <div id="cow-loading" className="cow-loading" role="status">
        <span className="cow-loading-mark" aria-hidden="true" />
        <p>正在把牛来牵过来…</p>
      </div>

      <div id="cow-error" className="cow-error" hidden>
        <p>没能加载牛来的 3D 模型。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    </main>
  );
}
