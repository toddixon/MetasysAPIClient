# Mock API (Development Only)

> [!WARNING]
> This mock API is an unfinished development feature for local testing and UI integration. It is not production-ready and does not implement full Metasys API coverage.

## Purpose

The mock API provides a local pseudo backend for MetasysAPIClient development.

- Backend framework: Fastify
- Database: SQLite
- Container runtime: Docker via `compose.yaml`
- Contract source: `references/openapi_v6_14-1.json`
- Seed inputs: `references/data/` and `references/mock-seed/`

## Quick Start

1. Start the Angular app against the mock API:

```bash
npm run proxy:mock
```

2. Build or run the mock API:

```bash
npm run mock-api:build
npm run mock-api:dev
```

3. Seed/reset local data:

```bash
npm run mock-api:seed
```

4. Optional container run:

```bash
docker compose up --build mock-api
```

If you want mock commands to load environment variables automatically, place them in `mock-api/.env`.

## Currently Implemented Route Subset

The mock API currently supports app-critical routes:

- `POST /api/v6/login`
- `GET /api/v6/refreshToken`
- `GET /api/v6/stream`
- `GET /api/v6/objects`
- `GET /api/v6/objects/:objectId`
- `GET /api/v6/objects/:objectId/objects`
- `GET /api/v6/objects/:objectId/views`
- `GET /api/v6/objects/:objectId/attributes`
- `GET /api/v6/objects/:objectId/attributes/:attributeId`
- `POST /api/v6/objects/batch`
- `PATCH /api/v6/objects/:objectId`
- `DELETE /api/v6/objects/streams/:streamId/subscriptions/:subscriptionId`
- `GET /api/v6/schemas/objectTypes/:objectType`
- `GET /api/v6/schemas/enums/:enumId`
- `GET /api/v6/networkDevices`
- `GET /api/v6/spaces`

## Manifest-Driven Object Seeding

1. Add a folder under `references/mock-seed/objects/<objectId>/`.
2. Save the object snapshot as `object.json`.
3. Optionally add `views.json`, `commands.json`, and `supported-child-types.json`.
4. Add `meta.json` with at least:
   - `classification`
   - `parentId`
   - `networkDeviceId`
5. Register the folder in `references/mock-seed/manifest.json`.
6. Re-run:

```bash
npm run mock-api:seed
```

## Refreshing Snapshots From Live Metasys

The exporter is located at `mock-api/src/export-snapshots.ts`.

### Basic export example

```bash
METASYS_BASE_URL=https://desktop-vm/api/v6 \
METASYS_USERNAME=your-user \
METASYS_PASSWORD=your-password \
npm run mock-api:refresh -- --object 828d2053-4e99-5511-93fb-bb5063033e83 --overwrite
```

### Selectors

- `--object <id>`: export one object
- `--pathTo <id>`: export all objects on the path to a target object

### Useful flags

- `--dry-run`: report planned writes without changing files
- `--overwrite`: replace existing captured artifacts
- `--out-dir <path>`: write to a different output folder
- `--verbose`: log request and response details with secrets redacted
- `--login-only`: verify login then exit
- `--insecure`: disable TLS certificate verification for development troubleshooting only

After refreshing snapshots, reseed local data:

```bash
npm run mock-api:seed
```

## Exported Artifacts

The exporter writes files such as:

- `references/mock-seed/objects/<id>/object.json`
- `references/mock-seed/objects/<id>/meta.json`
- `references/mock-seed/objects/<id>/views.json`
- `references/mock-seed/objects/<id>/commands.json`
- `references/mock-seed/objects/<id>/supported-child-types.json`
- `references/data/object-type-schemas/<objectType>.json`
- `references/data/enums/<enumId>.json`
- `references/mock-seed/manifest.json`

## Live Sync On Read

The mock API supports two read modes:

- Sync disabled: serve local SQLite-backed data
- Sync enabled: query live Metasys on eligible routes, compare payloads, update local cache when different, then return refreshed data

Enable sync-on-read with:

```bash
METASYS_SYNC_ON_READ=1
```

Environment variables used by sync-enabled runtime:

- `METASYS_BASE_URL`
- `METASYS_USERNAME`
- `METASYS_PASSWORD`
- `METASYS_TOKEN`
- `METASYS_SYNC_ON_READ`

`METASYS_BASE_URL` may be either:

- `https://desktop-vm`
- `https://desktop-vm/api/v6`

## Troubleshooting Metasys Login

1. Verify login via curl:

```bash
curl -k -X POST 'https://desktop-vm/api/v6/login' \
  -H 'Accept: application/vnd.metasysapi.v6+json' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: API-Client' \
  --data '{"username":"your-user","password":"your-password"}'
```

2. Verify exporter login only:

```bash
METASYS_BASE_URL=https://desktop-vm/api/v6 \
METASYS_USERNAME=your-user \
METASYS_PASSWORD=your-password \
npm run mock-api:refresh -- --login-only --verbose
```

3. Retry with insecure TLS for development certificates:

```bash
METASYS_INSECURE_TLS=1 \
METASYS_BASE_URL=https://desktop-vm/api/v6 \
METASYS_USERNAME=your-user \
METASYS_PASSWORD=your-password \
npm run mock-api:refresh -- --login-only --verbose
```

4. Run full export after login succeeds:

```bash
METASYS_BASE_URL=https://desktop-vm/api/v6 \
METASYS_USERNAME=your-user \
METASYS_PASSWORD=your-password \
npm run mock-api:refresh -- --object 828d2053-4e99-5511-93fb-bb5063033e83 --overwrite --verbose
```
