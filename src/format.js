import { t } from './i18n.js';
export const frames = value => t('count.frames', { count: Number(value) || 0 });
