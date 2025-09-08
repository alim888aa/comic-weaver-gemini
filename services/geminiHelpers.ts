// Lightweight rate limiter for image generation (Free tier: 10 RPM) with small concurrency pool
const IMAGE_RPM_LIMIT = 10; // requests per minute
const IMAGE_CONCURRENCY_LIMIT = 3; // in-flight requests
const ONE_MINUTE_MS = 60_000;

type QueueTask<T> = { run: () => Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
const imageQueue: QueueTask<any>[] = [];
let imageInFlight = 0;
let imageStartTimestamps: number[] = [];

const pruneOldStarts = () => {
  const now = Date.now();
  imageStartTimestamps = imageStartTimestamps.filter((t) => now - t < ONE_MINUTE_MS);
};

const scheduleNextTick = (delayMs: number) => {
  setTimeout(processImageQueue, delayMs);
};

const canStartMore = () => {
  pruneOldStarts();
  return imageInFlight < IMAGE_CONCURRENCY_LIMIT && imageStartTimestamps.length < IMAGE_RPM_LIMIT;
};

function processImageQueue() {
  pruneOldStarts();
  while (canStartMore() && imageQueue.length > 0) {
    const task = imageQueue.shift()!;
    imageInFlight += 1;
    imageStartTimestamps.push(Date.now());
    task
      .run()
      .then((res) => task.resolve(res))
      .catch((err) => task.reject(err))
      .finally(() => {
        imageInFlight -= 1;
        // Try to start more immediately
        scheduleNextTick(0);
      });
  }

  if (imageQueue.length > 0 && !canStartMore()) {
    const now = Date.now();
    const oldest = imageStartTimestamps[0] ?? now;
    const msUntilWindowFrees = Math.max(0, ONE_MINUTE_MS - (now - oldest));
    // Wake when RPM window frees up; also wakes on in-flight completions
    scheduleNextTick(msUntilWindowFrees + 5);
  }
}

export function scheduleImageTask<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    imageQueue.push({ run, resolve, reject });
    processImageQueue();
  });
}

function isRateLimitError(err: unknown): boolean {
  const anyErr: any = err as any;
  const status = anyErr?.status || anyErr?.code;
  const message: string = (anyErr?.message || "").toString().toLowerCase();
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    message.includes('rate') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('429')
  );
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, opts?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number }): Promise<T> {
  const retries = opts?.retries ?? 3;
  const base = opts?.baseDelayMs ?? 250;
  const max = opts?.maxDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= retries) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * base);
      const delay = Math.min(max, base * Math.pow(2, attempt)) + jitter;
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

