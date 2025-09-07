import React from 'react';
import type { InterpreterFrom } from 'xstate';
import type { storyMachine } from '../state/storyMachine';
import { ArrowLeftIcon, ArrowRightIcon } from './icons';

interface NavigationProps {
  currentPanelIndex: number;
  totalPanels: number;
  send: InterpreterFrom<typeof storyMachine>['send'];
  isGenerating: boolean;
}

const NavButton: React.FC<{ onClick: () => void; disabled: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="bg-gray-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition duration-200 flex items-center space-x-2"
  >
    {children}
  </button>
);

const Navigation: React.FC<NavigationProps> = ({ currentPanelIndex, totalPanels, send, isGenerating }) => {
  const canGoNext = currentPanelIndex < totalPanels - 1;
  const canGoPrev = currentPanelIndex > 0;

  return (
    <div className="flex-grow flex justify-between items-center mt-2">
      <NavButton onClick={() => send({ type: 'VIEW_PREV' })} disabled={!canGoPrev}>
        <ArrowLeftIcon className="w-5 h-5" />
        <span>Previous</span>
      </NavButton>
      
      {totalPanels > 0 && (
        <div className="text-lg font-semibold text-gray-300 px-4">
          Panel {currentPanelIndex + 1} of {totalPanels}
          {isGenerating && currentPanelIndex === totalPanels - 1 && '...'}
        </div>
      )}

      <NavButton onClick={() => send({ type: 'VIEW_NEXT' })} disabled={!canGoNext}>
        <span>Next</span>
        <ArrowRightIcon className="w-5 h-5" />
      </NavButton>
    </div>
  );
};

export default Navigation;
