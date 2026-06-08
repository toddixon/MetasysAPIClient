import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { environment } from '../environments/environment.development';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'MetasysAPIClient';
  private _matIconRegistry = inject(MatIconRegistry);
  private _domSanitizer = inject(DomSanitizer);
  public envName = environment.envName;

  constructor() {

  }


}
