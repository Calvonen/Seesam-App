import Constants from 'expo-constants';

const DEFAULT_PUBLIC_API_BASE_URL = 'http://192.168.68.74:8000';
const API_BASE_URL_PROBE_TIMEOUT_MS = 2500;
const API_BASE_URL_PROBE_PATH = '/dashboard';


type ExpoExtra = {
  lanApiBaseUrl?: string;
  publicApiBaseUrl?: string;
  tailscaleApiBaseUrl?: string;
  seesamApiBaseUrl?: string;
};

export type ChatResponse = {
  answer: string;
};

export type ServerStatusResponse = {
  serverStatus: string;
  details: Record<string, unknown>;
};

export type DashboardItemState = 'ok' | 'warning' | 'error' | 'offline' | 'unknown';

export type DashboardResponse = {
  hub?: {
    status?: string;
    hostname?: string;
    time?: string;
    uptime_seconds?: number | null;
  };
  worker?: {
    host?: string;
    online?: boolean;
    last_used_at?: string | null;
    idle_timeout_seconds?: number | null;
    idle?: boolean;
    seconds_since_last_used?: number | null;
  };
  system?: {
    disk_usage_percent?: number | null;
    memory_usage_percent?: number | null;
    load_average?: {
      '1m'?: number;
      '5m'?: number;
      '15m'?: number;
    };
  };
  services?: {
    seesam_hub?: string;
    tailscale?: string;
  };
  updates?: {
    apt_updates_available_count?: number | null;
    apt_packages?: string[];
    firmware_updates_available?: boolean;
    firmware_updates_available_count?: number | null;
    firmware_summaries?: string[];
  };
};

export type SpeechAudioResponse = {
  audio: ArrayBuffer;
};

export type TranscribeResponse = {
  text: string;
};

export type SeesamRequestStep = 'transcribe' | 'chat' | 'speak' | 'status' | 'intent';

export class SeesamRequestError extends Error {
  originalError: unknown;
  requestUrl: string;
  step: SeesamRequestStep;

  constructor(step: SeesamRequestStep, requestUrl: string, originalError: unknown) {
    super(getErrorMessage(originalError));
    this.name = 'SeesamRequestError';
    this.originalError = originalError;
    this.requestUrl = requestUrl;
    this.step = step;
  }
}

class SeesamHttpResponseError extends Error {}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function wrapRequestError(step: SeesamRequestStep, requestUrl: string, error: unknown) {
  if (error instanceof SeesamRequestError) {
    return error;
  }

