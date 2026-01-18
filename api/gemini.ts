import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Modality } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

// Retry with exponential backoff
const retryWithBackoff = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries === 0 || error?.status === 400) throw error;
    await new Promise((r) => setTimeout(r, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, ...params } = req.body;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    switch (action) {
      case 'generateDirectorPageAndJSON': {
        const { theme, mood, previousPanels, lastChoiceText, currentCharacterDescription, styleReferenceImage } = params;
        const result = await generateDirectorPageAndJSON(ai, theme, mood, previousPanels, lastChoiceText, currentCharacterDescription, styleReferenceImage);
        return res.status(200).json(result);
      }

      case 'generatePanelImage': {
        const { theme, panelDescription, characterDescription, characterReferenceImage, npcs } = params;
        const result = await generatePanelImage(ai, theme, panelDescription, characterDescription, characterReferenceImage, npcs);
        return res.status(200).json({ image: result });
      }

      case 'generatePanelImageFromPageRef': {
        const { theme, panelDescription, specs, pageReferenceImage, characterReferenceImage, characterDescription, npcs } = params;
        const result = await generatePanelImageFromPageRef(ai, theme, panelDescription, specs, pageReferenceImage, characterReferenceImage, characterDescription, npcs);
        return res.status(200).json({ image: result });
      }

      case 'generateChapterImagesBatch': {
        const { theme, panelDescriptions, panelSpecs, characterDescription, characterReferenceImage, npcs } = params;
        const result = await generateChapterImagesBatch(ai, theme, panelDescriptions, panelSpecs, characterDescription, characterReferenceImage, npcs);
        return res.status(200).json({ images: result });
      }

      case 'generateStoryChapter': {
        const { theme, mood, previousPanels, characterDescription, lastChoiceText } = params;
        const result = await generateStoryChapter(ai, theme, mood, previousPanels, characterDescription, lastChoiceText);
        return res.status(200).json(result);
      }

      case 'generateAudioBriefs': {
        const { theme, mood, panels } = params;
        const result = await generateAudioBriefs(ai, theme, mood, panels);
        return res.status(200).json(result);
      }

      case 'generateEndingChapter': {
        const { theme, mood, previousPanels, characterDescription, dominantMood } = params;
        const result = await generateEndingChapter(ai, theme, mood, previousPanels, characterDescription, dominantMood);
        return res.status(200).json(result);
      }

      case 'generateChoicesFallback': {
        const { theme, mood, allPanels, lastChoiceText } = params;
        const result = await generateChoicesFallback(ai, theme, mood, allPanels, lastChoiceText);
        return res.status(200).json({ choices: result });
      }

      case 'analyzeCharacterPhoto': {
        const { photo } = params;
        const result = await analyzeCharacterPhoto(ai, photo);
        return res.status(200).json(result);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error('[API] Gemini error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// --- Gemini Service Functions ---

const storyGenerationSchema = {
  type: 'object' as const,
  properties: {
    panels: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          description: { type: 'string' as const },
          narrative: { type: 'string' as const },
          specs: {
            type: 'object' as const,
            properties: {
              shotType: { type: 'string' as const },
              angle: { type: 'string' as const },
              lens: { type: 'number' as const },
              composition: { type: 'string' as const },
              lighting: { type: 'string' as const },
              colorPalette: { type: 'string' as const },
              movement: { type: 'string' as const },
              continuityRole: { type: 'string' as const },
            },
          },
        },
        required: ['description', 'narrative'],
      },
    },
    choices: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' as const },
          impact: {
            type: 'object' as const,
            properties: {
              adventure: { type: 'number' as const },
              danger: { type: 'number' as const },
              romance: { type: 'number' as const },
              drama: { type: 'number' as const },
            },
            required: ['adventure', 'danger', 'romance', 'drama'],
          },
        },
        required: ['text', 'impact'],
      },
    },
    newNpcs: {
      type: 'array' as const,
      description: "A list of any new NPCs introduced in this chapter. Do not include existing characters.",
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          description: { type: 'string' as const },
        },
        required: ['name', 'description'],
      },
    },
  },
  required: ['panels', 'choices', 'newNpcs'],
};

