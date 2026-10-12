/** TicketStub Tailwind preset. Values reference the CSS variables in tokens.css,
 *  so the night theme switches without a rebuild.
 *  Usage: presets: [require("@ticketstub/brand-kit/tokens/tailwind.preset.js")] */
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
        track: "80ms",
        quick: "160ms",
        base: "240ms",
        settle: "380ms",
        reveal: "600ms",
      },
    },
  },
};
