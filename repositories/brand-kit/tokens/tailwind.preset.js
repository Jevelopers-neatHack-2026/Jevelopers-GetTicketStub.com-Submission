/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Tailwind adapter for tailwindcss 3.4.x (tested with 3.4.19); Tailwind 4 is not supported or tested.
 * Values reference the CSS variables in tokens.css, so the night theme and reduced-motion overrides apply without a rebuild.
 * Usage: presets: [require("@ticketstub/brand-kit/tokens/tailwind.preset.js")] plus tokens.css loaded by the page (no package is published).
 * Source of truth: tokens/tokens.json (rules: tokens/profile.json, outputs: tokens/mapping.json).
 * Generator: tools/build_tokens.py. Regenerate with `make build-tokens`; `make check-tokens` fails on drift.
 * Profile: ticketstub-token-profile 1.0.0 (not claimed DTCG-compatible).
 * Input sha256 tokens/tokens.json: 649e570dc1397ef78bc00b28127ce166d640a4187eb2889fb2f57cc54054f228
 * Input sha256 tokens/profile.json: 18ce404d9e9f667bcab5a6cc0a87ca7be9e9866c5b7e69bff0c529e21742fef3
 * Input sha256 tokens/mapping.json: 7db9104591711ff10a86f2fa26f2ec64fc995f3fb5eec9b7040be6ae363ffb45
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        orange: "var(--ts-orange)",
        copper: "var(--ts-copper)",
        moss: "var(--ts-moss)",
        cyan: "var(--ts-cyan)",
        cream: "var(--ts-cream)",
        ink: "var(--ts-ink)",
        bg: "var(--ts-bg)",
        surface: "var(--ts-surface)",
        fg: "var(--ts-text)",
        muted: "var(--ts-text-muted)",
        focus: "var(--ts-focus)",
      },
      backgroundImage: {
        foil: "var(--ts-foil)",
        holo: "var(--ts-holo-spectrum)",
      },
      fontFamily: {
        display: ["Fraunces", "Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
        ui: ["Inter Tight", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
      },
      fontSize: {
        "step--1": "var(--ts-step--1)",
        "step-0": "var(--ts-step-0)",
        "step-1": "var(--ts-step-1)",
        "step-2": "var(--ts-step-2)",
        "step-3": "var(--ts-step-3)",
        "step-4": "var(--ts-step-4)",
        "step-5": "var(--ts-step-5)",
        "step-6": "var(--ts-step-6)",
      },
      borderRadius: {
        paper: "var(--ts-radius-paper)",
        control: "var(--ts-radius-control)",
        sheet: "var(--ts-radius-sheet)",
        pill: "var(--ts-radius-pill)",
      },
      boxShadow: {
        paper: "var(--ts-shadow-paper)",
        lifted: "var(--ts-shadow-lifted)",
      },
      transitionTimingFunction: {
        standard: "var(--ts-ease-standard)",
        enter: "var(--ts-ease-enter)",
        exit: "var(--ts-ease-exit)",
        flip: "var(--ts-ease-flip)",
      },
      transitionDuration: {
        track: "var(--ts-dur-track)",
        quick: "var(--ts-dur-quick)",
        base: "var(--ts-dur-base)",
        settle: "var(--ts-dur-settle)",
        reveal: "var(--ts-dur-reveal)",
        shutter: "var(--ts-dur-shutter)",
        "print-sweep": "var(--ts-dur-print-sweep)",
      },
    },
  },
};