async function generateStoryChapter(
  ai: GoogleGenAI,
  theme: string,
  mood: any,
  previousPanels: any[],
  characterDescription: string,
  lastChoiceText?: string
) {
  const previousContext = previousPanels.length > 0
    ? `The story so far: ${previousPanels.slice(-5).map(p => p.narrative).join(' ')}`
    : 'This is the beginning of the story.';

  const choiceContext = lastChoiceText
    ? `The user just chose: "${lastChoiceText}". Continue directly from this decision.`
    : 'No previous choice was made.';

  const prompt = `
    You are a master comic book writer and director.
    Theme: ${theme}. Style: Modern American comic book.
    Current mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}.
    Character Description: ${characterDescription}

    ${previousContext}
    ${choiceContext}

    Generate exactly 5 panels for this chapter in JSON format with fields: panels, choices, newNpcs.
    1. The story should flow naturally from the previous context.
    2. For each panel, provide a detailed visual 'description' for an AI image generator, a short 'narrative' text, and optional 'specs'.
    3. The story should reflect the current mood.
    4. After the 5 panels, create exactly 4 'choices' for the user.
    5. Each choice must be biased toward ONE mood vector among [adventure, danger, romance, drama].
    6. If you introduce any new named characters, list them in the 'newNpcs' array.
    7. Respond ONLY with the JSON object described in the schema.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: storyGenerationSchema,
    },
  });
  return JSON.parse(response.text.trim());
}

async function generatePanelImage(
  ai: GoogleGenAI,
  theme: string,
  panelDescription: string,
  characterDescription: string,
  characterReferenceImage?: string,
  npcs: any[] = []
) {
  let npcDetails = '';
  const parts: any[] = [];

  if (characterReferenceImage) {
    parts.push({ inlineData: { data: characterReferenceImage, mimeType: 'image/jpeg' } });
  }

  for (const npc of npcs) {
    if (panelDescription.includes(npc.name)) {
      npcDetails += `\nNPC Name: ${npc.name}. NPC Description: ${npc.description}.`;
      parts.push({ inlineData: { data: npc.referenceImage, mimeType: 'image/jpeg' } });
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

  const runRequest = async () => {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    return res;
  };

  const response = await retryWithBackoff(runRequest);

  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const cparts = candidate?.content?.parts ?? [];
    for (const part of cparts) {
      if (part?.inlineData?.data) {
        return part.inlineData.data;
      }
    }
  }
  throw new Error('Image generation failed: no image returned');
}

async function generateChapterImagesBatch(
  ai: GoogleGenAI,
  theme: string,
  panelDescriptions: string[],
  panelSpecs: any[],
  characterDescription: string,
  characterReferenceImage?: string,
  npcs: any[] = []
) {
  const parts: any[] = [];

  if (characterReferenceImage) {
    parts.push({ inlineData: { data: characterReferenceImage, mimeType: 'image/jpeg' } });
  }

  const allText = panelDescriptions.join(' ').toLowerCase();
  for (const npc of npcs) {
    if (allText.includes(npc.name.toLowerCase())) {
      parts.push({ inlineData: { data: npc.referenceImage, mimeType: 'image/jpeg' } });
    }
  }

  const specText = panelDescriptions
    .map((desc, i) => {
      const s = panelSpecs?.[i] || {};
      const lines = [`Panel ${i + 1}:`, `  Description: ${desc}`];
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
    Maintain strict continuity across panels.
    Main Character Details: ${characterDescription}.
    ${specText}
    Output constraints: Return exactly ${panelCount} IMAGE parts and nothing else.
  `;
  parts.push({ text: prompt });

  const runRequest = async () => {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    return res;
  };

  const response = await retryWithBackoff(runRequest);

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

  if (images.length < panelCount) {
    throw new Error(`Batch image generation failed: expected ${panelCount} images, got ${images.length}`);
  }
  return images.slice(0, panelCount);
}

