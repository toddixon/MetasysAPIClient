import fs from 'node:fs';
import path from 'node:path';
import Fastify, { FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { config } from './config';
import { getDb } from './db';
import { fetchLiveMetasysJson, fetchLiveMetasysText, isLiveMetasysConfigured, LiveMetasysHttpError } from './live-metasys';
import { getOpenApiSummary } from './openapi';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface StoredObject {
  id: string;
  parent_id: string | null;
  network_device_id: string;
  object_type: string;
  object_type_version: string;
  classification: string;
  item_reference: string;
  name: string;
  label: string;
  item_json: string;
  views_json: string;
  schema_json: string;
  effective_permissions_json: string;
  commands_json: string;
  supported_child_types_json: string;
}

interface StoredSubscription {
  id: string;
  stream_id: string;
  object_id: string;
  subscription_type: string;
  attributes_json: string;
  created_at: string;
}

interface StoredObjectViewRow {
  object_id: string;
  items_json: string;
}

interface StoredObjectCommandRow {
  object_id: string;
  items_json: string;
}

interface StoredSupportedChildTypeRow {
  object_id: string;
  payload_json: string;
}

interface StoredObjectTypeSchemaRow {
  object_type: string;
  schema_json: string;
  views_json: string;
}

interface StoredEnumSetRow {
  enum_id: string;
  schema_json: string;
}

interface BatchRequestItem {
  id: string;
  relativeUrl: string;
}

interface BatchRequestBody {
  method?: string;
  requests?: BatchRequestItem[];
}

interface StreamConnection {
  reply: FastifyReply;
  heartbeat: NodeJS.Timeout;
}

interface RouteInfo {
  method: string;
  path: string;
  description: string;
}

type DbExplorerTableName =
  | 'objects'
  | 'network_devices'
  | 'spaces'
  | 'users'
  | 'subscriptions'
  | 'streams'
  | 'object_views'
  | 'object_commands'
  | 'supported_child_types'
  | 'object_type_schema'
  | 'enum_sets';

interface DbTableSummary {
  table: DbExplorerTableName;
  count: number;
  description: string;
}

const BASE_URL = `http://localhost:${config.port}${config.apiPrefix}`;
const streamConnections = new Map<string, StreamConnection>();
const routeCatalog: RouteInfo[] = [
  { method: 'GET', path: '/', description: 'Barebones client page with request context and implemented route summary.' },
  { method: 'GET', path: '/health', description: 'Reports service status and loaded OpenAPI metadata.' },
  { method: 'POST', path: '/api/v6/login', description: 'Returns a mock access token for the seeded API user.' },
  { method: 'GET', path: '/api/v6/refreshToken', description: 'Refreshes a mock access token.' },
  { method: 'GET', path: '/api/v6/stream', description: 'Opens the SSE stream and emits hello/heartbeat/object update events.' },
  { method: 'GET', path: '/api/v6/objects', description: 'Returns the root object tree or a path-filtered tree.' },
  { method: 'GET', path: '/api/v6/objects/identifiers?fqr=...', description: 'Resolves a fully-qualified reference to an object ID.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/objects', description: 'Returns a subtree rooted at the requested object.' },
  { method: 'GET', path: '/api/v6/objects/:objectId', description: 'Returns object details, schema, views, and permissions.' },
  { method: 'PATCH', path: '/api/v6/objects/:objectId', description: 'Persists barebones object updates and emits subscription events.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/views', description: 'Lists alternate view IDs for the object from object_views, with live fallback on cache miss.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/attributes', description: 'Returns the object attribute payload and schema.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/attributes/:attributeId', description: 'Returns a single attribute and can create a stream subscription.' },
  { method: 'POST', path: '/api/v6/objects/batch', description: 'Returns synchronous batch attribute reads and can create a batch subscription.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/commands', description: 'Returns object commands from object_commands, with live fallback on cache miss.' },
  { method: 'GET', path: '/api/v6/objects/:objectId/supportedChildTypes', description: 'Returns supported child types from supported_child_types, with live fallback on cache miss.' },
  { method: 'DELETE', path: '/api/v6/objects/streams/:streamId/subscriptions/:subscriptionId', description: 'Deletes an active object subscription.' },
  { method: 'GET', path: '/api/v6/schemas/objectTypes/:objectType', description: 'Returns object type schemas from object_type_schema, with live fallback on cache miss.' },
  { method: 'GET', path: '/api/v6/schemas/enums/:enumId', description: 'Returns enum schemas from enum_sets, with live fallback on cache miss.' },
  { method: 'GET', path: '/api/v6/networkDevices', description: 'Returns seeded network device rows from SQLite.' },
  { method: 'GET', path: '/api/v6/spaces', description: 'Returns seeded space rows from SQLite.' },
  { method: 'GET', path: '/_mock/db/tables', description: 'Lists allowlisted SQLite tables with row counts for the mock DB explorer.' },
  { method: 'GET', path: '/_mock/db/tables/:table', description: 'Returns a capped row preview for an allowlisted SQLite table.' },
];

const DB_EXPLORER_TABLES: Record<DbExplorerTableName, string> = {
  objects: 'Core object rows used to build the UI tree and detail views.',
  network_devices: 'Seeded network device rows and payloads.',
  spaces: 'Seeded space rows and payloads.',
  users: 'Mock login users.',
  subscriptions: 'Active attribute and batch subscriptions.',
  streams: 'Open or persisted stream IDs.',
  object_views: 'Table-backed object view payloads captured from snapshots or live fallback.',
  object_commands: 'Table-backed object command payloads captured from snapshots or live fallback.',
  supported_child_types: 'Table-backed supported child type payloads captured from snapshots or live fallback.',
  object_type_schema: 'Table-backed object type schema payloads captured from files or live fallback.',
  enum_sets: 'Table-backed enum schema payloads captured from files or live fallback.',
};

const DB_EXPLORER_TABLE_NAMES = Object.keys(DB_EXPLORER_TABLES) as DbExplorerTableName[];
const DEFAULT_DB_ROW_LIMIT = 20;
const MAX_DB_ROW_LIMIT = 50;
const MOCK_SEED_OBJECTS_DIR = path.join(config.referencesRoot, 'mock-seed', 'objects');
const ENUM_SETS_DIR = path.join(config.referencesDataDir, 'enums');
const OBJECT_TYPE_SCHEMA_DIR = path.join(config.referencesDataDir, 'object-type-schemas');

const db = getDb();
const app = Fastify({ logger: true });

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function extractItemsArray(value: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object' && Array.isArray((value as { items?: JsonValue }).items)) {
    return ((value as { items?: JsonValue }).items as JsonValue[]) ?? [];
  }

  return [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createAcceptHeaders(reply: FastifyReply): void {
  reply.header('Content-Type', 'application/vnd.metasysapi.v6+json');
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function deleteFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function isSyncOnReadEnabled(): boolean {
  return config.liveSyncOnRead && isLiveMetasysConfigured();
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asJsonObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function lastSegment(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(/[^/]+$/);
  return match ? match[0] : null;
}

function buildObjectSeedMeta(row: StoredObject): JsonObject {
  return {
    id: row.id,
    parentId: row.parent_id,
    networkDeviceId: row.network_device_id,
    classification: row.classification,
    name: row.name,
    label: row.label,
    itemReference: row.item_reference,
    objectType: row.object_type,
    objectTypeVersion: row.object_type_version,
  };
}

function buildSeedSnapshotFromRow(row: StoredObject): JsonObject {
  return {
    objectType: row.object_type,
    objectTypeVersion: row.object_type_version,
    parentUrl: row.parent_id ? `https://mock.local/api/v6/objects/${row.parent_id}` : null,
    networkDeviceUrl: `https://mock.local/api/v6/networkDevices/${row.network_device_id}`,
    item: parseJson<JsonObject>(row.item_json),
    schema: parseJson<JsonObject>(row.schema_json),
    views: parseJson<JsonValue[]>(row.views_json),
    effectivePermissions: parseJson<JsonObject>(row.effective_permissions_json),
  };
}

function ensureManifestEntry(objectId: string): void {
  const manifestPath = path.join(config.referencesRoot, 'mock-seed', 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: number; objects?: Array<{ directory: string }> })
    : { version: 1, objects: [] as Array<{ directory: string }> };
  const objects = Array.isArray(manifest.objects) ? manifest.objects : [];
  const directory = `objects/${objectId}`;
  if (!objects.some((entry) => entry.directory === directory)) {
    objects.push({ directory });
    objects.sort((left, right) => left.directory.localeCompare(right.directory));
    writeJsonFile(manifestPath, { version: manifest.version ?? 1, objects });
  }
}

function writeObjectSeedFilesFromRow(row: StoredObject): void {
  const objectDir = path.join(MOCK_SEED_OBJECTS_DIR, row.id);
  ensureManifestEntry(row.id);
  writeJsonFile(path.join(objectDir, 'object.json'), buildSeedSnapshotFromRow(row));
  writeJsonFile(path.join(objectDir, 'meta.json'), buildObjectSeedMeta(row));
}

function buildDefaultItem(objectId: string, currentRow?: StoredObject): JsonObject {
  const currentItem = currentRow ? parseJson<JsonObject>(currentRow.item_json) : {};
  return {
    ...currentItem,
    id: currentItem.id ?? objectId,
  };
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) {
    return DEFAULT_DB_ROW_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DB_ROW_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_DB_ROW_LIMIT);
}

function isDbExplorerTableName(value: string): value is DbExplorerTableName {
  return DB_EXPLORER_TABLE_NAMES.includes(value as DbExplorerTableName);
}

function getDbTableSummaries(): DbTableSummary[] {
  return DB_EXPLORER_TABLE_NAMES.map((table) => ({
    table,
    count: (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    description: DB_EXPLORER_TABLES[table],
  }));
}

function getDbTableRows(table: DbExplorerTableName, query: Record<string, unknown>, limit: number): JsonObject[] {
  switch (table) {
    case 'objects': {
      const id = typeof query.id === 'string' && query.id.length > 0 ? query.id : null;
      const parentId = typeof query.parentId === 'string' && query.parentId.length > 0 ? query.parentId : null;

      let rows: StoredObject[];
      if (id) {
        rows = db.prepare('SELECT * FROM objects WHERE id = ? ORDER BY name LIMIT ?').all(id, limit) as StoredObject[];
      } else if (parentId) {
        rows = db.prepare('SELECT * FROM objects WHERE parent_id = ? ORDER BY name LIMIT ?').all(parentId, limit) as StoredObject[];
      } else {
        rows = db.prepare('SELECT * FROM objects ORDER BY name LIMIT ?').all(limit) as StoredObject[];
      }

      return rows.map((row) => {
        const item = parseJson<JsonObject>(row.item_json);
        return {
          id: row.id,
          parent_id: row.parent_id,
          network_device_id: row.network_device_id,
          object_type: row.object_type,
          object_type_version: row.object_type_version,
          classification: row.classification,
          item_reference: row.item_reference,
          name: row.name,
          label: row.label,
          item,
          view_count: parseJson<JsonObject[]>(row.views_json).length,
        };
      });
    }
    case 'network_devices': {
      const rows = db.prepare('SELECT * FROM network_devices ORDER BY name LIMIT ?').all(limit) as Array<{
        id: string;
        parent_id: string | null;
        classification: string;
        item_reference: string;
        name: string;
        payload_json: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        parent_id: row.parent_id,
        classification: row.classification,
        item_reference: row.item_reference,
        name: row.name,
        payload: parseJson<JsonObject>(row.payload_json),
      }));
    }
    case 'spaces': {
      const rows = db.prepare('SELECT * FROM spaces ORDER BY name LIMIT ?').all(limit) as Array<{
        id: string;
        parent_id: string | null;
        name: string;
        item_reference: string;
        type: string;
        payload_json: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        parent_id: row.parent_id,
        name: row.name,
        item_reference: row.item_reference,
        type: row.type,
        payload: parseJson<JsonObject>(row.payload_json),
      }));
    }
    case 'users': {
      const rows = db.prepare('SELECT username, display_name FROM users ORDER BY username LIMIT ?').all(limit) as Array<{
        username: string;
        display_name: string;
      }>;

      return rows.map((row) => ({
        username: row.username,
        display_name: row.display_name,
      }));
    }
    case 'subscriptions': {
      const objectId = typeof query.objectId === 'string' && query.objectId.length > 0 ? query.objectId : null;
      const rows = objectId
        ? (db
            .prepare('SELECT * FROM subscriptions WHERE object_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(objectId, limit) as StoredSubscription[])
        : (db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT ?').all(limit) as StoredSubscription[]);

      return rows.map((row) => ({
        id: row.id,
        stream_id: row.stream_id,
        object_id: row.object_id,
        subscription_type: row.subscription_type,
        attributes: parseJson<JsonValue[]>(row.attributes_json),
        created_at: row.created_at,
      }));
    }
    case 'streams': {
      const rows = db.prepare('SELECT id, created_at FROM streams ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{
        id: string;
        created_at: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
      }));
    }
    case 'object_views': {
      const objectId = typeof query.objectId === 'string' && query.objectId.length > 0 ? query.objectId : null;
      const rows = objectId
        ? (db.prepare('SELECT * FROM object_views WHERE object_id = ? LIMIT ?').all(objectId, limit) as StoredObjectViewRow[])
        : (db.prepare('SELECT * FROM object_views ORDER BY object_id LIMIT ?').all(limit) as StoredObjectViewRow[]);

      return rows.map((row) => ({
        object_id: row.object_id,
        items: parseJson<JsonValue[]>(row.items_json),
      }));
    }
    case 'object_commands': {
      const objectId = typeof query.objectId === 'string' && query.objectId.length > 0 ? query.objectId : null;
      const rows = objectId
        ? (db.prepare('SELECT * FROM object_commands WHERE object_id = ? LIMIT ?').all(objectId, limit) as StoredObjectCommandRow[])
        : (db.prepare('SELECT * FROM object_commands ORDER BY object_id LIMIT ?').all(limit) as StoredObjectCommandRow[]);

      return rows.map((row) => ({
        object_id: row.object_id,
        items: parseJson<JsonValue[]>(row.items_json),
      }));
    }
    case 'supported_child_types': {
      const objectId = typeof query.objectId === 'string' && query.objectId.length > 0 ? query.objectId : null;
      const rows = objectId
        ? (db
            .prepare('SELECT * FROM supported_child_types WHERE object_id = ? LIMIT ?')
            .all(objectId, limit) as StoredSupportedChildTypeRow[])
        : (db.prepare('SELECT * FROM supported_child_types ORDER BY object_id LIMIT ?').all(limit) as StoredSupportedChildTypeRow[]);

      return rows.map((row) => ({
        object_id: row.object_id,
        payload: parseJson<JsonValue[]>(row.payload_json),
      }));
    }
    case 'object_type_schema': {
      const rows = db
        .prepare('SELECT * FROM object_type_schema ORDER BY object_type LIMIT ?')
        .all(limit) as StoredObjectTypeSchemaRow[];

      return rows.map((row) => ({
        object_type: row.object_type,
        schema: parseJson<JsonObject>(row.schema_json),
        views: parseJson<JsonValue[]>(row.views_json),
      }));
    }
    case 'enum_sets': {
      const rows = db.prepare('SELECT * FROM enum_sets ORDER BY enum_id LIMIT ?').all(limit) as StoredEnumSetRow[];

      return rows.map((row) => ({
        enum_id: row.enum_id,
        schema: parseJson<JsonObject>(row.schema_json),
      }));
    }
  }
}

