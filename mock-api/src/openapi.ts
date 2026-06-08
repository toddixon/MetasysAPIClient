import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

interface OpenApiInfo {
  title?: string;
  version?: string;
  'x-revision'?: string;
}

interface OpenApiDocument {
  info?: OpenApiInfo;
  paths?: Record<string, unknown>;
}

let cachedDocument: OpenApiDocument | null = null;

export function loadOpenApiDocument(): OpenApiDocument {
  if (cachedDocument) {
    return cachedDocument;
  }

  const filePath = path.join(config.referencesRoot, 'openapi_v6_14-1.json');
  cachedDocument = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OpenApiDocument;
  return cachedDocument;
}

export function getOpenApiSummary(): { title: string; version: string; revision: string; pathCount: number } {
  const document = loadOpenApiDocument();

  return {
    title: document.info?.title ?? 'Metasys REST API',
    version: document.info?.version ?? 'unknown',
    revision: document.info?.['x-revision'] ?? 'unknown',
    pathCount: Object.keys(document.paths ?? {}).length,
  };
}
