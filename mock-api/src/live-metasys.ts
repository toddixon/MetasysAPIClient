import { buildMetasysUrl, normalizeMetasysBaseUrl } from './metasys-url';
import { sendHttpRequest } from './http-request';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface LoginResponse {
  accessToken?: string;
}

const ACCEPT_HEADER = 'application/vnd.metasysapi.v6+json';
const USER_AGENT = 'API-Client';
const DEFAULT_BASE_URL = 'https://desktop-vm/api/v6';

export class LiveMetasysHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly method: string,
    readonly url: string,
    readonly responseBody: string
  ) {
    super(`Live Metasys request failed (${status} ${statusText}) for ${method} ${url}`);
    this.name = 'LiveMetasysHttpError';
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getConfiguredBaseUrl(): string {
  return normalizeMetasysBaseUrl(process.env.METASYS_BASE_URL ?? DEFAULT_BASE_URL);
}

function getConfiguredUsername(): string {
  return process.env.METASYS_USERNAME ?? '';
}

function getConfiguredPassword(): string {
  return process.env.METASYS_PASSWORD ?? '';
}

function getExistingToken(): string | null {
  const token = process.env.METASYS_TOKEN;
  return token && token.length > 0 ? token : null;
}

function setExistingToken(token: string): void {
  process.env.METASYS_TOKEN = token;
}

function clearExistingToken(): void {
  delete process.env.METASYS_TOKEN;
}

function ensureTlsMode(): void {
  if (parseBooleanEnv(process.env.METASYS_INSECURE_TLS)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

function ensureLiveConfiguration(): void {
  if (!getConfiguredBaseUrl() || !getConfiguredUsername() || !getConfiguredPassword()) {
    throw new Error(
      'Live Metasys fallback requires METASYS_BASE_URL, METASYS_USERNAME, and METASYS_PASSWORD to be configured.'
    );
  }
}

async function readJsonResponse<T>(url: string, init: RequestInit): Promise<T> {
  const method = init.method ?? 'GET';
  let responseText = '';
  let status = 0;
  let statusText = '';

  try {
    const response = await sendHttpRequest(url, {
      method,
      headers: init.headers as Record<string, string> | undefined,
      body: typeof init.body === 'string' ? init.body : undefined,
      rejectUnauthorized: !parseBooleanEnv(process.env.METASYS_INSECURE_TLS),
    });
    responseText = response.body;
    status = response.status;
    statusText = response.statusText;
  } catch (error) {
    throw new Error(
      `Live Metasys request failed for ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (status < 200 || status >= 300) {
    throw new LiveMetasysHttpError(status, statusText, method, url, responseText);
  }

  if (!responseText.trim()) {
    throw new Error(`Expected JSON response body for ${method} ${url}, but received an empty response.`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON response for ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readTextResponse(url: string, init: RequestInit): Promise<string> {
  const method = init.method ?? 'GET';
  let responseText = '';
  let status = 0;
  let statusText = '';

  try {
    const response = await sendHttpRequest(url, {
      method,
      headers: init.headers as Record<string, string> | undefined,
      body: typeof init.body === 'string' ? init.body : undefined,
      rejectUnauthorized: !parseBooleanEnv(process.env.METASYS_INSECURE_TLS),
    });
    responseText = response.body;
    status = response.status;
    statusText = response.statusText;
  } catch (error) {
    throw new Error(
      `Live Metasys request failed for ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (status < 200 || status >= 300) {
    throw new LiveMetasysHttpError(status, statusText, method, url, responseText);
  }

  return responseText;
}

export function isLiveMetasysConfigured(): boolean {
  return Boolean(getConfiguredBaseUrl() && getConfiguredUsername() && getConfiguredPassword());
}

export async function loginToLiveMetasys(forceRefresh = false): Promise<string> {
  ensureTlsMode();
  ensureLiveConfiguration();

  if (!forceRefresh) {
    const existingToken = getExistingToken();
    if (existingToken) {
      return existingToken;
    }
  }

  const response = await readJsonResponse<LoginResponse>(buildMetasysUrl(getConfiguredBaseUrl(), '/login'), {
    method: 'POST',
    headers: {
      Accept: ACCEPT_HEADER,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      username: getConfiguredUsername(),
      password: getConfiguredPassword(),
    }),
  });

  if (!response.accessToken || response.accessToken.length === 0) {
    throw new Error('Live Metasys login response did not include an access token.');
  }

  setExistingToken(response.accessToken);
  return response.accessToken;
}

export async function fetchLiveMetasysJson<T>(relativePath: string): Promise<T> {
  ensureTlsMode();
  ensureLiveConfiguration();

  const url = buildMetasysUrl(getConfiguredBaseUrl(), relativePath);

  const performRequest = async (token: string): Promise<T> =>
    readJsonResponse<T>(url, {
      headers: {
        Accept: ACCEPT_HEADER,
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });

  let token = await loginToLiveMetasys();
  try {
    return await performRequest(token);
  } catch (error) {
    if (!(error instanceof LiveMetasysHttpError) || error.status !== 401) {
      throw error;
    }

    clearExistingToken();
    token = await loginToLiveMetasys(true);
    return performRequest(token);
  }
}

export async function fetchLiveMetasysText(relativePath: string): Promise<string> {
  ensureTlsMode();
  ensureLiveConfiguration();

  const url = buildMetasysUrl(getConfiguredBaseUrl(), relativePath);

  const performRequest = async (token: string): Promise<string> =>
    readTextResponse(url, {
      headers: {
        Accept: ACCEPT_HEADER,
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });

  let token = await loginToLiveMetasys();
  try {
    return await performRequest(token);
  } catch (error) {
    if (!(error instanceof LiveMetasysHttpError) || error.status !== 401) {
      throw error;
    }

    clearExistingToken();
    token = await loginToLiveMetasys(true);
    return performRequest(token);
  }
}

export function clearLiveMetasysToken(): void {
  clearExistingToken();
}

export type { JsonValue };
