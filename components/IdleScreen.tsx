import React, { useState } from 'react';
import type { InterpreterFrom } from 'xstate';
import type { storyMachine } from '../state/storyMachine';
import type { Theme } from '../types';
import { BookOpenIcon, PlayIcon, RefreshIcon } from './icons';

interface IdleScreenProps {
  send: InterpreterFrom<typeof storyMachine>['send'];
  showContinue: boolean;
  showViewPrevious?: boolean;
}

const ThemeButton: React.FC<{ onClick: () => void; label: string; disabled: boolean; }> = ({ onClick, label, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:transform-none"
  >
    {label}
  </button>
);

const IdleScreen: React.FC<IdleScreenProps> = ({ send, showContinue, showViewPrevious }) => {
  const envGeminiKey = (process.env.GEMINI_API_KEY ?? '').toString().trim();
  const envElevenLabsKey = (process.env.ELEVENLABS_API_KEY ?? '').toString().trim();
  const [apiKey] = useState(envGeminiKey);
  const [elevenLabsKey] = useState(envElevenLabsKey);
  const areKeysProvided = apiKey !== '' && elevenLabsKey !== '';

  const handleStart = (theme: Theme) => {
    if (!areKeysProvided) return;
    send({ type: 'START', theme, apiKey, elevenLabsApiKey: elevenLabsKey });
  };

  const handleContinue = () => {
    send({ type: 'CONTINUE' });
  };

  const handleViewPrevious = () => {
    send({ type: 'VIEW_PREVIOUS' });
  };

  return (
    <div className="w-full max-w-md p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 text-center">
      <div className="flex justify-center mb-6">
        <BookOpenIcon className="w-16 h-16 text-purple-400" />
      </div>
      <h2 className="text-3xl font-bold mb-2">Welcome, Storyteller!</h2>
      <p className="text-gray-400 mb-6">Choose a genre to begin.</p>

      <div className="space-y-4">
        <ThemeButton onClick={() => handleStart('fantasy')} label="Fantasy" disabled={!areKeysProvided} />
        <ThemeButton onClick={() => handleStart('scifi')} label="Sci-Fi" disabled={!areKeysProvided} />
        <ThemeButton onClick={() => handleStart('school')} label="School Life" disabled={!areKeysProvided} />
      </div>

      {(showContinue || showViewPrevious) && (
        <>
          <div className="my-6 flex items-center">
            <div className="flex-grow border-t border-gray-600"></div>
            <span className="flex-shrink mx-4 text-gray-500">OR</span>
            <div className="flex-grow border-t border-gray-600"></div>
          </div>
          {showContinue && (
            <button
              onClick={handleContinue}
              className="w-full flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 mb-3"
            >
              <PlayIcon className="w-5 h-5 mr-2" />
              Continue Last Story
            </button>
          )}
          {showViewPrevious && (
            <button
              onClick={handleViewPrevious}
              className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
            >
              <PlayIcon className="w-5 h-5 mr-2" />
              View Previous Story
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default IdleScreen;