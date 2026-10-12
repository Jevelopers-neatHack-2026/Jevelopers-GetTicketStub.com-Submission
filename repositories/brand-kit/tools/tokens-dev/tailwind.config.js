// Minimal consumer config: the generated preset plus a fixed content file. Dev fixture only.
module.exports = {
  presets: [require("../../tokens/tailwind.preset.js")],
  content: [require("path").join(__dirname, "fixture.html")],
  corePlugins: { preflight: false },
};
