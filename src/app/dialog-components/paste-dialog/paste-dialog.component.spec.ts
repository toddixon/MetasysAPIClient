import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { FormControl } from '@angular/forms';
import { FormService } from '../../form.service';
import { NavigationTreeService } from '../../navigation-tree.service';
import { ObjectOperationsService } from '../../object-operations.service';
import { IconService } from '../../icon.service';
import { FormControlWithMetaData } from '../../models/formControlWithMetadata.model';
import { FormGroupWithMetaData } from '../../models/formGroupWithMetadata.model';
import { DisplayGroup, ViewConfigGroup } from '../../models/object-views.models';
import { ObjectSnapshot } from '../../models/copied-object.models';
import { PasteSiblingContext } from '../../models/dialog.models';
import { PasteDialogComponent } from './paste-dialog.component';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeConfigGroups(entries: { name: string; value: any }[]): ViewConfigGroup[] {
  const controls: Record<string, FormControlWithMetaData> = {};
  const fields: FormControlWithMetaData[] = [];
  entries.forEach(({ name, value }) => {
    const ctrl = new FormControl(value) as unknown as FormControlWithMetaData;
    Object.assign(ctrl, { name, title: name, type: 'string' });
    controls[name] = ctrl;
    fields.push(ctrl);
  });
  const group = new FormGroupWithMetaData(controls, { title: 'Main', id: 'main' });
  const displayGroup: DisplayGroup = {
    id: 'grp',
    title: 'Main',
    properties: entries.map((e) => e.name),
    fields,
    group,
  };
  return [
    {
      id: 'page-1',
      title: 'Page 1',
      page: { objectId: 'obj-1', name: 'Page 1', keyView: displayGroup, views: [], dynamicProperties: [] },
    },
  ];
}

function makeSnapshot(uniqueProps: string[]): ObjectSnapshot {
  const schemaProps: Record<string, any> = {};
  uniqueProps.forEach((p) => { schemaProps[p] = { type: 'integer', title: p }; });
  return {
    sourceObjectId: 'obj-1',
    sourceParentId: 'parent-1',
    objectType: 'testType',
    name: 'TestObj',
    label: 'Test Object',
    itemReference: 'test:TestObj',
    hasChildrenMatchingQuery: false,
    schemaResponse: { schema: { required: uniqueProps, properties: schemaProps } } as any,
    batchAttributeResponse: { responses: [] } as any,
  };
}

function makeSnapshotWithIds(sourceObjectId: string, sourceParentId: string | null, objectType: string = 'objectTypeEnumSet.avClass'): ObjectSnapshot {
  return {
    sourceObjectId,
    sourceParentId,
    objectType,
    name: sourceObjectId,
    label: sourceObjectId,
    itemReference: `test:${sourceObjectId}`,
    hasChildrenMatchingQuery: false,
    schemaResponse: { schema: { required: [], properties: {} } } as any,
    batchAttributeResponse: { responses: [] } as any,
  };
}

const mockIconService = {
  getIconForClass: jasmine.createSpy('getIconForClass').and.callFake((obj: any) =>
    obj?.objectType === 'objectTypeEnumSet.avClass' ? 'speed' : 'help',
  ),
  isSvgIcon: jasmine.createSpy('isSvgIcon').and.callFake((icon: string) => icon === 'input_gauge_0'),
};

