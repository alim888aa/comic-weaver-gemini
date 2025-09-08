
import React, { useEffect, useState } from 'react';
import { useMachine } from '@xstate/react';
import type { StateFrom, InterpreterFrom } from 'xstate';
import { storyMachine } from './state/storyMachine';
import IdleScreen from './components/IdleScreen';
import ComicView from './components/ComicView';
import EndScreen from './components/EndScreen';
import { saveState, hasSavedState, hasCompletedState } from './services/storageService';
import LoadingSpinner from './components/LoadingSpinner';

const App: React.FC = () => {
  // Explicitly type the useMachine hook's return values.
  // This can resolve complex type inference issues that may manifest in other parts of the component,
  // such as the "Type 'boolean' is not assignable to type 'never'" error.
  const [state, send, service] = useMachine(storyMachine) as unknown as [
    StateFrom<typeof storyMachine>,
    InterpreterFrom<typeof storyMachine>['send'],
    InterpreterFrom<typeof storyMachine>
  ];

  const [showContinue, setShowContinue] = useState<boolean>(false);
  const [showViewPrevious, setShowViewPrevious] = useState<boolean>(false);

  useEffect(() => {
    if (!state.matches('idle')) return;
    let cancelled = false;
    (async () => {
      try {
        const [exists, completed] = await Promise.all([
          hasSavedState(),
          hasCompletedState(),
        ]);
        if (!cancelled) {
          setShowContinue(exists);
          setShowViewPrevious(completed);
        }
      } catch {
        if (!cancelled) {
          setShowContinue(false);
          setShowViewPrevious(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.value]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const subscription = service.subscribe((currentState) => {
      if (currentState.matches('idle') || currentState.matches('loadingSavedStory')) return;
      const snapshot = { value: currentState.value, context: currentState.context };
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        saveState(snapshot).catch((e) => {
          console.error('Could not save state to IndexedDB', e);
        });
      }, 150);
    });

    return () => {
      if (timeout) clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [service]);

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4">
      <header className="w-full max-w-5xl text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold text-purple-400 tracking-wider">Gemini Comic Weaver</h1>
        <p className="text-gray-400 mt-2">Craft your own adventure, one panel at a time.</p>
      </header>
      <main className="w-full flex-grow flex items-center justify-center">
        {state.matches('idle') && <IdleScreen send={send} showContinue={showContinue} showViewPrevious={showViewPrevious} />}
        {state.matches('loadingSavedStory') && (
            <div className="flex flex-col items-center justify-center h-full">
                <LoadingSpinner />
                <p className="mt-4 text-lg text-gray-400">Loading your masterpiece...</p>
            </div>
        )}
        {state.matches('loadingCompletedStory') && (
            <div className="flex flex-col items-center justify-center h-full">
                <LoadingSpinner />
                <p className="mt-4 text-lg text-gray-400">Retrieving your previous story...</p>
            </div>
        )}
        {(state.matches('playing') || state.matches('generating') || state.matches('endingGenerating') || state.matches('viewingPrevious')) && <ComicView state={state} send={send} />}
        {state.matches('storyEnded') && <EndScreen context={state.context} send={send} />}
      </main>
    </div>
  );
};

export default App;
