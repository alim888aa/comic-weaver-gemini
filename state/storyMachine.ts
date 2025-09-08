import { createMachine, assign, fromPromise, setup } from 'xstate';
import {
  generateStoryChapter,
  generatePanelImage,
  generateAudioBriefs,
  generateChapterImagesBatch,
  generateEndingChapter,
  generateDirectorPageAndJSON,
  generatePanelImageFromPageRef,
  generateChoicesFallback,
} from '../services/geminiService';
import {
  generateSoundEffect,
  generateBackgroundMusic,
  generateAmbienceBed,
  generateStinger,
} from '../services/elevenlabsService';
import { loadState, clearState, loadCompletedState, saveCompletedState } from '../services/storageService';
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

/*
  Story state machine
  - States: idle, loadingSavedStory, generating, playing, storyEnded
  - Events: START, CONTINUE, MAKE_CHOICE, VIEW_PREV, VIEW_NEXT, RESTART, TOGGLE_MUTE
  - Actors:
    • loadState: restores a previously saved story context
    • generateChapter: creates the next chapter (images, SFX, music) based on theme, mood, and last choice
  Responsibilities
  - Orchestrates content generation and navigation between panels
  - Maintains mood vector, choices, and media URLs; cleans object URLs on teardown
*/
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
      | { type: 'TOGGLE_MUTE' }
      | { type: 'EXIT_TO_MENU' }
      | { type: 'VIEW_PREVIOUS' };
  },
  actors: {
    loadState: fromPromise(loadState),
    loadCompleted: fromPromise(loadCompletedState),
    generateChapter: fromPromise(async ({ input }: { input: StoryContext }): Promise<GenerationOutput> => {
      const { apiKey, elevenLabsApiKey, theme, mood, allPanels, lastChoiceText, npcs } = input;
      if (!apiKey || !elevenLabsApiKey || !theme) {
        throw new Error("API keys and theme are required for generation.");
      }
      
      let charDesc = input.characterDescription; // Canonical description; optional at start
      let charRefImg = input.characterReference; // Optional portrait; can be undefined

      // Primary path: Director + Image (6-panel reference page + JSON)
      let directorPanels: { description: string; narrative: string; specs?: any }[] | null = null;
      let directorChoices: any[] = [];
      let directorNewNpcs: { name: string; description: string }[] = [];
      let referencePage: string | undefined;
      try {
        console.log('[Director] Starting director+page flow');
        const director = await generateDirectorPageAndJSON(apiKey, theme, mood, allPanels, lastChoiceText, charDesc);
        referencePage = director.pageImage;
        if (!charDesc && director.characterDescription) {
          charDesc = director.characterDescription;
        }
        directorPanels = director.panels;
        directorChoices = director.choices || [];
        directorNewNpcs = director.newNpcs || [];
        console.log('[Director] Received page and JSON', { panelCount: directorPanels?.length, choiceCount: directorChoices.length });
      } catch (err) {
        console.warn('[Director] Director flow failed, will fallback to text orchestrator', err);
      }

      // If director failed, fallback to text orchestrator
      let storyData: any = null;
      if (!directorPanels || !referencePage) {
        storyData = await generateStoryChapter(apiKey, theme, mood, allPanels, charDesc || '', lastChoiceText);
        directorPanels = storyData.panels;
        directorChoices = storyData.choices;
        directorNewNpcs = storyData.newNpcs || [];
        console.log('[Fallback] Using text orchestrator panels', { count: directorPanels.length });
      }

      // Build or reuse NPC portraits (cache by identical name+description)
      const createdOrReusedNpcs: NPC[] = directorNewNpcs.length
        ? await Promise.all(
            directorNewNpcs.map(async (npc) => {
              const existing = npcs.find((n) => n.name === npc.name && n.description === npc.description);
              if (existing) return existing;
              const npcPortrait = await generatePanelImage(apiKey, theme, `A portrait of ${npc.name}, ${npc.description}`, "");
              return { name: npc.name, description: npc.description, referenceImage: npcPortrait } as NPC;
            })
          )
        : [];

      const allKnownNpcs = [...npcs, ...createdOrReusedNpcs];

      // Ask Gemini for audio briefs to craft precise prompts and reduce wasted calls
      const pseudoForAudio: Panel[] = (directorPanels || []).map((p: any) => ({ image: '', narrative: p.narrative })) as unknown as Panel[];
      const audioBriefs = await generateAudioBriefs(apiKey, theme, mood, pseudoForAudio);

      // Start background music generation with fallback to ambience bed
      const backgroundMusicPromise = (async () => {
        const track = await generateBackgroundMusic(elevenLabsApiKey, audioBriefs.musicPrompt);
        if (track && track.length > 0) return track;
        // Fallback ambience bed
        return await generateAmbienceBed(elevenLabsApiKey, audioBriefs.ambiencePrompt || audioBriefs.musicPrompt);
      })();

      // Cost caps: at most 4 SFX and 2 stingers per chapter
      let sfxCount = 0;
      let stingerCount = 0;
      const maxSfx = 4;
      const maxStingers = 2;

      // Image generation path
      let panelsWithAudio: Panel[] = [];
      if (referencePage && directorPanels) {
        console.log('[Director] Rendering panels from reference page');
        panelsWithAudio = await Promise.all(
          directorPanels.map(async (panel: any, index: number) => {
            const briefs = audioBriefs.perPanel[index] ?? { sfxPrompt: `Sound effect for: ${panel.description.substring(0, 200)}` };
            const shouldGenSfx = sfxCount < maxSfx;
            const shouldGenStinger = briefs.stingerPrompt && stingerCount < maxStingers;

            const imagePromise = generatePanelImageFromPageRef(apiKey, theme, panel.description, panel.specs || {}, referencePage!, charRefImg, charDesc, allKnownNpcs)
              .then((img) => { console.log('[Director] Panel-from-page success', { index }); return img; })
              .catch(async (err) => {
                console.warn('[Director] Panel-from-page failed; fallback to per-panel without page', { index, err });
                return await generatePanelImage(apiKey, theme, panel.description, charDesc || '', charRefImg, allKnownNpcs);
              });
            const sfxPromise = shouldGenSfx ? generateSoundEffect(elevenLabsApiKey, briefs.sfxPrompt) : Promise.resolve("");
            const stingerPromise = shouldGenStinger ? generateStinger(elevenLabsApiKey, briefs.stingerPrompt as string) : Promise.resolve("");

            const [image, soundEffectAudio, stingerAudio] = await Promise.all([imagePromise, sfxPromise, stingerPromise]);
            if (shouldGenSfx && soundEffectAudio) sfxCount += 1;
            if (shouldGenStinger && stingerAudio) stingerCount += 1;
            return { image, narrative: panel.narrative, soundEffectAudio: soundEffectAudio || undefined, stingerAudio: stingerAudio || undefined } as Panel;
          })
        );
      } else {
        console.log('[Fallback] Rendering panels via batch (if available) else per-panel');
        const panelDescriptions: string[] = directorPanels!.map((p: any) => p.description as string);
        const panelSpecs: Array<any> = directorPanels!.map((p: any) => p.specs || {});
        try {
          const batchImages: string[] = await generateChapterImagesBatch(apiKey, theme, panelDescriptions, panelSpecs, charDesc || '', charRefImg, allKnownNpcs);
          panelsWithAudio = await Promise.all(
            directorPanels!.map(async (panel: any, index: number) => {
              const briefs = audioBriefs.perPanel[index] ?? { sfxPrompt: `Sound effect for: ${panel.description.substring(0, 200)}` };
              const shouldGenSfx = sfxCount < maxSfx;
              const shouldGenStinger = briefs.stingerPrompt && stingerCount < maxStingers;

              const sfxPromise = shouldGenSfx ? generateSoundEffect(elevenLabsApiKey, briefs.sfxPrompt) : Promise.resolve("");
              const stingerPromise = shouldGenStinger ? generateStinger(elevenLabsApiKey, briefs.stingerPrompt as string) : Promise.resolve("");
              const [soundEffectAudio, stingerAudio] = await Promise.all([sfxPromise, stingerPromise]);
              if (shouldGenSfx && soundEffectAudio) sfxCount += 1;
              if (shouldGenStinger && stingerAudio) stingerCount += 1;
              return { image: batchImages[index], narrative: panel.narrative, soundEffectAudio: soundEffectAudio || undefined, stingerAudio: stingerAudio || undefined } as Panel;
            })
          );
        } catch (err) {
          console.warn('[Fallback] Batch failed; generating per-panel sequentially', err);
          panelsWithAudio = await Promise.all(
            directorPanels!.map(async (panel: any, index: number) => {
              const briefs = audioBriefs.perPanel[index] ?? { sfxPrompt: `Sound effect for: ${panel.description.substring(0, 200)}` };
              const shouldGenSfx = sfxCount < maxSfx;
              const shouldGenStinger = briefs.stingerPrompt && stingerCount < maxStingers;

              const imagePromise = generatePanelImage(apiKey, theme, panel.description, charDesc || '', charRefImg, allKnownNpcs);
              const sfxPromise = shouldGenSfx ? generateSoundEffect(elevenLabsApiKey, briefs.sfxPrompt) : Promise.resolve("");
              const stingerPromise = shouldGenStinger ? generateStinger(elevenLabsApiKey, briefs.stingerPrompt as string) : Promise.resolve("");
              const [image, soundEffectAudio, stingerAudio] = await Promise.all([imagePromise, sfxPromise, stingerPromise]);
              if (shouldGenSfx && soundEffectAudio) sfxCount += 1;
              if (shouldGenStinger && stingerAudio) stingerCount += 1;
              return { image, narrative: panel.narrative, soundEffectAudio: soundEffectAudio || undefined, stingerAudio: stingerAudio || undefined } as Panel;
            })
          );
        }
      }

      const backgroundMusic = await backgroundMusicPromise;

      // Validate choices; fallback if missing/invalid
      let finalChoices = directorChoices;
      const validChoice = (c: any) => c && typeof c.text === 'string' && c.impact && typeof c.impact.adventure === 'number';
      if (!Array.isArray(finalChoices) || finalChoices.length !== 4 || !finalChoices.every(validChoice)) {
        console.warn('[Choices] Director choices invalid/missing; invoking fallback model');
        try {
          finalChoices = await generateChoicesFallback(apiKey, theme, mood, allPanels.concat(panelsWithAudio), lastChoiceText);
          console.log('[Choices] Fallback choices generated', { count: finalChoices?.length, first: finalChoices?.[0]?.text });
        } catch (err) {
          console.error('[Choices] Fallback generation failed', err);
          finalChoices = [] as any[];
        }
      } else {
        console.log('[Choices] Director choices accepted', { count: finalChoices.length, first: finalChoices[0].text });
      }

      return {
        newPanels: panelsWithAudio,
        choices: finalChoices,
        characterDescription: charDesc!,
        characterReference: charRefImg,
        backgroundMusic,
        newNpcs: createdOrReusedNpcs,
      };
    }),
    generateEnding: fromPromise(async ({ input }: { input: StoryContext }): Promise<{ newPanels: Panel[] }> => {
      const { apiKey, elevenLabsApiKey, theme, mood, allPanels, characterDescription, characterReference, npcs, ending } = input;
      if (!apiKey || !elevenLabsApiKey || !theme) {
        throw new Error("API keys and theme are required for ending generation.");
      }

      const dominantMood = ending ?? (['adventure', 'danger', 'romance', 'drama'] as const)
        .reduce((best, key) => (mood[key] > mood[best] ? key : best), 'adventure' as keyof typeof mood);

      const charDesc = characterDescription || '';
      const charRefImg = characterReference || undefined;

      const endingData = await generateEndingChapter(apiKey, theme, mood, allPanels, charDesc, dominantMood);

      // Prepare lightweight pseudo panels for audio brief authoring
      const pseudoPanels: Panel[] = endingData.panels.map(p => ({ image: '', narrative: p.narrative })) as unknown as Panel[];
      const audioBriefs = await generateAudioBriefs(apiKey, theme, mood, pseudoPanels);

      let sfxCount = 0;
      let stingerCount = 0;
      const maxSfx = 4;
      const maxStingers = 2;

      const allKnownNpcs = npcs;

      // Batch-generate the 4 ending images for consistency
      const endingDescriptions: string[] = endingData.panels.map(p => p.description);
      const endingSpecs: Array<any> = endingData.panels.map((_p) => ({}));
      const endingImages: string[] = await generateChapterImagesBatch(
        apiKey,
        theme,
        endingDescriptions,
        endingSpecs,
        charDesc!,
        charRefImg,
        allKnownNpcs,
      );

      const panelsWithAudio: Panel[] = await Promise.all(
        endingData.panels.map(async (panel, index) => {
          const briefs = audioBriefs.perPanel[index] ?? { sfxPrompt: `Sound effect for: ${panel.description.substring(0, 200)}` };
          const shouldGenSfx = sfxCount < maxSfx;
          const shouldGenStinger = briefs.stingerPrompt && stingerCount < maxStingers;

          const sfxPromise = shouldGenSfx ? generateSoundEffect(elevenLabsApiKey, briefs.sfxPrompt) : Promise.resolve("");
          const stingerPromise = shouldGenStinger ? generateStinger(elevenLabsApiKey, briefs.stingerPrompt as string) : Promise.resolve("");

          const [soundEffectAudio, stingerAudio] = await Promise.all([sfxPromise, stingerPromise]);
          if (shouldGenSfx && soundEffectAudio) sfxCount += 1;
          if (shouldGenStinger && stingerAudio) stingerCount += 1;
          return { image: endingImages[index], narrative: panel.narrative, soundEffectAudio: soundEffectAudio || undefined, stingerAudio: stingerAudio || undefined } as Panel;
        })
      );

      return { newPanels: panelsWithAudio };
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
          actions: assign(({ event }) => ({
            ...initialContext,
            theme: event.theme,
            apiKey: event.apiKey,
            elevenLabsApiKey: event.elevenLabsApiKey,
            isGenerating: true,
          })),
        },
        CONTINUE: {
          target: 'loadingSavedStory',
        },
        VIEW_PREVIOUS: {
          target: 'loadingCompletedStory',
        },
      },
    },
    loadingSavedStory: {
      invoke: {
        id: 'loadStoryFromDB',
        src: 'loadState',
        onDone: [
          {
            target: 'playing',
            guard: ({ event }) => {
              const savedState = event.output as { value: unknown; context: StoryContext } | null;
              return !!(
                savedState &&
                savedState.context &&
                savedState.context.apiKey &&
                savedState.context.elevenLabsApiKey
              );
            },
            actions: assign(({ event }) => {
              const savedState = event.output as { value: unknown; context: StoryContext } | null;
              if (savedState && savedState.context) {
                savedState.context.allPanels.forEach((panel: Panel) => {
                  if (panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
                  if (panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
                });

                const loadedContext: StoryContext = savedState.context;
                loadedContext.allPanels = loadedContext.allPanels.map((p: Panel) => ({ ...p, narrativeAudio: undefined, soundEffectAudio: undefined }));
                loadedContext.npcs = loadedContext.npcs || [];
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
          {
            target: 'idle',
            actions: assign(() => ({
              ...initialContext,
              error: 'Saved story is missing API keys. Please start a new game.',
            })),
          },
        ],
        onError: {
          target: 'idle',
          actions: assign({
            error: 'Failed to load saved story. Please start a new game.',
          }),
        },
      },
    },
    loadingCompletedStory: {
      invoke: {
        src: 'loadCompleted',
        onDone: [
          {
            target: 'viewingPrevious',
            guard: ({ event }) => {
              const savedState = event.output as { value: unknown; context: StoryContext } | null;
              return !!(savedState && savedState.context);
            },
            actions: assign(({ event }) => {
              const savedState = event.output as { value: unknown; context: StoryContext } | null;
              if (savedState && savedState.context) {
                const loadedContext: StoryContext = savedState.context;
                loadedContext.allPanels = loadedContext.allPanels.map((p: Panel) => ({ ...p, narrativeAudio: undefined, soundEffectAudio: undefined }));
                loadedContext.npcs = loadedContext.npcs || [];
                loadedContext.isGenerating = false;
                loadedContext.error = null;
                return loadedContext;
              }
              return initialContext;
            }),
          },
          {
            target: 'idle',
            actions: assign(() => ({
              ...initialContext,
              error: 'No completed story found.',
            })),
          },
        ],
        onError: {
          target: 'idle',
          actions: assign({
            error: 'Failed to load the completed story.',
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
            currentPanelIndex: ({ context }) => Math.max(0, Math.min(context.allPanels.length - 1, context.currentPanelIndex + 1))
          }),
        },
        TOGGLE_MUTE: {
            actions: assign({ isMuted: ({ context }) => !context.isMuted })
        },
        EXIT_TO_MENU: {
          target: 'idle',
          actions: assign(({ context }) => {
            context.allPanels.forEach(panel => {
              if(panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
              if(panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
            });
            if(context.backgroundMusic) URL.revokeObjectURL(context.backgroundMusic);
            return initialContext;
          })
        }
      },
    },
    playing: {
      on: {
        MAKE_CHOICE: [
          {
            target: 'endingGenerating',
            guard: ({ context, event }) => {
              const impact = event.choice.impact;
              return (
                context.mood.adventure + impact.adventure >= 1.0 ||
                context.mood.danger + impact.danger >= 1.0 ||
                context.mood.romance + impact.romance >= 1.0 ||
                context.mood.drama + impact.drama >= 1.0
              );
            },
            actions: [
              assign({
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
                isGenerating: (_) => true,
                choices: (_) => [],
              }),
            ],
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
        },
        EXIT_TO_MENU: {
          target: 'idle',
          actions: assign(({ context }) => {
            context.allPanels.forEach(panel => {
              if(panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
              if(panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
            });
            if(context.backgroundMusic) URL.revokeObjectURL(context.backgroundMusic);
            return initialContext;
          })
        }
      },
    },
    endingGenerating: {
      invoke: {
        id: 'generateEnding',
        input: ({ context }) => context,
        src: 'generateEnding',
        onDone: {
          target: 'playing',
          actions: assign({
            isGenerating: false,
            allPanels: ({ context, event }) => [...context.allPanels, ...event.output.newPanels],
            currentPanelIndex: ({ context }) => context.allPanels.length,
          })
        },
        onError: {
          target: 'playing',
          actions: assign({ isGenerating: false })
        }
      },
      on: {
        VIEW_PREV: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.max(0, context.currentPanelIndex - 1),
          }),
        },
        VIEW_NEXT: {
          actions: assign({
            currentPanelIndex: ({ context }) => Math.max(0, Math.min(context.allPanels.length - 1, context.currentPanelIndex + 1))
          }),
        },
        TOGGLE_MUTE: {
            actions: assign({ isMuted: ({ context }) => !context.isMuted })
        },
        EXIT_TO_MENU: {
          target: 'idle',
          actions: assign(({ context }) => {
            context.allPanels.forEach(panel => {
              if(panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
              if(panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
            });
            if(context.backgroundMusic) URL.revokeObjectURL(context.backgroundMusic);
            return initialContext;
          })
        }
      }
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
    viewingPrevious: {
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
        },
        EXIT_TO_MENU: {
          target: 'idle',
          actions: assign(({ context }) => {
            context.allPanels.forEach(panel => {
              if(panel.narrativeAudio) URL.revokeObjectURL(panel.narrativeAudio);
              if(panel.soundEffectAudio) URL.revokeObjectURL(panel.soundEffectAudio);
            });
            if(context.backgroundMusic) URL.revokeObjectURL(context.backgroundMusic);
            return initialContext;
          })
        }
      }
    }
  },
});
