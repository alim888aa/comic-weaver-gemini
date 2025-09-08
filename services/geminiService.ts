import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { Theme, MoodVector, Panel, NPC } from '../types';

// Lightweight rate limiter for image generation (Free tier: 10 RPM) with small concurrency pool
const IMAGE_RPM_LIMIT = 10; // requests per minute
const IMAGE_CONCURRENCY_LIMIT = 3; // in-flight requests
const ONE_MINUTE_MS = 60_000;

type QueueTask<T> = { run: () => Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
const imageQueue: QueueTask<any>[] = [];
let imageInFlight = 0;
let imageStartTimestamps: number[] = [];

const pruneOldStarts = () => {
  const now = Date.now();
  imageStartTimestamps = imageStartTimestamps.filter((t) => now - t < ONE_MINUTE_MS);
};

const scheduleNextTick = (delayMs: number) => {
  setTimeout(processImageQueue, delayMs);
};

const canStartMore = () => {
  pruneOldStarts();
  return imageInFlight < IMAGE_CONCURRENCY_LIMIT && imageStartTimestamps.length < IMAGE_RPM_LIMIT;
};

function processImageQueue() {
  pruneOldStarts();
  while (canStartMore() && imageQueue.length > 0) {
    const task = imageQueue.shift()!;
    imageInFlight += 1;
    imageStartTimestamps.push(Date.now());
    task
      .run()
      .then((res) => task.resolve(res))
      .catch((err) => task.reject(err))
      .finally(() => {
        imageInFlight -= 1;
        // Try to start more immediately
        scheduleNextTick(0);
      });
  }

  if (imageQueue.length > 0 && !canStartMore()) {
    const now = Date.now();
    const oldest = imageStartTimestamps[0] ?? now;
    const msUntilWindowFrees = Math.max(0, ONE_MINUTE_MS - (now - oldest));
    // Wake when RPM window frees up; also wakes on in-flight completions
    scheduleNextTick(msUntilWindowFrees + 5);
  }
}

function scheduleImageTask<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    imageQueue.push({ run, resolve, reject });
    processImageQueue();
  });
}

function isRateLimitError(err: unknown): boolean {
  const anyErr = err as any;
  const status = anyErr?.status || anyErr?.code;
  const message: string = (anyErr?.message || "").toString().toLowerCase();
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    message.includes('rate') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('429')
  );
}

async function retryWithBackoff<T>(fn: () => Promise<T>, opts?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number }): Promise<T> {
  const retries = opts?.retries ?? 3;
  const base = opts?.baseDelayMs ?? 250;
  const max = opts?.maxDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= retries) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * base);
      const delay = Math.min(max, base * Math.pow(2, attempt)) + jitter;
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