function buildProviders(
  pasteItems: ObjectSnapshot[],
  configGroupsList: ViewConfigGroup[][],
  pasteSiblingContext?: PasteSiblingContext,
) {
  let callIndex = 0;
  return [
    {
      provide: MAT_DIALOG_DATA,
      useValue: {
        operation: 'paste',
        message: '',
        doSomething: 'Paste',
        pasteItems,
        ignoredNodes: [],
        pasteSiblingContext,
      },
    },
    { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
    {
      provide: NavigationTreeService,
      useValue: {
        refreshNode: jasmine.createSpy('refreshNode'),
        getNode: jasmine.createSpy('getNode').and.returnValue(of({})),
      },
    },
    {
      provide: ObjectOperationsService,
      useValue: {
        buildCopiedObjectSnapshotFromNode: jasmine.createSpy().and.returnValue(of(null)),
        pasteSingleObject: jasmine.createSpy().and.returnValue(of(null)),
        pasteChildObject: jasmine.createSpy().and.returnValue(of(null)),
      },
    },
    {
      provide: FormService,
      useValue: {
        buildFormFromSchema: jasmine.createSpy('buildFormFromSchema'),
        buildFormConfigGroups: jasmine.createSpy('buildFormConfigGroups').and.callFake(
          () => configGroupsList[callIndex++] ?? [],
        ),
      },
    },
    { provide: IconService, useValue: mockIconService },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PasteDialogComponent', () => {
  let component: PasteDialogComponent;
  let fixture: ComponentFixture<PasteDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasteDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            operation: 'paste',
            message: 'Paste copied objects',
            doSomething: 'Paste',
            pasteItems: [],
            ignoredNodes: [],
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: jasmine.createSpy('close') },
        },
        {
          provide: NavigationTreeService,
          useValue: {
            refreshNode: jasmine.createSpy('refreshNode'),
            getNode: jasmine.createSpy('getNode').and.returnValue(of({})),
          },
        },
        {
          provide: ObjectOperationsService,
          useValue: {
            buildCopiedObjectSnapshotFromNode: jasmine.createSpy('buildCopiedObjectSnapshotFromNode').and.returnValue(of(null)),
            pasteSingleObject: jasmine.createSpy('pasteSingleObject').and.returnValue(of(null)),
            pasteChildObject: jasmine.createSpy('pasteChildObject').and.returnValue(of(null)),
          },
        },
        {
          provide: FormService,
          useValue: {
            buildFormFromSchema: jasmine.createSpy('buildFormFromSchema'),
            buildFormConfigGroups: jasmine.createSpy('buildFormConfigGroups').and.returnValue([]),
          },
        },
        { provide: IconService, useValue: mockIconService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PasteDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep the paste action enabled when there are no copied items', () => {
    expect(component.isDialogValid()).toBeTrue();
  });

  describe('when pasteSiblingContext is preloaded', () => {
    let siblingComponent: PasteDialogComponent;

    beforeEach(async () => {
      const snapshot = makeSnapshot(['macAddress']);
      const configGroups = makeConfigGroups([{ name: 'macAddress', value: null }]);
      const siblingContext: PasteSiblingContext = {
        siblingLabels: [],
        siblingUniqueValues: new Map(),
        availableMacAddresses: [],
      };
      await TestBed.configureTestingModule({
        imports: [PasteDialogComponent],
        providers: buildProviders([snapshot], [configGroups], siblingContext),
      }).compileComponents();
      const f = TestBed.createComponent(PasteDialogComponent);
      siblingComponent = f.componentInstance;
      f.detectChanges();
    });

    it('should mark the form as touched immediately so validation is visible without user interaction', () => {
      expect(siblingComponent.pasteForm.touched).toBeTrue();
    });
  });

  describe('when instanceNumber matches an existing sibling', () => {
    let warningComponent: PasteDialogComponent;

    beforeEach(async () => {
      const snapshot = makeSnapshot(['instanceNumber']);
      const configGroups = makeConfigGroups([{ name: 'instanceNumber', value: '42' }]);
      const siblingContext: PasteSiblingContext = {
        siblingLabels: [],
        siblingUniqueValues: new Map([['instanceNumber', new Set(['42'])]]),
        availableMacAddresses: [],
      };
      await TestBed.configureTestingModule({
        imports: [PasteDialogComponent],
        providers: buildProviders([snapshot], [configGroups], siblingContext),
      }).compileComponents();
      const f = TestBed.createComponent(PasteDialogComponent);
      warningComponent = f.componentInstance;
      f.detectChanges();
    });

    it('should show a warning for the matching instanceNumber', () => {
      expect(warningComponent.hasItemControlWarning(0, 'instanceNumber')).toBeTrue();
    });

    it('should keep the dialog valid (instanceNumber collision is non-blocking)', () => {
      expect(warningComponent.isDialogValid()).toBeTrue();
    });
  });

  describe('when macAddress duplicates an existing sibling', () => {
    let dupComponent: PasteDialogComponent;

    beforeEach(async () => {
      const snapshot = makeSnapshot(['macAddress']);
      const configGroups = makeConfigGroups([{ name: 'macAddress', value: null }]);
      const siblingContext: PasteSiblingContext = {
        siblingLabels: [],
        siblingUniqueValues: new Map([['macAddress', new Set(['42'])]]),
        availableMacAddresses: [],
      };
      await TestBed.configureTestingModule({
        imports: [PasteDialogComponent],
        providers: buildProviders([snapshot], [configGroups], siblingContext),
      }).compileComponents();
      const f = TestBed.createComponent(PasteDialogComponent);
      dupComponent = f.componentInstance;
      f.detectChanges();
    });

    it('should set a notUnique error and invalidate the dialog when macAddress matches a sibling', () => {
      const macCtrl = dupComponent.getConfigControl(dupComponent.topLevelConfigPages()[0], 'macAddress');
      macCtrl?.setValue('42');
      dupComponent['_checkTopLevelUniqueness']();
      expect(macCtrl?.errors?.['notUnique']).toBeTrue();
      expect(dupComponent.isDialogValid()).toBeFalse();
    });

    it('should exclude sibling-occupied mac addresses from available options', () => {
      expect(dupComponent.getMacAvailableOptions(0)).not.toContain(42);
    });
  });

  describe('hierarchy and header severity helpers', () => {
    let hierarchyComponent: PasteDialogComponent;

    beforeEach(async () => {
      const root = makeSnapshotWithIds('root', null, 'objectTypeEnumSet.avClass');
      const child = makeSnapshotWithIds('child', 'root', 'objectTypeEnumSet.avClass');
      const grandChild = makeSnapshotWithIds('grand', 'child', 'objectTypeEnumSet.avClass');
      const configGroups = [makeConfigGroups([]), makeConfigGroups([]), makeConfigGroups([])];

      await TestBed.configureTestingModule({
        imports: [PasteDialogComponent],
        providers: buildProviders([root, child, grandChild], configGroups),
      }).compileComponents();

      const f = TestBed.createComponent(PasteDialogComponent);
      hierarchyComponent = f.componentInstance;
      f.detectChanges();
    });

    it('should compute increasing depth for nested copied objects', () => {
      const items = hierarchyComponent['data'].pasteItems as ObjectSnapshot[];
      expect(hierarchyComponent.getSnapshotDepth(items[0])).toBe(0);
      expect(hierarchyComponent.getSnapshotDepth(items[1])).toBe(1);
      expect(hierarchyComponent.getSnapshotDepth(items[2])).toBe(2);
    });

    it('should report warning severity for non-blocking warnings', () => {
      (hierarchyComponent as any)._applyWarning('item-0-instanceNumber', 'warning');
      expect(hierarchyComponent.getTopLevelIssueSeverity(0)).toBe('warning');
    });

    it('should report error severity for blocking form errors', () => {
      const first = hierarchyComponent.itemsArray.at(0) as any;
      first.get('localUniqueIdentifier')?.setValue('');
      first.get('localUniqueIdentifier')?.markAsTouched();
      expect(hierarchyComponent.getTopLevelIssueSeverity(0)).toBe('error');
    });
  });
});
