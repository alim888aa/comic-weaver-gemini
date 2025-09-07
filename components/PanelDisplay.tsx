import React, { useEffect, useRef } from 'react';
import type { Panel } from '../types';

interface PanelDisplayProps {
  panel: Panel;
  isMuted: boolean;
}

const PanelDisplay: React.FC<PanelDisplayProps> = ({ panel, isMuted }) => {
  const narrativeAudioRef = useRef<HTMLAudioElement>(null);
  const sfxAudioRef = useRef<HTMLAudioElement>(null);

  // This effect triggers whenever the panel changes, playing the new audio.
  useEffect(() => {
    const playAudio = (audioElement: HTMLAudioElement | null) => {
      if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(error => {
          // Autoplay can be blocked by the browser, especially before user interaction.
          // The main mute button serves as sufficient user interaction in most cases.
          if (error.name !== 'NotAllowedError') {
            console.error("Audio playback error:", error);
          }
        });
      }
    };
    
    // Play narrative and SFX simultaneously for an immersive effect.
    playAudio(narrativeAudioRef.current);
    playAudio(sfxAudioRef.current);

  }, [panel]); // Dependency array ensures this runs only when the panel object changes.


  return (
    <div className="w-full h-full flex flex-col">
      <img
        src={`data:image/jpeg;base64,${panel.image}`}
        alt="Comic panel"
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 p-4">
        <p className="text-white text-center text-sm md:text-base font-serif italic">{panel.narrative}</p>
      </div>

      {/* Hidden audio elements for playback control */}
      {panel.narrativeAudio && (
        <audio ref={narrativeAudioRef} src={panel.narrativeAudio} muted={isMuted} preload="auto" />
      )}
      {panel.soundEffectAudio && (
        <audio ref={sfxAudioRef} src={panel.soundEffectAudio} muted={isMuted} preload="auto" />
      )}
    </div>
  );
};

export default PanelDisplay;