function getObjectRow(objectId: string): StoredObject | undefined {
  return db.prepare('SELECT * FROM objects WHERE id = ?').get(objectId) as StoredObject | undefined;
}

function getObjectChildren(parentId: string): StoredObject[] {
  return db.prepare('SELECT * FROM objects WHERE parent_id = ? ORDER BY name').all(parentId) as StoredObject[];
}

function getRootObjects(): StoredObject[] {
  return db.prepare('SELECT * FROM objects WHERE parent_id IS NULL ORDER BY name').all() as StoredObject[];
}

function upsertObjectRow(row: StoredObject): void {
  db.prepare(`
    INSERT OR REPLACE INTO objects (
      id, parent_id, network_device_id, object_type, object_type_version, classification, item_reference, name, label,
      item_json, views_json, schema_json, effective_permissions_json, commands_json, supported_child_types_json
    ) VALUES (
      @id, @parent_id, @network_device_id, @object_type, @object_type_version, @classification, @item_reference, @name, @label,
      @item_json, @views_json, @schema_json, @effective_permissions_json, @commands_json, @supported_child_types_json
    )
  `).run(row);
}

function buildStoredObjectRow(objectId: string, payload: JsonObject, currentRow?: StoredObject): StoredObject {
  const currentItem = currentRow ? parseJson<JsonObject>(currentRow.item_json) : {};
  const payloadItem = asJsonObject(payload.item);
  const item: JsonObject = {
    ...currentItem,
    ...payloadItem,
  };
  item.id = asString(item.id) ?? objectId;

  const objectType = asString(payload.objectType) ?? asString(item.objectType) ?? currentRow?.object_type ?? 'objectTypeEnumSet.unknown';
  item.objectType = objectType;

  const name = asString(item.name) ?? currentRow?.name ?? objectId;
  const label = asString(item.label) ?? currentRow?.label ?? name;
  const itemReference = asString(item.itemReference) ?? currentRow?.item_reference ?? objectId;
  const classification =
    asString(payload.classification) ?? asString(item.classification) ?? currentRow?.classification ?? 'object';
  const objectTypeVersion =
    asString(payload.objectTypeVersion) ?? asString(item.objectTypeVersion) ?? currentRow?.object_type_version ?? '1.0';
  const schema = Object.keys(asJsonObject(payload.schema)).length > 0
    ? asJsonObject(payload.schema)
    : currentRow
      ? parseJson<JsonObject>(currentRow.schema_json)
      : {};
  const views = Array.isArray(payload.views)
    ? (payload.views as JsonValue[])
    : currentRow
      ? parseJson<JsonValue[]>(currentRow.views_json)
      : [];
  const effectivePermissions = Object.keys(asJsonObject(payload.effectivePermissions)).length > 0
    ? asJsonObject(payload.effectivePermissions)
    : currentRow
      ? parseJson<JsonObject>(currentRow.effective_permissions_json)
      : {};
  const commands = currentRow ? parseJson<JsonValue[]>(currentRow.commands_json) : [];
  const supportedChildTypes = currentRow ? parseJson<JsonValue[]>(currentRow.supported_child_types_json) : [];

  return {
    id: objectId,
    parent_id: lastSegment(asString(payload.parentUrl)) ?? currentRow?.parent_id ?? null,
    network_device_id: lastSegment(asString(payload.networkDeviceUrl)) ?? currentRow?.network_device_id ?? objectId,
    object_type: objectType,
    object_type_version: objectTypeVersion,
    classification,
    item_reference: itemReference,
    name,
    label,
    item_json: JSON.stringify(item),
    views_json: JSON.stringify(views),
    schema_json: JSON.stringify(schema),
    effective_permissions_json: JSON.stringify(effectivePermissions),
    commands_json: JSON.stringify(commands),
    supported_child_types_json: JSON.stringify(supportedChildTypes),
  };
}

