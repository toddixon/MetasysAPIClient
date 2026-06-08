import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { FormService } from '../form.service';
import { FormControlWithMetaData } from '../models/formControlWithMetadata.model';
import { FormGroupWithMetaData } from '../models/formGroupWithMetadata.model';
import { MatIconModule } from '@angular/material/icon';
import { CommandFormControls, CommandPriorityEntry, isAggregateCommand } from '../models/objectCommand.models';
import { catchError, combineLatest, isObservable, map, Observable, of, startWith, tap } from 'rxjs';
import { DisplayGroup } from '../models/object-views.models';
import { AggregateCommandSet, CommandEntry, GetObjectCommands200ResponseItemsInner, PutCommandRequest } from '../api';
import { EnumMember } from '../models/enum-set.models';
import { MatTableModule } from '@angular/material/table';
import { MatSliderModule } from '@angular/material/slider';
import { ObjectManagerService } from '../objectManager.service';
import { environment } from '../../environments/environment.development';
import { ngxSkeletonThemes } from '../constants/ngxSkeleton.consants';
import { DivFormControlDirective } from "../directives/divFormControl";
import { FloatInputSliderControlComponent } from "../float-input-slider-control/float-input-slider-control.component";
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-object-command-dialog',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatIconModule,
    MatTabsModule,
    MatCheckboxModule,
    MatMenuModule,
    MatDialogModule,
    MatTableModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatDialogActions,
    MatSliderModule,
    MatDialogContent,
    MatDividerModule,
    NgxSkeletonLoaderComponent,
    DivFormControlDirective,
    FloatInputSliderControlComponent
  ],
  templateUrl: './object-command-dialog.component.html',
  styleUrl: './object-command-dialog.component.scss',
  // changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObjectCommandDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<ObjectCommandDialogComponent>);
  public data: { objectId: string, command: GetObjectCommands200ResponseItemsInner, keyGroup: DisplayGroup, priorityArray$?: Observable<{ commandEntry: CommandPriorityEntry[], enumSet: EnumMember[] }> } = inject(MAT_DIALOG_DATA);

  private _formService = inject(FormService);
  private _objectManagerService = inject(ObjectManagerService);

  public isAggregateCommand = isAggregateCommand;
  public title: string = this.data.command.title ?? 'Command';
  public properties: any = {};
  public parameters: Array<any> = [];
  public commandControlGroups: CommandFormControls;
  public primaryControl?: FormControlWithMetaData;
  public annotationControl?: FormControlWithMetaData | null;
  public priorityControl?: FormControlWithMetaData | null;
  public isObservable = isObservable;
  public commonControls: { priority?: FormControlWithMetaData, annotation?: FormControlWithMetaData } = {};

  public priorityColumns: string[] = ['priority', 'value'];
  public commandForm: FormGroupWithMetaData;
  public priorityWarn$?: Observable<EnumMember | undefined>;
  public defautPriority: EnumMember = environment.defaultPriorityMember;
  public keyView: FormControlWithMetaData[] = [];
  public keyControl?: FormControlWithMetaData;
  public ngxSkeletonThemes = ngxSkeletonThemes;

  public executingCommand: WritableSignal<boolean> = signal(false);

  public skeletonThemeDark = {
    'background-color': "#7f7f7f",
    'border-radius': '5px',
    height: '5em',
    width: '100%',
    margin: 'unset',
  }
  public skeletonThemeLight = {
    'background-color': "#cbcbcb",
    'border-radius': '5px',
    height: '3em',
    width: '100%',
    margin: 'unset',
  }


  constructor() {
    this.keyView = this.getControlArray(this.data.keyGroup.group);
    if (this.data.keyGroup.keyAttribute) {
      this.keyControl = this.data.keyGroup.group.get(this.data.keyGroup.keyAttribute) as FormControlWithMetaData;
      const keyIdx = this.keyView.findIndex(c => c.name == this.data.keyGroup.keyAttribute);
      this.keyView.splice(keyIdx, 1);
    }

    if (isAggregateCommand(this.data.command)) {
      this.commandControlGroups = this.getAggregatedControls(this.data.command);
    } else {
      this.commandControlGroups = this.getCommandControls(this.data.command);
    }
    let groups: Record<string, FormGroupWithMetaData> = {};
    Object.values(this.commandControlGroups).forEach((g: FormGroupWithMetaData | undefined) => {
      if (g) {
        groups[g.id] = g;
      }
    });

    const validCtrlId = this.data.command.id.split('.')[1] ?? this.data.command.id;

    this.commandForm = new FormGroupWithMetaData(
      groups,
      { title: this.data.command.title ?? validCtrlId, id: validCtrlId }
    );

    if (this.commandControlGroups.commonControls) {
      const priorityControl = this.commandControlGroups.commonControls.get('priority') as FormControlWithMetaData;
      const annotationControl = this.commandControlGroups.commonControls.get('annotation') as FormControlWithMetaData;

      this.priorityWarn$ = of();

      this.commonControls = { priority: priorityControl, annotation: annotationControl };


    }

    const priorityCtrlVal$ = this.commonControls.priority?.valueChanges.pipe(startWith(this.commonControls.priority?.value));
    const priorityWrn$ = combineLatest([priorityCtrlVal$!, this.data.priorityArray$!]);

    this.priorityWarn$ = priorityWrn$.pipe(
      map(([selectedPriority, { commandEntry: priorityArray, enumSet }]) => {
        const selectedMember = (enumSet).find((m) => m.const == selectedPriority) ?? enumSet[0];

        //* Returns EnumMember object (True) if selected priority memberId is greater than an entry in the priority array 
        const warn = priorityArray.find((p) => p.memberId < selectedMember.memberId!) ? selectedMember : undefined;
        return warn;
      })

    );

  }

  ngOnInit(): void {

  }

  public getCommandControls(command: CommandEntry): CommandFormControls {
    let commandControls: CommandFormControls;
    const schema = command.commandBodySchema as any;
    this.properties = schema.properties;
    this.parameters = this.properties.parameters?.items;
    const commandId = this.data.command.id.split('.')[1] ?? this.data.command.id;
    commandControls = this._formService.buildCommandSchemaForm({ title: this.title, id: commandId }, schema);

    return commandControls;
  }

  public getAggregatedControls(command: AggregateCommandSet): CommandFormControls {
    let commandControls: CommandFormControls;
    let group;
    const options: EnumMember[] = [];

    command.commandSet.forEach(c => {
      options.push({
        const: c.id,
        title: c.title ?? c.id
      });
    });

    this.primaryControl = new FormControlWithMetaData({ value: options[0].const, disabled: false }, {}, command.id.split('.')[1] ?? command.id, command, of(options))
    const controlRecord: Record<string, FormControlWithMetaData> = {};
    controlRecord[this.primaryControl.name] = this.primaryControl;
    if (Object.keys(controlRecord)) {
      group = new FormGroupWithMetaData(controlRecord, { title: this.primaryControl.title, id: this.primaryControl.name });
      group.setParent(this.commandForm);
    }
    commandControls = this._formService.buildCommandSchemaForm({ title: command.title ?? command.id, id: command.id.split('.')[1] ?? command.id }, command.commandSet[0].commandBodySchema);
    commandControls.parameters = group ?? undefined;

    return commandControls;
  }

  public getControlValidator(control: FormControlWithMetaData, validator: string): any {
    const val = control.validator?.({} as any)?.['maxlength']?.requiredLength;
    return val;
  }

  public getControlArray(group: FormGroupWithMetaData | undefined): Array<FormControlWithMetaData> {
    const controls = Object.values(group?.controls ?? {});
    return controls as Array<FormControlWithMetaData>;
  }


  public onSendClick() {
    let commandReq = this.buildCommandRequest(this.commandControlGroups.parameters?.value);

    this.executeCommand(commandReq).pipe(
      tap({
        subscribe: () => this.executingCommand.set(true),
        finalize: () => this.executingCommand.set(false),
      }),
      catchError((err) => {
        return of(this.dialogRef.close(err));
      }),
      tap((data) => {
        console.log(data);
        this.dialogRef.close(data);
      }),
    ).subscribe();
  };

  public buildCommandRequest(parameterControlValues?: any): { commandId: string, commandRequest: PutCommandRequest } {
    const commandRequest: PutCommandRequest = {};
    let commandId: string;

    commandRequest.annotation = this.commonControls.annotation?.value;
    commandRequest.priority = this.commonControls.priority?.value;

    if (this.data.command.aggregateCommand) {
      commandId = this.primaryControl?.value;
      commandRequest.parameters = Object.values(parameterControlValues).filter(p => p !== commandId);
    } else {
      commandId = this.data.command.id;
      commandRequest.parameters = Object.values(parameterControlValues ?? {});
    }

    return { commandId, commandRequest };
  };

  public executeCommand({ commandId, commandRequest }: { commandId: string, commandRequest: PutCommandRequest }): Observable<any> {

    return this._objectManagerService.executeCommand(this.data.objectId, commandId, commandRequest);

  }

  public onCancelClick(): void {
    this.dialogRef.close();
  }




}
