import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { sendHttpRequest } from './http-request';
import { buildMetasysUrl, normalizeMetasysBaseUrl } from './metasys-url';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface CliOptions {
  baseUrl: string;
  username: string;
  password: string;
  objectIds: string[];
  pathToIds: string[];
  outDir: string;
  dryRun: boolean;
  overwrite: boolean;
  verbose: boolean;
  loginOnly: boolean;
  insecure: boolean;
}

interface LoginResponse {
  accessToken: string;
  expires: string;
}

interface PathTreeNode {
  id: string;
  parentUrl: string | null;
  networkDeviceUrl: string;
  itemReference: string;
  name: string;
  label: string;
  objectType: string;
  objectTypeVersion: string;
  classification: string;
  items?: PathTreeNode[];
}

interface PathTreeResponse {
  items: PathTreeNode[];
}

interface ObjectSnapshotResponse {
  objectType?: string;
  objectTypeVersion?: string;
  parentUrl?: string | null;
  networkDeviceUrl?: string;
  item?: JsonValue;
  schema?: JsonValue;
  views?: JsonValue;
  effectivePermissions?: JsonValue;
}

interface ObjectTypeSchemaResponse {
  schema?: JsonValue;
  views?: JsonValue;
}

interface ObjectViewsResponse {
  items?: JsonValue;
}

interface ObjectAttributesResponse {
  item?: JsonValue;
  schema?: JsonValue;
}

interface ObjectCommandsResponse {
  items?: JsonValue;
}

type SupportedChildTypesResponse = JsonValue;

interface ObjectSeedManifest {
  version: number;
  objects: ObjectSeedManifestEntry[];
}

interface ObjectSeedManifestEntry {
  directory: string;
  objectFile?: string;
  metaFile?: string;
}

interface ObjectSeedMeta {
  id: string;
  parentId: string | null;
  networkDeviceId: string;
  classification: string;
  name: string;
  label: string;
  itemReference: string;
  objectType: string;
  objectTypeVersion: string;
}

interface ObjectCaptureArtifacts {
  snapshot: ObjectSnapshotResponse;
  viewsResponse: ObjectViewsResponse | null;
  commandsResponse: ObjectCommandsResponse | null;
  supportedChildTypes: SupportedChildTypesResponse | null;
  objectTypeSchema: ObjectTypeSchemaResponse | null;
}

const ACCEPT_HEADER = 'application/vnd.metasysapi.v6+json';
const USER_AGENT = 'API-Client';
const DEFAULT_BASE_URL = 'https://desktop-vm/api/v6';
const MAX_BODY_EXCERPT_LENGTH = 400;

