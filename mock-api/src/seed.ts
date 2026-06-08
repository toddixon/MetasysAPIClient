import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface TreeNode {
  id: string;
  parentUrl: string | null;
  networkDeviceUrl: string;
  itemReference: string;
  name: string;
  label: string;
  objectType: string;
  objectTypeVersion: string;
  classification: string;
  items?: TreeNode[];
}

interface TreeResponse {
  self?: string;
  items?: JsonValue[];
}

interface RawTreeNode {
  id?: JsonValue;
  parentUrl?: JsonValue;
  networkDeviceUrl?: JsonValue;
  itemReference?: JsonValue;
  name?: JsonValue;
  label?: JsonValue;
  objectType?: JsonValue;
  objectTypeVersion?: JsonValue;
  classification?: JsonValue;
  items?: JsonValue;
}

interface CollectionResponse {
  items?: JsonValue[];
}

interface RawSpaceItem {
  id?: JsonValue;
  itemReference?: JsonValue;
  name?: JsonValue;
  type?: JsonValue;
  parentUrl?: JsonValue;
}

interface RawNetworkDeviceItem {
  id?: JsonValue;
  itemReference?: JsonValue;
  name?: JsonValue;
  parentUrl?: JsonValue;
}

interface CollectionResponse {
  items?: JsonValue[];
}

interface RawSpaceItem {
  id?: JsonValue;
  itemReference?: JsonValue;
  name?: JsonValue;
  type?: JsonValue;
  parentUrl?: JsonValue;
}

interface RawNetworkDeviceItem {
  id?: JsonValue;
  itemReference?: JsonValue;
  name?: JsonValue;
  parentUrl?: JsonValue;
}

interface StoredObjectRow {
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

interface StoredSpace {
  id: string;
  parent_id: string | null;
  name: string;
  item_reference: string;
  type: string;
  payload_json: string;
}

interface StoredNetworkDevice {
  id: string;
  parent_id: string | null;
  classification: string;
  item_reference: string;
  name: string;
  payload_json: string;
}

interface ViewGroup {
  title: string;
  properties: string[];
  id: string;
}

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
  id?: string;
  parentId?: string | null;
  networkDeviceId?: string;
  classification?: string;
  name?: string;
  label?: string;
  itemReference?: string;
  objectType?: string;
  objectTypeVersion?: string;
}

interface ObjectSnapshot {
  objectType?: string;
  objectTypeVersion?: string;
  parentUrl?: string | null;
  networkDeviceUrl?: string;
  item?: JsonValue;
  schema?: JsonValue;
  views?: JsonValue;
  effectivePermissions?: JsonValue;
}

interface StoredEnumSchema {
  id: string;
  schemaJson: string;
}

interface StoredObjectTypeSchema {
  id: string;
  schemaJson: string;
  viewsJson: string;
}

function toJsonViewGroup(group: ViewGroup): JsonObject {
  return {
    title: group.title,
    properties: [...group.properties],
    id: group.id,
  };
}

const PROGRAMMING_FOLDER_ID = 'f45c66c1-59be-52a6-b549-a15b3c359239';
const DEFAULT_SERVER_ID = '1dd8657b-33b5-591e-b8aa-4a86ced81bec';
const TREE_DATA_PATH = path.join(config.referencesDataDir, 'ObjectTree.json');
const LEGACY_TREE_PATH = path.join(config.referencesRoot, 'ObjectTree.json');
const SPACES_DATA_PATH = path.join(config.referencesDataDir, 'Spaces.json');
const NETWORK_DEVICES_DATA_PATH = path.join(config.referencesDataDir, 'NetworkDevices.json');
const ENUM_SCHEMAS_DIR = path.join(config.referencesDataDir, 'enums');
const OBJECT_TYPE_SCHEMAS_DIR = path.join(config.referencesDataDir, 'object-type-schemas');
const MOCK_SEED_DIR = path.join(config.referencesRoot, 'mock-seed');
const MOCK_SEED_MANIFEST = path.join(MOCK_SEED_DIR, 'manifest.json');
const MOCK_SEED_OBJECTS_DIR = path.join(MOCK_SEED_DIR, 'objects');

function asObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

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

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function listJsonFiles(directoryPath: string): string[] {
  if (!fileExists(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

function listObjectSeedDirectories(): string[] {
  if (!fileExists(MOCK_SEED_OBJECTS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MOCK_SEED_OBJECTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(MOCK_SEED_OBJECTS_DIR, entry.name))
    .sort();
}

function listLegacySchemaCaptureFiles(): string[] {
  return fs
    .readdirSync(config.referencesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.schema.json'))
    .map((entry) => path.join(config.referencesRoot, entry.name))
    .sort();
}

function requireExistingPath(paths: string[]): string {
  const existingPath = paths.find((candidate) => fileExists(candidate));
  if (!existingPath) {
    throw new Error(`Unable to find any expected seed file. Checked: ${paths.join(', ')}`);
  }
  return existingPath;
}

function inferJsonSchema(value: JsonValue): JsonObject {
  if (Array.isArray(value)) {
    return { type: 'array' };
  }

  switch (typeof value) {
    case 'boolean':
      return { type: 'boolean' };
    case 'number':
      return { type: 'number' };
    case 'string':
      return { type: 'string' };
    case 'object':
      if (value === null) {
        return { type: 'null' };
      }
      return { type: 'object' };
    default:
      return { type: 'string' };
  }
}

function buildViewsFromItem(item: JsonObject): JsonObject[] {
  const itemKeys = Object.keys(item);
  const objectProps = itemKeys.filter((key) => ['id', 'name', 'label', 'description', 'itemReference', 'bacnetObjectType', 'objectCategory', 'objectType'].includes(key));
  const statusProps = itemKeys.filter((key) => ['status', 'alarmState', 'reliability', 'outOfService', 'currentCommandPriority', 'presentValueWritable'].includes(key));
  const keyAttribute = typeof item.defaultAttribute === 'string' ? item.defaultAttribute.split('.').pop() ?? '' : '';
  const keyProps = itemKeys.filter((key) => ['presentValue', 'attrChangeCount', keyAttribute].includes(key)).filter(Boolean);

  const nonEmptyGroups: ViewGroup[] = [
    objectProps.length > 0
      ? {
          title: 'Object',
          properties: objectProps,
          id: 'viewGroupEnumSet.objectGrp',
        }
      : null,
    statusProps.length > 0
      ? {
          title: 'Status',
          properties: statusProps,
          id: 'viewGroupEnumSet.statusGrp',
        }
      : null,
    keyProps.length > 0
      ? {
          title: 'None',
          properties: keyProps,
          id: 'viewGroupEnumSet.noGrp',
        }
      : null,
  ].filter((group): group is ViewGroup => group !== null);

  const primaryView: JsonObject = {
    title: 'Focus',
    id: 'viewNameEnumSet.focusView',
    views: [
      {
        title: 'Basic',
        id: 'groupTypeEnumSet.basicGrpType',
        views: nonEmptyGroups
          .filter((group) => group.id !== 'viewGroupEnumSet.noGrp')
          .map((group) => toJsonViewGroup(group)),
      },
    ],
  };

  if (nonEmptyGroups.some((group) => group.id === 'viewGroupEnumSet.noGrp')) {
    (primaryView.views as JsonValue[]).push({
      title: 'Key',
      id: 'groupTypeEnumSet.keyGrpType',
      views: nonEmptyGroups
        .filter((group) => group.id === 'viewGroupEnumSet.noGrp')
        .map((group) => toJsonViewGroup(group)),
    });
  }

  return [
    primaryView,
    {
      title: 'Configuration',
      id: 'viewNameEnumSet.configView',
      views: [
        {
          title: 'Configuration',
          id: 'groupTypeEnumSet.basicGrpType',
          views: nonEmptyGroups
            .filter((group) => group.id !== 'viewGroupEnumSet.noGrp')
            .map((group) => toJsonViewGroup(group)),
        },
      ],
    },
  ];
}

function buildSchemaFromItem(title: string, item: JsonObject): JsonObject {
  const properties = Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, { title: key, ...inferJsonSchema(value) }])
  ) as JsonObject;

  return {
    type: 'object',
    $schema: 'http://json-schema.org/draft-07/schema#',
    title,
    version: '1.0',
    properties,
  };
}

function buildEffectivePermissions(id: string): JsonObject {
  return {
    canDelete: [id],
    canView: [id],
    canModify: [id],
  };
}

function lastSegment(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(/[^/]+$/);
  return match ? match[0] : null;
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

function normalizeObjectTypeSchemaId(id: string): string {
  return id.includes('.') ? id : `objectTypeEnumSet.${id}`;
}

function inferSchemaIdFromFilename(filePath: string): string {
  return path.basename(filePath, '.json').replace(/\.schema$/, '');
}

function isRawTreeNode(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTreeNodeCandidate(value: RawTreeNode): boolean {
  return (
    typeof value.id === 'string' ||
    typeof value.itemReference === 'string' ||
    typeof value.objectType === 'string' ||
    typeof value.networkDeviceUrl === 'string'
  );
}

function missingTreeNodeFields(value: RawTreeNode): string[] {
  const requiredFields: Array<keyof TreeNode> = [
    'id',
    'parentUrl',
    'networkDeviceUrl',
    'itemReference',
    'name',
    'label',
    'objectType',
    'objectTypeVersion',
    'classification',
  ];

  return requiredFields.filter((field) => {
    const candidate = value[field as keyof RawTreeNode];
    return field === 'parentUrl'
      ? !(typeof candidate === 'string' || candidate === null)
      : typeof candidate !== 'string';
  });
}

function normalizeTreeNodes(value: JsonValue, sourcePath: string, nodePath: string): TreeNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => normalizeTreeNodes(entry, sourcePath, `${nodePath}[${index}]`));
  }

  if (!isRawTreeNode(value)) {
    throw new Error(`Malformed object tree entry at ${nodePath} in ${sourcePath}: expected an object or array.`);
  }

  const rawNode = value as RawTreeNode;

  const rawItems = Array.isArray(rawNode.items) ? rawNode.items : [];
  const children = rawItems.flatMap((entry, index) => normalizeTreeNodes(entry, sourcePath, `${nodePath}.items[${index}]`));
  if (isTreeNodeCandidate(rawNode)) {
    const missingFields = missingTreeNodeFields(rawNode);
    if (missingFields.length > 0) {
      throw new Error(
        `Malformed object tree node at ${nodePath} in ${sourcePath}: missing required fields ${missingFields.join(', ')}.`
      );
    }

    return [
      {
        id: rawNode.id as string,
        parentUrl: rawNode.parentUrl as string | null,
        networkDeviceUrl: rawNode.networkDeviceUrl as string,
        itemReference: rawNode.itemReference as string,
        name: rawNode.name as string,
        label: rawNode.label as string,
        objectType: rawNode.objectType as string,
        objectTypeVersion: rawNode.objectTypeVersion as string,
        classification: rawNode.classification as string,
        items: children,
      },
    ];
  }

  if (Array.isArray(rawNode.items)) {
    return children;
  }

  throw new Error(
    `Malformed object tree wrapper at ${nodePath} in ${sourcePath}: expected nested items or an object node with required fields.`
  );
}

function loadObjectTreeRows(): StoredObjectRow[] {
  const treePath = requireExistingPath([TREE_DATA_PATH, LEGACY_TREE_PATH]);
  const treeResponse = parseJsonFile<TreeResponse>(treePath);
  const normalizedNodes = normalizeTreeNodes(treeResponse.items ?? [], treePath, 'root.items');
  const rows: StoredObjectRow[] = [];

  normalizedNodes.forEach((node) => collectTreeRows(node, rows));
  return rows;
}

function loadCollectionItems(filePath: string): JsonValue[] {
  if (!fileExists(filePath)) {
    throw new Error(`Required seed file is missing: ${filePath}`);
  }

  const response = parseJsonFile<CollectionResponse>(filePath);
  if (!Array.isArray(response.items)) {
    throw new Error(`Malformed collection seed file ${filePath}: expected an "items" array.`);
  }

  return response.items;
}

function loadSpaces(): StoredSpace[] {
  const items = loadCollectionItems(SPACES_DATA_PATH);
  return items.map((value, index) => {
    if (!isRawTreeNode(value)) {
      throw new Error(`Malformed space item at ${SPACES_DATA_PATH} items[${index}]: expected an object.`);
    }

    const space = value as RawSpaceItem;
    const id = requireString(typeof space.id === 'string' ? space.id : undefined, `Missing id for space at items[${index}] in ${SPACES_DATA_PATH}`);
    const itemReference = requireString(
      typeof space.itemReference === 'string' ? space.itemReference : undefined,
      `Missing itemReference for space ${id} in ${SPACES_DATA_PATH}`
    );

    return {
      id,
      parent_id: requireNullableString(lastSegment(typeof space.parentUrl === 'string' ? space.parentUrl : null)),
      name: expectString(space.name, `Missing name for space ${id} in ${SPACES_DATA_PATH}`),
      item_reference: itemReference,
      type: expectString(space.type, `Missing type for space ${id} in ${SPACES_DATA_PATH}`),
      payload_json: JSON.stringify(value),
    };
  });
}

function loadNetworkDevices(objectRows: StoredObjectRow[]): StoredNetworkDevice[] {
  const items = loadCollectionItems(NETWORK_DEVICES_DATA_PATH);
  const objectRowMap = new Map(objectRows.map((row) => [row.id, row]));

  return items.map((value, index) => {
    if (!isRawTreeNode(value)) {
      throw new Error(`Malformed network device item at ${NETWORK_DEVICES_DATA_PATH} items[${index}]: expected an object.`);
    }

    const device = value as RawNetworkDeviceItem;
    const id = requireString(
      typeof device.id === 'string' ? device.id : undefined,
      `Missing id for network device at items[${index}] in ${NETWORK_DEVICES_DATA_PATH}`
    );
    const linkedObjectRow = objectRowMap.get(id);
    if (!linkedObjectRow) {
      throw new Error(`Network device ${id} from ${NETWORK_DEVICES_DATA_PATH} has no matching object row in the seeded object tree.`);
    }

    return {
      id,
      parent_id: requireNullableString(lastSegment(typeof device.parentUrl === 'string' ? device.parentUrl : null)),
      classification: linkedObjectRow.classification,
      item_reference: requireString(
        typeof device.itemReference === 'string' ? device.itemReference : undefined,
        `Missing itemReference for network device ${id} in ${NETWORK_DEVICES_DATA_PATH}`
      ),
      name: expectString(device.name, `Missing name for network device ${id} in ${NETWORK_DEVICES_DATA_PATH}`),
      payload_json: JSON.stringify(value),
    };
  });
}

function parseObjectTypeSchemaEntry(filePath: string, strict: boolean): StoredObjectTypeSchema | null {
  const raw = parseJsonFile<JsonValue>(filePath);
  if (!isRawTreeNode(raw)) {
    if (strict) {
      throw new Error(`Malformed object type schema file ${filePath}: expected an object payload.`);
    }
    return null;
  }

  const root = raw as JsonObject;
  const schemaSource =
    root.schema && isRawTreeNode(root.schema as JsonValue)
      ? (root.schema as JsonObject)
      : root;
  const rawId =
    (typeof root.id === 'string' ? root.id : undefined) ??
    (typeof schemaSource.$id === 'string' ? extractSchemaIdFromUrl(schemaSource.$id, 'objectTypes') : null) ??
    inferSchemaIdFromFilename(filePath);

  if (!rawId) {
    if (strict) {
      throw new Error(`Unable to infer object type schema id from ${filePath}.`);
    }
    return null;
  }

  return {
    id: normalizeObjectTypeSchemaId(rawId),
    schemaJson: JSON.stringify(schemaSource),
    viewsJson: JSON.stringify(Array.isArray(root.views) ? root.views : []),
  };
}

function parseEnumSchemaEntry(filePath: string): StoredEnumSchema {
  const raw = parseJsonFile<JsonValue>(filePath);
  if (!isRawTreeNode(raw)) {
    throw new Error(`Malformed enum schema file ${filePath}: expected an object payload.`);
  }

  const root = raw as JsonObject;
  const schemaSource =
    root.schema && isRawTreeNode(root.schema as JsonValue)
      ? (root.schema as JsonObject)
      : root;
  const id =
    (typeof root.id === 'string' ? root.id : undefined) ??
    (typeof schemaSource.$id === 'string' ? extractSchemaIdFromUrl(schemaSource.$id, 'enums') : null) ??
    inferSchemaIdFromFilename(filePath);

  return {
    id: requireString(id ?? undefined, `Unable to infer enum schema id from ${filePath}.`),
    schemaJson: JSON.stringify(schemaSource),
  };
}

function collectEnumSchemaRefs(value: JsonValue, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEnumSchemaRefs(entry, ids));
    return;
  }

  if (!isRawTreeNode(value)) {
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

function createPlaceholderEnumSchema(id: string): StoredEnumSchema {
  return {
    id,
    schemaJson: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: `https://mock.local/api/v6/schemas/enums/${id}`,
      title: id,
      type: 'string',
    }),
  };
}

