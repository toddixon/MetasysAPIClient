// import "../api/model/getObjectsResponseItemsInner";
import { Observable } from "rxjs";

import "../api/model/objectEntityInTree";
import "../api/model/objectMinimalList";


declare module "../api/model/objectEntityInTree" {
  interface ObjectEntityInTree {
    expanded?: boolean;
    attribute$?: Observable<any>;
  }

}

declare module "../api/model/objectMinimalList" {
  interface ObjectMinimalList {
    expanded?: boolean;
    attribute$?: Observable<any>;
  }
}