  return new SeesamRequestError(step, requestUrl, error);
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
let cachedApiBaseUrl: string | null = null;
let pendingApiBaseUrlResolution: Promise<string> | null = null;

function normalizeApiBaseUrl(baseUrl: string | undefined) {
  const trimmedBaseUrl = baseUrl?.trim();

  if (!trimmedBaseUrl || trimmedBaseUrl.includes('<')) {
    return null;
  }

  return trimmedBaseUrl.replace(/\/+$/, '');
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function getApiBaseUrls(preferredBaseUrl?: string | null) {
  const lanBaseUrl = normalizeApiBaseUrl(extra.lanApiBaseUrl);
  const publicBaseUrls = [
    normalizeApiBaseUrl(extra.publicApiBaseUrl),
    normalizeApiBaseUrl(extra.tailscaleApiBaseUrl),
    normalizeApiBaseUrl(extra.seesamApiBaseUrl),
    DEFAULT_PUBLIC_API_BASE_URL,
  ].filter((baseUrl): baseUrl is string => Boolean(baseUrl));
  const apiBaseUrls = lanBaseUrl ? [lanBaseUrl, ...publicBaseUrls] : publicBaseUrls;
  const preferredApiBaseUrl = normalizeApiBaseUrl(preferredBaseUrl ?? undefined);

  return uniqueValues(preferredApiBaseUrl ? [preferredApiBaseUrl, ...apiBaseUrls] : apiBaseUrls);
}

function buildRequestUrl(baseUrl: string, path: string) {
  return baseUrl + path;
}

async function fetchWithTimeout(requestUrl: string, requestInit: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(requestUrl, {
      ...requestInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeApiBaseUrl(baseUrl: string) {
  const requestUrl = buildRequestUrl(baseUrl, API_BASE_URL_PROBE_PATH);
  const response = await fetchWithTimeout(
    requestUrl,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
    API_BASE_URL_PROBE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    throw new SeesamHttpResponseError(
      ('Seesam dashboard probe failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
    );
  }
}

async function resolveApiBaseUrl(ignoredBaseUrls: string[] = []) {
  const ignoredBaseUrlSet = new Set(ignoredBaseUrls);

  if (ignoredBaseUrlSet.size === 0 && cachedApiBaseUrl) {
    return cachedApiBaseUrl;
  }

  if (ignoredBaseUrlSet.size === 0 && pendingApiBaseUrlResolution) {
    return pendingApiBaseUrlResolution;
  }

  const resolution = (async () => {
    const apiBaseUrls = getApiBaseUrls(cachedApiBaseUrl).filter((baseUrl) => !ignoredBaseUrlSet.has(baseUrl));
    let lastRequestUrl = buildRequestUrl(apiBaseUrls[0] ?? DEFAULT_PUBLIC_API_BASE_URL, API_BASE_URL_PROBE_PATH);
    let lastError: unknown = new Error('No Seesam API base URLs are configured.');

    for (const baseUrl of apiBaseUrls) {
      const requestUrl = buildRequestUrl(baseUrl, API_BASE_URL_PROBE_PATH);
      lastRequestUrl = requestUrl;

      try {
        await probeApiBaseUrl(baseUrl);
        cachedApiBaseUrl = baseUrl;
        return baseUrl;
      } catch (error) {
        lastError = error;
      }
    }

    throw wrapRequestError('status', lastRequestUrl, lastError);
  })();

  if (ignoredBaseUrlSet.size === 0) {
    pendingApiBaseUrlResolution = resolution;
    resolution.then(
      () => {
        if (pendingApiBaseUrlResolution === resolution) {
          pendingApiBaseUrlResolution = null;
        }
      },
      () => {
        if (pendingApiBaseUrlResolution === resolution) {
          pendingApiBaseUrlResolution = null;
        }
      },
    );
  }

  return resolution;
}

async function sendSeesamRequest(
  baseUrl: string,
  path: string,
  requestInit: () => RequestInit,
  buildHttpError: (response: Response, errorBody: string) => string,
) {
  const requestUrl = buildRequestUrl(baseUrl, path);
  const response = await fetch(requestUrl, requestInit());

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    throw new SeesamHttpResponseError(buildHttpError(response, errorBody));
  }

  return response;
}

async function fetchFromSeesamApi(
  step: SeesamRequestStep,
  path: string,
  requestInit: () => RequestInit,
  buildHttpError: (response: Response, errorBody: string) => string,
) {
  const baseUrl = await resolveApiBaseUrl();
  const requestUrl = buildRequestUrl(baseUrl, path);

  try {
    return await sendSeesamRequest(baseUrl, path, requestInit, buildHttpError);
  } catch (error) {
    if (error instanceof SeesamHttpResponseError) {
      throw wrapRequestError(step, requestUrl, error);
    }

    if (cachedApiBaseUrl === baseUrl) {
      cachedApiBaseUrl = null;
    }

    try {
      const fallbackBaseUrl = await resolveApiBaseUrl([baseUrl]);
      return await sendSeesamRequest(fallbackBaseUrl, path, requestInit, buildHttpError);
    } catch (fallbackError) {
      throw wrapRequestError(step, requestUrl, fallbackError);
    }
  }
}

function readAnswer(payload: unknown) {
  if (
    payload &&
    typeof payload === 'object' &&
    'answer' in payload &&
    typeof payload.answer === 'string'
  ) {
    return payload.answer;
  }

  throw new Error('Seesam API response did not include an answer.');
}

function readTranscription(payload: unknown) {
  if (
    payload &&
    typeof payload === 'object' &&
    'text' in payload &&
    typeof payload.text === 'string'
  ) {
    return payload.text;
  }

  throw new Error('Seesam API response did not include transcribed text.');
}

function isSensorKey(key: string) {
  const normalizedKey = key.toLowerCase();

  return normalizedKey.includes('sensor');
}

function omitSensorDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitSensorDetails);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const details: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, nestedValue]) => {
    if (!isSensorKey(key)) {
      details[key] = omitSensorDetails(nestedValue);
    }
  });