function createGenericObjectRow(node: TreeNode): StoredObjectRow {
  const item: JsonObject = {
    id: node.id,
    name: node.name,
    label: node.label,
    itemReference: node.itemReference,
    objectType: node.objectType,
    status: 'objectStatusEnumSet.osNormal',
    alarmState: 'objectStatusEnumSet.osNormal',
  };
  const schema = buildSchemaFromItem(node.name || node.label, item);
  const views = buildViewsFromItem(item);

  return {
    id: node.id,
    parent_id: lastSegment(node.parentUrl),
    network_device_id: lastSegment(node.networkDeviceUrl) ?? node.id,
    object_type: node.objectType,
    object_type_version: node.objectTypeVersion,
    classification: node.classification,
    item_reference: node.itemReference,
    name: node.name,
    label: node.label,
    item_json: JSON.stringify(item),
    views_json: JSON.stringify(views),
    schema_json: JSON.stringify(schema),
    effective_permissions_json: JSON.stringify(buildEffectivePermissions(node.id)),
    commands_json: JSON.stringify([]),
    supported_child_types_json: JSON.stringify([]),
  };
}

function collectTreeRows(node: TreeNode, rows: StoredObjectRow[]): void {
  rows.push(createGenericObjectRow(node));

  for (const child of node.items ?? []) {
    collectTreeRows(child, rows);
  }
}