const REDACTED_KEYS = new Set(['password', 'accessToken', 'refreshToken', 'token', 'authorization']);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly method: string,
    readonly url: string,
    readonly responseBody: string
  ) {
    super(
      `Request failed (${status} ${statusText}) for ${method} ${url}${responseBody ? `: ${responseBody}` : ''}`
    );
    this.name = 'HttpError';
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function printUsage(): void {
  process.stdout.write(`Usage:
  npm run mock-api:refresh -- --object <id> [--object <id> ...] [options]
  npm run mock-api:refresh -- --pathTo <id> [--pathTo <id> ...] [options]
  npm run mock-api:refresh -- --login-only [options]

Options:
  --object <id>        Capture a specific object by ID (repeatable)
  --pathTo <id>        Capture every object along the path to the target ID (repeatable)
  --base-url <url>     Override METASYS_BASE_URL
  --username <name>    Override METASYS_USERNAME
  --password <value>   Override METASYS_PASSWORD
  --out-dir <path>     Override the output snapshot directory
  --dry-run            Fetch and report changes without writing files
  --overwrite          Replace existing snapshot files
  --verbose            Log request/response details with secrets redacted
  --login-only         Authenticate and exit without exporting snapshots
  --insecure           Disable TLS certificate verification for dev debugging only
  --help               Show this help

Environment:
  METASYS_BASE_URL     Defaults to https://desktop-vm/api/v6
  METASYS_USERNAME     Required unless provided via --username
  METASYS_PASSWORD     Required unless provided via --password
  MOCK_SEED_DIR        Optional override for references/mock-seed
  METASYS_INSECURE_TLS Set to 1/true/yes/on to match --insecure
`);
}

function ensureValue(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: normalizeMetasysBaseUrl(process.env.METASYS_BASE_URL ?? DEFAULT_BASE_URL),
    username: process.env.METASYS_USERNAME ?? '',
    password: process.env.METASYS_PASSWORD ?? '',
    objectIds: [],
    pathToIds: [],
    outDir: process.env.MOCK_SEED_DIR ?? path.join(config.referencesRoot, 'mock-seed'),
    dryRun: false,
    overwrite: false,
    verbose: false,
    loginOnly: false,
    insecure: parseBooleanEnv(process.env.METASYS_INSECURE_TLS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--object':
        options.objectIds.push(ensureValue(argv[++index], 'Missing value for --object'));
        break;
      case '--pathTo':
        options.pathToIds.push(ensureValue(argv[++index], 'Missing value for --pathTo'));
        break;
      case '--base-url':
          options.baseUrl = normalizeMetasysBaseUrl(ensureValue(argv[++index], 'Missing value for --base-url'));
        break;
      case '--username':
        options.username = ensureValue(argv[++index], 'Missing value for --username');
        break;
      case '--password':
        options.password = ensureValue(argv[++index], 'Missing value for --password');
        break;
      case '--out-dir':
        options.outDir = ensureValue(argv[++index], 'Missing value for --out-dir');
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--overwrite':
        options.overwrite = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--login-only':
        options.loginOnly = true;
        break;
      case '--insecure':
        options.insecure = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.loginOnly && options.objectIds.length === 0 && options.pathToIds.length === 0) {
    throw new Error('Provide at least one --object or --pathTo selector.');
  }

  options.username = ensureValue(options.username, 'Missing METASYS_USERNAME or --username');
  options.password = ensureValue(options.password, 'Missing METASYS_PASSWORD or --password');
  return options;
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function lastSegment(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(/[^/]+$/);
  return match ? match[0] : null;
}

function asObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function stripQueryString(value: string): string {
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

function extractSchemaIdFromUrl(url: string, schemaKind: 'enums' | 'objectTypes'): string | null {
  const marker = `/schemas/${schemaKind}/`;
  const normalized = stripQueryString(url);
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const schemaId = normalized.slice(markerIndex + marker.length);
  return schemaId.length > 0 ? decodeURIComponent(schemaId) : null;
}

function collectEnumSchemaRefs(value: JsonValue, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEnumSchemaRefs(entry, ids));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    if (key === '$ref' && typeof child === 'string') {
      const enumId = extractSchemaIdFromUrl(child, 'enums');
      if (enumId) {
        ids.add(enumId);
      }
      return;
    }

    collectEnumSchemaRefs(child, ids);
  });
}

function verboseLog(options: CliOptions, message: string): void {
  if (options.verbose) {
    process.stderr.write(`[verbose] ${message}\n`);
  }
}

function redactJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        REDACTED_KEYS.has(key) ? '[redacted]' : redactJsonValue(nestedValue),
      ])
    );
  }
  return value;
}

function redactBody(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as JsonValue;
    return JSON.stringify(redactJsonValue(parsed));
  } catch {
    return body;
  }
}

function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const entries = new Headers(headers).entries();
  return Object.fromEntries(
    Array.from(entries, ([key, value]) => [key, key.toLowerCase() === 'authorization' ? '[redacted]' : value])
  );
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_EXCERPT_LENGTH);
}

function formatNetworkError(url: string, method: string, error: unknown): string {
  const cause = error instanceof Error ? error : new Error(String(error));
  const lowerMessage = cause.message.toLowerCase();
  const tlsHint =
    lowerMessage.includes('self-signed') ||
      lowerMessage.includes('certificate') ||
      lowerMessage.includes('hostname') ||
      lowerMessage.includes('tls')
      ? ' If this is a development certificate issue, retry with --insecure.'
      : '';

  return `Network request failed for ${method} ${url}: ${cause.message}.${tlsHint}`;
}

