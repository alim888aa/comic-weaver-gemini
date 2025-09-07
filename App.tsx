
import React, { useEffect, useState } from 'react';
import { useMachine } from '@xstate/react';
import type { StateFrom, InterpreterFrom } from 'xstate';
import { storyMachine } from './state/storyMachine';
import IdleScreen from './components/IdleScreen';
import ComicView from './components/ComicView';
import EndScreen from './components/EndScreen';
import { saveState, hasSavedState } from './services/storageService';
import LoadingSpinner from './components/LoadingSpinner';

const App: React.FC = () => {
  // FIX: Explicitly type the useMachine hook's return values.
  // This can resolve complex type inference issues that may manifest in other parts of the component,
  // such as the "Type 'boolean' is not assignable to type 'never'" error.
  const [state, send, service]: [
    StateFrom<typeof storyMachine>,
    InterpreterFrom<typeof storyMachine>['send'],
    InterpreterFrom<typeof storyMachine>
  ] = useMachine(storyMachine, {
    devTools: true,
  });

  const [showContinue, setShowContinue] = useState<boolean>(false);

  useEffect(() => {
    // FIX: Only check for saved state when the app is in the idle state.
    // This prevents unnecessary checks on every state transition and may resolve a complex type inference issue.
    if (state.matches('idle')) {
      // Asynchronously check for a saved state when the component mounts or returns to idle
      hasSavedState().then(exists => {
        setShowContinue(exists);
      });
    }
    // FIX: The dependency should be the entire state object to correctly react to all state changes.
  }, [state]);

  useEffect(() => {
    const subscription = service.subscribe((currentState) => {
      // Persist state to IndexedDB whenever it changes, except for initial/loading states.
      if (!currentState.matches('idle') && !currentState.matches('loadingSavedStory')) {
        const persistedState = {
          value: currentState.value,
          context: currentState.context,
        };
        try {
          saveState(persistedState);
        } catch (e) {
          console.error("Could not save state to IndexedDB", e);
        }
      }
    });

    return subscription.unsubscribe;
  }, [service]);

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4">
      <header className="w-full max-w-5xl text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold text-purple-400 tracking-wider">Gemini Comic Weaver</h1>
        <p className="text-gray-400 mt-2">Craft your own adventure, one panel at a time.</p>
      </header>
      <main className="w-full flex-grow flex items-center justify-center">
        {state.matches('idle') && <IdleScreen send={send} showContinue={showContinue} />}
        {state.matches('loadingSavedStory') && (
            <div className="flex flex-col items-center justify-center h-full">
                <LoadingSpinner />
                <p className="mt-4 text-lg text-gray-400">Loading your masterpiece...</p>
            </div>
        )}
        {(state.matches('playing') || state.matches('generating')) && <ComicView state={state} send={send} />}
        {state.matches('storyEnded') && <EndScreen context={state.context} send={send} />}
      </main>
    </div>
  );
};

export default App;
