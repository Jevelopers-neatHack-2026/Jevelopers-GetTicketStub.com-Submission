// Dashboard report coverage. Keep independent of the measurement producer so
// accidentally dropping a producer check cannot silently weaken this gate.
export const CONTRAST_SOURCE = 'brand-kit@3822635aff507cd5918a08a0c636bb0e41705261';
export const CONTRAST_METHOD = 'WCAG sRGB relative luminance; source-over alpha in sRGB; unrounded comparisons';
export const REQUIRED_CONTRAST_PAIRS = Object.freeze([
  ['body / cream', 4.5, true],
  ['muted / cream', 4.5, true],
  ['body / subtle surface', 4.5, true],
  ['focus / cream', 3, true],
  ['focus / subtle surface', 3, true],
  ['meaningful bar / subtle surface', 3, true],
  ['negative control: orange body / cream', 4.5, false],
  ['negative control: copper body / cream', 4.5, false],
  ['negative control: cyan body / cream', 4.5, false],
].map(([name, threshold, expected]) => Object.freeze({ name, threshold, expected })));
