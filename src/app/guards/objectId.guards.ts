import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthenticationManagerService } from '../authentication-manager.service';
import { catchError, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { navigationTreeParam } from '../constants/router.constants';
import { parseAndValidateOids } from '../helpers/objectId';
import { NavigationTreeService } from '../navigation-tree.service';
import { ObjectManagerService } from '../objectManager.service';
import { LoggerService } from '../logger.service';

export const oidsExistGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const navigationTreeService = inject(NavigationTreeService);
  const objectManagerService = inject(ObjectManagerService);

  const objects = route.paramMap.get(navigationTreeParam);
  if (!objects) return true;

  const validIdStr = parseAndValidateOids(objects);
  if (validIdStr !== objects) {
    const redirectTree = validIdStr ? ['home', 'objects', validIdStr] : ['home', 'objects'];
    return of(router.createUrlTree(redirectTree));
  }

  return true;
};