function buildObjectLinks(row: StoredObject): JsonObject {
  return {
    self: `${BASE_URL}/objects/${row.id}`,
    parentUrl: row.parent_id ? `${BASE_URL}/objects/${row.parent_id}` : null,
    networkDeviceUrl: `${BASE_URL}/networkDevices/${row.network_device_id}`,
    pointsUrl: `${BASE_URL}/objects/${row.id}/points`,
    objectsUrl: `${BASE_URL}/objects/${row.id}/objects`,
    alarmsUrl: `${BASE_URL}/objects/${row.id}/alarms`,
    auditsUrl: `${BASE_URL}/objects/${row.id}/audits`,
    trendedAttributesUrl: `${BASE_URL}/objects/${row.id}/trendedAttributes`,
  };
}

function buildTreeNode(row: StoredObject, depth: number): JsonObject {
  const nextDepth = depth < 0 ? -1 : depth - 1;
  const children = depth === 0 ? [] : getObjectChildren(row.id).map((child) => buildTreeNode(child, nextDepth));
  console.log(`Building tree node for object ${row.id} at depth ${depth} with ${children.length} children`);
  return {
    ...buildObjectLinks(row),
    itemReference: row.item_reference,
    hasChildrenMatchingQuery: getObjectChildren(row.id).length > 0,
    name: row.name,
    label: row.label,
    id: row.id,
    objectType: row.object_type,
    objectTypeVersion: row.object_type_version,
    classification: row.classification,
    // expanded: children.length > 0,
    items: children,
  };
}

function buildPathTree(targetId: string): JsonObject[] {
  const chain: StoredObject[] = [];
  let current = getObjectRow(targetId);

  while (current) {
    chain.unshift(current);
    current = current.parent_id ? getObjectRow(current.parent_id) : undefined;
  }

  if (chain.length === 0) {
    return [];
  }

  let nested: JsonObject | null = null;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const row = chain[index];
    const node = buildTreeNode(row, 0);
    node.items = nested ? [nested] : [];
    node.hasChildrenMatchingQuery = (node.items as JsonValue[]).length > 0 || getObjectChildren(row.id).length > 0;
    nested = node;
  }

  return nested ? [nested] : [];
}

function getObjectResponse(row: StoredObject): JsonObject {
  const item = parseJson<JsonObject>(row.item_json);
  return {
    ...buildObjectLinks(row),
    objectType: row.object_type,
    objectTypeVersion: row.object_type_version,
    item,
    schema: parseJson<JsonObject>(row.schema_json),
    views: parseJson<JsonObject[]>(row.views_json),
    effectivePermissions: parseJson<JsonObject>(row.effective_permissions_json),
    condition: {},
  };
}

function getObjectAttributesPayload(row: StoredObject): JsonObject {
  const item = parseJson<JsonObject>(row.item_json);
  const schema = parseJson<JsonObject>(row.schema_json);
  return {
    item,
    schema,
  };
}

function getObjectAttributePayload(row: StoredObject, attributeId: string): JsonObject {
  const item = parseJson<JsonObject>(row.item_json);
  const schema = parseJson<JsonObject>(row.schema_json);
  const propertySchema =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? (schema.properties as JsonObject)[attributeId]
      : undefined;

  return {
    item: {
      [attributeId]: item[attributeId] ?? null,
      id: item.id ?? row.id,
      itemReference: item.itemReference ?? row.item_reference,
    },
    schema: {
      type: 'object',
      properties: {
        [attributeId]: propertySchema ?? { type: typeof item[attributeId] === 'number' ? 'number' : 'string' },
      },
    },
    condition: {},
  };
}

function persistSyncedObjectResponse(objectId: string, payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  const row = buildStoredObjectRow(objectId, payloadObject, getObjectRow(objectId));
  upsertObjectRow(row);

  if (Array.isArray(payloadObject.views)) {
    db.prepare('INSERT OR REPLACE INTO object_views (object_id, items_json) VALUES (?, ?)')
      .run(objectId, JSON.stringify(payloadObject.views));
    writeJsonFile(path.join(MOCK_SEED_OBJECTS_DIR, objectId, 'views.json'), payloadObject.views);
  }

  writeObjectSeedFilesFromRow(row);
  return getObjectResponse(getObjectRow(objectId)!);
}

function persistSyncedAttributesPayload(objectId: string, payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  const currentRow = getObjectRow(objectId);
  const currentItem = buildDefaultItem(objectId, currentRow);
  const incomingItem = asJsonObject(payloadObject.item);
  const item = { ...currentItem, ...incomingItem };
  item.id = asString(item.id) ?? objectId;

  const schema = Object.keys(asJsonObject(payloadObject.schema)).length > 0
    ? asJsonObject(payloadObject.schema)
    : currentRow
      ? parseJson<JsonObject>(currentRow.schema_json)
      : {};

  const row: StoredObject = currentRow
    ? {
        ...currentRow,
        name: asString(item.name) ?? currentRow.name,
        label: asString(item.label) ?? currentRow.label,
        item_reference: asString(item.itemReference) ?? currentRow.item_reference,
        object_type: asString(item.objectType) ?? currentRow.object_type,
        item_json: JSON.stringify(item),
        schema_json: JSON.stringify(schema),
      }
    : {
        id: objectId,
        parent_id: null,
        network_device_id: objectId,
        object_type: asString(item.objectType) ?? 'objectTypeEnumSet.unknown',
        object_type_version: '1.0',
        classification: asString(item.classification) ?? 'object',
        item_reference: asString(item.itemReference) ?? objectId,
        name: asString(item.name) ?? objectId,
        label: asString(item.label) ?? asString(item.name) ?? objectId,
        item_json: JSON.stringify(item),
        views_json: JSON.stringify([]),
        schema_json: JSON.stringify(schema),
        effective_permissions_json: JSON.stringify({}),
        commands_json: JSON.stringify([]),
        supported_child_types_json: JSON.stringify([]),
      };

  upsertObjectRow(row);
  writeObjectSeedFilesFromRow(row);
  return getObjectAttributesPayload(getObjectRow(objectId)!);
}

function persistSyncedAttributePayload(objectId: string, attributeId: string, payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  const currentRow = getObjectRow(objectId);
  const currentItem = buildDefaultItem(objectId, currentRow);
  const incomingItem = asJsonObject(payloadObject.item);
  const item = { ...currentItem, ...incomingItem };
  item.id = asString(item.id) ?? objectId;

  const currentSchema = currentRow ? parseJson<JsonObject>(currentRow.schema_json) : {};
  const incomingSchema = asJsonObject(payloadObject.schema);
  const incomingProperties = asJsonObject(incomingSchema.properties);
  const schema: JsonObject = {
    ...currentSchema,
    properties: {
      ...asJsonObject(currentSchema.properties),
      ...incomingProperties,
    },
  };

  const row: StoredObject = currentRow
    ? {
        ...currentRow,
        name: asString(item.name) ?? currentRow.name,
        label: asString(item.label) ?? currentRow.label,
        item_reference: asString(item.itemReference) ?? currentRow.item_reference,
        object_type: asString(item.objectType) ?? currentRow.object_type,
        item_json: JSON.stringify(item),
        schema_json: JSON.stringify(schema),
      }
    : {
        id: objectId,
        parent_id: null,
        network_device_id: objectId,
        object_type: asString(item.objectType) ?? 'objectTypeEnumSet.unknown',
        object_type_version: '1.0',
        classification: asString(item.classification) ?? 'object',
        item_reference: asString(item.itemReference) ?? objectId,
        name: asString(item.name) ?? objectId,
        label: asString(item.label) ?? asString(item.name) ?? objectId,
        item_json: JSON.stringify(item),
        views_json: JSON.stringify([]),
        schema_json: JSON.stringify(schema),
        effective_permissions_json: JSON.stringify({}),
        commands_json: JSON.stringify([]),
        supported_child_types_json: JSON.stringify([]),
      };

  upsertObjectRow(row);
  writeObjectSeedFilesFromRow(row);
  return getObjectAttributePayload(getObjectRow(objectId)!, attributeId);
}

