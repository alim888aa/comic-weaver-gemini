const DB_NAME = 'ComicWeaverDB';
const STORE_NAME = 'storyState';
const ASSET_STORE_NAME = 'assets';
const VERSION = 2;

let db: IDBDatabase | undefined;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }
    const request = indexedDB.open(DB_NAME, VERSION);

    request.onerror = () => {
      reject('Error opening IndexedDB');
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(ASSET_STORE_NAME)) {
        dbInstance.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const saveBackgroundMusicFromUrl = async (musicUrl: string | undefined): Promise<void> => {
  if (!musicUrl) return;
  try {
    const response = await fetch(musicUrl);
    if (!response.ok) return;
    const blob = await response.blob();
    const dbInstance = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = dbInstance.transaction(ASSET_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ASSET_STORE_NAME);
      store.put({ id: 'backgroundMusic', blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storing failures silently
  }
};

export const saveState = async (state: any): Promise<void> => {
  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    // Use a fixed key 'currentState' for our single state object
    store.put({ id: 'currentState', ...state });
    
    transaction.oncomplete = () => {
      resolve();
    };
    
    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
  // Persist background music blob separately if available
  await saveBackgroundMusicFromUrl(state?.context?.backgroundMusic);
};

export const loadState = async (): Promise<any | null> => {
    const dbInstance = await openDB();
    const saved = await new Promise<any | null>((resolve, reject) => {
        const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get('currentState');
        request.onsuccess = () => {
            resolve(request.result || null);
        };
        request.onerror = () => {
            reject(request.error);
        };
    });

    if (!saved) return null;

    // Try to rehydrate background music from assets store
    try {
        const musicBlob: Blob | null = await new Promise((resolve, reject) => {
            const tx = dbInstance.transaction(ASSET_STORE_NAME, 'readonly');
            const store = tx.objectStore(ASSET_STORE_NAME);
            const req = store.get('backgroundMusic');
            req.onsuccess = () => {
                const record = req.result as { id: string; blob: Blob } | undefined;
                resolve(record?.blob ?? null);
            };
            req.onerror = () => reject(req.error);
        });
        if (musicBlob) {
            const url = URL.createObjectURL(musicBlob);
            if (saved.context) {
                saved.context.backgroundMusic = url;
            }
        }
    } catch {
        // Ignore rehydration failure
    }

    return saved;
};

export const hasSavedState = async (): Promise<boolean> => {
    const state = await loadState();
    return state !== null;
}

export const clearState = async (): Promise<void> => {
    const dbInstance = await openDB();
    // Clear story state
    await new Promise<void>((resolve, reject) => {
        const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete('currentState');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    // Clear background music asset
    await new Promise<void>((resolve, reject) => {
        const transaction = dbInstance.transaction(ASSET_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(ASSET_STORE_NAME);
        store.delete('backgroundMusic');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};
