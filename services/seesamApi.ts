import Constants from 'expo-constants';

const DEFAULT_SEESAM_API_BASE_URL = 'http://83.146.237.189:8000';

type ExpoExtra = {
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

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

function getApiBaseUrl() {
  const baseUrl = extra.seesamApiBaseUrl?.trim() || DEFAULT_SEESAM_API_BASE_URL;

  return baseUrl.replace(/\/+$/, '');
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
  const requestUrl = getApiBaseUrl() + '/status';

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      throw new Error(
        ('Seesam status request failed with ' + response.status + ' ' + response.statusText + '. ' + errorBody).trim(),
      );
    }

    const payload: unknown = await response.json();

    return {
      serverStatus: readServerStatus(payload),
      details: pickServerStatusDetails(payload),
    };
  } catch (error) {
    console.error('Seesam status error:', error);
    throw error;
  }
}

export async function getSpeechAudio(text: string): Promise<SpeechAudioResponse> {
  const requestUrl = getApiBaseUrl() + "/speak";

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Accept: "audio/wav",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      throw new Error(
        ("Seesam speak request failed with " + response.status + " " + response.statusText + ". " + errorBody).trim(),
      );
    }

    return {
      audio: await response.arrayBuffer(),
    };
  } catch (error) {
    console.error("Seesam /speak request failed:", requestUrl, error);
    throw error;
  }
}

export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const requestUrl = `${getApiBaseUrl()}/chat`;

  console.log('Seesam API request:', requestUrl);

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      throw new Error(
        `Seesam API request failed with ${response.status} ${response.statusText}. ${errorBody}`.trim(),
      );
    }

    const payload: unknown = await response.json();

    return {
      answer: readAnswer(payload),
    };
  } catch (error) {
    console.error('Seesam API error:', error);
    throw error;
  }
}
