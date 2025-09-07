import React, { useEffect, useRef } from 'react';
import type { StateFrom, InterpreterFrom } from 'xstate';
import type { storyMachine } from '../state/storyMachine';
import PanelDisplay from './PanelDisplay';
import Navigation from './Navigation';
import MoodCard from './MoodCard.tsx';
import ChoiceButtons from './ChoiceButtons';
import LoadingSpinner from './LoadingSpinner';
import { VolumeUpIcon, VolumeOffIcon } from './icons';

interface ComicViewProps {
  state: StateFrom<typeof storyMachine>;
  send: InterpreterFrom<typeof storyMachine>['send'];
}

const ComicView: React.FC<ComicViewProps> = ({ state, send }) => {
  const { context } = state;
  const { allPanels, currentPanelIndex, choices, isGenerating, isMuted, backgroundMusic } = context;

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
        audioRef.current.volume = 0.3; // Lower volume for background music
    }
  }, [backgroundMusic]);

  const showChoices = (currentPanelIndex + 1) % 5 === 0 && currentPanelIndex === allPanels.length - 1 && choices.length > 0 && !isGenerating;

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col lg:flex-row items-start gap-4">
      {context.error && <div className="bg-red-500 text-white p-4 rounded-lg mb-4">{context.error}</div>}

      {/* Left: Panel */}
      <div className="flex-1">
        <div className="w-full relative aspect-[4/3] bg-gray-800 rounded-lg shadow-lg overflow-hidden border-4 border-gray-700">
          {allPanels.length > 0 ? (
            <PanelDisplay panel={allPanels[currentPanelIndex]} isMuted={isMuted} />
          ) : (
            <div className="flex flex-row items-center justify-center h-full gap-3">
              <div className="self-center"><LoadingSpinner /></div>
              <p className="text-lg leading-none text-gray-400">Weaving the first threads of your story...</p>
            </div>
          )}
          {backgroundMusic && (
              <audio ref={audioRef} src={backgroundMusic} autoPlay loop muted={isMuted} />
          )}
        </div>
      </div>

      {/* Right: Controls and Info */}
      <div className="w-full lg:w-96 xl:w-[28rem] flex flex-col gap-4">
        <MoodCard mood={context.mood} />

        <div className="w-full flex items-center justify-between">
          <Navigation
            currentPanelIndex={currentPanelIndex}
            totalPanels={allPanels.length}
            send={send}
            isGenerating={isGenerating}
          />
          <div className="flex items-center ml-4" style={{ height: '48px' }}>
            <button
              onClick={() => send({ type: 'TOGGLE_MUTE' })}
              className="p-3 bg-gray-700 rounded-full hover:bg-purple-600 transition-colors flex items-center justify-center"
              style={{ width: '42px', height: '42px' }}
            >
              {isMuted ? <VolumeOffIcon className="w-6 h-6" /> : <VolumeUpIcon className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {isGenerating && currentPanelIndex === allPanels.length - 1 && (
          <div className="mt-2 flex items-center justify-start gap-3">
            <LoadingSpinner />
            <p className="text-purple-300 animate-pulse">Generating images, narration, and sounds...</p>
          </div>
        )}

        {showChoices && (
          <ChoiceButtons choices={choices} onChoose={(choice) => send({ type: 'MAKE_CHOICE', choice })} />
        )}
      </div>
    </div>
  );
};

export default ComicView;
