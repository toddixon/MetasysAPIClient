export const environment = {

  envName: 'production',
  production: true,
  host: '',
  port: 4200,
  username: '',
  password: '',
  apiBaseUrl: undefined,

  asyncDelay: 0,

  tokenRefreshDeltaT: 60,
  tokenRefreshInterval: 30 * 1000,

  keyGroup: 'groupTypeEnumSet.keyGrpType',
  noGroup: 'groupTypeEnumSet.noGrpType',

  defaultPriorityMember: {
    const: "writePriorityEnumSet.priorityDefault",
    title: "16 (Default)",
    memberId: 16,
  },

  storageKeys: {
    token: 'accessToken',
    version: 'apiVersion',
    baseUrl: 'baseUrl',
    streamId: 'lastEventId',
  },

  snackBarDurations: {
    short: 500,
    medium: 1000,
    long: 3000,
  },

  maxConcurrentRequests: 5,
  requestDelay: 100,
  streamReconnectionDelay: 1_000,
  streamConnectionTimeout: 10_000,

  loginTimeout: 10_000,

  queryRetryCount: 3,
  queryRetryDelay: 100,

  sideNavParams: {
    initWidth: 300,
    minWidth: 200,
    maxWidth: 800
  },

  maxSubscriptions: 100,

  maxSliderRange: 1e6,
  maxSliderSteps: 1000,

  localUniqueIdentifierRegex: new RegExp(/^[^\x00-\x1F\x7F\x22#'*,.\/:<>?@\[\\\]|]+$/),
  localUniqueIdentifierMaxLength: 32,

  copyMaxDescendantDepth: 3,

};