const storyGenerationSchema = {
  type: Type.OBJECT,
  properties: {
    panels: {
      type: Type.ARRAY,
      description: "An array of 5 comic panel objects.",
      items: {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description: "A detailed visual description of the panel for an AI image generator.",
          },
          narrative: {
            type: Type.STRING,
            description: "The narrative text or dialogue for the panel.",
          },
          specs: {
            type: Type.OBJECT,
            description: "Optional cinematography guidance for the image generator.",
            properties: {
              shotType: { type: Type.STRING, description: "Shot type, e.g., wide, medium, close-up, over-the-shoulder." },
              angle: { type: Type.STRING, description: "Camera angle or perspective (e.g., low, high, dutch tilt)." },
              lens: { type: Type.NUMBER, description: "Focal length in mm (e.g., 24, 35, 50)." },
              composition: { type: Type.STRING, description: "Composition notes (rule of thirds, leading lines, foreground occlusion)." },
              lighting: { type: Type.STRING, description: "Lighting setup or vibe (e.g., rim light, soft dusk light)." },
              colorPalette: { type: Type.STRING, description: "Dominant palette tokens (e.g., teal-orange dusk, neon magenta)." },
              movement: { type: Type.STRING, description: "Motion cues (speed lines, implied blur)." },
              continuityRole: { type: Type.STRING, description: "How this panel serves scene continuity (establishing, match-on-action, reaction)." },
            },
          },
        },
        required: ["description", "narrative"],
      },
    },
    choices: {
      type: Type.ARRAY,
      description: "An array of exactly 4 choices, each biased to one mood vector (adventure, danger, romance, drama).",
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description: "The text for the choice button.",
          },
          impact: {
            type: Type.OBJECT,
            properties: {
              adventure: { type: Type.NUMBER, description: "Impact on adventure mood (0.0 to 0.2)." },
              danger: { type: Type.NUMBER, description: "Impact on danger mood (0.0 to 0.2)." },
              romance: { type: Type.NUMBER, description: "Impact on romance mood (0.0 to 0.2)." },
              drama: { type: Type.NUMBER, description: "Impact on drama mood (0.0 to 0.2)." },
            },
            required: ["adventure", "danger", "romance", "drama"],
          },
        },
        required: ["text", "impact"],
      },
    },
    newNpcs: {
        type: Type.ARRAY,
        description: "A list of any new NPCs introduced in this chapter. Do not include existing characters.",
        items: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: "The NPC's name." },
                description: { type: Type.STRING, description: "A detailed visual description of the NPC for an image generator." }
            },
            required: ["name", "description"]
        }
    }
  },
  required: ["panels", "choices"],
};

export const generateStoryChapter = async (
  apiKey: string,
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  characterDescription: string,
  lastChoiceText?: string,
): Promise<any> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });
  
  const previousContext = previousPanels.length > 0
    ? `The story so far: ${previousPanels.slice(-3).map(p => p.narrative).join(' ')}`
    : 'This is the very first chapter of the story.';

  const choiceContext = lastChoiceText
    ? `The user just made the choice: "${lastChoiceText}". The story must now continue directly from this decision.`
    : 'This is the beginning of the story, so there was no previous choice.';

  const prompt = `
    You are a comic book writer. Continue the story based on the provided context.
    Theme: ${theme}
    Character Description: ${characterDescription}
    Current Mood - Adventure: ${mood.adventure.toFixed(2)}, Danger: ${mood.danger.toFixed(2)}, Romance: ${mood.romance.toFixed(2)}, Drama: ${mood.drama.toFixed(2)}.
    
    Previous Story Context: ${previousContext}
    Decision Made: ${choiceContext}
    
    Instructions:
    1. Generate a new chapter consisting of exactly 5 comic book panels that logically follows from the 'Decision Made'.
    2. For each panel, provide:
       - a detailed visual 'description' for an AI image generator,
       - a short 'narrative' text,
       - an optional 'specs' object with cinematography guidance: { shotType, angle, lens, composition, lighting, colorPalette, movement, continuityRole }.
    3. The story should reflect the current mood.
       - If adventure is high (> 0.3), include exciting or exploratory elements.
       - If danger is high (> 0.3), add tension, suspense, or a threat.
       - If romance is high (> 0.3), introduce emotional or intimate moments.
       - If drama is high (> 0.3), elevate stakes, emotional weight, and twists.
    4. After the 5 panels, create exactly 4 'choices' for the user.
    5. Each choice must be biased toward ONE mood vector among [adventure, danger, romance, drama]:
       - The biased vector must be between 0.10 and 0.20.
       - All other vectors must be between 0.00 and 0.05.
       - Across the 4 choices, cover all four mood vectors exactly once.
    6. Each choice text should clearly signal its bias.
    7. If you introduce any new named characters, list them in the 'newNpcs' array with their name and a detailed visual description.
    8. **CRITICAL RULE: Do not introduce more than two new named NPCs in this chapter.**
    9. Ensure the narrative flows logically and maintains character consistency.
    10. Respond ONLY with the JSON object described in the schema.
  `;

  try {
    console.log('[Gemini] generateStoryChapter request', { model: 'gemini-2.5-flash' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: storyGenerationSchema,
      },
    });
    const jsonText = response.text.trim();
    console.log('[Gemini] generateStoryChapter response received');
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('[Gemini] generateStoryChapter error', { error });
    throw error;
  }
};

