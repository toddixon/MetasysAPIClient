import { CommonModule } from '@angular/common';
import { Component, HostBinding, inject, Input } from '@angular/core';
import { Observable } from 'rxjs';
import { NavigationTreeService } from '../navigation-tree.service';
import { ObjectComponent } from "../object/object.component";
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GetObjectsResponseItemsInner } from '../api';
import { ngxSkeletonThemes } from '../constants/ngxSkeleton.consants';

@Component({
  selector: 'app-network-objects',
  imports: [
    CommonModule,
    ObjectComponent,
    MatProgressSpinnerModule
  ],
  templateUrl: './objects-navigation-tree.html',
  styleUrls: ['./objects-navigation-tree.scss']
})
export class ObjectsNavigationTreeComponent {

  private _navTreeService = inject(NavigationTreeService);
  public ngxSkeletonThemes = ngxSkeletonThemes;
  @Input() selectableObjectTypes: string[] | null = null;
  @Input() disableNonMatchingSelection: boolean = false;
  @Input() forceMultiSelect: boolean = false;
  @Input() pickerMode: boolean = false;

  @HostBinding('class.picker-mode')
  get isPickerMode(): boolean {
    return this.pickerMode;
  }

  public navTree$: Observable<GetObjectsResponseItemsInner | undefined> = this._navTreeService.getRootNode();

}
