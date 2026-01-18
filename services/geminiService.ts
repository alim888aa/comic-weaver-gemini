import type { Theme, MoodVector, Panel, NPC } from '../types';

const API_BASE = '/api/gemini';

const callGeminiAPI = async (action: string, params: Record<string, any>): Promise<any> => {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }

  return response.json();
};

export const generateStoryChapter = async (
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  characterDescription: string,
  lastChoiceText?: string
): Promise<{ panels: { description: string; narrative: string; specs?: any }[]; choices: { text: string; impact: MoodVector }[]; newNpcs: { name: string; description: string }[] }> => {
  console.log('[Gemini] generateStoryChapter request');
  const result = await callGeminiAPI('generateStoryChapter', {
    theme,
    mood,
    previousPanels: previousPanels.map(p => ({ narrative: p.narrative })),
    characterDescription,
    lastChoiceText,
  });
    console.log('[Gemini] generateStoryChapter response received');
  return result;
};

export const generatePanelImage = async (
  theme: Theme,
  panelDescription: string,
  characterDescription: string,
  characterReferenceImage?: string,
  npcs: NPC[] = []
): Promise<string> => {
  console.log('[Gemini] generatePanelImage request');
  const result = await callGeminiAPI('generatePanelImage', {
    theme,
    panelDescription,
    characterDescription,
    characterReferenceImage,
    npcs,
      });
      console.log('[Gemini] generatePanelImage response received');
  return result.image;
};

export const generateChapterImagesBatch = async (
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
  console.log('[Gemini] generateChapterImagesBatch request', { panelCount: panelDescriptions.length });
  const result = await callGeminiAPI('generateChapterImagesBatch', {
    theme,
    panelDescriptions,
    panelSpecs,
    characterDescription,
    characterReferenceImage,
    npcs,
      });
      console.log('[Gemini] generateChapterImagesBatch response received');
  return result.images;
};

export const generateEndingChapter = async (
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  characterDescription: string,
  dominantMood: string
): Promise<{ panels: { description: string; narrative: string }[] }> => {
  console.log('[Gemini] generateEndingChapter request');
  const result = await callGeminiAPI('generateEndingChapter', {
    theme,
    mood,
    previousPanels: previousPanels.map(p => ({ narrative: p.narrative })),
    characterDescription,
    dominantMood,
  });
  console.log('[Gemini] generateEndingChapter response received');
  return result;
};

export const generateAudioBriefs = async (
  theme: Theme,
  mood: MoodVector,
  panels: Panel[]
): Promise<{ musicPrompt: string; ambiencePrompt?: string; perPanel: { sfxPrompt: string; stingerPrompt?: string }[] }> => {
  console.log('[Gemini] generateAudioBriefs request');
  const result = await callGeminiAPI('generateAudioBriefs', {
    theme,
    mood,
    panels: panels.map(p => ({ narrative: p.narrative })),
  });
    console.log('[Gemini] generateAudioBriefs response received');
  return result;
};

export const generateChoicesFallback = async (
  theme: Theme,
  mood: MoodVector,
  allPanels: Panel[],
  lastChoiceText?: string
): Promise<{ text: string; impact: MoodVector }[]> => {
  console.log('[Gemini] generateChoicesFallback request');
  const result = await callGeminiAPI('generateChoicesFallback', {
    theme,
    mood,
    allPanels: allPanels.map(p => ({ narrative: p.narrative })),
    lastChoiceText,
  });
    console.log('[Gemini] generateChoicesFallback response received');
  return result.choices;
};

export const generateDirectorPageAndJSON = async (
  theme: Theme,
  mood: MoodVector,
  previousPanels: Panel[],
  lastChoiceText?: string,
  currentCharacterDescription?: string,
  styleReferenceImage?: string
): Promise<{
  pageImage: string;
  characterDescription?: string;
  panels: { description: string; narrative: string; specs?: { shotType?: string; angle?: string; lens?: number; composition?: string; lighting?: string; colorPalette?: string; movement?: string; continuityRole?: string } }[];
  choices: { text: string; impact: MoodVector }[];
  newNpcs: { name: string; description: string }[];
}> => {
  console.log('[Gemini] generateDirectorPageAndJSON request');
  const result = await callGeminiAPI('generateDirectorPageAndJSON', {
    theme,
    mood,
    previousPanels: previousPanels.map(p => ({ narrative: p.narrative })),
    lastChoiceText,
    currentCharacterDescription,
    styleReferenceImage,
      });
      console.log('[Gemini] generateDirectorPageAndJSON response received', {
    panels: result.panels?.length || 0,
    choices: result.choices?.length || 0,
  });
  return result;
};

export const generatePanelImageFromPageRef = async (
  theme: Theme,
  panelDescription: string,
  specs: { shotType?: string; angle?: string; lens?: number; composition?: string; lighting?: string; colorPalette?: string; movement?: string } | undefined,
  pageReferenceImage: string,
  characterReferenceImage?: string,
  characterDescription?: string,
  npcs: NPC[] = []
): Promise<string> => {
  console.log('[Gemini] generatePanelImageFromPageRef request');
  const result = await callGeminiAPI('generatePanelImageFromPageRef', {
    theme,
    panelDescription,
    specs,
    pageReferenceImage,
    characterReferenceImage,
    characterDescription,
    npcs,
      });
      console.log('[Gemini] generatePanelImageFromPageRef response received');
  return result.image;
};