export const generatePanelImage = async (
  apiKey: string,
  theme: Theme,
  panelDescription: string,
  characterDescription: string,
  characterReferenceImage?: string, // Optional reference image for consistency
  npcs: NPC[] = [] // Optional list of NPCs in the scene
): Promise<string> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });
  
  let npcDetails = '';
  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];

  // Add main character reference if available
  if (characterReferenceImage) {
    parts.push({
      inlineData: {
        data: characterReferenceImage,
        mimeType: 'image/jpeg', 
      },
    });
  }

  // Add NPC references if they are in the panel description
  for (const npc of npcs) {
    if (panelDescription.includes(npc.name)) {
        npcDetails += `\nNPC Name: ${npc.name}. NPC Description: ${npc.description}.`;
        parts.push({
            inlineData: {
                data: npc.referenceImage,
                mimeType: 'image/jpeg',
            }
        });
    }
  }

  const prompt = `
    A vibrant comic book panel with clear black line art and dynamic coloring.
    Style: Modern American comic book art.
    Theme: ${theme}.
    Panel content: ${panelDescription}.
    Main Character Details: ${characterDescription}.
    ${npcDetails}
    Ensure all characters are drawn consistently based on their descriptions and provided reference images.
    Aspect Ratio: 4:3.
  `;
  parts.push({ text: prompt });

  let response: any;
  try {
    const runRequest = async () => {
      console.log('[Gemini] generatePanelImage request', { model: 'gemini-2.5-flash-image-preview' });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: {
          parts: parts,
        },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });
      console.log('[Gemini] generatePanelImage response received');
      return res;
    };

    response = await scheduleImageTask(() => retryWithBackoff(runRequest));
  } catch (error) {
    console.error('[Gemini] generatePanelImage error', { error });
    throw error;
  }

  try {
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? [];
      for (const part of parts) {
        if (part?.inlineData?.data) {
          return part.inlineData.data;
        }
      }
    }
  } catch (err) {
    console.error('[Gemini] Unexpected response shape for image generation', { err, response });
  }

  const textResponse: string = typeof response?.text === 'string' ? response.text : '[no text payload]';
  const errorMessage = `Image generation failed: model did not return an image inlineData. Details: ${textResponse}`;
  console.error(errorMessage, { response });
  throw new Error(errorMessage);
};

