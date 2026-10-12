import { readFile } from 'node:fs/promises';
import { CONTRAST_SOURCE, CONTRAST_METHOD, REQUIRED_CONTRAST_PAIRS } from './contrast-policy.mjs';
const css = await readFile('src/styles/brand-tokens.css', 'utf8');
function rgb(token) {
  const match = css.match(new RegExp(`--ts-${token}: #([a-f0-9]{6})`, 'i'));
  if (!match) throw new Error(`Missing pinned token ${token}`);
  return [0, 2, 4].map(index => parseInt(match[1].slice(index, index + 2), 16) / 255);
}
function luminance(color) { return color.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); }
function ratio(foreground, background) { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0] + 0.05) / (values[1] + 0.05); }
function composite(foreground, background, alpha) { return foreground.map((value, index) => value * alpha + background[index] * (1 - alpha)); }
const ink = rgb('ink'), cream = rgb('cream'), moss = rgb('moss');
const pairColors = new Map([
  ['body / cream', [ink, cream]],
  ['muted / cream', [composite(ink, cream, .66), cream]],
  ['body / subtle surface', [ink, composite(ink, cream, .05)]],
  ['focus / cream', [ink, cream]],
  ['focus / subtle surface', [ink, composite(ink, cream, .05)]],
  ['meaningful bar / subtle surface', [moss, composite(ink, cream, .05)]],
  ['negative control: orange body / cream', [rgb('orange'), cream]],
  ['negative control: copper body / cream', [rgb('copper'), cream]],
  ['negative control: cyan body / cream', [rgb('cyan'), cream]],
]);
const report = REQUIRED_CONTRAST_PAIRS.map(({ name, threshold, expected }) => {
  const colors = pairColors.get(name);
  if (!colors) throw new Error(`Missing contrast colors for ${name}`);
  const actual = ratio(...colors);
  const passes = actual >= threshold;
  if (passes !== expected) throw new Error(`Unexpected contrast for ${name}: ${actual}`);
  return { name, ratio: actual, threshold, passes, expected };
});
console.log(JSON.stringify({ source: CONTRAST_SOURCE, method: CONTRAST_METHOD, pairs: report }, null, 2));
