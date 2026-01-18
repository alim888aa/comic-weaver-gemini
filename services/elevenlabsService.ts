const API_BASE = '/api/elevenlabs';

const callElevenLabsAPI = async (action: string, params: Record<string, any>): Promise<string> => {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });

    if (!response.ok) {
      console.error(`ElevenLabs API error: ${response.status}`);
      return '';
    }

    const data = await response.json();
    const base64Audio = data.audio;

    if (!base64Audio) {
      return '';
    }

    // Convert base64 to blob URL for playback
    const byteCharacters = atob(base64Audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/mpeg' });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('An error occurred while generating ElevenLabs audio.', error);
    return '';
  }
};

export const generateSoundEffect = (prompt: string): Promise<string> => {
  return callElevenLabsAPI('generateSoundEffect', { prompt });
};

export const generateBackgroundMusic = (prompt: string): Promise<string> => {
  return callElevenLabsAPI('generateBackgroundMusic', { prompt });
};

export const generateStinger = (prompt: string): Promise<string> => {
  return callElevenLabsAPI('generateStinger', { prompt });
};

export const generateAmbienceBed = (prompt: string): Promise<string> => {
  return callElevenLabsAPI('generateAmbienceBed', { prompt });
};

// Kept for compatibility but not used with backend proxy
export const generateVoiceOver = (_text: string, _voiceId?: string): Promise<string> => {
  return Promise.resolve('');
};
