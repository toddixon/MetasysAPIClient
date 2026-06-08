# Copilot Instructions

## Commands

```bash
npm start                     # Dev server at http://localhost:4200
npm run proxy                 # Dev server with proxy to Metasys server (for CORS)
npm run build                 # Production build
npm test                      # Run all unit tests (Karma + Jasmine)
npm run gen:api               # Regenerate API client from OpenAPI spec
```

To run a single test file, use the `--include` flag with Karma or focus with `fdescribe`/`fit` in the spec file.

Before `start`, `build`, and `proxy`, a `preX` script runs `scripts/generate-icon-manifest.mjs` automatically.

## Architecture

### Generated API Client — do not edit
`src/app/api/` is auto-generated from `references/openapiv6m150.json` via openapi-generator-cli. **Never manually edit files here.** Run `npm run gen:api` to regenerate when the spec changes.

### HTTP Request Pipeline (always follow this order)
```
Component
  → Domain service (e.g. ObjectManagerService, SpacesService)
      → RequestQueueService.request(() => apiService.someCall())
          → Interceptors: PerformanceInterceptor → AuthInterceptor → ProxyInterceptor
              → Generated API service → HttpClient
```
Never call generated API services directly from components. Always route through a domain service and `RequestQueueService`.

### Extending Generated Models Without Touching Generated Code
`src/app/api-extensions/` uses TypeScript module augmentation to add UI state to generated models:
- `expanded?: boolean` and `attribute$?: Observable<any>` are added to `ObjectEntityInTree` and `ObjectMinimalList`
- `GetObjectsResponseItemsInner` is a discriminated union of both; use the type guards `isObjectEntityInTree()` / `isObjectMinimalList()` (exported from `api-extensions/`) to narrow before accessing type-specific properties like `items`

### Real-Time SSE Streaming
1. `StreamService.initStream()` opens the SSE connection; `object.values.update` events flow into `objectValuesUpdateSubject$` (a `BehaviorSubject`)
2. To subscribe an attribute for COV updates: call the generated API with `Prefer: respond-async`; pass the `metasys-subscription-location` response header to `StreamService.addSubscription()`
3. Consume updates via `listenToValueUpdates(subscriptionId)` or `listenToObjectStatus(objectId)`
4. **Always** unsubscribe with `takeUntilDestroyed(destroyRef)` on stream subscriptions in components

### Navigation Tree State
`NavigationTreeService` is the central state hub for both tree views. Key observables:
- `selectedNodesSubject$` — selected object IDs
- `selectedFqr$` — selected FQRs (used by `ObjectComponent` to auto-expand ancestors)
- `nodeSelectedEventSubject$` — click events including ctrl/shift multi-select and unsaved-changes guard

### Environment Configuration
`src/environments/environment.development.ts` contains dev settings including credentials, request throttle limits (`maxConcurrentRequests`, `requestDelay`), retry counts, and stream reconnect timings. `environment.ts` is the production equivalent. `RequestQueueService` reads these values at startup.

### Proxy Configuration
`proxy.conf.json` maps `/api/*` to the Metasys server. Update the `target` hostname before running `npm run proxy`.

## Key Conventions

- **Route through RequestQueueService**: `this._requestQueueService.request(() => this._someApiService.call())` — never call generated services directly
- **API route constants**: Use the helper functions in `src/app/constants/api.constants.ts` (e.g. `objectRoutes.objectById(id)`) rather than constructing URL strings inline
- **Type narrowing for tree items**: Always use `isObjectEntityInTree()` / `isObjectMinimalList()` before accessing union-type properties
- **RxJS cleanup**: Use `takeUntilDestroyed(destroyRef)` (not `ngOnDestroy` + `Subject`) for all subscriptions in components
- **Custom app types**: `src/app/models/` for app-specific interfaces; `src/app/api/model/` for generated API types (do not edit)
- **Icons**: Add SVG to `src/assets/icons/`, then register in `icon.service.ts` (`svgIcons` list) and map in `objectTypeToIcon`/`objectClassToFontIcon`
- **`ApiFactoryService`** (`api-factory.service.ts`) is marked `//! UNUSED` — do not use it