function persistTreeNode(node: JsonObject): void {
  const objectId = asString(node.id);
  if (!objectId) {
    return;
  }

  const currentRow = getObjectRow(objectId);
  const item = buildDefaultItem(objectId, currentRow);
  item.name = asString(node.name) ?? currentRow?.name ?? objectId;
  item.label = asString(node.label) ?? currentRow?.label ?? asString(item.name) ?? objectId;
  item.itemReference = asString(node.itemReference) ?? currentRow?.item_reference ?? objectId;
  item.objectType = asString(node.objectType) ?? currentRow?.object_type ?? 'objectTypeEnumSet.unknown';

  const row: StoredObject = {
    id: objectId,
    parent_id: lastSegment(asString(node.parentUrl)) ?? currentRow?.parent_id ?? null,
    network_device_id: lastSegment(asString(node.networkDeviceUrl)) ?? currentRow?.network_device_id ?? objectId,
    object_type: asString(node.objectType) ?? currentRow?.object_type ?? 'objectTypeEnumSet.unknown',
    object_type_version: asString(node.objectTypeVersion) ?? currentRow?.object_type_version ?? '1.0',
    classification: asString(node.classification) ?? currentRow?.classification ?? 'object',
    item_reference: asString(node.itemReference) ?? currentRow?.item_reference ?? objectId,
    name: asString(node.name) ?? currentRow?.name ?? objectId,
    label: asString(node.label) ?? currentRow?.label ?? asString(node.name) ?? objectId,
    item_json: JSON.stringify(item),
    views_json: currentRow?.views_json ?? JSON.stringify([]),
    schema_json: currentRow?.schema_json ?? JSON.stringify({}),
    effective_permissions_json: currentRow?.effective_permissions_json ?? JSON.stringify({}),
    commands_json: currentRow?.commands_json ?? JSON.stringify([]),
    supported_child_types_json: currentRow?.supported_child_types_json ?? JSON.stringify([]),
  };

  upsertObjectRow(row);

  for (const child of extractItemsArray(node.items)) {
    persistTreeNode(asJsonObject(child));
  }
}

function persistObjectTreePayload(payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  for (const item of extractItemsArray(payloadObject.items)) {
    persistTreeNode(asJsonObject(item));
  }
  return payloadObject;
}

function persistNetworkDevicesPayload(payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  const items = extractItemsArray(payloadObject.items).map((value) => asJsonObject(value));
  const replaceRows = db.transaction(() => {
    db.prepare('DELETE FROM network_devices').run();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO network_devices (id, parent_id, classification, item_reference, name, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const item of items) {
      const id = asString(item.id);
      if (!id) {
        continue;
      }

      const existingObject = getObjectRow(id);
      insert.run(
        id,
        lastSegment(asString(item.parentUrl)),
        existingObject?.classification ?? 'object',
        asString(item.itemReference) ?? id,
        asString(item.name) ?? id,
        JSON.stringify(item)
      );
    }
  });

  replaceRows();
  writeJsonFile(path.join(config.referencesDataDir, 'NetworkDevices.json'), payloadObject);
  return payloadObject;
}

function persistSpacesPayload(payload: JsonValue): JsonObject {
  const payloadObject = asJsonObject(payload);
  const items = extractItemsArray(payloadObject.items).map((value) => asJsonObject(value));
  const replaceRows = db.transaction(() => {
    db.prepare('DELETE FROM spaces').run();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO spaces (id, parent_id, name, item_reference, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const item of items) {
      const id = asString(item.id);
      if (!id) {
        continue;
      }

      insert.run(
        id,
        lastSegment(asString(item.parentUrl)),
        asString(item.name) ?? id,
        asString(item.itemReference) ?? id,
        asString(item.type) ?? 'spaceTypeEnumSet.space',
        JSON.stringify(item)
      );
    }
  });

  replaceRows();
  writeJsonFile(path.join(config.referencesDataDir, 'Spaces.json'), payloadObject);
  return payloadObject;
}

function getObjectViewsRow(objectId: string): StoredObjectViewRow | undefined {
  return db.prepare('SELECT * FROM object_views WHERE object_id = ?').get(objectId) as StoredObjectViewRow | undefined;
}

function getObjectCommandsRow(objectId: string): StoredObjectCommandRow | undefined {
  return db.prepare('SELECT * FROM object_commands WHERE object_id = ?').get(objectId) as StoredObjectCommandRow | undefined;
}

function getSupportedChildTypesRow(objectId: string): StoredSupportedChildTypeRow | undefined {
  return db.prepare('SELECT * FROM supported_child_types WHERE object_id = ?').get(objectId) as StoredSupportedChildTypeRow | undefined;
}

function getObjectTypeSchemaRow(objectType: string): StoredObjectTypeSchemaRow | undefined {
  return db.prepare('SELECT * FROM object_type_schema WHERE object_type = ?').get(objectType) as StoredObjectTypeSchemaRow | undefined;
}

function getEnumSetRow(enumId: string): StoredEnumSetRow | undefined {
  return db.prepare('SELECT * FROM enum_sets WHERE enum_id = ?').get(enumId) as StoredEnumSetRow | undefined;
}

function listViewItemsFromItems(objectId: string, views: JsonValue[]): JsonObject {
  const items = views.map((view) => {
    const viewObject = view && typeof view === 'object' && !Array.isArray(view) ? (view as JsonObject) : {};
    const viewId = typeof viewObject.id === 'string' ? viewObject.id : 'viewNameEnumSet.focusView';
    return {
      id: viewId,
      viewUrl: `${BASE_URL}/objects/${objectId}?viewId=${viewId.split('.').pop() ?? 'focusView'}`,
    };
  });

  return {
    self: `${BASE_URL}/objects/${objectId}/views`,
    items,
  };
}

function persistObjectViews(objectId: string, payload: JsonValue): JsonObject {
  const items = extractItemsArray(payload);
  db.prepare('INSERT OR REPLACE INTO object_views (object_id, items_json) VALUES (?, ?)').run(objectId, JSON.stringify(items));
  db.prepare('UPDATE objects SET views_json = ? WHERE id = ?').run(JSON.stringify(items), objectId);
  writeJsonFile(path.join(MOCK_SEED_OBJECTS_DIR, objectId, 'views.json'), payload);
  const row = getObjectRow(objectId);
  if (row) {
    writeObjectSeedFilesFromRow({
      ...row,
      views_json: JSON.stringify(items),
    });
  }
  return listViewItemsFromItems(objectId, items);
}

function persistObjectCommands(objectId: string, payload: JsonValue): JsonObject {
  const items = extractItemsArray(payload);
  db.prepare('INSERT OR REPLACE INTO object_commands (object_id, items_json) VALUES (?, ?)').run(objectId, JSON.stringify(items));
  db.prepare('UPDATE objects SET commands_json = ? WHERE id = ?').run(JSON.stringify(items), objectId);
  writeJsonFile(path.join(MOCK_SEED_OBJECTS_DIR, objectId, 'commands.json'), payload);
  return {
    self: `${BASE_URL}/objects/${objectId}/commands`,
    items,
  };
}

function persistSupportedChildTypes(objectId: string, payload: JsonValue): JsonValue[] {
  const items = extractItemsArray(payload);
  db.prepare('INSERT OR REPLACE INTO supported_child_types (object_id, payload_json) VALUES (?, ?)').run(objectId, JSON.stringify(items));
  db.prepare('UPDATE objects SET supported_child_types_json = ? WHERE id = ?').run(JSON.stringify(items), objectId);
  writeJsonFile(path.join(MOCK_SEED_OBJECTS_DIR, objectId, 'supported-child-types.json'), items);
  return items;
}

function persistObjectTypeSchema(objectType: string, payload: JsonObject): JsonObject {
  const schema = payload.schema && typeof payload.schema === 'object' && !Array.isArray(payload.schema) ? payload.schema : {};
  const views = extractItemsArray(payload.views);
  db.prepare('INSERT OR REPLACE INTO object_type_schema (object_type, schema_json, views_json) VALUES (?, ?, ?)')
    .run(objectType, JSON.stringify(schema), JSON.stringify(views));
  db.prepare('INSERT OR REPLACE INTO object_type_schemas (id, schema_json, views_json) VALUES (?, ?, ?)')
    .run(objectType, JSON.stringify(schema), JSON.stringify(views));
  writeJsonFile(path.join(OBJECT_TYPE_SCHEMA_DIR, `${objectType}.json`), payload);
  return {
    schema,
    views,
  };
}

function persistEnumSet(enumId: string, payload: JsonObject): JsonObject {
  db.prepare('INSERT OR REPLACE INTO enum_sets (enum_id, schema_json) VALUES (?, ?)').run(enumId, JSON.stringify(payload));
  db.prepare('INSERT OR REPLACE INTO enum_schemas (id, schema_json) VALUES (?, ?)').run(enumId, JSON.stringify(payload));
  writeJsonFile(path.join(ENUM_SETS_DIR, `${enumId}.json`), payload);
  return payload;
}

function listViewItems(row: StoredObject): JsonObject {
  return listViewItemsFromItems(row.id, parseJson<JsonValue[]>(row.views_json));
}

function getLegacyObjectViewsPayload(row: StoredObject | undefined): JsonObject | null {
  return row ? listViewItems(row) : null;
}

function getLegacyObjectCommandsPayload(row: StoredObject | undefined): JsonObject | null {
  if (!row) {
    return null;
  }

  return {
    self: `${BASE_URL}/objects/${row.id}/commands`,
    items: parseJson<JsonValue[]>(row.commands_json),
  };
}

function getLegacySupportedChildTypesPayload(row: StoredObject | undefined): JsonValue[] | null {
  return row ? parseJson<JsonValue[]>(row.supported_child_types_json) : null;
}