// Batch image generation: single call returning exactly 5 images for the chapter
export const generateChapterImagesBatch = async (
  apiKey: string,
  theme: Theme,
  panelDescriptions: string[],
  panelSpecs: Array<{
    shotType?: string;
    angle?: string;
    lens?: number;
    composition?: string;
    lighting?: string;
    colorPalette?: string;
    movement?: string;
    continuityRole?: string;
  }>,
  characterDescription: string,
  characterReferenceImage?: string,
  npcs: NPC[] = []
): Promise<string[]> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  if (!Array.isArray(panelDescriptions) || panelDescriptions.length < 1) {
    throw new Error('generateChapterImagesBatch requires at least 1 panel description');
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];

  // Add main character reference if available
  if (characterReferenceImage) {
    parts.push({ inlineData: { data: characterReferenceImage, mimeType: 'image/jpeg' } });
  }

  // Include NPC references that are mentioned in any panel description
  const allText = panelDescriptions.join(' ').toLowerCase();
  for (const npc of npcs) {
    if (allText.includes(npc.name.toLowerCase())) {
      parts.push({ inlineData: { data: npc.referenceImage, mimeType: 'image/jpeg' } });
    }
  }

  // Build a global continuity + per-panel directive
  const specText = panelDescriptions
    .map((desc, i) => {
      const s = panelSpecs?.[i] || {};
      const lines: string[] = [
        `Panel ${i + 1}:`,
        `  Description: ${desc}`,
      ];
      const cam: string[] = [];
      if (s.shotType) cam.push(`shot: ${s.shotType}`);
      if (s.angle) cam.push(`angle: ${s.angle}`);
      if (typeof s.lens === 'number') cam.push(`lens: ${s.lens}mm`);
      if (s.composition) cam.push(`composition: ${s.composition}`);
      if (s.lighting) cam.push(`lighting: ${s.lighting}`);
      if (s.colorPalette) cam.push(`palette: ${s.colorPalette}`);
      if (s.movement) cam.push(`movement: ${s.movement}`);
      if (s.continuityRole) cam.push(`continuity: ${s.continuityRole}`);
      if (cam.length) lines.push(`  Camera: ${cam.join('; ')}`);
      return lines.join('\n');
    })
    .join('\n\n');

  const panelCount = panelDescriptions.length;
  const prompt = `
    Generate exactly ${panelCount} sequential comic panels as IMAGES in a single response.
    Style: Modern American comic book art. Theme: ${theme}. Aspect Ratio: 4:3.
    Maintain strict continuity across panels: consistent character design (use reference images),
    environment layout, time-of-day, and color palette unless descriptions specify a change.
    No text bubbles or UI; only visual art.

    Main Character Details: ${characterDescription}.

    Per-panel specifications follow. Respect composition and camera guidance, but preserve readability and avoid cropping heads/feet unintentionally.
    ${specText}

    Output constraints (critical):
    - Return exactly ${panelCount} IMAGE parts and nothing else (no text parts, no captions, no markdown).
    - Order strictly: Panel 1 image, Panel 2 image, ..., Panel ${panelCount} image.
    - One image per panel.
  `;
  parts.push({ text: prompt });

  let response: any;
  try {
    const runRequest = async () => {
      console.log('[Gemini] generateChapterImagesBatch request', { model: 'gemini-2.5-flash-image-preview', panelCount });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE] },
      });
      console.log('[Gemini] generateChapterImagesBatch response received');
      return res;
    };
    response = await scheduleImageTask(() => retryWithBackoff(runRequest));
  } catch (error) {
    console.error('[Gemini] generateChapterImagesBatch error', { error });
    throw error;
  }

  try {
    const images: string[] = [];
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    for (const candidate of candidates) {
      const cparts = candidate?.content?.parts ?? [];
      for (const part of cparts) {
        if (part?.inlineData?.data) {
          images.push(part.inlineData.data);
        }
      }
    }
    if (images.length !== panelCount) {
      throw new Error(`Batch image generation returned ${images.length} images, expected ${panelCount}.`);
    }
    return images;
  } catch (err) {
    console.error('[Gemini] Unexpected response shape for batch image generation', { err, response });
    throw err instanceof Error ? err : new Error('Batch image generation failed');
  }
};

