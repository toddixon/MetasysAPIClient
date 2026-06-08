import { Component, inject, Input, signal, WritableSignal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { Observable } from 'rxjs';
import { prettyJson } from '../helpers/jsonSyntax';
import { skeletonTheme } from '../constants/ngxSkeleton.consants';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DisplayItem } from '../models/display.models';

@Component({
  selector: 'app-unformatted-display',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatDividerModule,
    MatIcon,
    NgxSkeletonLoaderComponent
],
  templateUrl: './unformatted-display.component.html',
  styleUrl: './unformatted-display.component.scss'
})
export class UnformattedDisplayComponent {
  @Input({ required: true }) displayItem!: DisplayItem;

  private _sanitizer = inject(DomSanitizer);

  public ngxSkeletonTheme = skeletonTheme;
  public hidden0: WritableSignal<boolean> = signal(true);
  public hidden1: WritableSignal<boolean> = signal(true);


  public getPrettyJson(data: object): SafeHtml {
    return prettyJson(data, this._sanitizer);
  }

}