function getLegacyObjectTypeSchemaPayload(objectType: string): JsonObject | null {
  const schema = db.prepare('SELECT schema_json, views_json FROM object_type_schemas WHERE id = ?').get(objectType) as
    | { schema_json: string; views_json: string }
    | undefined;

  if (!schema) {
    return null;
  }

  return {
    schema: parseJson<JsonObject>(schema.schema_json),
    views: parseJson<JsonValue[]>(schema.views_json),
  };
}

function getLegacyEnumSetPayload(enumId: string): JsonObject | null {
  const schema = db.prepare('SELECT schema_json FROM enum_schemas WHERE id = ?').get(enumId) as { schema_json: string } | undefined;
  return schema ? parseJson<JsonObject>(schema.schema_json) : null;
}

interface SyncRouteResult<T> {
  handled: boolean;
  notFound: boolean;
  value: T | null;
}

function buildLiveSyncLogPayload(error: unknown, path: string, servedLocalFallback: boolean): Record<string, unknown> {
  if (error instanceof LiveMetasysHttpError) {
    return {
      path,
      liveStatus: error.status,
      liveStatusText: error.statusText,
      servedLocalFallback,
      error: error.message,
      liveResponseBodyExcerpt: error.responseBody.slice(0, 300),
    };
  }

  return {
    path,
    servedLocalFallback,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function syncJsonRoute<T>(
  path: string,
  currentValue: T | null,
  normalize: (payload: JsonValue) => T,
  persist: (payload: JsonValue) => T
): Promise<SyncRouteResult<T>> {
  if (!isSyncOnReadEnabled()) {
    return { handled: false, notFound: false, value: null };
  }

  try {
    const payload = await fetchLiveMetasysJson<JsonValue>(path);
    const normalized = normalize(payload);
    if (currentValue !== null && jsonEqual(currentValue, normalized)) {
      return { handled: true, notFound: false, value: normalized };
    }

    return { handled: true, notFound: false, value: persist(payload) };
  } catch (error) {
    if (error instanceof LiveMetasysHttpError && error.status === 404) {
      return { handled: true, notFound: true, value: null };
    }

    app.log.warn(
      buildLiveSyncLogPayload(error, path, currentValue !== null),
      'Live Metasys sync-on-read request failed'
    );
    return { handled: false, notFound: false, value: null };
  }
}

async function syncTextRoute(path: string, currentValue: string | null): Promise<SyncRouteResult<string>> {
  if (!isSyncOnReadEnabled()) {
    return { handled: false, notFound: false, value: null };
  }

  try {
    const payload = await fetchLiveMetasysText(path);
    return { handled: true, notFound: false, value: payload };
  } catch (error) {
    if (error instanceof LiveMetasysHttpError && error.status === 404) {
      return { handled: true, notFound: true, value: null };
    }

    app.log.warn(
      buildLiveSyncLogPayload(error, path, currentValue !== null),
      'Live Metasys sync-on-read request failed'
    );
    return { handled: false, notFound: false, value: currentValue };
  }
}

function writeSseEvent(reply: FastifyReply, event: string, payload: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
}

function getStreamIdFromHeader(request: FastifyRequest): string | undefined {
  const header = request.headers['metasys-subscribe'] ?? request.headers['METASYS-SUBSCRIBE'.toLowerCase()];
  if (Array.isArray(header)) {
    return header[0];
  }
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

function createSubscription(
  streamId: string,
  objectId: string,
  subscriptionType: 'attribute' | 'batch',
  attributes: string[]
): string {
  const subscriptionId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO subscriptions (id, stream_id, object_id, subscription_type, attributes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(subscriptionId, streamId, objectId, subscriptionType, JSON.stringify(attributes), nowIso());
  return subscriptionId;
}

function emitObjectUpdate(subscriptionId: string, row: StoredObject, attributes: string[]): void {
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as StoredSubscription | undefined;
  if (!subscription) {
    return;
  }

  const connection = streamConnections.get(subscription.stream_id);
  if (!connection) {
    return;
  }

  const item = parseJson<JsonObject>(row.item_json);
  const updateItem = Object.fromEntries(
    attributes.map((attribute) => [attribute, item[attribute] ?? null])
  ) as JsonObject;
  updateItem.id = item.id ?? row.id;
  updateItem.itemReference = item.itemReference ?? row.item_reference;

  writeSseEvent(connection.reply, 'object.values.update', [
    {
      subscriptionId,
      item: updateItem,
      condition: {},
    },
  ]);
}

function emitBatchUpdate(subscriptionId: string, row: StoredObject, attributes: string[]): void {
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as StoredSubscription | undefined;
  if (!subscription) {
    return;
  }

  const connection = streamConnections.get(subscription.stream_id);
  if (!connection) {
    return;
  }

  const item = parseJson<JsonObject>(row.item_json);
  const updates = attributes.map((attribute) => ({
    subscriptionId,
    item: {
      [attribute]: item[attribute] ?? null,
      id: item.id ?? row.id,
      itemReference: item.itemReference ?? row.item_reference,
    },
    condition: {},
  }));

  writeSseEvent(connection.reply, 'object.values.update', updates);
}

function emitUpdatesForObject(objectId: string, changedAttributes: string[]): void {
  const row = getObjectRow(objectId);
  if (!row) {
    return;
  }

  const subscriptions = db
    .prepare('SELECT * FROM subscriptions WHERE object_id = ?')
    .all(objectId) as StoredSubscription[];

  for (const subscription of subscriptions) {
    const attributes = parseJson<string[]>(subscription.attributes_json);
    const relevantAttributes = attributes.filter((attribute) => changedAttributes.includes(attribute));

    if (subscription.subscription_type === 'attribute' && relevantAttributes.length > 0) {
      emitObjectUpdate(subscription.id, row, relevantAttributes.slice(0, 1));
      continue;
    }

    if (subscription.subscription_type === 'batch' && relevantAttributes.length > 0) {
      emitBatchUpdate(subscription.id, row, relevantAttributes);
    }
  }
}

function getRequestedDepth(value: unknown, defaultDepth: number): number {
  if (typeof value !== 'string' || value.length === 0) {
    return defaultDepth;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultDepth;
}

app.get('/health', async (_request, reply) => {
  createAcceptHeaders(reply);
  return {
    status: 'ok',
    liveSyncOnRead: config.liveSyncOnRead,
    openApi: getOpenApiSummary(),
  };
});

app.get('/_mock/db/tables', async (_request, reply) => {
  reply.header('Content-Type', 'application/json; charset=utf-8');
  return {
    tables: getDbTableSummaries(),
    limit: {
      default: DEFAULT_DB_ROW_LIMIT,
      max: MAX_DB_ROW_LIMIT,
    },
  };
});

app.get('/_mock/db/tables/:table', async (request, reply) => {
  reply.header('Content-Type', 'application/json; charset=utf-8');
  const params = request.params as { table: string };
  if (!isDbExplorerTableName(params.table)) {
    reply.code(404);
    return {
      message: 'DB explorer table not found',
      supportedTables: DB_EXPLORER_TABLE_NAMES,
    };
  }

  const query = request.query as Record<string, unknown>;
  const limit = parseLimit(query.limit);
  const rows = getDbTableRows(params.table, query, limit);

  return {
    table: params.table,
    description: DB_EXPLORER_TABLES[params.table],
    totalRows: (db.prepare(`SELECT COUNT(*) AS count FROM ${params.table}`).get() as { count: number }).count,
    returnedRows: rows.length,
    limit,
    filters: {
      id: typeof query.id === 'string' ? query.id : null,
      parentId: typeof query.parentId === 'string' ? query.parentId : null,
      objectId: typeof query.objectId === 'string' ? query.objectId : null,
    },
    rows,
  };
});

app.post(`${config.apiPrefix}/login`, async (request, reply) => {
  createAcceptHeaders(reply);
  const body = (request.body ?? {}) as { username?: string; password?: string };
  const user = body.username
    ? (db.prepare('SELECT * FROM users WHERE username = ?').get(body.username) as { username: string; password: string } | undefined)
    : undefined;

  if (!user || user.password !== body.password) {
    reply.code(401);
    return { message: 'Invalid credentials' };
  }

  return {
    accessToken: `mock-token-${crypto.randomUUID()}`,
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
});

app.get(`${config.apiPrefix}/refreshToken`, async (_request, reply) => {
  createAcceptHeaders(reply);
  return {
    accessToken: `mock-token-${crypto.randomUUID()}`,
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
});

app.get(`${config.apiPrefix}/stream`, async (_request, reply) => {
  const streamId = crypto.randomUUID();
  db.prepare('INSERT OR REPLACE INTO streams (id, created_at) VALUES (?, ?)').run(streamId, nowIso());

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const heartbeat = setInterval(() => {
    writeSseEvent(reply, 'object.values.heartbeat', nowIso());
  }, 15_000);

  streamConnections.set(streamId, { reply, heartbeat });
  writeSseEvent(reply, 'hello', JSON.stringify(streamId));

  reply.raw.on('close', () => {
    const connection = streamConnections.get(streamId);
    if (connection) {
      clearInterval(connection.heartbeat);
      streamConnections.delete(streamId);
    }
  });
});

app.get(`${config.apiPrefix}/objects`, async (request, reply) => {
  createAcceptHeaders(reply);
  const query = request.query as { pathTo?: string; depth?: string };
  const items = query.pathTo ? buildPathTree(query.pathTo) : getRootObjects().map((row) => buildTreeNode(row, getRequestedDepth(query.depth, -1)));
  const ids = items.flatMap((item) => collectIds(item));
  const localPayload = {
    self: `${BASE_URL}/objects`,
    items,
    effectivePermissions: {
      canDelete: ids,
      canView: ids,
      canModify: ids,
    },
  };
  const syncResult = await syncJsonRoute(request.raw.url ?? `${config.apiPrefix}/objects`, localPayload, (payload) => asJsonObject(payload), persistObjectTreePayload);
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  return localPayload;
});

app.get(`${config.apiPrefix}/objects/identifiers`, async (request, reply) => {
  createAcceptHeaders(reply);
  const query = request.query as { fqr?: string };
  if (!query.fqr) {
    reply.code(400);
    return { message: 'Missing fqr query parameter' };
  }

  const row = db.prepare('SELECT id FROM objects WHERE item_reference = ?').get(query.fqr) as { id?: string } | undefined;
  const syncResult = await syncTextRoute(request.raw.url ?? `${config.apiPrefix}/objects/identifiers?fqr=${encodeURIComponent(query.fqr)}`, row?.id ?? null);
  if (syncResult.handled && syncResult.notFound) {
    reply.code(404);
    return { message: 'Identifier not found' };
  }
  if (syncResult.handled && syncResult.value) {
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return syncResult.value;
  }

  if (!row?.id) {
    reply.code(404);
    return { message: 'Identifier not found' };
  }

  reply.header('Content-Type', 'text/plain; charset=utf-8');
  return row.id;
});

app.get(`${config.apiPrefix}/objects/:objectId/objects`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  if (!row) {
    reply.code(404);
    return { message: 'Object not found' };
  }

  const query = request.query as { pathTo?: string; depth?: string };
  const items = query.pathTo ? buildPathTree(query.pathTo) : [buildTreeNode(row, getRequestedDepth(query.depth, -1))];
  const ids = items.flatMap((item) => collectIds(item));
  const localPayload = {
    self: `${BASE_URL}/objects/${params.objectId}/objects`,
    items,
    effectivePermissions: {
      canDelete: ids,
      canView: ids,
      canModify: ids,
    },
  };
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/objects`,
    localPayload,
    (payload) => asJsonObject(payload),
    persistObjectTreePayload
  );
  if (syncResult.handled && syncResult.notFound) {
    reply.code(404);
    return { message: 'Object not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  return localPayload;
});

app.get(`${config.apiPrefix}/objects/:objectId`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  const localPayload = row ? getObjectResponse(row) : null;
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}`,
    localPayload,
    (payload) => asJsonObject(payload),
    (payload) => persistSyncedObjectResponse(params.objectId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    reply.code(404);
    return { message: 'Object not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (!row) {
    reply.code(404);
    return { message: 'Object not found' };
  }

  return localPayload;
});

app.patch(`${config.apiPrefix}/objects/:objectId`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  if (!row) {
    reply.code(404);
    return { message: 'Object not found' };
  }

  const body = (request.body ?? {}) as { item?: Record<string, JsonValue> };
  const item = parseJson<JsonObject>(row.item_json);
  const updates = body.item ?? {};
  const changedAttributes = Object.keys(updates);

  for (const [key, value] of Object.entries(updates)) {
    item[key] = value;
  }

  if (typeof item.attrChangeCount === 'number') {
    item.attrChangeCount += 1;
  }

  db.prepare('UPDATE objects SET item_json = ? WHERE id = ?').run(JSON.stringify(item), params.objectId);
  emitUpdatesForObject(params.objectId, changedAttributes);

  return { item };
});

app.get(`${config.apiPrefix}/objects/:objectId/views`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  const tableRow = getObjectViewsRow(params.objectId);
  const localPayload = tableRow
    ? listViewItemsFromItems(params.objectId, parseJson<JsonValue[]>(tableRow.items_json))
    : getLegacyObjectViewsPayload(row);
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/views`,
    localPayload,
    (payload) => listViewItemsFromItems(params.objectId, extractItemsArray(payload)),
    (payload) => persistObjectViews(params.objectId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    db.prepare('DELETE FROM object_views WHERE object_id = ?').run(params.objectId);
    db.prepare('UPDATE objects SET views_json = ? WHERE id = ?').run(JSON.stringify([]), params.objectId);
    deleteFileIfExists(path.join(MOCK_SEED_OBJECTS_DIR, params.objectId, 'views.json'));
    reply.code(404);
    return { message: 'Object not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (localPayload) {
    return localPayload;
  }

  reply.code(404);
  return { message: 'Object not found' };
});

app.get(`${config.apiPrefix}/objects/:objectId/attributes`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  const localPayload = row ? getObjectAttributesPayload(row) : null;
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/attributes`,
    localPayload,
    (payload) => asJsonObject(payload),
    (payload) => persistSyncedAttributesPayload(params.objectId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    reply.code(404);
    return { message: 'Object not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (!row) {
    reply.code(404);
    return { message: 'Object not found' };
  }

  return localPayload;
});

app.get(`${config.apiPrefix}/objects/:objectId/attributes/:attributeId`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string; attributeId: string };
  let row = getObjectRow(params.objectId);
  const localPayload = row ? getObjectAttributePayload(row, params.attributeId) : null;
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/attributes/${encodeURIComponent(params.attributeId)}`,
    localPayload,
    (payload) => asJsonObject(payload),
    (payload) => persistSyncedAttributePayload(params.objectId, params.attributeId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    reply.code(404);
    return { message: 'Object not found' };
  }
  if (syncResult.handled) {
    row = getObjectRow(params.objectId);
  }
  if (!row) {
    reply.code(404);
    return { message: 'Object not found' };
  }

  const streamId = getStreamIdFromHeader(request);
  if (streamId) {
    const subscriptionId = createSubscription(streamId, params.objectId, 'attribute', [params.attributeId]);
    reply.header('metasys-subscription-location', `${BASE_URL}/objects/streams/${streamId}/subscriptions/${subscriptionId}`);
    setTimeout(() => {
      const latestRow = getObjectRow(params.objectId);
      if (latestRow) {
        emitObjectUpdate(subscriptionId, latestRow, [params.attributeId]);
      }
    }, 50);
  }

  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  return localPayload ?? getObjectAttributePayload(row, params.attributeId);
});

app.post(`${config.apiPrefix}/objects/batch`, async (request, reply) => {
  createAcceptHeaders(reply);
  const body = (request.body ?? {}) as BatchRequestBody;
  const requests = body.requests ?? [];
  const responses = requests.map((entry) => {
    const parts = entry.relativeUrl.split('/');
    const objectId = parts[0];
    const attributeId = parts[2];
    const row = getObjectRow(objectId);

    if (!row || !attributeId) {
      return {
        id: entry.id,
        status: 404,
        body: null,
      };
    }

    return {
      id: entry.id,
      status: 200,
      body: getObjectAttributePayload(row, attributeId),
    };
  });

  const firstObjectId = requests[0]?.relativeUrl.split('/')[0];
  const streamId = getStreamIdFromHeader(request);
  if (streamId && firstObjectId) {
    const attributes = requests
      .map((entry) => entry.relativeUrl.split('/')[2])
      .filter((attribute): attribute is string => typeof attribute === 'string' && attribute.length > 0);
    const row = getObjectRow(firstObjectId);
    if (row) {
      const subscriptionId = createSubscription(streamId, firstObjectId, 'batch', attributes);
      reply.header('metasys-subscription-location', `${BASE_URL}/objects/streams/${streamId}/subscriptions/${subscriptionId}`);
      setTimeout(() => {
        const latestRow = getObjectRow(firstObjectId);
        if (latestRow) {
          emitBatchUpdate(subscriptionId, latestRow, attributes);
        }
      }, 50);
    }
  }

  return { responses };
});

app.get(`${config.apiPrefix}/objects/:objectId/commands`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  const tableRow = getObjectCommandsRow(params.objectId);
  const localPayload = tableRow
    ? {
        self: `${BASE_URL}/objects/${params.objectId}/commands`,
        items: parseJson<JsonValue[]>(tableRow.items_json),
      }
    : getLegacyObjectCommandsPayload(row);
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/commands`,
    localPayload,
    (payload) => ({
      self: `${BASE_URL}/objects/${params.objectId}/commands`,
      items: extractItemsArray(payload),
    }),
    (payload) => persistObjectCommands(params.objectId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    db.prepare('DELETE FROM object_commands WHERE object_id = ?').run(params.objectId);
    db.prepare('UPDATE objects SET commands_json = ? WHERE id = ?').run(JSON.stringify([]), params.objectId);
    deleteFileIfExists(path.join(MOCK_SEED_OBJECTS_DIR, params.objectId, 'commands.json'));
    reply.code(404);
    return {
      message: `Object ${params.objectId} not found`,
    };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (localPayload) {
    return localPayload;
  }

  reply.code(404);
  return {
    message: `Object ${params.objectId} not found`,
  };
});

app.get(`${config.apiPrefix}/objects/:objectId/supportedChildTypes`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectId: string };
  const row = getObjectRow(params.objectId);
  const tableRow = getSupportedChildTypesRow(params.objectId);
  const localPayload = tableRow ? parseJson<JsonValue[]>(tableRow.payload_json) : getLegacySupportedChildTypesPayload(row);
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/objects/${encodeURIComponent(params.objectId)}/supportedChildTypes`,
    localPayload,
    (payload) => extractItemsArray(payload),
    (payload) => persistSupportedChildTypes(params.objectId, payload)
  );
  if (syncResult.handled && syncResult.notFound) {
    db.prepare('DELETE FROM supported_child_types WHERE object_id = ?').run(params.objectId);
    db.prepare('UPDATE objects SET supported_child_types_json = ? WHERE id = ?').run(JSON.stringify([]), params.objectId);
    deleteFileIfExists(path.join(MOCK_SEED_OBJECTS_DIR, params.objectId, 'supported-child-types.json'));
    reply.code(404);
    return {
      message: `Object ${params.objectId} not found`,
    };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (localPayload) {
    return localPayload;
  }

  reply.code(404);
  return {
    message: `Object ${params.objectId} not found`,
  };
});

app.delete(`${config.apiPrefix}/objects/streams/:streamId/subscriptions/:subscriptionId`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { streamId: string; subscriptionId: string };
  const result = db.prepare('DELETE FROM subscriptions WHERE id = ? AND stream_id = ?').run(params.subscriptionId, params.streamId);
  if (result.changes === 0) {
    reply.code(404);
    return { message: 'Subscription not found' };
  }
  reply.code(204);
  return null;
});

app.get(`${config.apiPrefix}/schemas/objectTypes/:objectType`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { objectType: string };
  const tableRow = getObjectTypeSchemaRow(params.objectType);
  const localPayload = tableRow
    ? {
        schema: parseJson<JsonObject>(tableRow.schema_json),
        views: parseJson<JsonValue[]>(tableRow.views_json),
      }
    : getLegacyObjectTypeSchemaPayload(params.objectType);
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/schemas/objectTypes/${encodeURIComponent(params.objectType)}`,
    localPayload,
    (payload) => {
      const payloadObject = asJsonObject(payload);
      return {
        schema: asJsonObject(payloadObject.schema),
        views: extractItemsArray(payloadObject.views),
      };
    },
    (payload) =>
      persistObjectTypeSchema(
        params.objectType,
        payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as JsonObject) : {}
      )
  );
  if (syncResult.handled && syncResult.notFound) {
    db.prepare('DELETE FROM object_type_schema WHERE object_type = ?').run(params.objectType);
    db.prepare('DELETE FROM object_type_schemas WHERE id = ?').run(params.objectType);
    deleteFileIfExists(path.join(OBJECT_TYPE_SCHEMA_DIR, `${params.objectType}.json`));
    reply.code(404);
    return { message: 'Schema not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (localPayload) {
    return localPayload;
  }

  reply.code(404);
  return { message: 'Schema not found' };
});

app.get(`${config.apiPrefix}/schemas/enums/:enumId`, async (request, reply) => {
  createAcceptHeaders(reply);
  const params = request.params as { enumId: string };
  const tableRow = getEnumSetRow(params.enumId);
  const localPayload = tableRow ? parseJson<JsonObject>(tableRow.schema_json) : getLegacyEnumSetPayload(params.enumId);
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/schemas/enums/${encodeURIComponent(params.enumId)}`,
    localPayload,
    (payload) => asJsonObject(payload),
    (payload) => persistEnumSet(params.enumId, payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as JsonObject) : {})
  );
  if (syncResult.handled && syncResult.notFound) {
    db.prepare('DELETE FROM enum_sets WHERE enum_id = ?').run(params.enumId);
    db.prepare('DELETE FROM enum_schemas WHERE id = ?').run(params.enumId);
    deleteFileIfExists(path.join(ENUM_SETS_DIR, `${params.enumId}.json`));
    reply.code(404);
    return { message: 'Enum schema not found' };
  }
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  if (localPayload) {
    return localPayload;
  }

  reply.code(404);
  return { message: 'Enum schema not found' };
});

app.get(`${config.apiPrefix}/networkDevices`, async (request, reply) => {
  createAcceptHeaders(reply);
  const query = request.query as { classification?: string | string[] };
  const rawItems = db.prepare('SELECT * FROM network_devices ORDER BY name').all() as Array<{ payload_json: string; classification: string; id: string }>;
  const classificationFilter = Array.isArray(query.classification)
    ? query.classification
    : typeof query.classification === 'string'
      ? [query.classification]
      : [];
  const items = rawItems
    .filter((row) => classificationFilter.length === 0 || classificationFilter.includes(row.classification))
    .map((row) => parseJson<JsonObject>(row.payload_json));
  const ids = rawItems.map((row) => row.id);
  const localPayload = {
    total: items.length,
    items,
    next: null,
    previous: null,
    self: `${BASE_URL}/networkDevices`,
    effectivePermissions: {
      canDelete: ids,
      canView: ids,
      canModify: ids,
    },
  };
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/networkDevices`,
    localPayload,
    (payload) => asJsonObject(payload),
    persistNetworkDevicesPayload
  );
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  return localPayload;
});

app.get(`${config.apiPrefix}/spaces`, async (request, reply) => {
  createAcceptHeaders(reply);
  const rows = db.prepare('SELECT payload_json FROM spaces ORDER BY name').all() as Array<{ payload_json: string }>;
  const items = rows.map((row) => parseJson<JsonObject>(row.payload_json));
  const localPayload = {
    total: items.length,
    items,
    next: null,
    previous: null,
    self: `${BASE_URL}/spaces`,
  };
  const syncResult = await syncJsonRoute(
    request.raw.url ?? `${config.apiPrefix}/spaces`,
    localPayload,
    (payload) => asJsonObject(payload),
    persistSpacesPayload
  );
  if (syncResult.handled && syncResult.value) {
    return syncResult.value;
  }

  return localPayload;
});

function collectIds(node: JsonObject): string[] {
  const ids = typeof node.id === 'string' ? [node.id] : [];
  const children = Array.isArray(node.items) ? node.items : [];
  for (const child of children) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      ids.push(...collectIds(child as JsonObject));
    }
  }
  return ids;
}