// Heuristic cinematography selector to diversify framing and avoid straight-on, tight crops
function hashStringToInt(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function chooseCinematography(description: string): {
  shot: string;
  angle: string;
  lensMm: number;
  eyeline: string;
  composition: string;
  framing: string;
  movement?: string;
  subjectScaleHint: string;
} {
  const lower = description.toLowerCase();
  const matches = (re: RegExp) => re.test(lower);

  const isDialogue = matches(/\b(dialogue|conversation|talks?|speaks?|whispers?|argues?)\b/);
  const isCrowdOrWide = matches(/\b(crowd|cityscape|landscape|wide|panoramic|battle|market|plaza|rooftops?)\b/);
  const isAction = matches(/\b(run|running|jump|leap|fight|chase|explosion|blast|dash|attack|strike|punch|kick)\b/);
  const isStealth = matches(/\b(sneak|stealth|hide|shadow|peek|spy|eavesdrop)\b/);
  const isIntimate = matches(/\b(hug|holds?|hand in hand|kiss|close|tender|quiet moment|comforts?)\b/);
  const isThreat = matches(/\b(monster|enemy|threat|danger|gun|weapon|blade|creature|beast)\b/);

  if (isDialogue) {
    return {
      shot: 'medium over-the-shoulder two-shot',
      angle: 'slight high angle for the listener character',
      lensMm: 35,
      eyeline: 'characters look at each other, not at camera',
      composition: 'rule of thirds, faces placed on intersecting points; background depth cues',
      framing: 'include full heads with comfortable headroom; no cropping of chins or foreheads',
      subjectScaleHint: 'subjects ~55-65% of frame height; ensure entire heads visible',
    };
  }

  if (isCrowdOrWide) {
    return {
      shot: 'wide establishing shot',
      angle: 'slight high angle to capture environment',
      lensMm: 24,
      eyeline: 'main subject looks within scene context, not into camera',
      composition: 'leading lines guide toward subject; strong foreground/midground/background separation',
      framing: 'full-body framing with generous headroom and footroom; do not crop head or feet',
      subjectScaleHint: 'subject ~35-45% of frame height to keep full body in frame',
    };
  }

  if (isAction) {
    return {
      shot: 'three-quarter action shot',
      angle: isThreat ? 'slight low angle to amplify power' : 'dynamic dutch tilt (subtle)',
      lensMm: 35,
      eyeline: 'subject focuses on target or path; avoid direct camera gaze',
      composition: 'diagonals and motion lines; off-center subject for direction of travel',
      framing: 'keep hands and feet within frame during motion; preserve headroom',
      movement: 'implied motion blur streaks and speed lines, debris for impact',
      subjectScaleHint: 'subject ~50-60% of frame height; ensure no limb or head cropping',
    };
  }

  if (isStealth) {
    return {
      shot: 'medium long over-the-shoulder peek',
      angle: 'slight high angle looking down corridor/alley',
      lensMm: 28,
      eyeline: 'subject looks past frame edge; no eye contact with camera',
      composition: 'use foreground occlusion (door frame, foliage) to frame subject',
      framing: 'subject placed at one third; ample headroom; no cropping at joints',
      subjectScaleHint: 'subject ~45-55% of frame height; maintain full head visibility',
    };
  }

  if (isIntimate) {
    return {
      shot: 'medium close-up',
      angle: 'gentle 10° high angle',
      lensMm: 50,
      eyeline: 'soft side gaze; do not look at camera unless specified',
      composition: 'rule of thirds; negative space supports mood',
      framing: 'include full head with comfortable headroom; avoid ear or crown cropping',
      subjectScaleHint: 'head-and-shoulders within frame; ~60-70% height; no crown crop',
    };
  }

  // Default: vary by hash to avoid repetition
  const variants = [
    {
      shot: 'medium shot',
      angle: 'eye-level',
      lensMm: 35,
      eyeline: 'looking within scene; not at camera',
      composition: 'rule of thirds, balanced background',
      framing: 'include full head with headroom; hands visible if gesturing',
      subjectScaleHint: 'subject ~55-65% of frame height; keep entire head visible',
    },
    {
      shot: 'full shot',
      angle: 'slight high angle',
      lensMm: 28,
      eyeline: 'gaze toward subject of interest in scene',
      composition: 'leading lines from environment; off-center placement',
      framing: 'full body fits; no cropping of head or feet',
      subjectScaleHint: 'subject ~40-50% of frame height; adjust camera back to keep feet and head',
    },
    {
      shot: 'over-the-shoulder',
      angle: 'eye-level behind protagonist',
      lensMm: 40,
      eyeline: 'toward focus object/person; not at camera',
      composition: 'foreground shoulder as frame; subject at one third',
      framing: 'maintain headroom; avoid tight forehead crop',
      subjectScaleHint: 'primary subject ~50-60% of frame height; full head visible',
    },
    {
      shot: 'wide environmental shot',
      angle: 'slight low angle for grandeur',
      lensMm: 24,
      eyeline: 'subject looks into scene space',
      composition: 'strong foreground depth; subject small but readable',
      framing: 'ample breathing room on all sides; keep horizon level',
      subjectScaleHint: 'subject ~30-40% of frame height to avoid cropping',
    },
  ];
  const idx = hashStringToInt(description) % variants.length;
  return variants[idx];
}