function flattenPathNodes(nodes: PathTreeNode[]): PathTreeNode[] {
  const result: PathTreeNode[] = [];
  const visit = (node: PathTreeNode): void => {
    result.push(node);
    for (const child of node.items ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }
  return result;
}

async function fetchJson<T>(options: CliOptions, url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  verboseLog(options, `-> ${method} ${url}`);

  if (options.verbose) {
    const headers = redactHeaders(init?.headers);
    const body = redactBody(init?.body);
    verboseLog(options, `headers: ${JSON.stringify(headers)}`);
    if (body) {
      verboseLog(options, `body: ${body}`);
    }
  }

  let responseText = '';
  let responseStatus = 0;
  let responseStatusText = '';
  try {
    const response = await sendHttpRequest(url, {
      method,
      headers: init?.headers as Record<string, string> | undefined,
      body: typeof init?.body === 'string' ? init.body : undefined,
      rejectUnauthorized: !options.insecure,
    });
    responseText = response.body;
    responseStatus = response.status;
    responseStatusText = response.statusText;
  } catch (error) {
    throw new Error(formatNetworkError(url, method, error));
  }

  verboseLog(options, `<- ${responseStatus} ${responseStatusText} ${method} ${url}`);

  if (responseStatus < 200 || responseStatus >= 300) {
    const bodyExcerpt = excerpt(responseText);
    if (bodyExcerpt) {
      verboseLog(options, `response body: ${bodyExcerpt}`);
    }
    throw new HttpError(responseStatus, responseStatusText, method, url, bodyExcerpt);
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

async function login(options: CliOptions): Promise<LoginResponse> {
  const payload = {
    username: options.username,
    password: options.password,
  };

  const response = await fetchJson<LoginResponse>(options, buildMetasysUrl(options.baseUrl, '/login'), {
    method: 'POST',
    headers: {
      Accept: ACCEPT_HEADER,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  return response;
}

async function apiGet<T>(options: CliOptions, token: string, relativePath: string): Promise<T> {
  return fetchJson<T>(options, buildMetasysUrl(options.baseUrl, relativePath), {
    headers: {
      Accept: ACCEPT_HEADER,
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });
}

async function tryApiGet<T>(options: CliOptions, token: string, relativePath: string, context: string): Promise<T | null> {
  try {
    return await apiGet<T>(options, token, relativePath);
  } catch (error) {
    if (error instanceof HttpError) {
      verboseLog(options, `${context} failed with ${error.status} ${error.statusText}; continuing with reduced snapshot data`);
      return null;
    }
    throw error;
  }
}

function buildMinimalSchema(node: PathTreeNode): JsonObject {
  return {
    type: 'object',
    title: node.label,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      label: { type: 'string' },
      itemReference: { type: 'string' },
      objectType: { type: 'string' },
      objectTypeVersion: { type: 'string' },
      classification: { type: 'string' },
    },
  };
}

function buildMinimalViews(): JsonObject[] {
  return [{ id: 'viewNameEnumSet.focusView' }];
}

function buildSnapshotFromPathNode(
  node: PathTreeNode,
  attributes: ObjectAttributesResponse | null,
  objectTypeSchema: ObjectTypeSchemaResponse | null,
  viewsResponse: ObjectViewsResponse | null
): ObjectSnapshotResponse {
  const viewItems = asArray(viewsResponse?.items);
  const schemaViews = asArray(objectTypeSchema?.views);

  return {
    objectType: node.objectType,
    objectTypeVersion: node.objectTypeVersion,
    parentUrl: node.parentUrl,
    networkDeviceUrl: node.networkDeviceUrl,
    item: {
      id: node.id,
      name: node.name,
      label: node.label,
      itemReference: node.itemReference,
      objectType: node.objectType,
      objectTypeVersion: node.objectTypeVersion,
      classification: node.classification,
    },
    schema:
      attributes?.schema && typeof attributes.schema === 'object' && !Array.isArray(attributes.schema)
        ? (attributes.schema as JsonObject)
        : objectTypeSchema?.schema && typeof objectTypeSchema.schema === 'object' && !Array.isArray(objectTypeSchema.schema)
          ? (objectTypeSchema.schema as JsonObject)
          : buildMinimalSchema(node),
    views:
      viewItems.length > 0
        ? viewItems
        : schemaViews.length > 0
          ? schemaViews
          : buildMinimalViews(),
    effectivePermissions: {},
  };
}

async function fetchObjectArtifacts(options: CliOptions, token: string, node: PathTreeNode): Promise<ObjectCaptureArtifacts> {
  const objectId = node.id;
  const commandsResponse = await tryApiGet<ObjectCommandsResponse>(
    options,
    token,
    `/objects/${encodeURIComponent(objectId)}/commands`,
    `GET /objects/${objectId}/commands`
  );
  const supportedChildTypes = await tryApiGet<SupportedChildTypesResponse>(
    options,
    token,
    `/objects/${encodeURIComponent(objectId)}/supportedChildTypes`,
    `GET /objects/${objectId}/supportedChildTypes`
  );
  const viewsResponse = await tryApiGet<ObjectViewsResponse>(
    options,
    token,
    `/objects/${encodeURIComponent(objectId)}/views`,
    `GET /objects/${objectId}/views`
  );

  try {
    const snapshot = await apiGet<ObjectSnapshotResponse>(options, token, `/objects/${encodeURIComponent(objectId)}?includeSchema=true`);
    const parentId = lastSegment(snapshot.parentUrl ?? node.parentUrl);
    const objectType =
      typeof snapshot.objectType === 'string'
        ? snapshot.objectType
        : typeof asObject(snapshot.item).objectType === 'string'
          ? (asObject(snapshot.item).objectType as string)
          : node.objectType;
    const objectTypeSchema = parentId
      ? await tryApiGet<ObjectTypeSchemaResponse>(
          options,
          token,
          `/schemas/objectTypes/${encodeURIComponent(objectType)}?parentId=${encodeURIComponent(parentId)}`,
          `GET /schemas/objectTypes/${objectType}?parentId=${parentId}`
        )
      : null;

    return {
      snapshot,
      viewsResponse,
      commandsResponse,
      supportedChildTypes,
      objectTypeSchema,
    };
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw error;
    }

    verboseLog(
      options,
      `includeSchema=true failed for ${objectId} with ${error.status} ${error.statusText}; retrying without schema and fetching object type schema separately`
    );

    const snapshot = await tryApiGet<ObjectSnapshotResponse>(
      options,
      token,
      `/objects/${encodeURIComponent(objectId)}`,
      `GET /objects/${objectId}`
    );
    if (snapshot) {
      const objectType =
        typeof snapshot.objectType === 'string'
          ? snapshot.objectType
          : typeof asObject(snapshot.item).objectType === 'string'
            ? (asObject(snapshot.item).objectType as string)
            : node.objectType;
      const parentId = lastSegment(snapshot.parentUrl ?? node.parentUrl);
      const objectTypeSchema = parentId
        ? await tryApiGet<ObjectTypeSchemaResponse>(
            options,
            token,
            `/schemas/objectTypes/${encodeURIComponent(objectType)}?parentId=${encodeURIComponent(parentId)}`,
            `GET /schemas/objectTypes/${objectType}?parentId=${parentId}`
          )
        : null;

      return {
        snapshot: {
          ...snapshot,
          schema: objectTypeSchema?.schema ?? snapshot.schema,
          views: extractItemsArray(viewsResponse?.items).length > 0 ? extractItemsArray(viewsResponse?.items) : objectTypeSchema?.views ?? snapshot.views,
        },
        viewsResponse,
        commandsResponse,
        supportedChildTypes,
        objectTypeSchema,
      };
    }

    const parentId = lastSegment(node.parentUrl);
    const attributes = await tryApiGet<ObjectAttributesResponse>(
      options,
      token,
      `/objects/${encodeURIComponent(objectId)}/attributes`,
      `GET /objects/${objectId}/attributes`
    );
    const objectTypeSchema = parentId
      ? await tryApiGet<ObjectTypeSchemaResponse>(
          options,
          token,
          `/schemas/objectTypes/${encodeURIComponent(node.objectType)}?parentId=${encodeURIComponent(parentId)}`,
          `GET /schemas/objectTypes/${node.objectType}?parentId=${parentId}`
        )
      : null;

    verboseLog(options, `Falling back to synthesized snapshot data for ${objectId}`);
    return {
      snapshot: buildSnapshotFromPathNode(node, attributes, objectTypeSchema, viewsResponse),
      viewsResponse,
      commandsResponse,
      supportedChildTypes,
      objectTypeSchema,
    };
  }
}

async function fetchPathNodesForTarget(options: CliOptions, token: string, targetId: string): Promise<PathTreeNode[]> {
  const response = await apiGet<PathTreeResponse>(options, token, `/objects?pathTo=${encodeURIComponent(targetId)}`);
  return flattenPathNodes(response.items ?? []);
}

function buildMeta(node: PathTreeNode, snapshot: ObjectSnapshotResponse): ObjectSeedMeta {
  const item = asObject(snapshot.item);
  return {
    id: node.id,
    parentId: lastSegment(snapshot.parentUrl ?? node.parentUrl),
    networkDeviceId: ensureValue(
      lastSegment(snapshot.networkDeviceUrl ?? node.networkDeviceUrl) ?? undefined,
      `Unable to resolve network device ID for ${node.id}`
    ),
    classification: node.classification,
    name: typeof item.name === 'string' ? item.name : node.name,
    label: typeof item.label === 'string' ? item.label : node.label,
    itemReference: typeof item.itemReference === 'string' ? item.itemReference : node.itemReference,
    objectType:
      typeof snapshot.objectType === 'string'
        ? snapshot.objectType
        : ensureValue(typeof item.objectType === 'string' ? item.objectType : undefined, `Missing objectType for ${node.id}`),
    objectTypeVersion:
      typeof snapshot.objectTypeVersion === 'string' ? snapshot.objectTypeVersion : node.objectTypeVersion,
  };
}

function extractItemsArray(value: JsonValue | null | undefined): JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object' && Array.isArray((value as { items?: JsonValue }).items)) {
    return ((value as { items?: JsonValue }).items as JsonValue[]) ?? [];
  }

  return [];
}

function readManifest(manifestPath: string): ObjectSeedManifest {
  if (!fileExists(manifestPath)) {
    return { version: 1, objects: [] };
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ObjectSeedManifest;
}

function ensureManifestEntry(manifest: ObjectSeedManifest, objectId: string): void {
  const directory = `objects/${objectId}`;
  const existing = manifest.objects.find((entry) => entry.directory === directory);
  if (!existing) {
    manifest.objects.push({ directory });
  }
  manifest.objects.sort((a, b) => a.directory.localeCompare(b.directory));
}

function writeJsonFile(filePath: string, data: unknown, overwrite: boolean): 'written' | 'skipped' {
  if (!overwrite && fileExists(filePath)) {
    return 'skipped';
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return 'written';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    verboseLog(options, 'TLS certificate verification disabled for this process.');
  }

  const loginResponse = await login(options);
  process.stdout.write(`Authenticated successfully against ${options.baseUrl} as ${options.username}.\n`);
  process.stdout.write(`Token expires at ${loginResponse.expires}.\n`);

  if (options.loginOnly) {
    return;
  }

  const token = loginResponse.accessToken;
  const outDir = path.resolve(options.outDir);
  const referencesDataDir = path.resolve(__dirname, '..', '..', 'references', 'data');
  const objectTypeSchemaDir = path.join(referencesDataDir, 'object-type-schemas');
  const enumSchemaDir = path.join(referencesDataDir, 'enums');
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = readManifest(manifestPath);

  const selectedIds = new Set<string>(options.objectIds);
  const pathNodeCache = new Map<string, PathTreeNode>();

  for (const targetId of options.pathToIds) {
    const pathNodes = await fetchPathNodesForTarget(options, token, targetId);
    for (const node of pathNodes) {
      pathNodeCache.set(node.id, node);
      selectedIds.add(node.id);
    }
  }

  for (const objectId of options.objectIds) {
    if (!pathNodeCache.has(objectId)) {
      const pathNodes = await fetchPathNodesForTarget(options, token, objectId);
      for (const node of pathNodes) {
        pathNodeCache.set(node.id, node);
      }
    }
  }

  if (selectedIds.size === 0) {
    throw new Error('No objects resolved for export.');
  }

  const objectIds = [...selectedIds].sort();
  const fetchedEnumIds = new Set<string>();
  process.stdout.write(`Authenticated successfully. Preparing ${objectIds.length} object snapshot(s).\n`);

  for (const objectId of objectIds) {
    const pathNode = pathNodeCache.get(objectId);
    if (!pathNode) {
      throw new Error(`Unable to resolve tree metadata for ${objectId}`);
    }

    const artifacts = await fetchObjectArtifacts(options, token, pathNode);
    const snapshot = artifacts.snapshot;
    const meta = buildMeta(pathNode, snapshot);
    const directory = path.join(outDir, 'objects', objectId);
    const objectFilePath = path.join(directory, 'object.json');
    const metaFilePath = path.join(directory, 'meta.json');
    const commandsFilePath = path.join(directory, 'commands.json');
    const supportedChildTypesFilePath = path.join(directory, 'supported-child-types.json');
    const viewsFilePath = path.join(directory, 'views.json');
    const effectiveViewsPayload = artifacts.viewsResponse ?? (Array.isArray(snapshot.views) ? { items: snapshot.views } : null);
    const objectTypeSchema = artifacts.objectTypeSchema;
    const objectTypeSchemaFilePath = path.join(objectTypeSchemaDir, `${meta.objectType}.json`);

    if (options.dryRun) {
      process.stdout.write(`[dry-run] would write ${objectFilePath}\n`);
      process.stdout.write(`[dry-run] would write ${metaFilePath}\n`);
      if (artifacts.commandsResponse) {
        process.stdout.write(`[dry-run] would write ${commandsFilePath}\n`);
      }
      if (artifacts.supportedChildTypes) {
        process.stdout.write(`[dry-run] would write ${supportedChildTypesFilePath}\n`);
      }
      if (effectiveViewsPayload) {
        process.stdout.write(`[dry-run] would write ${viewsFilePath}\n`);
      }
      if (objectTypeSchema) {
        process.stdout.write(`[dry-run] would write ${objectTypeSchemaFilePath}\n`);
      }
      process.stdout.write(`[dry-run] would ensure manifest entry objects/${objectId}\n`);
    } else {
      const objectStatus = writeJsonFile(objectFilePath, snapshot, options.overwrite);
      const metaStatus = writeJsonFile(metaFilePath, meta, options.overwrite);
      const commandsStatus = artifacts.commandsResponse
        ? writeJsonFile(commandsFilePath, artifacts.commandsResponse, options.overwrite)
        : 'missing';
      const supportedChildTypesStatus = artifacts.supportedChildTypes
        ? writeJsonFile(supportedChildTypesFilePath, artifacts.supportedChildTypes, options.overwrite)
        : 'missing';
      const viewsStatus = effectiveViewsPayload ? writeJsonFile(viewsFilePath, effectiveViewsPayload, options.overwrite) : 'missing';
      const objectTypeSchemaStatus = objectTypeSchema
        ? writeJsonFile(objectTypeSchemaFilePath, objectTypeSchema, options.overwrite)
        : 'missing';
      ensureManifestEntry(manifest, objectId);

      process.stdout.write(
        `${objectId}: object=${objectStatus}, meta=${metaStatus}, views=${viewsStatus}, commands=${commandsStatus}, supportedChildTypes=${supportedChildTypesStatus}, objectTypeSchema=${objectTypeSchemaStatus}\n`
      );
    }

    const enumIds = new Set<string>();
    if (snapshot.schema) {
      collectEnumSchemaRefs(snapshot.schema, enumIds);
    }
    if (objectTypeSchema?.schema) {
      collectEnumSchemaRefs(objectTypeSchema.schema, enumIds);
    }

    for (const enumId of [...enumIds].sort()) {
      if (fetchedEnumIds.has(enumId)) {
        continue;
      }

      fetchedEnumIds.add(enumId);
      const enumSchema = await tryApiGet<JsonValue>(
        options,
        token,
        `/schemas/enums/${encodeURIComponent(enumId)}`,
        `GET /schemas/enums/${enumId}`
      );
      if (!enumSchema) {
        continue;
      }

      const enumFilePath = path.join(enumSchemaDir, `${enumId}.json`);
      if (options.dryRun) {
        process.stdout.write(`[dry-run] would write ${enumFilePath}\n`);
        continue;
      }

      const enumStatus = writeJsonFile(enumFilePath, enumSchema, options.overwrite);
      process.stdout.write(`  enum ${enumId}: ${enumStatus}\n`);
    }
  }

  if (options.dryRun) {
    process.stdout.write(`[dry-run] would write ${manifestPath}\n`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Updated manifest at ${manifestPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
