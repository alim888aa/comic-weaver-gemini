
import React from 'react';
import type { Choice } from '../types';

interface ChoiceButtonsProps {
  choices: Choice[];
  onChoose: (choice: Choice) => void;
}

const ChoiceButtons: React.FC<ChoiceButtonsProps> = ({ choices, onChoose }) => {
  return (
    <div className="mt-8 w-full max-w-2xl text-center">
      <h3 className="text-2xl font-bold text-purple-300 mb-4">What happens next?</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {choices.map((choice, index) => {
          const entries = Object.entries(choice.impact) as Array<[keyof import('../types').MoodVector, number]>;
          const [topMood, topVal] = entries.reduce((a, b) => (a[1] >= b[1] ? a : b));
          const label = `${topMood.toString().toUpperCase()} +${topVal.toFixed(2)}`;
          return (
          <button
            key={index}
            onClick={() => onChoose(choice)}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-75"
          >
            <span className="block text-sm text-purple-200 mb-1">{label}</span>
            <span>{choice.text}</span>
          </button>
          );
        })}
      </div>
    </div>
  );
};

export default ChoiceButtons;
