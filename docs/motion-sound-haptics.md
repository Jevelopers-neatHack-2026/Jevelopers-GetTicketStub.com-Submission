# Motion, sound and haptics

Every interaction should feel like handling paper. Tokens are in `tokens/tokens.json` under `motion`.

## Motion

| Token | Value | Use |
|---|---|---|
| `track` | 80 ms linear | Stub follows the finger, mouse or gyro |
| `quick` | 160 ms standard | Floating toolbar and chips appear |
| `base` | 240 ms standard | Sheets, toasts, style swap crossfade |
| `settle` | 380 ms `flip` (.45,0,.55,1) | Tilt returns to rest; card flip. The curve is symmetric so the face swap lands edge-on. |
| `reveal` | 600 ms `enter` | Stub lands after printing; stub pins to the wall |
| `shutter` | 320 ms | Print-complete flash: RGB split fades out with (1-p)^2.6 |
| `print-sweep` | 2600 ms loop | Foil sweep across the stub while it prints and researches |

- **Spring for drag-spin and swipe:** stiffness 0.055, damping 0.9, stepped at a fixed 60 Hz, maximum velocity 34. A fixed step means the stub settles in the same time on a 60 Hz phone and a 120 Hz laptop.
- **Tilt:** at most ±11° with 1400 px perspective.
- **Foil and tilt never step.** Pointer and gyro inputs are eased every frame (tilt τ 110 ms, glow in 400 ms and out 600 ms) instead of being set directly. See "Rules: foil must never pop" in `material-foil.md`.
- **Signature move: the tear.** Drag along the perforation. The stub follows with slight resistance; past 60% it rips free, flies to the wall, rotates to a random angle between -4° and 4°, and pins.
- **Reduced motion:** no tilt, spin or glitch. Foil holds a still sheen (`glow` 0.45), and transitions become instant cross-fades.

## Sound

Sound is **on by default**, with a mute toggle always visible in the top bar. Source all sounds from **[cuelume.dev](https://cuelume.dev/)** and keep each one under 600 ms (the printer loop is the exception), mixed quietly at -18 LUFS or below.

| Event | Character |
|---|---|
| Ticket dropped | Soft paper slide, short |
| Printing (loop while researching) | Thermal printer whirr, low and steady; fades out on completion |
| Print complete | Single crisp paper snap together with the shutter flash |
| Style shuffle | Card flick |
| Remix | Short shuffle and riffle |
| Tap to edit | Very soft tick |
| Flip to back | Paper turn |
| Perforation drag | Granular tearing that follows drag speed |
| Tear complete | Clean rip, then a pin "thunk" on landing |
| Add to cart | Rubber stamp |

- **Browser rule:** audio can only start after the first user gesture. The drop or tap that starts a stub unlocks it.

## Haptics

Use `navigator.vibrate` on Android. iOS Safari doesn't support web vibration, so on iOS the sound carries the feedback, and a native wrapper can map these to `UIImpactFeedbackGenerator` later.

| Event | Pattern (ms) |
|---|---|
| Drop accepted | `[12]` |
| Print complete | `[18, 40, 28]` |
| Style shuffle | `[8]` |
| Perforation tick (per hole crossed) | `[4]` |
| Tear complete | `[30, 30, 60]` |
| Pin to wall | `[20]` |
| Low-confidence chip appears | none (visual only) |

## Gyro

On mobile, phone tilt drives the foil light and parallax. iOS needs `DeviceOrientationEvent.requestPermission()` from a user gesture, so ask on the first tap on the stub, not on load. Smooth with a short low-pass filter (α ≈ 0.15) and clamp to the same ±11°.
