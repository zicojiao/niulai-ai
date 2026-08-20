'use client';

import { useEffect, useRef } from 'react';
import CowCallController from './CowCallController';
import { COW_PAGE_COPY } from '@/src/cowCopy';
import type { CowLocale } from '@/types/cow';
import '@/src/cow.css';

const ENTRY_AUDIO_SRC = '/niulai-voice/niulai-mom.mp3';

export default function CowExperience({ locale }: { locale: CowLocale }) {
  const entryAudioStarted = useRef(false);
  const copy = COW_PAGE_COPY[locale];

  useEffect(() => {
    void import('@/src/cow/main');
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-Hans';
    document.body.dataset.locale = locale;
    return () => {
      if (document.body.dataset.locale === locale) {
        delete document.body.dataset.locale;
      }
    };
  }, [locale]);

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
    <main id="cow-app" className={`cow-app--${locale}`}>
      <canvas id="cow-scene" aria-label={copy.canvasLabel} />

      <header className="cow-masthead">
        <p className="cow-kicker">{copy.kicker}</p>
        <h1 className="cow-title" lang={copy.titleLang}>
          {copy.title}
        </h1>
        <p className="cow-romanised">{copy.romanised}</p>
        <p className="cow-blurb">{copy.blurb}</p>
        <a
          className="cow-language-switch"
          href={copy.languageHref}
          lang={locale === 'en' ? 'zh-Hans' : 'en'}
          aria-label={locale === 'en' ? '切换到中文' : 'Switch to English'}
        >
          {copy.languageLabel}
        </a>
      </header>

      <CowCallController locale={locale} />

      <div id="cow-loading" className="cow-loading" role="status">
        <span className="cow-loading-mark" aria-hidden="true" />
        <p>{copy.loading}</p>
      </div>

      <div id="cow-error" className="cow-error" hidden>
        <p>{copy.modelError}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {copy.reload}
        </button>
      </div>
    </main>
  );
}
