# Audio Sources — Phase 4 Sword Reveal

All audio in this directory is **synthesised on the dev machine with FFmpeg** —
basic oscillators + filtered noise + envelopes. They're placeholders chosen for
the right *character* (drone, swoosh, thud, crack, sustain), not production
polish. Replace with proper licensed SFX when you find ones you like.

| File | Beat | Synthesis recipe |
| ---- | ---- | ---------------- |
| `portal-hum.mp3` | Ambient hum from the portal. Loops. | 55 Hz sine + 0.4 Hz vibrato @ 0.6 ratio + 0.45 vol + soft fades |
| `sword-summon.mp3` | Metallic shing as the sword materialises on click. | 440 Hz sine pitched up 1.5× + bandpass @ 2 kHz + 50 ms attack |
| `sword-swoosh.mp3` | Swoosh as the sword arcs toward the wall. | Brown noise + 400–4000 Hz bandpass + 40 ms attack + 250 ms decay |
| `impact.mp3` | Heavy thud at the moment the blade strikes the wall. | 70 Hz sine + 2.2× volume + 40 ms attack + 450 ms decay |
| `crack.mp3` | Glass crack propagation as fractures spread. | White noise + 2.5–8 kHz bandpass + 10 ms attack + slow tail |
| `vibe-hum.mp3` | Low reverb hum as VIBE glows through the cracks. Loops. | 100 Hz sine + 0.3 Hz tremolo + 0.35 vol + soft fades |

## Regeneration

The FFmpeg one-liners are in the commit that introduced this file. Quickest re-bake of the impact thud:

```bash
cd client/public/audio
ffmpeg -y -f lavfi -i "sine=frequency=70:duration=0.5" \
  -af "volume=2.2,afade=t=out:st=0.04:d=0.45" -ac 2 impact.mp3
```

## Licensing

Synthesised audio has no copyright restriction — it's first-principles oscillator output. Free to redistribute and ship with the site.
