import { createMachine, assign, fromPromise, setup } from 'xstate';
import {
  generateStoryChapter,
  generatePanelImage,
  generateCharacterDescription,
} from '../services/geminiService';
import {
  generateSoundEffect,
  generateBackgroundMusic
} from '../services/elevenlabsService';
import { loadState, clearState } from '../services/storageService';
import type { StoryContext, Theme, MoodVector, Panel, Choice, NPC } from '../types';

interface GenerationOutput {
  newPanels: Panel[];
  choices: Choice[];
  characterDescription: string;
  characterReference: string | undefined;
  backgroundMusic: string | undefined;
  newNpcs: NPC[];
}

const initialContext: StoryContext = {
  mood: { adventure: 0.25, danger: 0.25, romance: 0.25, drama: 0.25 },
  theme: null,
  choices: [],
  allPanels: [],
  currentPanelIndex: 0,
  characterReference: undefined,
  characterDescription: undefined,
  isGenerating: false,
  error: null,
  ending: null,
  backgroundMusic: undefined,
  isMuted: false,
  apiKey: undefined,
  elevenLabsApiKey: undefined,
  lastChoiceText: undefined,
  npcs: [],
};

// FIX: Refactored to use the setup API for more robust type inference, which resolves the downstream type error in App.tsx.
export const storyMachine = setup({
  types: {} as {
    context: StoryContext;
    events:
      | { type: 'START'; theme: Theme; apiKey: string; elevenLabsApiKey: string; }
      | { type: 'CONTINUE' }
      | { type: 'MAKE_CHOICE'; choice: Choice }
      | { type: 'VIEW_PREV' }
      | { type: 'VIEW_NEXT' }
      | { type: 'RESTART' }
      | { type: 'TOGGLE_MUTE' };
  },
  actors: {
    loadState: fromPromise(loadState),
    generateChapter: fromPromise(async ({ input }: { input: StoryContext }): Promise<GenerationOutput> => {
      const { apiKey, elevenLabsApiKey, theme, mood, allPanels, lastChoiceText, npcs } = input;
      if (!apiKey || !elevenLabsApiKey || !theme) {
        throw new Error("API keys and theme are required for generation.");
      }
      
      let charDesc = input.characterDescription;
      let charRefImg = input.characterReference;

      if (!charDesc) {
        charDesc = await generateCharacterDescription(apiKey, theme);
        charRefImg = await generatePanelImage(apiKey, theme, `A portrait of the main character.`, charDesc);
      }

      const storyData = await generateStoryChapter(apiKey, theme, mood, allPanels, charDesc, lastChoiceText);

      // Generate portraits for new NPCs
      const createdNpcs: NPC[] = [];
      if (storyData.newNpcs) {
          for (const npc of storyData.newNpcs) {
              const npcPortrait = await generatePanelImage(apiKey, theme, `A portrait of ${npc.name}, ${npc.description}`, "");
              createdNpcs.push({ name: npc.name, description: npc.description, referenceImage: npcPortrait });
          }
      }
      const allKnownNpcs = [...npcs, ...createdNpcs];

      // Generate panel images with all character references
      const panelsWithImages: Array<Panel & { description: string }> = [];
      for (const panel of storyData.panels) {
        const image = await generatePanelImage(apiKey, theme, panel.description, charDesc, charRefImg, allKnownNpcs);
        panelsWithImages.push({ image, narrative: panel.narrative, description: panel.description });
      }
      
      const musicPrompt = `An atmospheric, looping background track for a comic with a ${theme} theme. The mood levels are Adventure: ${mood.adventure.toFixed(2)}, Danger: ${mood.danger.toFixed(2)}, Romance: ${mood.romance.toFixed(2)}, Drama: ${mood.drama.toFixed(2)}.`;
      const backgroundMusic = await generateBackgroundMusic(elevenLabsApiKey, musicPrompt);

      const panelsWithAudio: Panel[] = [];
      for (const panel of panelsWithImages) {
          const sfxPrompt = `Comic book sound effect for: ${panel.description.substring(0, 400)}`;
          const soundEffectAudio = await generateSoundEffect(elevenLabsApiKey, sfxPrompt);
          panelsWithAudio.push({ image: panel.image, narrative: panel.narrative, soundEffectAudio });
      }
      
      return { newPanels: panelsWithAudio, choices: storyData.choices, characterDescription: charDesc, characterReference: charRefImg, backgroundMusic, newNpcs: createdNpcs };
    }),
  }
}).createMachine({
  id: 'story',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        START: {
          target: 'generating',
          actions: assign({
            theme: ({ event }) => event.theme,
            apiKey: ({ event }) => event.apiKey,
            elevenLabsApiKey: ({ event }) => event.elevenLabsApiKey,
            isGenerating: true,
          }),
        },
        CONTINUE: {
          target: 'loadingSavedStory',
        },
      },
    },
    loadingSavedStory: {
      invoke: {
        id: 'loadStoryFromDB',
        src: 'loadState',
        onDone: {
          target: 'playing',
          actions: assign(({ event }) => {
            const savedState = event.output as { value: unknown; context: StoryContext } | null;
            if (savedState && savedState.context) {
              savedState.context.allPanels.forEach((panel: Panel) => {
                if (panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
                if (panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
              });
              
              const loadedContext: StoryContext = savedState.context;
              loadedContext.allPanels = loadedContext.allPanels.map((p: Panel) => ({...p, narrativeAudio: undefined, soundEffectAudio: undefined}));
              loadedContext.npcs = loadedContext.npcs || []; // Backwards compatibility for old saves
              // Ensure mood has drama for older saves
              loadedContext.mood = {
                adventure: loadedContext.mood.adventure ?? 0.25,
                danger: loadedContext.mood.danger ?? 0.25,
                romance: loadedContext.mood.romance ?? 0.25,
                drama: (loadedContext.mood as any).drama ?? 0.25,
              };

              return loadedContext;
            }
            return initialContext;
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            error: 'Failed to load saved story. Please start a new game.',
          }),
        },
      },
    },
    generating: {
      invoke: {
        id: 'generateChapter',
        input: ({ context }) => context,
        src: 'generateChapter',
        onDone: {
          target: 'playing',
          actions: assign({
            isGenerating: false,
            allPanels: ({ context, event }) => [...context.allPanels, ...event.output.newPanels],
            choices: ({ event }) => event.output.choices,
            characterDescription: ({ context, event }) => context.characterDescription || event.output.characterDescription,
            characterReference: ({ context, event }) => context.characterReference || event.output.characterReference,
            backgroundMusic: ({ event }) => event.output.backgroundMusic,
            npcs: ({ context, event }) => [...context.npcs, ...event.output.newNpcs],
            currentPanelIndex: ({ context }) => context.allPanels.length, 
          }),
        },
        onError: {
          target: 'playing',
          actions: assign({
            isGenerating: false,
            error: ({ event }) => event.error instanceof Error ? event.error.message : 'An unknown error occurred during generation.',
          }),
        },
      },
      on: {
        VIEW_PREV: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.max(0, context.currentPanelIndex - 1),
          }),
        },
        VIEW_NEXT: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.min(context.allPanels.length - 1, context.currentPanelIndex + 1),
          }),
        },
        TOGGLE_MUTE: {
            actions: assign({ isMuted: ({ context }) => !context.isMuted })
        }
      },
    },
    playing: {
      on: {
        MAKE_CHOICE: [
          {
            target: 'storyEnded',
            guard: ({ context, event }) => {
              const impact = event.choice.impact;
              return (
                context.mood.adventure + impact.adventure >= 1.0 ||
                context.mood.danger + impact.danger >= 1.0 ||
                context.mood.romance + impact.romance >= 1.0 ||
                context.mood.drama + impact.drama >= 1.0
              );
            },
            actions: assign({
              mood: ({ context, event }) => {
                const newMood: MoodVector = {
                  adventure: Math.min(1.0, context.mood.adventure + event.choice.impact.adventure),
                  danger: Math.min(1.0, context.mood.danger + event.choice.impact.danger),
                  romance: Math.min(1.0, context.mood.romance + event.choice.impact.romance),
                  drama: Math.min(1.0, context.mood.drama + event.choice.impact.drama),
                };
                return newMood;
              },
              ending: ({ context, event }) => {
                 const newMood: MoodVector = {
                  adventure: Math.min(1.0, context.mood.adventure + event.choice.impact.adventure),
                  danger: Math.min(1.0, context.mood.danger + event.choice.impact.danger),
                  romance: Math.min(1.0, context.mood.romance + event.choice.impact.romance),
                  drama: Math.min(1.0, context.mood.drama + event.choice.impact.drama),
                };
                const maxMood = (Object.keys(newMood) as Array<keyof MoodVector>).reduce((a, b) => newMood[a] > newMood[b] ? a : b);
                return maxMood;
              },
              lastChoiceText: ({ event }) => event.choice.text,
            }),
          },
          {
            target: 'generating',
            actions: assign({
              isGenerating: true,
              mood: ({ context, event }) => ({
                adventure: Math.min(1.0, context.mood.adventure + event.choice.impact.adventure),
                danger: Math.min(1.0, context.mood.danger + event.choice.impact.danger),
                romance: Math.min(1.0, context.mood.romance + event.choice.impact.romance),
                drama: Math.min(1.0, context.mood.drama + event.choice.impact.drama),
              }),
              choices: [],
              lastChoiceText: ({ event }) => event.choice.text,
            }),
          },
        ],
        VIEW_PREV: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.max(0, context.currentPanelIndex - 1),
          }),
        },
        VIEW_NEXT: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.min(context.allPanels.length - 1, context.currentPanelIndex + 1),
          }),
        },
        TOGGLE_MUTE: {
            actions: assign({ isMuted: ({ context }) => !context.isMuted })
        }
      },
    },
    storyEnded: {
      on: {
        RESTART: {
          target: 'idle',
          actions: assign(({ context }, __) => {
              clearState();
              context.allPanels.forEach(panel => {
                  if(panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
                  if(panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
              });
              if(context.backgroundMusic) URL.revokeObjectURL(context.backgroundMusic);
              return initialContext;
          }),
        },
      },
    },
  },
});
