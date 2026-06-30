import Constants from 'expo-constants';

const DEFAULT_SEESAM_API_BASE_URL = 'http://83.146.237.189:8000';

type ExpoExtra = {
  seesamApiBaseUrl?: string;
};

export type ChatResponse = {
  answer: string;
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

async function readErrorBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
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