// Generate a final closing chapter when a mood vector reaches 1.0
export const generateEndingChapter = async (
  apiKey: string,
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  characterDescription: string,
  dominantMood: keyof MoodVector,
): Promise<{ panels: { description: string; narrative: string }[] }> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });

  const previousContext = previousPanels.length > 0
    ? `The story so far: ${previousPanels.slice(-5).map(p => p.narrative).join(' ')}`
    : 'This is the start of the story.';

  const endingTone = {
    adventure: 'cathartic triumph, horizon-widening discovery, reflective denouement',
    danger: 'resolution of threat, relief with lingering tension release, aftermath reflection',
    romance: 'emotional closure, intimacy, warm resonance, hopeful future note',
    drama: 'poignant resolution, character growth, bittersweet but satisfying close',
  }[dominantMood];

  const prompt = `
    You are a comic book writer. Craft a CONCLUSIVE ENDING SEQUENCE for the story.
    Theme: ${theme}
    Character Description: ${characterDescription}
    Final Mood Focus: ${dominantMood} — ${endingTone}.
    Current Mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}.

    Previous Story Context: ${previousContext}

    Instructions:
    1. Produce exactly 4 panels that deliver a satisfying ending, tying off threads naturally.
    2. Each panel must include a detailed visual 'description' and a concise 'narrative' line.
    3. DO NOT include choices. This is the finale.
    4. Keep continuity with prior events and tone. Focus on ${dominantMood}.
    5. Respond ONLY with a JSON object with shape: { "panels": [{ "description": string, "narrative": string }, ...] }.
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      panels: {
        type: Type.ARRAY,
        description: "An array of 4 closing comic panel objects.",
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            narrative: { type: Type.STRING },
          },
          required: ["description", "narrative"],
        },
      },
    },
    required: ["panels"],
  };

  try {
    console.log('[Gemini] generateEndingChapter request', { model: 'gemini-2.5-flash', dominantMood });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
    const jsonText = response.text.trim();
    const parsed = JSON.parse(jsonText);
    if (!parsed || !Array.isArray(parsed.panels)) throw new Error('Invalid ending payload');
    return parsed as { panels: { description: string; narrative: string }[] };
  } catch (error) {
    console.error('[Gemini] generateEndingChapter error', { error });
    throw error;
  }
};

// Audio briefs: text-only prompts for music/ambience and per-panel SFX/stingers
const audioBriefSchema = {
  type: Type.OBJECT,
  properties: {
    musicPrompt: { type: Type.STRING, description: "One sentence prompt for a loopable chapter background ambience track. No vocals. Minimal melody." },
    ambiencePrompt: { type: Type.STRING, description: "Fallback ambience bed prompt (10–15s), loopable, subtle, no melody, no vocals." },
    perPanel: {
      type: Type.ARRAY,
      description: "Array aligned to panels; each entry contains an SFX prompt and optional stinger metadata.",
      items: {
        type: Type.OBJECT,
        properties: {
          sfxPrompt: { type: Type.STRING, description: "Prompt for a 3–5s focused sound effect fitting the panel visuals." },
          stingerLabel: { type: Type.STRING, description: "Short label for caching/reuse (e.g., 'forest_tremor', 'door_creak')." },
          stingerPrompt: { type: Type.STRING, description: "Optional 1–2s stinger prompt for transitions or reveals." },
        },
        required: ["sfxPrompt"],
      },
    },
  },
  required: ["musicPrompt", "ambiencePrompt", "perPanel"],
};

export const generateAudioBriefs = async (
  apiKey: string,
  theme: Theme,
  mood: MoodVector,
  panels: Panel[],
): Promise<{ musicPrompt: string; ambiencePrompt: string; perPanel: { sfxPrompt: string; stingerLabel?: string; stingerPrompt?: string }[] }> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });

  const cappedPanels = panels.slice(0, 5);
  const panelSummaries = cappedPanels.map((p, i) => `Panel ${i + 1}: description="${p.narrative ? '' : ''}${(p as any).description ?? ''}" narrative="${p.narrative}"`).join("\n");

  const prompt = `You are an audio director for a comic experience. Create precise, production-ready prompts for generative audio services.

Context:
- Theme: ${theme}
- Mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}
- Panels (visual + narrative hints):
${panelSummaries}

Output goals:
1) musicPrompt: Describe a single, LOOPABLE ambience bed for the whole chapter. Requirements: no vocals, minimal melody, subtle texture, avoid strong percussion unless danger > 0.50. Mention environment (if implied), instrumentation textures (e.g., "forest hush, faint low-end tremor, airy wind, distant birds"), and stability ("steady, seamless loop"). Keep 1 sentence.
2) ambiencePrompt: Similar to musicPrompt but targeted for a 10–15s loopable ambience bed via a generic sound-generation API. No melody, no vocals, focus on texture.
3) perPanel[]: For each panel in order, provide:
   - sfxPrompt: A focused 3–5s effect matching the panel's key action/element (e.g., "stone resonant vibration with sub-bass flutter"), mention clarity, no music.
   - stingerLabel: Short kebab-case tag for caching/reuse (e.g., forest-tremor, door-creak). If no obvious stinger, omit.
   - stingerPrompt: Optional 1–2s transition/reveal hit (e.g., "soft low boom with sparkle tail"), only when impactful.

