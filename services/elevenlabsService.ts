const API_BASE_URL = 'https://api.elevenlabs.io/v1';

// A good default voice. Can be replaced with any other Voice ID.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; 

const generateAudio = async (apiKey: string, url: string, body: object): Promise<string> => {
  if (!apiKey) {
    console.warn("ElevenLabs API key is missing. Skipping audio generation.");
    return ""; // Return empty string if key is not provided
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // FIX: Provide a more specific error for 404 Not Found.
      if (response.status === 404) {
          console.error(`ElevenLabs API Error: 404 Not Found. The endpoint ${url} may not exist or may not be available on your plan.`, errorText);
      } else {
          console.error(`ElevenLabs API Error: ${response.statusText}`, errorText);
      }
      // Do not throw, allow the app to continue without this audio track
      return "";
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("An error occurred while generating ElevenLabs audio. The comic will continue without it.", error);
    // Return an empty string so the app can proceed.
    return ""; 
  }
};

export const generateVoiceOver = (apiKey: string, text: string, voiceId: string = DEFAULT_VOICE_ID): Promise<string> => {
  const url = `${API_BASE_URL}/text-to-speech/${voiceId}`;
  const body = {
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  };
  return generateAudio(apiKey, url, body);
};

export const generateSoundEffect = (apiKey: string, prompt: string): Promise<string> => {
  const url = `${API_BASE_URL}/sound-generation`;
  const body = {
    text: prompt,
    duration_seconds: 4, // Keep SFX short and punchy
  };
  return generateAudio(apiKey, url, body);
};

export const generateBackgroundMusic = (apiKey: string, prompt: string): Promise<string> => {
    // FIX: Use the sound-generation endpoint as a fallback for music generation, as the dedicated
    // music endpoint may not be available on all plans.
    const url = `${API_BASE_URL}/sound-generation`;
    const body = {
        text: prompt,
        duration_seconds: 20, // A short, loopable track
    };
    return generateAudio(apiKey, url, body);
};