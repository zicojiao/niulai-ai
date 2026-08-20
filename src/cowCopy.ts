import type { CowLocale } from '@/types/cow';

export type CowPageCopy = {
  kicker: string;
  title: string;
  titleLang: string;
  romanised: string;
  blurb: string;
  canvasLabel: string;
  loading: string;
  modelError: string;
  reload: string;
  languageLabel: string;
  languageHref: string;
};

export const COW_PAGE_COPY: Record<CowLocale, CowPageCopy> = {
  zh: {
    kicker: '一头会说话的小黄牛',
    title: '牛来',
    titleLang: 'zh-Hans',
    romanised: 'Niu Lai',
    blurb: '打开麦克风，直接跟它聊。',
    canvasLabel: '会说话的 3D 小牛「牛来」',
    loading: '正在把牛来牵过来…',
    modelError: '没能加载牛来的 3D 模型。',
    reload: '重新加载',
    languageLabel: 'EN',
    languageHref: '/en',
  },
  en: {
    kicker: 'A very talkative little bull',
    title: 'NIU LAI',
    titleLang: 'en',
    romanised: 'A VOICE IN THE ROOM',
    blurb: 'Turn on your mic. Say hello. He’s listening.',
    canvasLabel: 'Niu Lai, a talking 3D bull',
    loading: 'Bringing Niu Lai to life…',
    modelError: 'Niu Lai’s 3D model could not be loaded.',
    reload: 'Try again',
    languageLabel: '中文',
    languageHref: '/',
  },
};

