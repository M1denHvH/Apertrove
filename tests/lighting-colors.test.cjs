const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Lighting harmonies preserve the base color and calculate hue offsets, including wraparound', async () => {
  const { HARMONIES, hexToHsl, hslToHex, lightingPalette, wrapHue } = await import('../src/lighting-colors.mjs');
  for (const hex of ['#E52132', '#3491CD', '#CF9A26', '#000000', '#FFFFFF', '#808080']) {
    const base = hexToHsl(hex);
    assert.equal(hslToHex(base), hex);
    for (const [id, rule] of Object.entries(HARMONIES)) {
      const palette = lightingPalette(base, id);
      assert.equal(palette[0].hex, hex);
      for (const [index, offset] of rule.offsets.entries()) {
        assert.equal(palette[index + 1].hsl.h, wrapHue(base.h + offset));
        assert.match(palette[index + 1].hex, /^#[\dA-F]{6}$/);
      }
      assert.notEqual(palette[1].hex, palette[2].hex);
      if (base.s === 0) assert.ok(palette.every(color => color.hsl.s === 0));
    }
  }
});
