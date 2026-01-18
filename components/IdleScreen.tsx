import React, { useState } from 'react';
import type { InterpreterFrom } from 'xstate';
import type { storyMachine } from '../state/storyMachine';
import type { Theme } from '../types';
import { BookOpenIcon, PlayIcon } from './icons';
import { analyzeCharacterPhoto } from '../services/geminiService';

interface IdleScreenProps {
  send: InterpreterFrom<typeof storyMachine>['send'];
  showContinue: boolean;
  showViewPrevious?: boolean;
}

const ThemeButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
  >
    {label}
  </button>
);

const IdleScreen: React.FC<IdleScreenProps> = ({ send, showContinue, showViewPrevious }) => {
  const [step, setStep] = useState<'upload' | 'theme'>('upload');
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null);
  const [characterDescription, setCharacterDescription] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    setError(null);
    setIsAnalyzing(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.replace(/^data:image\/\w+;base64,/, '');
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setUploadedPhoto(base64);

      const result = await analyzeCharacterPhoto(base64);
      setCharacterDescription(result.characterDescription);
      setStep('theme');
    } catch (err) {
      console.error('Failed to analyze photo:', err);
      setError('Failed to analyze photo. Please try again.');
      setUploadedPhoto(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStart = (theme: Theme) => {
    if (!uploadedPhoto || !characterDescription) return;
    send({ type: 'START', theme, characterReference: uploadedPhoto, characterDescription });
  };

  const handleContinue = () => {
    send({ type: 'CONTINUE' });
  };

  const handleViewPrevious = () => {
    send({ type: 'VIEW_PREVIOUS' });
  };

  const handleBackToUpload = () => {
    setStep('upload');
    setUploadedPhoto(null);
    setCharacterDescription(null);
  };

  if (step === 'upload') {
    return (
      <div className="w-full max-w-md p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 text-center">
        <div className="flex justify-center mb-6">
          <BookOpenIcon className="w-16 h-16 text-purple-400" />
        </div>
        <h2 className="text-3xl font-bold mb-2">Become the Hero</h2>
        <p className="text-gray-400 mb-6">Upload a photo to become the main character of the story.</p>

        {isAnalyzing ? (
          <div className="py-8">
            <div className="w-12 h-12 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-purple-300">Analyzing your photo...</p>
          </div>
        ) : (
          <label htmlFor="photo-upload" className="block w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 cursor-pointer">
            <input
              id="photo-upload"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <div className="flex items-center justify-center gap-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload Your Photo
            </div>
          </label>
        )}

        {error && (
          <p className="text-red-400 mt-4">{error}</p>
        )}

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
  }

  return (
    <div className="w-full max-w-md p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 text-center">
      {uploadedPhoto && (
        <div className="mb-6">
          <img
            src={`data:image/jpeg;base64,${uploadedPhoto}`}
            alt="Your character"
            className="w-24 h-24 rounded-full mx-auto object-cover border-4 border-purple-500 shadow-lg"
          />
          <p className="text-sm text-gray-400 mt-2 line-clamp-2">{characterDescription}</p>
        </div>
      )}

      <h2 className="text-3xl font-bold mb-2">Choose Your Adventure</h2>
      <p className="text-gray-400 mb-6">Select a genre to begin.</p>

      <div className="space-y-4">
        <ThemeButton onClick={() => handleStart('fantasy')} label="Fantasy" />
        <ThemeButton onClick={() => handleStart('scifi')} label="Sci-Fi" />
        <ThemeButton onClick={() => handleStart('school')} label="School Life" />
      </div>

      <button
        onClick={handleBackToUpload}
        className="mt-6 text-gray-400 hover:text-white text-sm underline"
      >
        ← Change photo
      </button>
    </div>
  );
};

export default IdleScreen;