  return details;
}

function pickServerStatusDetails(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return omitSensorDetails(payload) as Record<string, unknown>;
}

function readServerStatus(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return 'Online';
  }

  const statusPayload = payload as Record<string, unknown>;
  const serverValue =
    statusPayload.server_online ??
    statusPayload.serverOnline ??
    statusPayload.server_status ??
    statusPayload.serverStatus ??
    statusPayload.api;

  if (typeof serverValue === 'boolean') {
    return serverValue ? 'Online' : 'Offline';
  }

  if (typeof serverValue === 'string') {
    const normalizedValue = serverValue.toLowerCase();

    if (['false', 'offline', 'down', 'error', 'failed', 'stopped'].includes(normalizedValue)) {
      return 'Offline';
    }

    if (['available', 'ok', 'online', 'running', 'true', 'up'].includes(normalizedValue)) {
      return 'Online';
    }
  }

  return 'Online';
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function stripTrailingSentencePunctuation(value: string) {
  let strippedValue = value.trim();

  while (
    strippedValue.endsWith('.') ||
    strippedValue.endsWith('!') ||
    strippedValue.endsWith('?')
  ) {
    strippedValue = strippedValue.slice(0, -1).trim();
  }

  return strippedValue;
}

function normalizeCommandText(value: string) {
  return stripTrailingSentencePunctuation(normalizeWhitespace(value)).toLocaleLowerCase('fi-FI');
}

function normalizeLatestMemoryDeleteCommand(message: string) {
  const text = normalizeCommandText(message);
  const deleteLatestPhrases = [
    'poista viimeisin muisto',
    'poista viimeisin muistosi',
    'poista viimeinen muisto',
    'poista edellinen muisto',
    'poista uusin muisto',
    'unohda viimeisin muisto',
    'unohda viimeisin muistosi',
    'unohda viimeinen muisto',
    'unohda edellinen muisto',
    'peru viimeisin muisto',
    'peru viimeisin muistosi',
    'peru viimeisin tallennus',
    'peru viimeksi tallennettu muisto',
    'kumoa viimeisin muisto',
    'kumoa viimeisin tallennus',
    'unohda mitä viimeksi muistit',
  ];

  if (deleteLatestPhrases.some((phrase) => text.includes(phrase))) {
    return 'poista viimeisin muisto';
  }

  return null;
}

function removeProfileCommandPrefix(value: string) {
  const lowerValue = value.toLocaleLowerCase('fi-FI');
  const prefixes = [
    'muista että ',
    'muista ',
    'tallenna että ',
    'tallenna muistiin ',
    'tallenna ',
    'kirjaa että ',
    'kirjaa muistiin ',
    'kirjaa ',
  ];

  for (const prefix of prefixes) {
    if (lowerValue.startsWith(prefix)) {
      return value.slice(prefix.length).trim();
    }
  }

  return value;
}

function trimMatchingQuotes(value: string) {
  let trimmedValue = value.trim();
  const quoteCharacters = ['"', "'", '“', '”', '‘', '’'];

  while (trimmedValue.length > 0 && quoteCharacters.includes(trimmedValue[0])) {
    trimmedValue = trimmedValue.slice(1).trim();
  }

  while (
    trimmedValue.length > 0 &&
    quoteCharacters.includes(trimmedValue[trimmedValue.length - 1])
  ) {
    trimmedValue = trimmedValue.slice(0, -1).trim();
  }

  return trimmedValue;
}

function cleanProfileName(rawName: string) {
  const cleanedName = trimMatchingQuotes(stripTrailingSentencePunctuation(normalizeWhitespace(rawName)));
  const lowerName = cleanedName.toLocaleLowerCase('fi-FI');
  const blockedJoiners = [' mutta ', ' koska ', ' joten ', ' ja '];

  if (
    cleanedName.length < 2 ||
    cleanedName.length > 60 ||
    cleanedName.includes('?') ||
    cleanedName.includes('/') ||
    cleanedName.includes(':') ||
    cleanedName.includes(';') ||
    blockedJoiners.some((joiner) => lowerName.includes(joiner))
  ) {
    return null;
  }

  return cleanedName;
}

