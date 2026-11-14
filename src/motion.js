import { gsap } from 'gsap';

export function motionDuration(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-' + name)) / 1000;
}

export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
export function allowDecorativeMotion() {
  return !document.documentElement.hasAttribute('data-performance-mode') && !matchMedia(reducedMotionQuery).matches;
}

export function withMotion(scope, animate) {
  const motion = gsap.matchMedia();
  motion.add('(prefers-reduced-motion: no-preference)', () => {
    if (allowDecorativeMotion()) return animate();
  }, scope);
  return () => motion.revert();
}
