<div align="center">
</div>

Comic Weaver is an interactive comic story maker where the user decides the genre and ending. It was created for the [Kaggle Banana competition hackathon](https://www.kaggle.com/competitions/banana/).

## Approach: nano-banana as Director + Storyboarder

The app uses nano-banana as a director and storyboarder. In a single multimodal call, it returns a clean 2×3 comic page (no text) and strict JSON describing six panel visuals, short narratives, four mood‑biased choices, and any new NPCs. That directing pass sets the visual language — character design, palette, lighting, and environment.

Next, the app asks nano‑banana to re‑create each panel as a standalone 4:3 image using the full page as a visual reference. Because nano‑banana accepts image inputs, it attaches the storyboard page and optional character/NPC portraits to preserve identity and continuity, and it passes per‑panel cinematography specs (shot, angle, lens, composition) from the JSON. When a mood vector reaches 1.0, it batch‑renders the ending panels for cohesive closure.

For audio, Gemini drafts a chapter ambience brief and per‑panel SFX/stinger prompts; ElevenLabs renders background music or subtle ambience plus targeted SFX. Overall, the app leans on nano‑banana’s image+text in one response, reference conditioning from images, and multi‑image outputs to turn one directing pass into a consistent, playable comic.

## Features

- Interactive branching driven by four mood vectors and user choices
- Consistent art via page‑level reference conditioning and per‑panel specs
- Optional NPC portrait caching for identity consistency
- Custom ambience and SFX per scene (Gemini prompts + ElevenLabs audio)
- Three selectable themes/settings; save/load via IndexedDB; XState orchestration

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
3. Enter your Gemini API key and ElevenLabs API key (must have sound effect generation access)