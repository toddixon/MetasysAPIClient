import { getMainPageUniqueProperties, type ObjectSnapshot } from './copied-object.models';

describe('copied-object models', () => {
  const createSnapshot = (required: string[]): ObjectSnapshot => ({
    sourceObjectId: 'obj-1',
    sourceParentId: 'parent-1',
    objectType: 'objectTypeEnumSet.folderType',
    name: 'Test Object',
    label: 'TEST',
    itemReference: 'adx:oas/TEST',
    hasChildrenMatchingQuery: false,
    schemaResponse: {
      schema: {
        type: 'object',
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        language: 'en-US',
        title: 'Test',
        version: '1',
        $id: 'test',
        definitions: {},
        required,
        properties: {
          instanceNumber: { title: 'Instance Number', type: 'number', metasysType: 'ulong' },
          macAddress: { title: 'MAC Address', type: 'string', metasysType: 'string' },
          trunkNumber: { title: 'Trunk Number', type: 'number', metasysType: 'ulong' },
          description: { title: 'Description', type: 'string', metasysType: 'string' },
        },
      },
      views: [],
    },
    batchAttributeResponse: { responses: [] },
  });

  it('returns only sibling-unique main-page properties that are required', () => {
    const snapshot = createSnapshot(['instanceNumber', 'description', 'macAddress']);

    expect(getMainPageUniqueProperties(snapshot)).toEqual(['instanceNumber', 'macAddress']);
  });

  it('returns an empty list when none of the tracked unique properties are required', () => {
    const snapshot = createSnapshot(['description']);

    expect(getMainPageUniqueProperties(snapshot)).toEqual([]);
  });
});
