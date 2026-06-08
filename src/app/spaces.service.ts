import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { ObjectTree } from './models/api-object.models';
import { reqOptions, spaceRoutes } from './constants/api.constants';
import { SpacesTree } from './models/spaces-tree.models';

@Injectable({
  providedIn: 'root'
})
export class SpacesService {
  private _httpClient = inject(HttpClient);

  public getSpaces(): Observable<SpacesTree> {
    // return of({} as ObjectTree);
    return this._httpClient.get<SpacesTree>(spaceRoutes.spaces, reqOptions as object).pipe(
      tap((spaces) => {
        console.log('Retrieved Spaces Tree!');
      })
    )
  }

}
