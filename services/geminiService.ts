import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { Theme, MoodVector, Panel, NPC } from '../types';

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


export const generateCharacterDescription = async (apiKey: string, theme: Theme): Promise<string> => {
    if (!apiKey) throw new Error("Gemini API key is required.");
    const ai = new GoogleGenAI({ apiKey });
    // Randomized attribute palettes to diversify characters across runs while staying coherent
    const choose = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

    const genders = ['female', 'male', 'non-binary'];
    const ageRanges = ['teen', 'young adult', 'adult', 'middle-aged'];
    const bodyTypes = ['slim', 'athletic', 'average', 'curvy', 'stocky'];
    const ethnicities = ['East Asian', 'South Asian', 'Black', 'White', 'Latinx', 'Middle Eastern', 'Southeast Asian', 'Mixed'];
    const eyeColors = ['brown', 'hazel', 'green', 'blue', 'gray', 'amber'];
    const hairColors = ['black', 'dark brown', 'brown', 'blonde', 'platinum blonde', 'auburn', 'red', 'silver'];
    const hairStyles = ['short and messy', 'shoulder-length wavy', 'long and straight', 'curly bob', 'pixie cut', 'braided', 'undercut', 'pony tail'];

    const outfitsByTheme: Record<Theme, string[]> = {
      fantasy: [
        'leather adventurer gear with subtle embroidery',
        'mage robes with geometric trims',
        'light chainmail over tunic, travel cloak',
        'ranger attire with layered fabrics and utility belts',
      ],
      scifi: [
        'sleek synth-fiber suit with holo accents',
        'utilitarian starship jumpsuit with modular panels',
        'techwear layers with reactive trim',
        'armored pilot suit with minimal plating',
      ],
      school: [
        'casual school uniform with personalized touches',
        'streetwear layered over uniform basics',
        'sporty jacket, graphic tee, and sneakers',
        'artsy cardigan, skirt/pants, and loafers',
      ],
    };

    const accessoriesByTheme: Record<Theme, string[]> = {
      fantasy: [
        'ornate pendant with a faint glow',
        'engraved bracer with runes',
        'leather satchel with charms',
        'ring shaped like a tiny serpent',
      ],
      scifi: [
        'wrist-mounted holo communicator',
        'augmented reality visor',
        'compact utility drone perched nearby',
        'neon-lined data glove',
      ],
      school: [
        'distinctive enamel pin collection',
        'headphones resting around the neck',
        'polaroid camera strap',
        'bracelet with handmade beads',
      ],
    };

    const gender = choose(genders);
    const ageRange = choose(ageRanges);
    const bodyType = choose(bodyTypes);
    const ethnicity = choose(ethnicities);
    const eyeColor = choose(eyeColors);
    const hairColor = choose(hairColors);
    const hairStyle = choose(hairStyles);
    const outfit = choose(outfitsByTheme[theme]);
    const accessory = choose(accessoriesByTheme[theme]);

    const attributeBlock = `Randomized identity anchors (use all, keep consistent across panels):\n- Gender: ${gender}\n- Age: ${ageRange}\n- Body type: ${bodyType}\n- Ethnicity: ${ethnicity}\n- Eyes: ${eyeColor}\n- Hair: ${hairColor}, ${hairStyle}\n- Outfit: ${outfit}\n- Unique accessory: ${accessory}`;

    const prompt = `Create a detailed visual description of a main character for a comic book with a ${theme} theme. The description should be suitable for a text-to-image AI generator to create a consistent character. Focus on key features like hair, eyes, clothing, and one unique accessory.\n\n${attributeBlock}\n\nWrite a concise, vivid description (120-200 words). Avoid generic tropes; be specific.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text;
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
    2. For each panel, provide a detailed visual 'description' for an AI image generator and a short 'narrative' text.
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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: storyGenerationSchema,
    },
  });

  const jsonText = response.text.trim();
  return JSON.parse(jsonText);
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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image-preview',
    contents: {
      parts: parts,
    },
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }

  const textResponse = response.text;
  const errorMessage = `Image generation failed. The model returned a text response instead of an image: "${textResponse}"`;
  console.error(errorMessage);
  throw new Error(errorMessage);
};
