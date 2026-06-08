import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { authGuard } from './guards/auth.guard';
import { ObjectsNavigationTreeComponent } from './network-objects/objects-navigation-tree.component';
import { SpacesNavigationTreeComponent } from './spaces-navigation-tree/spaces-navigation-tree.component';
import { navigationTreeParam } from './constants/router.constants';
import { NavigationTreeService } from './navigation-tree.service';
import { oidsExistGuard } from './guards/objectId.guards';

export const routes: Routes = [
  {
    path: "login",
    component: LoginComponent,
    pathMatch: "prefix",
  },
  {
    path: "home",
    canActivate: [authGuard],
    component: HomeComponent,
    children: [
      {
        path: "objects", title: "ObjectsTree", component: ObjectsNavigationTreeComponent,
      },
      {
        path: `objects/:oids`, title: "ObjectsTree", component: ObjectsNavigationTreeComponent,
        canActivate: [oidsExistGuard],
        resolve: { navigationTreeParam: NavigationTreeService },
      },
      {
        path: "spaces", title: "SpacesTree", component: SpacesNavigationTreeComponent,
      },
      { path: '', redirectTo: 'objects', pathMatch: 'full' },
    ]
  },
  { path: "**", redirectTo: "home" },
];