Return ONLY the JSON matching the provided schema.`;

  try {
    console.log('[Gemini] generateAudioBriefs request', { model: 'gemini-2.5-flash' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: audioBriefSchema,
      },
    });
    const jsonText = response.text.trim();
    console.log('[Gemini] generateAudioBriefs response received');
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('[Gemini] generateAudioBriefs error', { error });
    throw error;
  }
};

// Fallback: Generate exactly 4 choices via fast text model when director JSON lacks valid choices
export const generateChoicesFallback = async (
  apiKey: string,
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  lastChoiceText?: string,
): Promise<{ text: string; impact: MoodVector }[]> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });

  const previousContext = previousPanels.length > 0
    ? `The story so far: ${previousPanels.slice(-5).map(p => p.narrative).join(' ')}`
    : 'This is the beginning of the story.';

  const choiceContext = lastChoiceText
    ? `The user just chose: "${lastChoiceText}". Continue directly from this decision.`
    : 'No previous choice was made.';

  const schema = {
    type: Type.OBJECT,
    properties: {
      choices: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            impact: {
              type: Type.OBJECT,
              properties: {
                adventure: { type: Type.NUMBER },
                danger: { type: Type.NUMBER },
                romance: { type: Type.NUMBER },
                drama: { type: Type.NUMBER },
              },
              required: ["adventure", "danger", "romance", "drama"],
            },
          },
          required: ["text", "impact"],
        },
      },
    },
    required: ["choices"],
  };

  const prompt = `You are a narrative designer. Based on the context, produce exactly 4 next-step choices.
Theme: ${theme}. Mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}.
Context: ${previousContext}
Decision to follow: ${choiceContext}

Rules:
- Output exactly 4 choices in JSON: { "choices": [{ "text": string, "impact": { "adventure": number, "danger": number, "romance": number, "drama": number }}, ...] }.
- Each choice is biased to a different mood among [adventure, danger, romance, drama].
- The biased mood must be in [0.10, 0.20]. All other moods must be in [0.00, 0.05].
- Text should clearly signal its bias and be concise.`;

  try {
    console.log('[Gemini] generateChoicesFallback request', { model: 'gemini-2.0-flash' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
    const jsonText = response.text.trim();
    console.log('[Gemini] generateChoicesFallback response received');
    const parsed = JSON.parse(jsonText);
    const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
    return choices;
  } catch (error) {
    console.error('[Gemini] generateChoicesFallback error', { error });
    throw error;
  }
};

// Director + Image: Create a 6-panel reference PAGE and structured JSON in one call
export const generateDirectorPageAndJSON = async (
  apiKey: string,
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  lastChoiceText?: string,
  currentCharacterDescription?: string,
): Promise<{ pageImage: string; characterDescription?: string; panels: { description: string; narrative: string; specs?: { shotType?: string; angle?: string; lens?: number; composition?: string; lighting?: string; colorPalette?: string; movement?: string; continuityRole?: string } }[]; choices: { text: string; impact: MoodVector }[]; newNpcs: { name: string; description: string }[] }> => {
  if (!apiKey) throw new Error("Gemini API key is required.");
  const ai = new GoogleGenAI({ apiKey });

  const previousContext = previousPanels.length > 0
    ? `The story so far: ${previousPanels.slice(-5).map(p => p.narrative).join(' ')}`
    : 'This is the beginning of the story.';

  const choiceContext = lastChoiceText
    ? `The user just chose: "${lastChoiceText}". Continue directly from this decision.`
    : 'No previous choice was made.';

  const prompt = `
Act as DIRECTOR + LAYOUT ARTIST.

Goal:
1) Produce ONE comic PAGE image with EXACTLY 6 PANELS in a clean 2×3 grid with visible gutters.
2) Then output a JSON object (and nothing else) describing the panels, choices, and any newly introduced NPCs.

