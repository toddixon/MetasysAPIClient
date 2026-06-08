import { Component, Input, OnInit } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { Observable, tap } from 'rxjs';
import { EnumMember } from '../models/enum-set.models';
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { CommonModule } from '@angular/common';
import { FormControlWithMetaData } from '../models/formControlWithMetadata.model';

@Component({
  selector: 'app-display-field',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatButtonModule,
    MatCheckboxModule,
    MatInputModule,
    NgxSkeletonLoaderModule,
  ],
  templateUrl: './display-field.component.html',
  styleUrl: './display-field.component.scss'
})
export class DisplayFieldComponent implements OnInit {

  @Input({ required: true }) control!: FormControlWithMetaData;
  public type$!: Observable<string | EnumMember[]>;

  ngOnInit(): void {
    // this.type$ = this.control.type.pipe(
    //   tap((data) => {
    //     console.log(data);
    //   }),
    // )
  }

}
