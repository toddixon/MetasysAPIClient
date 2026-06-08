import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthenticationManagerService } from '../authentication-manager.service';
import { catchError, map, of, tap, throwError } from 'rxjs';

export const authGuard: CanActivateFn = (route, state) => {
  let router = inject(Router);
  return inject(AuthenticationManagerService).isAuthenticated().pipe(
    map((auth: boolean) => {
      if (auth) {
        return auth
      }
      return router.createUrlTree(['/login'])
    }),
    catchError(() => of(router.createUrlTree(['/login'])).pipe(
    ))
  )

};