function renderClientPage(request: FastifyRequest): string {
  const openApiSummary = getOpenApiSummary();
  const dbTableSummaries = getDbTableSummaries();
  const requestInfo = [
    ['Method', request.method],
    ['URL', request.url],
    ['Host', request.headers.host ?? 'unknown'],
    ['Remote address', request.ip],
    ['User-Agent', typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : 'unknown'],
    ['Accept', typeof request.headers.accept === 'string' ? request.headers.accept : 'unknown'],
    ['Served at', nowIso()],
  ];

  const requestRows = requestInfo
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  const routeRows = routeCatalog
    .map(
      (route) =>
        `<tr><td><code>${escapeHtml(route.method)}</code></td><td><code>${escapeHtml(route.path)}</code></td><td>${escapeHtml(route.description)}</td></tr>`
    )
    .join('');

  const dbSummaryRows = dbTableSummaries
    .map(
      (summary) =>
        `<tr><th><code>${escapeHtml(summary.table)}</code></th><td>${escapeHtml(String(summary.count))}</td><td>${escapeHtml(summary.description)}</td></tr>`
    )
    .join('');

  const dbTableOptions = DB_EXPLORER_TABLE_NAMES.map(
    (table) => `<option value="${escapeHtml(table)}"${table === 'objects' ? ' selected' : ''}>${escapeHtml(table)}</option>`
  ).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Metasys Mock API</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Arial, sans-serif;
      }
      body {
        margin: 0;
        padding: 24px;
        background: #0f172a;
        color: #e2e8f0;
      }
      .wrap {
        max-width: 1100px;
        margin: 0 auto;
      }
      .card {
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 18px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
      }
      h1, h2, p {
        margin-top: 0;
      }
      h3 {
        margin-top: 0;
        margin-bottom: 12px;
      }
      .subtle {
        color: #94a3b8;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border-bottom: 1px solid #334155;
        text-align: left;
        padding: 10px 8px;
        vertical-align: top;
      }
      th {
        width: 180px;
        color: #93c5fd;
      }
      code {
        background: rgba(148, 163, 184, 0.12);
        padding: 2px 6px;
        border-radius: 6px;
      }
      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      a {
        color: #93c5fd;
      }
      .db-controls {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 16px;
      }
      .db-controls label {
        display: block;
        font-size: 0.95rem;
        color: #cbd5e1;
      }
      .db-controls input,
      .db-controls select,
      .db-controls button {
        width: 100%;
        margin-top: 6px;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #020617;
        color: #e2e8f0;
        padding: 10px 12px;
        box-sizing: border-box;
      }
      .db-controls button {
        cursor: pointer;
        background: #1d4ed8;
        border-color: #2563eb;
        font-weight: 600;
      }
      .db-controls button:hover {
        background: #2563eb;
      }
      .db-preview-meta {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .db-preview-meta strong {
        color: #93c5fd;
      }
      .json-cell {
        min-width: 240px;
      }
      .json-cell pre,
      #db-preview-raw {
        margin: 0;
        max-height: 280px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 12px;
      }
      #db-preview-empty[hidden],
      #db-preview-table[hidden],
      #db-preview-raw[hidden] {
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Metasys Mock API</h1>
        <p class="subtle">Barebones client page served by the Fastify mock API.</p>
        <div class="grid">
          <div>
            <p><strong>OpenAPI title:</strong> ${escapeHtml(openApiSummary.title)}</p>
            <p><strong>OpenAPI version:</strong> ${escapeHtml(openApiSummary.version)}</p>
            <p><strong>OpenAPI revision:</strong> ${escapeHtml(openApiSummary.revision)}</p>
            <p><strong>Documented paths:</strong> ${escapeHtml(String(openApiSummary.pathCount))}</p>
          </div>
          <div>
            <p><strong>API base:</strong> <code>${escapeHtml(BASE_URL)}</code></p>
            <p><strong>Health:</strong> <a href="/health">/health</a></p>
            <p><strong>Root objects:</strong> <a href="${escapeHtml(`${config.apiPrefix}/objects`)}">${escapeHtml(`${config.apiPrefix}/objects`)}</a></p>
            <p><strong>Spaces:</strong> <a href="${escapeHtml(`${config.apiPrefix}/spaces`)}">${escapeHtml(`${config.apiPrefix}/spaces`)}</a></p>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Current request information</h2>
        <table>
          <tbody>
            ${requestRows}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Database explorer</h2>
        <p class="subtle">Read-only SQLite inspection for seeded mock data. Use it to confirm tree rows, parent links, and collection imports.</p>
        <div class="grid">
          <div>
            <h3>Table counts</h3>
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Rows</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${dbSummaryRows}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Row preview</h3>
            <form id="db-explorer-form" class="db-controls">
              <label>
                Table
                <select id="db-table" name="table">
                  ${dbTableOptions}
                </select>
              </label>
              <label>
                Limit
                <input id="db-limit" name="limit" type="number" min="1" max="${escapeHtml(String(MAX_DB_ROW_LIMIT))}" value="${escapeHtml(String(DEFAULT_DB_ROW_LIMIT))}" />
              </label>
              <label data-filter-tables="objects">
                Object ID
                <input id="db-filter-id" name="id" type="text" placeholder="42fa0447-23d0-5b6b-80b1-b20014d62ee5" />
              </label>
              <label data-filter-tables="objects">
                Parent ID
                <input id="db-filter-parent-id" name="parentId" type="text" placeholder="Parent object ID" />
              </label>
              <label data-filter-tables="subscriptions">
                Subscription object ID
                <input id="db-filter-object-id" name="objectId" type="text" placeholder="Subscription object ID" />
              </label>
              <label>
                Preview
                <button type="submit">Load rows</button>
              </label>
            </form>
            <p id="db-preview-status" class="subtle">Loading <code>objects</code> preview...</p>
            <div class="db-preview-meta">
              <span><strong>Rows returned:</strong> <span id="db-returned-rows">-</span></span>
              <span><strong>Total rows:</strong> <span id="db-total-rows">-</span></span>
              <span><strong>Active filters:</strong> <span id="db-active-filters">none</span></span>
            </div>
            <table id="db-preview-table" hidden>
              <thead id="db-preview-head"></thead>
              <tbody id="db-preview-body"></tbody>
            </table>
            <p id="db-preview-empty" class="subtle" hidden>No rows matched the current preview.</p>
            <pre id="db-preview-raw" hidden></pre>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Implemented routes</h2>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${routeRows}
          </tbody>
        </table>
      </div>
    </div>
    <script>
      (function () {
        var tableColumns = {
          objects: ['id', 'parent_id', 'network_device_id', 'classification', 'object_type', 'name', 'label', 'item_reference', 'view_count', 'item'],
          network_devices: ['id', 'parent_id', 'classification', 'name', 'item_reference', 'payload'],
          spaces: ['id', 'parent_id', 'type', 'name', 'item_reference', 'payload'],
          users: ['username', 'display_name'],
          subscriptions: ['id', 'stream_id', 'object_id', 'subscription_type', 'attributes', 'created_at'],
          streams: ['id', 'created_at']
        };

        var form = document.getElementById('db-explorer-form');
        var tableSelect = document.getElementById('db-table');
        var limitInput = document.getElementById('db-limit');
        var idInput = document.getElementById('db-filter-id');
        var parentIdInput = document.getElementById('db-filter-parent-id');
        var objectIdInput = document.getElementById('db-filter-object-id');
        var statusEl = document.getElementById('db-preview-status');
        var returnedRowsEl = document.getElementById('db-returned-rows');
        var totalRowsEl = document.getElementById('db-total-rows');
        var activeFiltersEl = document.getElementById('db-active-filters');
        var tableEl = document.getElementById('db-preview-table');
        var headEl = document.getElementById('db-preview-head');
        var bodyEl = document.getElementById('db-preview-body');
        var emptyEl = document.getElementById('db-preview-empty');
        var rawEl = document.getElementById('db-preview-raw');
        var filterGroups = Array.prototype.slice.call(document.querySelectorAll('[data-filter-tables]'));

        function escapeHtml(value) {
          return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
        }

        function getVisibleFilters(table) {
          if (table === 'objects') {
            return {
              id: idInput.value.trim(),
              parentId: parentIdInput.value.trim()
            };
          }

          if (table === 'subscriptions') {
            return {
              objectId: objectIdInput.value.trim()
            };
          }

          return {};
        }

        function updateFilterVisibility() {
          var table = tableSelect.value;
          filterGroups.forEach(function (group) {
            var supportedTables = String(group.getAttribute('data-filter-tables') || '').split(/\s+/).filter(Boolean);
            group.hidden = supportedTables.indexOf(table) === -1;
          });
        }

        function formatValue(value) {
          if (value === null || value === undefined) {
            return '<span class="subtle">null</span>';
          }

          if (typeof value === 'object') {
            return '<div class="json-cell"><pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre></div>';
          }

          return '<code>' + escapeHtml(value) + '</code>';
        }

        function getColumns(table, rows) {
          var configured = tableColumns[table];
          if (configured && configured.length > 0) {
            return configured.filter(function (column) {
              return rows.some(function (row) { return Object.prototype.hasOwnProperty.call(row, column); });
            });
          }

          if (rows.length === 0) {
            return [];
          }

          return Object.keys(rows[0]);
        }

        function renderRows(table, rows) {
          var columns = getColumns(table, rows);
          if (rows.length === 0 || columns.length === 0) {
            tableEl.hidden = true;
            bodyEl.innerHTML = '';
            headEl.innerHTML = '';
            emptyEl.hidden = false;
            rawEl.hidden = false;
            rawEl.textContent = '[]';
            return;
          }

          emptyEl.hidden = true;
          tableEl.hidden = false;
          rawEl.hidden = false;
          rawEl.textContent = JSON.stringify(rows, null, 2);
          headEl.innerHTML = '<tr>' + columns.map(function (column) {
            return '<th>' + escapeHtml(column) + '</th>';
          }).join('') + '</tr>';
          bodyEl.innerHTML = rows.map(function (row) {
            return '<tr>' + columns.map(function (column) {
              return '<td>' + formatValue(row[column]) + '</td>';
            }).join('') + '</tr>';
          }).join('');
        }

        function formatFilters(filters) {
          var entries = Object.entries(filters).filter(function (entry) {
            return entry[1];
          });

          if (entries.length === 0) {
            return 'none';
          }

          return entries.map(function (entry) {
            return entry[0] + '=' + entry[1];
          }).join(', ');
        }

        function loadPreview() {
          var table = tableSelect.value;
          var limit = limitInput.value.trim() || '${DEFAULT_DB_ROW_LIMIT}';
          var params = new URLSearchParams();
          params.set('limit', limit);

          var filters = getVisibleFilters(table);
          Object.entries(filters).forEach(function (entry) {
            if (entry[1]) {
              params.set(entry[0], entry[1]);
            }
          });

          updateFilterVisibility();
          statusEl.innerHTML = 'Loading <code>' + escapeHtml(table) + '</code> preview...';

          fetch('/_mock/db/tables/' + encodeURIComponent(table) + '?' + params.toString())
            .then(function (response) {
              if (!response.ok) {
                throw new Error('Preview request failed with ' + response.status);
              }
              return response.json();
            })
            .then(function (payload) {
              statusEl.textContent = payload.description;
              returnedRowsEl.textContent = String(payload.returnedRows);
              totalRowsEl.textContent = String(payload.totalRows);
              activeFiltersEl.textContent = formatFilters(payload.filters || {});
              renderRows(payload.table, Array.isArray(payload.rows) ? payload.rows : []);
            })
            .catch(function (error) {
              tableEl.hidden = true;
              emptyEl.hidden = false;
              rawEl.hidden = true;
              returnedRowsEl.textContent = '-';
              totalRowsEl.textContent = '-';
              activeFiltersEl.textContent = 'none';
              statusEl.textContent = error instanceof Error ? error.message : 'Failed to load preview.';
            });
        }

        tableSelect.addEventListener('change', function () {
          updateFilterVisibility();
          loadPreview();
        });

        form.addEventListener('submit', function (event) {
          event.preventDefault();
          loadPreview();
        });

        updateFilterVisibility();
        loadPreview();
      })();
    </script>
  </body>
</html>`;
}

app.get('/', async (request, reply) => {
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return renderClientPage(request);
});

async function start(): Promise<void> {
  const openApiSummary = getOpenApiSummary();
  app.log.info(
    {
      openApiVersion: openApiSummary.version,
      openApiRevision: openApiSummary.revision,
      openApiPaths: openApiSummary.pathCount,
    },
    'Loaded OpenAPI contract metadata'
  );
  console.log(`Metasys Mock API is running at ${BASE_URL}`);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