Theme: ${theme}. Style: Modern American comic.
Continuity: rainy neon dusk city; teal–magenta palette across all panels.
Rules (critical): No speech balloons, captions, SFX text, page numbers, or UI. Each panel frames a 4:3 scene INSIDE its cell (full-bleed within the cell). Maintain consistent character design, outfit, environment, lighting, and palette.

Story context: ${previousContext}
Decision to follow: ${choiceContext}
Mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}.

Per-panel guidance (left→right, top→bottom). Keep concise and cinematic. Vary camera and composition.

Main Character Details:
${currentCharacterDescription && currentCharacterDescription.length > 0 ? `USE THIS CANONICAL DESCRIPTION EXACTLY:
${currentCharacterDescription}
Do NOT change it. Include it verbatim as "characterDescription" in the JSON.` : `Create a CANONICAL description (80–140 words) for the main character suitable for image conditioning. Keep it specific (hair, eyes, outfit, accessory) and consistent. Include it as "characterDescription" in the JSON.`}

Output order (strict):
A) First: the single multi-panel PAGE image (2×3 grid with gutters). No text anywhere.
B) Then: output ONLY the JSON object with shape:
{
  "panels": [
    { "description": string, "narrative": string, "specs": { "shotType"?: string, "angle"?: string, "lens"?: number, "composition"?: string, "lighting"?: string, "colorPalette"?: string, "movement"?: string, "continuityRole"?: string } },
    { ... } x6 total
  ],
  "choices": [ { "text": string, "impact": { "adventure": number, "danger": number, "romance": number, "drama": number } } x4 ],
  "newNpcs": [ { "name": string, "description": string } ]
}
JSON rules (critical): Exactly 6 panels. Exactly 4 choices; each biased to a different mood vector: biased ∈ [0.10, 0.20]; others ∈ [0.00, 0.05]. At most 2 newNpcs. No extra keys.
`;

  const parts: ({ text: string })[] = [{ text: prompt }];

  // Single call: request IMAGE + TEXT; parse page image and JSON from text parts
  let response: any;
  try {
    const runRequest = async () => {
      console.log('[Gemini] generateDirectorPageAndJSON request', { model: 'gemini-2.5-flash-image-preview' });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });
      console.log('[Gemini] generateDirectorPageAndJSON response received', {
        candidates: Array.isArray(res?.candidates) ? res.candidates.length : 0,
      });
      return res;
    };
    response = await scheduleImageTask(() => retryWithBackoff(runRequest));
  } catch (error) {
    console.error('[Gemini] generateDirectorPageAndJSON error', { error });
    throw error;
  }

  let pageImage: string | undefined;
  let textPayload = '';
  try {
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    console.log('[Gemini] Director single-call candidates detail', {
      candidateCount: candidates.length,
      partCounts: candidates.map((c: any) => c?.content?.parts?.length || 0),
    });
    for (const candidate of candidates) {
      const cparts = candidate?.content?.parts ?? [];
      for (const part of cparts) {
        if (part?.inlineData?.data && !pageImage) {
          pageImage = part.inlineData.data;
        } else if (typeof part?.text === 'string') {
          textPayload += part.text + '\n';
        }
      }
    }
  } catch (err) {
    console.error('[Gemini] Director single-call parse error', { err, response });
  }
  if (!pageImage) {
    console.error('[Gemini] Director missing page image');
    throw new Error('Director call did not return a page image');
  }
  if (!textPayload || textPayload.trim().length === 0) {
    console.warn('[Gemini] Director missing JSON text; attempting fallback parse from response.text');
    if (typeof response?.text === 'string') textPayload = response.text;
  }

  let parsed: any;
  try {
    const start = textPayload.indexOf('{');
    const end = textPayload.lastIndexOf('}');
    const jsonSlice = start >= 0 && end > start ? textPayload.slice(start, end + 1) : textPayload;
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    console.error('[Gemini] Director JSON parse failed (single-call)', { err, textPreview: textPayload.slice(0, 200) });
    throw new Error('Director call JSON parse failed');
  }

  console.log('[Gemini] Director JSON parsed (single-call)', {
    panels: Array.isArray(parsed?.panels) ? parsed.panels.length : 0,
    choices: Array.isArray(parsed?.choices) ? parsed.choices.length : 0,
    newNpcs: Array.isArray(parsed?.newNpcs) ? parsed.newNpcs.length : 0,
    characterDescriptionLen: typeof parsed?.characterDescription === 'string' ? parsed.characterDescription.length : 0,
  });

  return {
    pageImage,
    characterDescription: parsed.characterDescription,
    panels: parsed.panels || [],
    choices: parsed.choices || [],
    newNpcs: parsed.newNpcs || [],
  };
};

// Re-render a single panel using the PAGE image as a visual reference
export const generatePanelImageFromPageRef = async (
  apiKey: string,
  theme: Theme,
  panelDescription: string,
  specs: { shotType?: string; angle?: string; lens?: number; composition?: string; lighting?: string; colorPalette?: string; movement?: string } | undefined,
  pageReferenceImage: string,
  characterReferenceImage?: string,
  characterDescription?: string,
  npcs: NPC[] = [],
): Promise<string> => {
  if (!apiKey) throw new Error('Gemini API key is required.');
  const ai = new GoogleGenAI({ apiKey });

  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
  // Page as primary reference
  parts.push({ inlineData: { data: pageReferenceImage, mimeType: 'image/jpeg' } });
  if (characterReferenceImage) {
    parts.push({ inlineData: { data: characterReferenceImage, mimeType: 'image/jpeg' } });
  }
  // NPC refs if present in description
  for (const npc of npcs) {
    if (panelDescription.toLowerCase().includes(npc.name.toLowerCase())) {
      parts.push({ inlineData: { data: npc.referenceImage, mimeType: 'image/jpeg' } });
    }
  }

  const cam: string[] = [];
  if (specs?.shotType) cam.push(`shot=${specs.shotType}`);
  if (specs?.angle) cam.push(`angle=${specs.angle}`);
  if (typeof specs?.lens === 'number') cam.push(`lens=${specs.lens}mm`);
  if (specs?.composition) cam.push(`composition=${specs.composition}`);
  if (specs?.lighting) cam.push(`lighting=${specs.lighting}`);
  if (specs?.colorPalette) cam.push(`palette=${specs.colorPalette}`);
  if (specs?.movement) cam.push(`movement=${specs.movement}`);

  const prompt = `