function extractProfileName(message: string) {
  const normalizedMessage = stripTrailingSentencePunctuation(normalizeWhitespace(message));
  const profileText = removeProfileCommandPrefix(normalizedMessage);
  const lowerProfileText = profileText.toLocaleLowerCase('fi-FI');
  const namePrefixes = [
    'minun nimeni on ',
    'mun nimeni on ',
    'nimeni on ',
    'minä olen nimeltä ',
    'mä olen nimeltä ',
    'olen nimeltä ',
    'minua kutsutaan ',
    'mua kutsutaan ',
    'minua voi kutsua ',
    'mua voi kutsua ',
    'minä olen ',
    'mä olen ',
  ];

  for (const prefix of namePrefixes) {
    if (lowerProfileText.startsWith(prefix)) {
      return cleanProfileName(profileText.slice(prefix.length));
    }
  }

  return null;
}

function normalizeUserNameProfile(message: string) {
  const profileName = extractProfileName(message);

  if (profileName) {
    return 'Käyttäjäprofiili: Käyttäjän nimi on ' + profileName + '.';
  }

  return null;
}

function normalizeChatMessageForSeesam(message: string) {
  const normalizedMessage = normalizeWhitespace(message);

  return (
    normalizeLatestMemoryDeleteCommand(normalizedMessage) ??
    normalizeUserNameProfile(normalizedMessage) ??
    normalizedMessage
  );
}

async function readErrorBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function getServerStatus(): Promise<ServerStatusResponse> {
  const response = await fetchFromSeesamApi(
    'status',
    '/health',
    () => ({
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    }),
    (response, errorBody) =>
      ('Seesam status request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
  const payload: unknown = await response.json();

  return {
    serverStatus: readServerStatus(payload),
    details: pickServerStatusDetails(payload),
  };
}

export async function getDashboard(): Promise<DashboardResponse> {
  const response = await fetchFromSeesamApi(
    'status',
    '/dashboard',
    () => ({
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    }),
    (response, errorBody) =>
      ('Seesam dashboard request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );

  return response.json();
}

export async function wakeWorker(): Promise<void> {
  await fetchFromSeesamApi(
    'status',
    '/worker/wake',
    () => ({
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    }),
    (response, errorBody) =>
      ('Worker wake request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
}

export async function shutdownWorker(): Promise<void> {
  await fetchFromSeesamApi(
    'status',
    '/worker/shutdown',
    () => ({
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    }),
    (response, errorBody) =>
      ('Worker shutdown request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
}

export async function getSpeechAudio(text: string): Promise<SpeechAudioResponse> {
  const response = await fetchFromSeesamApi(
    'speak',
    '/speak',
    () => {
      return {
        method: 'POST',
        headers: {
          Accept: 'audio/wav',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      };
    },
    (response, errorBody) =>
      ('Seesam speak request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );

  return {
    audio: await response.arrayBuffer(),
  };
}

export async function transcribeAudio(audioUri: string): Promise<TranscribeResponse> {
  const response = await fetchFromSeesamApi(
    'transcribe',
    '/transcribe',
    () => {
      const formData = new FormData();

      formData.append('file', {
        uri: audioUri,
        name: 'seesam-recording.m4a',
        type: 'audio/m4a',
      } as unknown as Blob);

      return {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      };
    },
    (response, errorBody) =>
      ('Seesam transcribe request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
  const payload: unknown = await response.json();
  const transcribedText = readTranscription(payload);

  return {
    text: transcribedText,
  };
}

async function sendIntent(text: string): Promise<void> {
  await fetchFromSeesamApi(
    'intent',
    '/intent',
    () => ({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    }),
    (response, errorBody) =>
      ('Seesam intent request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
}

export async function startWorker(): Promise<void> {
  await sendIntent('käynnistä worker');
}

export async function stopWorker(): Promise<void> {
  await sendIntent('sammuta worker');
}

export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const response = await fetchFromSeesamApi(
    'chat',
    '/chat',
    () => {
      const normalizedMessage = normalizeChatMessageForSeesam(message);
      return {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: normalizedMessage }),
      };
    },
    (response, errorBody) =>
      ('Seesam API request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
  );
  const payload: unknown = await response.json();
  const answer = readAnswer(payload);

  return {
    answer,
  };
}
