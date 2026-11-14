export const HARMONIES = {
  complementary: { label: "harmony.complementary", offsets: [180], note: "harmony.opposing_hues_create_clear_color_separation_keep_the" },
  analogous: { label: "harmony.analogous", offsets: [-30, 30], note: "harmony.neighboring_hues_blend_naturally_use_brightness_to_separate" },
  triadic: { label: "harmony.triadic", offsets: [120, 240], note: "harmony.three_evenly_spaced_hues_create_a_strong_contrast" },
  mono: { label: "harmony.monochromatic", offsets: [0, 0], note: "harmony.the_hue_stays_the_same_while_saturation_and" },
  split: { label: "harmony.split_complementary", offsets: [150, 210], note: "harmony.two_neighbors_of_the_complementary_color_give_you" },
  square: { label: "harmony.tetradic_square", offsets: [90, 180, 270], note: "harmony.four_evenly_spaced_hues_save_the_extra_color" }
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const wrapHue = hue => ((hue % 360) + 360) % 360;

export function hexToHsl(hex, fallbackHue = 0) {
  const [r, g, b] = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, l = (max + min) / 2;
  if (!delta) return { h: fallbackHue, s: 0, l: l * 100 };
  const h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: wrapHue(h * 60), s: delta / (1 - Math.abs(2 * l - 1)) * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  const hue = wrapHue(h) / 30;
  const light = clamp(l, 0, 100) / 100;
  const amplitude = clamp(s, 0, 100) / 100 * Math.min(light, 1 - light);
  return '#' + [0, 8, 4].map(channel => {
    const k = (channel + hue) % 12;
    const value = light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

export function lightingPalette(base, harmony) {
  const rule = HARMONIES[harmony];
  const swatches = [{ role: "harmony.key_color", hex: hslToHex(base), hsl: base }];
  const offsets = rule.offsets.length === 1 ? [rule.offsets[0], rule.offsets[0]] : rule.offsets;
  const roles = ["harmony.background_light", "harmony.rim_light", "harmony.props"];
  offsets.forEach((offset, index) => {
    const hsl = {
      h: wrapHue(base.h + offset),
      s: index === 0 ? base.s * 0.78 : base.s,
      l: index === 0 ? clamp(base.l * 0.66, 12, 55) : clamp(base.l * 0.62 + 32, 32, 86)
    };
    swatches.push({ role: roles[index], hex: hslToHex(hsl), hsl });
  });
  return swatches;
}
