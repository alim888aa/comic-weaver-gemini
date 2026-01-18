const API_BASE_URL = 'https://api.elevenlabs.io/v1';
const MAX_CONCURRENT_REQUESTS = 3;

// A good default voice. Can be replaced with any other Voice ID.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; 

let activeRequests = 0;
const requestQueue: Array<() => void> = [];

const acquireSlot = (): Promise<void> =>
  new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests += 1;
        resolve();
        return;
      }
      requestQueue.push(tryAcquire);
    };
    tryAcquire();
  });

const releaseSlot = () => {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = requestQueue.shift();
  if (next) next();
};

const generateAudio = async (apiKey: string, url: string, body: object): Promise<string> => {
  if (!apiKey) {
    console.warn("ElevenLabs API key is missing. Skipping audio generation.");
    return ""; // Return empty string if key is not provided
  }

  try {
    await acquireSlot();
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
  } finally {
    releaseSlot();
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
  // Cached, shorter duration to reduce cost and latency
  return getOrGenerateAudio(apiKey, prompt, 3);
};

export const generateBackgroundMusic = (apiKey: string, prompt: string): Promise<string> => {
  // Cached, shorter track to keep costs down
  const tunedPrompt = `${prompt} — short loopable background music, no vocals`;
  return getOrGenerateAudio(apiKey, tunedPrompt, 10);
};

// Simple in-memory cache scoped to a session. Keys are normalized prompts + duration.
const audioCache = new Map<string, string>();

const normalizePrompt = (prompt: string): string =>
  prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

const cacheKey = (prompt: string, durationSeconds: number): string =>
  `${normalizePrompt(prompt)}::${durationSeconds}`;

export const getOrGenerateAudio = async (
  apiKey: string,
  prompt: string,
  durationSeconds: number
): Promise<string> => {
  const key = cacheKey(prompt, durationSeconds);
  const cached = audioCache.get(key);
  if (cached) return cached;

  const url = `${API_BASE_URL}/sound-generation`;
  const body = { text: prompt, duration_seconds: durationSeconds } as const;
  const result = await generateAudio(apiKey, url, body);
  if (result) audioCache.set(key, result);
  return result;
};

export const generateStinger = (apiKey: string, prompt: string): Promise<string> => {
  return getOrGenerateAudio(apiKey, prompt, 2);
};

export const generateAmbienceBed = (apiKey: string, prompt: string): Promise<string> => {
  // 8s loopable ambience bed as fallback when music is unavailable
  return getOrGenerateAudio(apiKey, `${prompt} — loopable ambience bed, no vocals, minimal melody`, 8);
};