async function generateEndingChapter(
  ai: GoogleGenAI,
  theme: string,
  mood: any,
  previousPanels: any[],
  characterDescription: string,
  dominantMood: string
) {
  const endingTones: Record<string, string> = {
    adventure: 'triumphant discovery, new horizons, satisfying resolution',
    danger: 'narrow escape, bittersweet survival, lingering tension resolved',
    romance: 'heartfelt connection, emotional fulfillment, tender closure',
    drama: 'poignant resolution, character growth, bittersweet but satisfying close',
  };

  const prompt = `
    You are a master comic book writer crafting the final chapter.
    Theme: ${theme}. Style: Modern American comic book.
    Character Description: ${characterDescription}
    The story has been building toward a ${dominantMood}-focused ending: ${endingTones[dominantMood] || 'satisfying conclusion'}.

    Previous story: ${previousPanels.slice(-6).map(p => p.narrative).join(' ')}

    Generate exactly 4 panels that bring this story to a satisfying conclusion.
    Return JSON with a "panels" array, each panel having "description" and "narrative" fields.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          panels: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                description: { type: 'string' as const },
                narrative: { type: 'string' as const },
              },
              required: ['description', 'narrative'],
            },
          },
        },
        required: ['panels'],
      },
    },
  });
  return JSON.parse(response.text.trim());
}

async function generateAudioBriefs(
  ai: GoogleGenAI,
  theme: string,
  mood: any,
  panels: any[]
) {
  const prompt = `You are an audio director for a comic experience. Create precise, production-ready prompts for generative audio services.

Theme: ${theme}
Mood levels: adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}

Panels:
${panels.map((p, i) => `${i + 1}. ${p.narrative}`).join('\n')}

Return JSON with:
- musicPrompt: A prompt for background music generation (10s loopable)
- ambiencePrompt: A prompt for ambient sound bed
- perPanel: Array with sfxPrompt and optional stingerPrompt for each panel
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          musicPrompt: { type: 'string' as const },
          ambiencePrompt: { type: 'string' as const },
          perPanel: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                sfxPrompt: { type: 'string' as const },
                stingerPrompt: { type: 'string' as const },
              },
              required: ['sfxPrompt'],
            },
          },
        },
        required: ['musicPrompt', 'perPanel'],
      },
    },
  });
  return JSON.parse(response.text.trim());
}

