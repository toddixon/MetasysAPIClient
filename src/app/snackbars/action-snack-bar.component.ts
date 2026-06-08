import { Component, HostBinding, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_SNACK_BAR_DATA, MatSnackBarAction, MatSnackBarActions, MatSnackBarLabel, MatSnackBarRef } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { ActionWarnEvent } from '../models/dialog.models';

@Component({
  selector: 'app-action-snack-bar',
  imports: [
    MatButtonModule,
    MatSnackBarActions,
    MatDividerModule
  ],
  templateUrl: './action-snack-bar.component.html',
  styleUrl: './action-snack-bar.component.scss',
  host: {
    class: 'snackbar-warn'
  }
})
export class ActionSnackBarComponent {
  private snackBarRef = inject(MatSnackBarRef);
  public data: ActionWarnEvent = inject(MAT_SNACK_BAR_DATA);
  public objNames = this.data.nodes?.map(n => n.name);

}