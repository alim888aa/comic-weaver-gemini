import type { VercelRequest, VercelResponse } from '@vercel/node';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const API_BASE_URL = 'https://api.elevenlabs.io/v1';

// Concurrency limiter
const MAX_CONCURRENT = 2;
let activeRequests = 0;
const queue: (() => void)[] = [];

const acquireSlot = (): Promise<void> => {
  return new Promise((resolve) => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests++;
      resolve();
    } else {
      queue.push(() => {
        activeRequests++;
        resolve();
      });
    }
  });
};

const releaseSlot = () => {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
};

// In-memory cache
const audioCache = new Map<string, string>();

const normalizePrompt = (prompt: string): string =>
  prompt.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);

const cacheKey = (prompt: string, durationSeconds: number): string =>
  `${normalizePrompt(prompt)}::${durationSeconds}`;

async function generateAudio(url: string, body: object): Promise<ArrayBuffer | null> {
  if (!ELEVENLABS_API_KEY) {
    console.warn('ElevenLabs API key is missing. Skipping audio generation.');
    return null;
  }

  await acquireSlot();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs API Error: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error('An error occurred while generating ElevenLabs audio.', error);
    return null;
  } finally {
    releaseSlot();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, ...params } = req.body;

  if (!ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }

  try {
    switch (action) {
      case 'generateSoundEffect': {
        const { prompt } = params;
        const key = cacheKey(prompt, 3);
        const cached = audioCache.get(key);
        if (cached) {
          return res.status(200).json({ audio: cached });
        }

        const url = `${API_BASE_URL}/sound-generation`;
        const body = { text: prompt, duration_seconds: 3 };
        const audioBuffer = await generateAudio(url, body);

        if (!audioBuffer) {
          return res.status(200).json({ audio: '' });
        }

        const base64 = Buffer.from(audioBuffer).toString('base64');
        audioCache.set(key, base64);
        return res.status(200).json({ audio: base64 });
      }

      case 'generateBackgroundMusic': {
        const { prompt } = params;
        const key = cacheKey(prompt, 10);
        const cached = audioCache.get(key);
        if (cached) {
          return res.status(200).json({ audio: cached });
        }

        const url = `${API_BASE_URL}/sound-generation`;
        const body = { text: prompt, duration_seconds: 10 };
        const audioBuffer = await generateAudio(url, body);

        if (!audioBuffer) {
          return res.status(200).json({ audio: '' });
        }

        const base64 = Buffer.from(audioBuffer).toString('base64');
        audioCache.set(key, base64);
        return res.status(200).json({ audio: base64 });
      }

      case 'generateStinger': {
        const { prompt } = params;
        const key = cacheKey(prompt, 2);
        const cached = audioCache.get(key);
        if (cached) {
          return res.status(200).json({ audio: cached });
        }

        const url = `${API_BASE_URL}/sound-generation`;
        const body = { text: prompt, duration_seconds: 2 };
        const audioBuffer = await generateAudio(url, body);

        if (!audioBuffer) {
          return res.status(200).json({ audio: '' });
        }

        const base64 = Buffer.from(audioBuffer).toString('base64');
        audioCache.set(key, base64);
        return res.status(200).json({ audio: base64 });
      }

      case 'generateAmbienceBed': {
        const { prompt } = params;
        const ambientPrompt = `${prompt} — loopable ambience bed, no vocals, minimal melody`;
        const key = cacheKey(ambientPrompt, 8);
        const cached = audioCache.get(key);
        if (cached) {
          return res.status(200).json({ audio: cached });
        }

        const url = `${API_BASE_URL}/sound-generation`;
        const body = { text: ambientPrompt, duration_seconds: 8 };
        const audioBuffer = await generateAudio(url, body);

        if (!audioBuffer) {
          return res.status(200).json({ audio: '' });
        }

        const base64 = Buffer.from(audioBuffer).toString('base64');
        audioCache.set(key, base64);
        return res.status(200).json({ audio: base64 });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error('[API] ElevenLabs error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