async function generateChoicesFallback(
  ai: GoogleGenAI,
  theme: string,
  mood: any,
  allPanels: any[],
  lastChoiceText?: string
) {
  const recentNarratives = allPanels.slice(-6).map(p => p.narrative).join(' ');
  const prompt = `
You are a comic story director. Based on the story so far, generate exactly 4 choices for the reader.
Theme: ${theme}
Mood: adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}
Recent story: ${recentNarratives}
${lastChoiceText ? `Last choice made: "${lastChoiceText}"` : ''}

Return JSON with a "choices" array. Each choice has "text" and "impact" (adventure, danger, romance, drama numbers 0.00-0.20).
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          choices: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                text: { type: 'string' as const },
                impact: {
                  type: 'object' as const,
                  properties: {
                    adventure: { type: 'number' as const },
                    danger: { type: 'number' as const },
                    romance: { type: 'number' as const },
                    drama: { type: 'number' as const },
                  },
                  required: ['adventure', 'danger', 'romance', 'drama'],
                },
              },
              required: ['text', 'impact'],
            },
          },
        },
        required: ['choices'],
      },
    },
  });
  const parsed = JSON.parse(response.text.trim());
  return parsed.choices || [];
}

async function generateDirectorPageAndJSON(
  ai: GoogleGenAI,
  theme: string,
  mood: any,
  previousPanels: any[],
  lastChoiceText?: string,
  currentCharacterDescription?: string,
  styleReferenceImage?: string
) {
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
2) Then output a JSON object describing the panels, choices, and any newly introduced NPCs.

Theme: ${theme}. Style: Modern American comic.
${styleReferenceImage ? 'CRITICAL: Match the exact art style, line weights, coloring technique, and character designs from the provided STYLE REFERENCE IMAGE. This ensures visual continuity across chapters.' : ''}
Rules (critical): No speech balloons, captions, SFX text, page numbers, or UI. Each panel frames a 4:3 scene INSIDE its cell (full-bleed within the cell). Maintain consistent character design, outfit, environment, lighting, and palette.

Story context: ${previousContext}
Decision to follow: ${choiceContext}
Mood levels (0-1): adventure ${mood.adventure.toFixed(2)}, danger ${mood.danger.toFixed(2)}, romance ${mood.romance.toFixed(2)}, drama ${mood.drama.toFixed(2)}.

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
JSON rules (critical): Exactly 6 panels. Exactly 4 choices; each biased to a different mood vector. At most 2 newNpcs. No extra keys.
`;

  const parts: any[] = [];
  if (styleReferenceImage) {
    parts.push({ inlineData: { data: styleReferenceImage, mimeType: 'image/jpeg' } });
  }
  parts.push({ text: prompt });

  const runRequest = async () => {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    return res;
  };

  const response = await retryWithBackoff(runRequest);

  let pageImage: string | undefined;
  let textPayload = '';

  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
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

  if (!pageImage) {
    throw new Error('Director call did not return a page image');
  }

  let parsed: any;
  try {
    const start = textPayload.indexOf('{');
    const end = textPayload.lastIndexOf('}');
    const jsonSlice = start >= 0 && end > start ? textPayload.slice(start, end + 1) : textPayload;
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    throw new Error('Director call JSON parse failed');
  }

  return {
    pageImage,
    characterDescription: parsed.characterDescription,
    panels: parsed.panels || [],
    choices: parsed.choices || [],
    newNpcs: parsed.newNpcs || [],
  };
}

async function generatePanelImageFromPageRef(
  ai: GoogleGenAI,
  theme: string,
  panelDescription: string,
  specs: any,
  pageReferenceImage: string,
  characterReferenceImage?: string,
  characterDescription?: string,
  npcs: any[] = []
) {
  const parts: any[] = [];
  parts.push({ inlineData: { data: pageReferenceImage, mimeType: 'image/jpeg' } });
  if (characterReferenceImage) {
    parts.push({ inlineData: { data: characterReferenceImage, mimeType: 'image/jpeg' } });
  }
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

  const runRequest = async () => {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    return res;
  };

  const response = await retryWithBackoff(runRequest);

  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const cparts = candidate?.content?.parts ?? [];
    for (const part of cparts) {
      if (part?.inlineData?.data) {
        return part.inlineData.data;
      }
    }
  }
  throw new Error('Panel-from-page generation failed: no image returned');
}

async function analyzeCharacterPhoto(
  ai: GoogleGenAI,
  photo: string
): Promise<{ characterDescription: string }> {
  const prompt = `
You are analyzing a photo to create a detailed character description for a comic book story.
Examine the person in this image and write a vivid, specific description (80-140 words) suitable for image generation prompts.

Include:
- Apparent age range and gender presentation
- Hair color, style, and length
- Eye color and distinctive facial features
- Skin tone
- Any visible clothing style or accessories
- Overall vibe/aesthetic (e.g., adventurous, scholarly, mysterious)

Write in third person, present tense. Focus on visual details that would help an AI image generator recreate this person consistently across multiple comic panels.
Do NOT include any personal identifying information - describe them as a fictional character.

Return JSON with a single field "characterDescription" containing the description.
`;

  const parts: any[] = [
    { inlineData: { data: photo, mimeType: 'image/jpeg' } },
    { text: prompt }
  ];

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: { parts },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          characterDescription: { type: 'string' as const },
        },
        required: ['characterDescription'],
      },
    },
  });

  return JSON.parse(response.text.trim());
}
