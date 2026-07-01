import Constants from 'expo-constants';

const DEFAULT_PUBLIC_API_BASE_URL = 'http://83.146.233.178:8000';

function devLog(...messages: unknown[]) {
  if (__DEV__) {
    console.log(...messages);
  }
}

type ExpoExtra = {
  lanApiBaseUrl?: string;
  publicApiBaseUrl?: string;
  seesamApiBaseUrl?: string;
};

export type ChatResponse = {
  answer: string;
};

export type ServerStatusResponse = {
  serverStatus: string;
  details: Record<string, unknown>;
};

export type SpeechAudioResponse = {
  audio: ArrayBuffer;
};

export type TranscribeResponse = {
  text: string;
};

export type SeesamRequestStep = 'transcribe' | 'chat' | 'speak' | 'status';

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

function normalizeApiBaseUrl(baseUrl: string | undefined) {
  const trimmedBaseUrl = baseUrl?.trim();

  if (!trimmedBaseUrl || trimmedBaseUrl.includes('<')) {
    return null;
  }

  return trimmedBaseUrl.replace(/\/+$/, '');
}

function getApiBaseUrls() {
  const lanBaseUrl = normalizeApiBaseUrl(extra.lanApiBaseUrl);
  const publicBaseUrl =
    normalizeApiBaseUrl(extra.publicApiBaseUrl) ??
    normalizeApiBaseUrl(extra.seesamApiBaseUrl) ??
    DEFAULT_PUBLIC_API_BASE_URL;
  const apiBaseUrls = lanBaseUrl ? [lanBaseUrl, publicBaseUrl] : [publicBaseUrl];

  return Array.from(new Set(apiBaseUrls));
}

function buildRequestUrl(baseUrl: string, path: string) {
  return baseUrl + path;
}

async function fetchFromSeesamApi(
  step: SeesamRequestStep,
  path: string,
  requestInit: () => RequestInit,
  buildHttpError: (response: Response, errorBody: string) => string,
) {
  const apiBaseUrls = getApiBaseUrls();
  let lastRequestUrl = buildRequestUrl(apiBaseUrls[0], path);

  for (const [index, baseUrl] of apiBaseUrls.entries()) {
    const requestUrl = buildRequestUrl(baseUrl, path);
    lastRequestUrl = requestUrl;

    try {
      devLog('Seesam API URL used:', requestUrl);
      const response = await fetch(requestUrl, requestInit());

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw new Error(buildHttpError(response, errorBody));
      }

      return response;
    } catch (error) {
      const hasFallbackUrl = index < apiBaseUrls.length - 1;

      if (hasFallbackUrl) {
        continue;
      }

      throw wrapRequestError(step, lastRequestUrl, error);
    }
  }

  throw wrapRequestError(step, lastRequestUrl, new Error('Seesam API request failed.'));
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
    return 'Tuntematon';
  }

  const statusPayload = payload as Record<string, unknown>;
  const serverValue =
    statusPayload.server_status ??
    statusPayload.serverStatus ??
    statusPayload.status ??
    statusPayload.state ??
    statusPayload.health;

  if (typeof serverValue === 'string') {
    return serverValue;
  }

  if (typeof serverValue === 'boolean') {
    return serverValue ? 'Online' : 'Offline';
  }

  if (typeof serverValue === 'number') {
    return String(serverValue);
  }

  return 'Saatavilla';
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
    '/status',
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

export async function getSpeechAudio(text: string): Promise<SpeechAudioResponse> {
  const response = await fetchFromSeesamApi(
    'speak',
    '/speak',
    () => ({
      method: 'POST',
      headers: {
        Accept: 'audio/wav',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    }),
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

  return {
    text: readTranscription(payload),
  };
}

export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const response = await fetchFromSeesamApi(
    'chat',
    '/chat',
    () => ({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    }),
    (response, errorBody) =>
      `Seesam API request failed with ${response.status} ${response.statusText}. ${errorBody}`.trim(),
  );
  const payload: unknown = await response.json();

  return {
    answer: readAnswer(payload),
  };
}
