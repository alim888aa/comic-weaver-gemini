
import React from 'react';
import type { InterpreterFrom } from 'xstate';
import type { storyMachine } from '../state/storyMachine';
import type { StoryContext } from '../types';
import { RefreshIcon } from './icons';

interface EndScreenProps {
  context: StoryContext;
  send: InterpreterFrom<typeof storyMachine>['send'];
}

const getEndingDetails = (ending: keyof import('../types').MoodVector | null) => {
  switch (ending) {
    case 'adventure':
      return { title: "An Adventurous Legend", message: "Your tale became a legend, whispered by travelers and sung by bards for generations to come." };
    case 'danger':
      return { title: "A Perilous Fate", message: "You faced the darkness head-on, and while the path was fraught with peril, your name will never be forgotten." };
    case 'romance':
      return { title: "A Heartfelt Saga", message: "Your story became a timeless romance, a testament to the powerful bonds you forged along the way." };
    case 'drama':
      return { title: "A Dramatic Climax", message: "Emotions peaked, secrets surfaced, and your choices forged a gripping finale." };
    default:
      return { title: "The Story Concludes", message: "Your journey has reached its end." };
  }
};

const EndScreen: React.FC<EndScreenProps> = ({ context, send }) => {
  const { title, message } = getEndingDetails(context.ending);

  return (
    <div className="w-full max-w-lg p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 text-center flex flex-col items-center">
      <h2 className="text-4xl font-bold text-purple-400 mb-4">{title}</h2>
      <p className="text-gray-300 text-lg mb-8">{message}</p>
      
      <button
        onClick={() => send({ type: 'RESTART' })}
        className="flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
      >
        <RefreshIcon className="w-5 h-5 mr-2" />
        Start a New Story
      </button>
    </div>
  );
};

export default EndScreen;
