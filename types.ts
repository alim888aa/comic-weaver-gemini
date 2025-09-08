export type Theme = 'fantasy' | 'scifi' | 'school';

export interface MoodVector {
  adventure: number;
  danger: number;
  romance: number;
  drama: number;
}

export interface Panel {
  image: string; // base64 string
  narrative: string;
  narrativeAudio?: string; // object URL for voice-over
  soundEffectAudio?: string; // object URL for SFX
  stingerAudio?: string; // object URL for short transition hit
}

export interface Choice {
  text: string;
  impact: MoodVector;
}

export interface NPC {
  name: string;
  description: string;
  referenceImage: string; // base64 string
}

export interface StoryContext {
  mood: MoodVector;
  theme: Theme | null;
  choices: Choice[];
  allPanels: Panel[];
  currentPanelIndex: number;
  // FIX: Changed optional properties to be explicitly T | undefined for better type inference with XState.
  characterReference: string | undefined; // base64 image
  characterDescription: string | undefined;
  isGenerating: boolean;
  error: string | null;
  ending: keyof MoodVector | null;
  backgroundMusic: string | undefined; // object URL for chapter music
  isMuted: boolean;
  apiKey: string | undefined;
  elevenLabsApiKey: string | undefined;
  lastChoiceText: string | undefined; // The text of the last choice made by the user
  npcs: NPC[]; // A roster of all NPCs encountered in the story
}