You are given a REFERENCE COMIC PAGE (2×3 grid, 6 panels).
Task: Recreate ONE panel as a SINGLE standalone IMAGE, full-bleed 4:3, no borders/gutters/captions.
Theme: ${theme}.
Continuity: match character design, environment layout, lighting, and palette from the reference page.

Panel description: ${panelDescription}
${cam.length ? `Cinematography: ${cam.join('; ')}` : ''}
${characterDescription && characterDescription.length > 0 ? `Canonical character description (verbatim, keep consistent): ${characterDescription}` : ''}

Output: exactly ONE panel image (not a page or collage).
`;
  parts.push({ text: prompt });

  let response: any;
  try {
    const runRequest = async () => {
      console.log('[Gemini] generatePanelImageFromPageRef request', { model: 'gemini-2.5-flash-image-preview' });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });
      console.log('[Gemini] generatePanelImageFromPageRef response received');
      return res;
    };
    response = await scheduleImageTask(() => retryWithBackoff(runRequest));
  } catch (error) {
    console.error('[Gemini] generatePanelImageFromPageRef error', { error });
    throw error;
  }

  try {
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    for (const candidate of candidates) {
      const cparts = candidate?.content?.parts ?? [];
      for (const part of cparts) {
        if (part?.inlineData?.data) {
          return part.inlineData.data;
        }
      }
    }
  } catch (err) {
    console.error('[Gemini] Unexpected response for panel-from-page', { err, response });
  }
  throw new Error('Panel-from-page generation failed: no image returned');
};
