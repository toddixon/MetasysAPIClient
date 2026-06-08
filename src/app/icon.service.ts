import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { catchError, forkJoin, map, Observable, of, tap } from 'rxjs';
import { objectClassToFontIcon, objectStateIconMap, ObjectTreeIcons, objectTypeToIcon, svgIcons } from './models/icon-styling.models';
import { GetObjectsResponseItemsInner } from './api';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class IconService {
  private _matIconRegistry = inject(MatIconRegistry);
  private _loggerService = inject(LoggerService);
  private _domSanitizer = inject(DomSanitizer);
  private _http = inject(HttpClient);


  constructor() {
    svgIcons.forEach(icon => {
      this._matIconRegistry.addSvgIcon(icon,
        this._domSanitizer.bypassSecurityTrustResourceUrl(`assets/icons/${icon}.svg`),
      );
    })
  }

  public preloadIcons(): Observable<void> {
    const fetches = svgIcons.map(name =>
      this._http.get(`assets/icons/${name}.svg`, { responseType: 'text' }).pipe(
        tap(svgText =>
          this._matIconRegistry.addSvgIconLiteral(
            name,
            this._domSanitizer.bypassSecurityTrustHtml(svgText),
          )
        ),
        catchError((err) => {
          this._loggerService.error('Icon Service Error', err.message);
          return of()
        }),
      )
    );
    return forkJoin(fetches).pipe(map(() => void 0));
  }

  public getSvgIcon(state?: string) {
    return state ? objectStateIconMap[state] ?? 'exclamation_0' : ''
  }

  public isSvgIcon(name: string): boolean {
    return svgIcons.includes(name);
  }

  public getIconForClass(obj: GetObjectsResponseItemsInner): ObjectTreeIcons {
    let classification = obj.classification;
    if (classification === 'object' || classification === 'extension' || classification === 'integration' || classification === 'point' && obj.objectType) {
      if (obj.objectType in objectTypeToIcon) {
        return objectTypeToIcon[obj.objectType as keyof typeof objectTypeToIcon];
      } else {
        console.error(`Icon not configured for the specific objectType (${obj.objectType}) for item: ${obj.itemReference}`)
      }
    }
    return objectClassToFontIcon[classification!] || 'help';
  }

}