function createProgrammingFolderRow(serverId: string): StoredObjectRow {
  const item: JsonObject = {
    id: PROGRAMMING_FOLDER_ID,
    name: 'Programming',
    label: 'Programming',
    itemReference: 'DESKTOP-VM:DESKTOP-VM/Programming',
    status: 'objectStatusEnumSet.osNormal',
    alarmState: 'objectStatusEnumSet.osNormal',
  };

  return {
    id: PROGRAMMING_FOLDER_ID,
    parent_id: serverId,
    network_device_id: serverId,
    object_type: 'objectTypeEnumSet.containerClass',
    object_type_version: '1.0',
    classification: 'folder',
    item_reference: 'DESKTOP-VM:DESKTOP-VM/Programming',
    name: 'Programming',
    label: 'Programming',
    item_json: JSON.stringify(item),
    views_json: JSON.stringify(buildViewsFromItem(item)),
    schema_json: JSON.stringify(buildSchemaFromItem('Programming', item)),
    effective_permissions_json: JSON.stringify(buildEffectivePermissions(PROGRAMMING_FOLDER_ID)),
    commands_json: JSON.stringify([]),
    supported_child_types_json: JSON.stringify([]),
  };
}

function requireString(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function expectString(value: JsonValue | undefined, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

function requireNullableString(value: string | null | undefined): string | null {
  return value ?? null;
}

function loadObjectSeedRows(): StoredObjectRow[] {
  if (!fileExists(MOCK_SEED_MANIFEST)) {
    return [];
  }

  const manifest = parseJsonFile<ObjectSeedManifest>(MOCK_SEED_MANIFEST);
  return manifest.objects.map((entry) => loadObjectSeedRow(entry));
}

function loadObjectViewRows(): StoredObjectViewRow[] {
  const viewMap = new Map<string, StoredObjectViewRow>();

  for (const directory of listObjectSeedDirectories()) {
    const objectId = path.basename(directory);
    const viewsFile = path.join(directory, 'views.json');
    const objectFile = path.join(directory, 'object.json');

    if (fileExists(viewsFile)) {
      viewMap.set(objectId, {
        object_id: objectId,
        items_json: JSON.stringify(extractItemsArray(parseJsonFile<JsonValue>(viewsFile))),
      });
      continue;
    }

    if (fileExists(objectFile)) {
      const snapshot = parseJsonFile<ObjectSnapshot>(objectFile);
      const views = extractItemsArray(snapshot.views);
      if (views.length > 0) {
        viewMap.set(objectId, {
          object_id: objectId,
          items_json: JSON.stringify(views),
        });
      }
    }
  }

  return [...viewMap.values()];
}

function loadObjectCommandRows(): StoredObjectCommandRow[] {
  const commandRows: StoredObjectCommandRow[] = [];

  for (const directory of listObjectSeedDirectories()) {
    const commandsFile = path.join(directory, 'commands.json');
    if (!fileExists(commandsFile)) {
      continue;
    }

    commandRows.push({
      object_id: path.basename(directory),
      items_json: JSON.stringify(extractItemsArray(parseJsonFile<JsonValue>(commandsFile))),
    });
  }

  return commandRows;
}

function loadSupportedChildTypeRows(): StoredSupportedChildTypeRow[] {
  const rows: StoredSupportedChildTypeRow[] = [];

  for (const directory of listObjectSeedDirectories()) {
    const supportedChildTypesFile = path.join(directory, 'supported-child-types.json');
    if (!fileExists(supportedChildTypesFile)) {
      continue;
    }

    rows.push({
      object_id: path.basename(directory),
      payload_json: JSON.stringify(extractItemsArray(parseJsonFile<JsonValue>(supportedChildTypesFile))),
    });
  }

  return rows;
}

function loadObjectSeedRow(entry: ObjectSeedManifestEntry): StoredObjectRow {
  const directory = path.join(MOCK_SEED_DIR, entry.directory);
  const objectFile = path.join(directory, entry.objectFile ?? 'object.json');
  const metaFile = path.join(directory, entry.metaFile ?? 'meta.json');
  const commandsFile = path.join(directory, 'commands.json');
  const supportedChildTypesFile = path.join(directory, 'supported-child-types.json');

  const snapshot = parseJsonFile<ObjectSnapshot>(objectFile);
  const meta = fileExists(metaFile) ? parseJsonFile<ObjectSeedMeta>(metaFile) : {};
  const item = asObject(snapshot.item);

  const id = requireString(
    meta.id ?? (typeof item.id === 'string' ? item.id : undefined),
    `Missing object id for snapshot seed in ${directory}`
  );
  const name = meta.name ?? (typeof item.name === 'string' ? item.name : undefined) ?? id;
  const label =
    meta.label ??
    (typeof item.label === 'string' ? item.label : undefined) ??
    (typeof item.name === 'string' ? item.name : undefined) ??
    name;
  const itemReference = requireString(
    meta.itemReference ?? (typeof item.itemReference === 'string' ? item.itemReference : undefined),
    `Missing itemReference for snapshot seed ${id}`
  );
  const objectType = requireString(
    meta.objectType ?? snapshot.objectType ?? (typeof item.objectType === 'string' ? item.objectType : undefined),
    `Missing objectType for snapshot seed ${id}`
  );
  const objectTypeVersion = meta.objectTypeVersion ?? snapshot.objectTypeVersion ?? '1.0';
  const classification = requireString(meta.classification, `Missing classification in ${metaFile} for snapshot seed ${id}`);
  const parentId = requireNullableString(meta.parentId ?? lastSegment(snapshot.parentUrl ?? null));
  const networkDeviceId = requireString(
    meta.networkDeviceId ?? lastSegment(snapshot.networkDeviceUrl ?? null) ?? id,
    `Missing networkDeviceId for snapshot seed ${id}`
  );
  const views = Array.isArray(snapshot.views) ? (snapshot.views as JsonObject[]) : buildViewsFromItem(item);
  const schema =
    snapshot.schema && typeof snapshot.schema === 'object' && !Array.isArray(snapshot.schema)
      ? (snapshot.schema as JsonObject)
      : buildSchemaFromItem(name, item);
  const effectivePermissions =
    snapshot.effectivePermissions && typeof snapshot.effectivePermissions === 'object' && !Array.isArray(snapshot.effectivePermissions)
      ? (snapshot.effectivePermissions as JsonObject)
      : buildEffectivePermissions(id);
  const commands = fileExists(commandsFile) ? extractItemsArray(parseJsonFile<JsonValue>(commandsFile)) : [];
  const supportedChildTypes = fileExists(supportedChildTypesFile) ? extractItemsArray(parseJsonFile<JsonValue>(supportedChildTypesFile)) : [];

  return {
    id,
    parent_id: parentId,
    network_device_id: networkDeviceId,
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

function resolveFinalObjectRows(rows: StoredObjectRow[]): StoredObjectRow[] {
  const rowMap = new Map<string, StoredObjectRow>();
  for (const row of rows) {
    rowMap.set(row.id, row);
  }
  return [...rowMap.values()];
}

function buildDefaultEnumSchemas(): StoredEnumSchema[] {
  const createEnum = (id: string, members: Array<{ const: string; title: string }>) => ({
    id,
    schemaJson: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: `https://mock.local/api/v6/schemas/enums/${id}`,
      title: id,
      type: 'string',
      oneOf: members,
    }),
  });

  return [
    createEnum('writePriorityEnumSet', [
      { const: 'writePriorityEnumSet.priorityDefault', title: '16 (Default)' },
      { const: 'writePriorityEnumSet.priority14', title: '14' },
      { const: 'writePriorityEnumSet.priorityOperatorOverride', title: '8 (Operator Override)' },
    ]),
    createEnum('objectStatusEnumSet', [
      { const: 'objectStatusEnumSet.osNormal', title: 'Normal' },
      { const: 'objectStatusEnumSet.osOffline', title: 'Offline' },
      { const: 'objectStatusEnumSet.osAlarm', title: 'Alarm' },
    ]),
    createEnum('viewNameEnumSet', [
      { const: 'viewNameEnumSet.focusView', title: 'Focus' },
      { const: 'viewNameEnumSet.configView', title: 'Configuration' },
    ]),
  ];
}

function loadObjectTypeSchemas(finalRows: StoredObjectRow[]): StoredObjectTypeSchema[] {
  const schemaMap = new Map<string, StoredObjectTypeSchema>();

  for (const filePath of listJsonFiles(OBJECT_TYPE_SCHEMAS_DIR)) {
    const entry = parseObjectTypeSchemaEntry(filePath, true);
    if (entry) {
      schemaMap.set(entry.id, entry);
    }
  }

  for (const filePath of listLegacySchemaCaptureFiles()) {
    const entry = parseObjectTypeSchemaEntry(filePath, false);
    if (entry) {
      schemaMap.set(entry.id, entry);
    }
  }

  const typeSeedMap = new Map<string, StoredObjectRow>();
  for (const row of finalRows) {
    if (!typeSeedMap.has(row.object_type)) {
      typeSeedMap.set(row.object_type, row);
    }
  }

  for (const [id, row] of typeSeedMap.entries()) {
    if (!schemaMap.has(id)) {
      schemaMap.set(id, {
        id,
        schemaJson: row.schema_json,
        viewsJson: row.views_json,
      });
    }
  }

  return [...schemaMap.values()];
}

function loadCapturedObjectTypeSchemas(): StoredObjectTypeSchema[] {
  const schemaMap = new Map<string, StoredObjectTypeSchema>();

  for (const filePath of listJsonFiles(OBJECT_TYPE_SCHEMAS_DIR)) {
    const entry = parseObjectTypeSchemaEntry(filePath, true);
    if (entry) {
      schemaMap.set(entry.id, entry);
    }
  }

  for (const filePath of listLegacySchemaCaptureFiles()) {
    const entry = parseObjectTypeSchemaEntry(filePath, false);
    if (entry) {
      schemaMap.set(entry.id, entry);
    }
  }

  return [...schemaMap.values()];
}

function loadEnumSchemas(objectTypeSchemas: StoredObjectTypeSchema[]): StoredEnumSchema[] {
  const schemaMap = new Map<string, StoredEnumSchema>();

  for (const entry of buildDefaultEnumSchemas()) {
    schemaMap.set(entry.id, entry);
  }

  for (const filePath of listJsonFiles(ENUM_SCHEMAS_DIR)) {
    const entry = parseEnumSchemaEntry(filePath);
    schemaMap.set(entry.id, entry);
  }

  const referencedEnumIds = new Set<string>();
  for (const schema of objectTypeSchemas) {
    collectEnumSchemaRefs(parseJson<JsonValue>(schema.schemaJson), referencedEnumIds);
  }

  for (const enumId of referencedEnumIds) {
    if (!schemaMap.has(enumId)) {
      schemaMap.set(enumId, createPlaceholderEnumSchema(enumId));
    }
  }

  return [...schemaMap.values()];
}

function loadCapturedEnumSchemas(): StoredEnumSchema[] {
  const schemaMap = new Map<string, StoredEnumSchema>();

  for (const filePath of listJsonFiles(ENUM_SCHEMAS_DIR)) {
    const entry = parseEnumSchemaEntry(filePath);
    schemaMap.set(entry.id, entry);
  }

  return [...schemaMap.values()];
}

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      network_device_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_type_version TEXT NOT NULL,
      classification TEXT NOT NULL,
      item_reference TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      item_json TEXT NOT NULL,
      views_json TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      effective_permissions_json TEXT NOT NULL,
      commands_json TEXT NOT NULL DEFAULT '[]',
      supported_child_types_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      item_reference TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS network_devices (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      classification TEXT NOT NULL,
      item_reference TEXT NOT NULL,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enum_schemas (
      id TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS object_type_schemas (
      id TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      views_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS object_views (
      object_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS object_commands (
      object_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supported_child_types (
      object_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS object_type_schema (
      object_type TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      views_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enum_sets (
      enum_id TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      object_id TEXT NOT NULL,
      subscription_type TEXT NOT NULL,
      attributes_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const objectColumns = new Set(
    (db.prepare('PRAGMA table_info(objects)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!objectColumns.has('commands_json')) {
    db.exec(`ALTER TABLE objects ADD COLUMN commands_json TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!objectColumns.has('supported_child_types_json')) {
    db.exec(`ALTER TABLE objects ADD COLUMN supported_child_types_json TEXT NOT NULL DEFAULT '[]';`);
  }
}

export function seedDatabase(db: Database.Database): void {
  const rows = loadObjectTreeRows();
  const rootTreeRowCount = rows.filter((row) => row.parent_id === null).length;
  const nestedTreeRowCount = rows.length - rootTreeRowCount;
  console.log(
    `Seeding database with object tree rows (${rows.length}: ${rootTreeRowCount} root, ${nestedTreeRowCount} nested) and additional mock objects from manifest...`
  );
  rows.push(createProgrammingFolderRow(DEFAULT_SERVER_ID));
  rows.push(...loadObjectSeedRows());
  const finalRows = resolveFinalObjectRows(rows);
  const objectViewRows = loadObjectViewRows();
  const objectCommandRows = loadObjectCommandRows();
  const supportedChildTypeRows = loadSupportedChildTypeRows();
  const objectTypeSchemas = loadObjectTypeSchemas(finalRows);
  const capturedObjectTypeSchemas = loadCapturedObjectTypeSchemas();
  const enumSchemas = loadEnumSchemas(objectTypeSchemas);
  const capturedEnumSchemas = loadCapturedEnumSchemas();

  const objectInsert = db.prepare(`
    INSERT OR REPLACE INTO objects (
      id, parent_id, network_device_id, object_type, object_type_version, classification, item_reference, name, label,
      item_json, views_json, schema_json, effective_permissions_json, commands_json, supported_child_types_json
    ) VALUES (
      @id, @parent_id, @network_device_id, @object_type, @object_type_version, @classification, @item_reference, @name, @label,
      @item_json, @views_json, @schema_json, @effective_permissions_json, @commands_json, @supported_child_types_json
    )
  `);

  const spaceInsert = db.prepare(`
    INSERT OR REPLACE INTO spaces (id, parent_id, name, item_reference, type, payload_json)
    VALUES (@id, @parent_id, @name, @item_reference, @type, @payload_json)
  `);

  const networkInsert = db.prepare(`
    INSERT OR REPLACE INTO network_devices (id, parent_id, classification, item_reference, name, payload_json)
    VALUES (@id, @parent_id, @classification, @item_reference, @name, @payload_json)
  `);

  const enumInsert = db.prepare(`
    INSERT OR REPLACE INTO enum_schemas (id, schema_json)
    VALUES (@id, @schemaJson)
  `);

  const objectTypeInsert = db.prepare(`
    INSERT OR REPLACE INTO object_type_schemas (id, schema_json, views_json)
    VALUES (@id, @schemaJson, @viewsJson)
  `);

  const objectViewsInsert = db.prepare(`
    INSERT OR REPLACE INTO object_views (object_id, items_json)
    VALUES (@object_id, @items_json)
  `);

  const objectCommandsInsert = db.prepare(`
    INSERT OR REPLACE INTO object_commands (object_id, items_json)
    VALUES (@object_id, @items_json)
  `);

  const supportedChildTypesInsert = db.prepare(`
    INSERT OR REPLACE INTO supported_child_types (object_id, payload_json)
    VALUES (@object_id, @payload_json)
  `);

  const objectTypeSchemaInsert = db.prepare(`
    INSERT OR REPLACE INTO object_type_schema (object_type, schema_json, views_json)
    VALUES (@object_type, @schema_json, @views_json)
  `);

  const enumSetInsert = db.prepare(`
    INSERT OR REPLACE INTO enum_sets (enum_id, schema_json)
    VALUES (@enum_id, @schema_json)
  `);

  const userInsert = db.prepare(`
    INSERT OR REPLACE INTO users (username, password, display_name)
    VALUES (@username, @password, @displayName)
  `);

  const seedTransaction = db.transaction(() => {
    db.exec(`
      DELETE FROM subscriptions;
      DELETE FROM streams;
      DELETE FROM users;
      DELETE FROM spaces;
      DELETE FROM network_devices;
      DELETE FROM enum_schemas;
      DELETE FROM object_type_schemas;
      DELETE FROM object_views;
      DELETE FROM object_commands;
      DELETE FROM supported_child_types;
      DELETE FROM object_type_schema;
      DELETE FROM enum_sets;
      DELETE FROM objects;
    `);

    userInsert.run({ username: 'MetasysAPI', password: 'J0hns0n1!', displayName: 'Metasys API User' });
    for (const row of finalRows) {
      objectInsert.run(row);
    }
    for (const row of loadSpaces()) {
      spaceInsert.run(row);
    }
    for (const row of loadNetworkDevices(finalRows)) {
      networkInsert.run(row);
    }
    for (const entry of enumSchemas) {
      enumInsert.run(entry);
    }

    for (const schema of objectTypeSchemas) {
      objectTypeInsert.run({
        id: schema.id,
        schemaJson: schema.schemaJson,
        viewsJson: schema.viewsJson,
      });
    }

    for (const row of objectViewRows) {
      objectViewsInsert.run(row);
    }

    for (const row of objectCommandRows) {
      objectCommandsInsert.run(row);
    }

    for (const row of supportedChildTypeRows) {
      supportedChildTypesInsert.run(row);
    }

    for (const schema of capturedObjectTypeSchemas) {
      objectTypeSchemaInsert.run({
        object_type: schema.id,
        schema_json: schema.schemaJson,
        views_json: schema.viewsJson,
      });
    }

    for (const schema of capturedEnumSchemas) {
      enumSetInsert.run({
        enum_id: schema.id,
        schema_json: schema.schemaJson,
      });
    }
  });

  seedTransaction();
}

export function seedDatabaseIfEmpty(db: Database.Database): void {
  const objectCount = db.prepare('SELECT COUNT(*) AS count FROM objects').get() as { count: number };
  if (objectCount.count > 0) {
    return;
  }

  seedDatabase(db);
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  createSchema(db);
  seedDatabase(db);
  db.close();
  process.stdout.write(`Seeded SQLite database at ${config.dbPath}\n`);
}
