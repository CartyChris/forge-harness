# Forge — round 5 (2026-10-26): free AI, new features, refined UI

## Free AI you can use right away
- **Free AI directory** (new rail icon 🎁, `/free`): every provider grouped by what it takes — *No key needed — works right here*, *No key but needs your gateway / an https page*, *Free key (1-minute signup)*, *On-device*, *Local server*, *Paid* — each with an honest route badge, limits, **Get free key ↗**, **Use**, and a one-tap **Test**.
- **No key:** Pollinations (already), **LLM7.io** (works without a key at a lower rate; optional free token) — plus the on-device trio below.
- **On-device, no key** (new `66-local-ai`): **Chrome built-in AI** (Gemini Nano, desktop Chrome 148+), **wllama** (GGUF on CPU/WASM — the option that can run on iPhone without WebGPU), **Transformers.js** small instruct models. Capability table, download progress, load/unload, clear cache. These now also appear in the model picker under *On-device & plugin providers*.
- **New free-key providers:** Z.ai GLM Flash (glm-4.7-flash, glm-4.5-flash), Vercel AI Gateway (monthly free credit), Nous Portal (Hermes, $0 daily quota), Hack Club AI (teens only); Cloudflare Workers AI listed as "needs a Worker/gateway".
- **Get free key ↗** button next to every key box in the picker, and in every missing-key error.
- **Less-restricted open models:** OpenRouter `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` and `nousresearch/hermes-3-llama-3.1-405b:free` (both free), Venice `venice-uncensored-1-2` (free key; Venice's docs say browsers may call it directly, so it is now routed *direct*), plus the earlier Dolphin/Hermes/uncensored ids. They carry a neutral **OPEN · LESS FILTERED** badge and a picker filter. No jailbreak / "never refuse" prompt is added — Forge's own guardrails (approvals, shield) still apply.

## New features
- **Model Arena** — blind A/B battles, vote, then names are revealed; Elo leaderboard (rough ±band), rematch, continue with the winner, export votes. Votes where a live model failed and an offline stand-in answered are saved but not rated.
- **Voice Mode** — hands-free loop (listen → answer → speak → listen) with a mic-reactive orb, live captions, barge-in, sentence-chunked speech for iPhone, voice/rate/pitch/language settings; typing fallback where speech recognition is unavailable.
- **Gen-Art Studio** — the "Ember Ledger" algorithmic-art series (`assets/GENART_PHILOSOPHY.md`): Flow Embers, Crystal Ledger, Orbital Harmonics, Ink Branches; seeded and reproducible, sliders, palettes, six-seed gallery, PNG saved to `/art/`; agent tool `genart_create`; also an animated **Ember Ledger** background.
- **Theme Studio + Theme Factory** — the 10 theme-factory palettes as 20 dark/light themes (all pass WCAG text ≥ 4.5 and accent ≥ 3), a custom theme builder with live preview, contrast check + **Fix contrast**, save/export/import, heading-font pairings.
- **Refined UI** — new type rhythm, message bubbles, tool cards with a status rail, composer elevation and focus ring, 40 px touch targets, ember-mark start screen with a starter grid; toggle in Settings → Appearance.

## Fixes
- Composer buttons are 40 px in core; tool cards carry a status class; light themes no longer flash dark form controls on load; composer pills can be one-tap actions (Voice); generative-art requests no longer get routed to the image generator.

## Independent review — 8 findings, all fixed
- wllama / Transformers.js could start two parallel model downloads (big memory leak on iPhone) → one in-flight load is shared.
- Stop didn't stop Transformers.js generation → it now interrupts the model.
- Voice Mode could re-listen forever in silence → it pauses after three silent tries.
- Mic meter likely dead on iPhone (AudioContext made outside a tap) → created during the tap.
- Barge-in could let the assistant interrupt itself through the speaker → off by default and now needs a clear rise over the speaking level.
- LLM7 was listed as "works right here" although its browser access is unverified → its own "worth a try" group.
- Paid providers' key button said "Get free key" → says "Get key".
- The polish layer used `:has()` in a hot DOM observer (throws on older Safari) → removed, one check per frame.

## Tests
39 suites in `tests/run_all.sh` (8 new). No internet in the build sandbox: every new endpoint was tested against mocks only, and nothing ran on a real iPhone.
