# @

## Introduction  The Metasys REST API is the exposed interface for accessing data from a Johnson Controls® Metasys system. This spec documents `v6` of the API for Metasys 15.0. This documentation was last updated on October 29, 2025 at 9:00 PM (UTC) and is assigned the revision identifier `ab97043e`.  > **Note**\\ > The Metasys REST API is only supported on the following Metasys products: ADS, > ADX, and OAS. The REST API is not supported on Metasys for Validated > Environments (MVE) sites. Do not attempt to use the REST API on an MVE site.   Metasys is a network-based building automation system (BAS) that operates the mechanical and electrical equipment in your building. For an introduction to Metasys, refer to _Metasys System_ in [Metasys System Configuration Guide](https://docs.johnsoncontrols.com/bas/r/Metasys/en-US/Metasys-System-Configuration-Guide/12.0). For a glossary of Metasys terms, refer to [Metasys System Glossary](https://docs.johnsoncontrols.com/bas/r/Metasys/en-US/Metasys-System-Glossary/12.0). For additional information on Metasys, search the Johnson Controls documentation site [Knowledge Exchange](https://docs.johnsoncontrols.com/bas/).  This specification defines the operations you can use to retrieve data through the API. For further information on the Metasys API, including tutorials, see the [Metasys API home page](https://jci-metasys.github.io/api-landing).  © 2025 Johnson Controls Tyco IP Holdings LLP.  ## Feedback  If you see issues with this documentation, please open an [issue](https://github.com/jci-metasys/api-landing/issues/new) and let us know about it.  ## Supported Releases  This is version 6 of the Metasys REST API. It is supported on the following releases of Metasys: 14.0, 14.1 and 15.0  Newer releases of Metasys may offer enhancements to `6` not available on earlier releases. By default, everything in this spec is available on all of the mentioned releases. Where there are exceptions they are called out in the following ways.  - The description of any element that is supported on only a subset of the above   releases will list the supported subset. (For example:   <span style=\"color: #92989b; font-size: 13px\">RELEASES:</span><span style=\"color: #d41f1c;\">   <strong>14.1 and 15.0</strong></span>). - Any operation listed in the navigation pane that is only supported on a subset   of the above releases will be denoted with an asterisk.  ## Base URL  The base path for the API is `https://{hostname}/api/v6` where `{hostname}` is the host name of your Metasys server.  ### API Version Notes  Multiple versions of this API may be supported on one release of Metasys. See the [Version Support Matrix](https://jci-metasys.github.io/api-landing/guides/version-support-matrix) to identify which versions are available for your release of Metasys.  You must specify which version you intend to use in the URL, using the format `v[#]`.  For example, `https://localhost/api/v6/spaces` for version 6 of `spaces`.  #### Version Response Behavior  The `Content-Type` header of the response will always identify the version of the API that was used to serve the request.  For example, `Content-Type: application/vnd.metasysapi.v6+json` for version 6.  ## Licensed Operations  You must obtain an additional license to access some operations. For more information, refer to the _Licensing information_ and _Software information_ sections in [Metasys System Software Purchase Options Product Bulletin (LIT-12011703)](https://docs.johnsoncontrols.com/bas/access/sources/dita/map?ft:locale=en-US&docnumber=LIT-12011703).  ### Monitoring and Commanding API license  The Monitoring and Commanding API enables reading, writing, and commanding one or more Metasys objects/properties, including Present Value. This API succeeds the Metasys System Secure Data Access dynamic link library (MSSDA DLL).  The following operations require the Monitoring and Commanding API license:  - [Get an object](#operation/getObject) - [Edit an object](#operation/patchObject) - [Get attribute value](#operation/getObjectAttribute) - [List the commands of an object](#operation/getObjectCommands) - [Send command](#operation/putObjectCommand) - [Batch object operations](#operation/postObjectsBatch)  <!-- In the future we\'ll have config APIs as well. License restrictions (if any) will need to be customized for offline APIs -->  ## Case Sensitivity Rules  In general, you should assume that all URLs, parameter names, parameter values, payload property names and payload property values are case sensitive. For example:  - All attributes of objects are case sensitive. For example, many objects have   an attribute named `presentValue`. It is case sensitive and must always be   spelled `presentValue`. - Enumeration set names and set members are case sensitive (for example,   `reliabilityEnumSet.reliable`, `displayPrecisionEnumSet.displayPrecision1`,   and `writePriorityEnumSet.priorityDefault`).  ## Pagination  For operations where `page` and `pageSize` is allowed, the default `page` number will be 1 and is 1-based for all paths while the default `pageSize` will vary between paths. The `page` parameter indicates the page number of items to return from the path. The `pageSize` parameter indicates the maximum number of items in the response from the path.  Payloads returned by pagination-enabled paths have a similar structure. A `total` property indicates the total number of items included in all pages. A `next` and `previous` property supplies a link to the next and previous page of data, respectively. These properties can be empty if irrelevant (for example, if it is the first/last page, or there is only one page of data). The `items` property contains the data included in the page.  ## Sorting Rules  For operations where a `sort` query parameter is allowed, the supplied value should be in the format of a single attribute name, optionally prefixed with `-` to indicate descending sort order (ascending order is used if no prefix is supplied).  ## Relationship Links  Payloads may contain links to related data, each represented as a property sharing the name of the respective relationship. The links point to either single or multiple related entities. A link to a single entity points to the canonical path for that entity. A link to multiple entities points to a path dedicated to representing that particular relationship.  For example, if object `/objects/a` has children `/objects/b` and `/objects/c`, the payload returned by `/objects/a` will have a property `objects` with a value of `/objects/a/objects`, because multiple children can be returned. However, the payload returned by `/objects/b/` will contain a property `parent` with a value of `/objects/a` (not `/objects/b/parent`), because the relationship represents a single entity.  Additionally, each payload contain a `self` property, which contains a link representing the path used to obtain the data contained in the current payload.  ## DateTimes  All date-times in the alarms, audits, activities, and samples operations are ISO-8601 encoded strings in UTC. Other operations, such as objects, use a proprietary structure further described in supporting documentation.  ## Streaming  Some operations accept a stream ID to receiving notifications. These notifications are sent over a stream, which is a long-running server-sent event request. A single stream can be used for multiple subscriptions. To obtain a stream ID to use with these operations:  1. Make a [Get a stream](#operation/getStream) request. 2. Listen for a `hello` event that contains the stream ID.  ## Validation and Common Error Codes  There are some general rules that apply across all operations. If certain provided inputs are invalid or preconditions are not met, the API will respond with an appropriate error to indicate what went wrong.  | Condition                         | Error                       | Details                                                                                                         | | --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- | | Invalid request body              | 400 (Bad Request)           | A body is provided which does not adhere to the expected format and/or schema                                   | | Missing required parameter        | 400 (Bad Request)           | A parameter marked required in this document is not included in the request                                     | | Parameter incorrect type          | 400 (Bad Request)           | A parameter is included with a value of the wrong type (for example, number is expected and string is provided) | | Parameter out of range            | 400 (Bad Request)           | A numeric parameter is included but the value is outside the allowed range                                      | | Parameter not in set              | 400 (Bad Request)           | A string parameter has a set of predefined valid values, and the value provided is not included in that set     | | Parameter not in correct format   | 400 (Bad Request)           | A string parameter with expected format is provided in the wrong format                                         | | Unsupported `Content-Type`        | 400 (Bad Request)           | An unsupported `Content-Type` header is provided                                                                | | User not authenticated            | 401 (Unauthorized)          | The auth token supplied with the request is missing, invalid, or expired                                        | | Record not authorized             | 403 (Forbidden)             | The user is not authorized to view data matching the provided identifier or too many requests                   | | Invalid user type                 | 403 (Forbidden)             | Not an \"API user\"; not all user accounts have API access                                                        | | API version not supported for MVE | 403 (Forbidden)             | An operation was attempted against a validated resource using a version of an API not supported for MVE         | | Identifier not found              | 404 (Not Found)             | An identifier is provided that does not match any known data                                                    | | The resource already exists       | 409 (Conflict)              | The resource already exists                                                                                     | | Internal Server Error             | 500 (Internal Server Error) | An unexpected error occurred                                                                                    | | The device is not supported       | 501 (Not Implemented)       | The server does not support the functionality required to fulfill the request                                   | | A service is unavailable          | 503 (Service Unavailable)   | A service is currently unavailable to service the request.                                                      | | The device is offline             | 504 (Bad Gateway)           | An attempt was made to talk to another device that is currently offline.                                        |  ## Schemas in Response Payloads  The response payload of some operations in this document have a section of information labeled `schema`. This section of information includes important pieces of metadata about the `item` or `items` attributes that gives better context to the meaning of attribute values. This section follows [JSON Schema](http://json-schema.org/schema) specification with added custom annotation keywords.  ## Using the Code Snippets  This is information about the code snippets provided for each operation.  The snippets are written in such a way that you should be able to copy and paste them and run them with appropriate modifications to the parameters. The operations require you to be authenticated so start with the [Request access token](#operation/createToken) operation first to get an accessToken.  Then use that token in any other operation that requires it by including it in the `Authorization` header.  **Note:** Any operation that requires a binary payload will make mention of a fictitious method like `GetPayloadData()` to load a buffer with data. These snippets will not work \"as-is\" and require you to actually fill the buffer with the necessary data.  ### Shell + Curl  These snippets rely on `curl` and are meant to be run in a terminal shell like `bash`.  The example for the _Request access token_ operation which you use to login relies on the [jq](https://github.com/jqlang/jq) command line tool to parse out the `accessToken` and store it in a variable named `accessToken`. This variable is then used in every operation that requires an `Authorization` header.  ### C# + Flurl  The examples for the csharp language use the Flurl.Http package. They are tested using version 4 of [Flurl](https://github.com/tmenier/Flurl).  ### Powershell  The examples for powershell use `Invoke-RestMethod` and were tested using [powershell core](https://github.com/PowerShell/PowerShell) version 7.4.  ### Node + Axios  The examples for javascript for Node.js use the Axios library. They are tested using a ES module syntax so that top level async/await commands can be used. [Axios](https://github.com/axios/axios) version 1.7 was used for testing.  ### PS Metasys Rest Client  The examples in this section use powershell core version 7.4 and use the Powershell [MetasysRestClient](https://github.com/jci-metasys/powershell-metasysrestclient) version 2.4.  The MetasysRestClient is a lightweight command line client that reduces boiler plate text when using powershell to call the Metasys REST API. It\'s primarily meant as a development tool to aid in making quick calls to Metasys to check how an API works. In particular, once authenticated, its very nice for `GET` calls. A typical `GET` looks like  ```powershell Invoke-MetasysMethod /objects/{objectId} ```  ### Python  The examples in this section were tested with version 3.13.1 of [python](https://www.python.org).  ### Java  The example for the _Request access token_ operation which you use to login relies on the [org.json library](https://github.com/stleary/JSON-java) to parse out the `accessToken` from the JSON response and store it in a variable named `accessToken`. This variable is then used in every operation that requires an `Authorization` header.  The examples were tested with the OpenJDK 24 version of [java](https://jdk.java.net/24/) and version `20240303` of `org.json`.  ## Security  <security-definitions /> 

The version of the OpenAPI document: Version 6 for 15.0

## Building

To install the required dependencies and to build the typescript sources run:

```console
npm install
npm run build
```

## Publishing

First build the package then run `npm publish dist` (don't forget to specify the `dist` folder!)

## Consuming

Navigate to the folder of your consuming project and run one of next commands.

_published:_

```console
npm install @ --save
```

_without publishing (not recommended):_

```console
npm install PATH_TO_GENERATED_PACKAGE/dist.tgz --save
```

_It's important to take the tgz file, otherwise you'll get trouble with links on windows_

_using `npm link`:_

In PATH_TO_GENERATED_PACKAGE/dist:

```console
npm link
```

In your project:

```console
npm link 
```

__Note for Windows users:__ The Angular CLI has troubles to use linked npm packages.
Please refer to this issue <https://github.com/angular/angular-cli/issues/8284> for a solution / workaround.
Published packages are not effected by this issue.

### General usage

In your Angular project:

```typescript

import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi()
    ],
};
```

**NOTE**
If you're still using `AppModule` and haven't [migrated](https://angular.dev/reference/migrations/standalone) yet, you can still import an Angular module:
```typescript
import { ApiModule } from '';
```

If different from the generated base path, during app bootstrap, you can provide the base path to your service.

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi('http://localhost:9999')
    ],
};
```

```typescript
// with a custom configuration
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi({
            withCredentials: true,
            username: 'user',
            password: 'password'
        })
    ],
};
```

```typescript
// with factory building a custom configuration
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi, Configuration } from '';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        {
            provide: Configuration,
            useFactory: (authService: AuthService) => new Configuration({
                    basePath: 'http://localhost:9999',
                    withCredentials: true,
                    username: authService.getUsername(),
                    password: authService.getPassword(),
            }),
            deps: [AuthService],
            multi: false
        }
    ],
};
```

### Using multiple OpenAPI files / APIs

In order to use multiple APIs generated from different OpenAPI files,
you can create an alias name when importing the modules
in order to avoid naming conflicts:

```typescript
import { provideApi as provideUserApi } from 'my-user-api-path';
import { provideApi as provideAdminApi } from 'my-admin-api-path';
import { HttpClientModule } from '@angular/common/http';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideUserApi(environment.basePath),
        provideAdminApi(environment.basePath),
    ],
};
```

### Customizing path parameter encoding

Without further customization, only [path-parameters][parameter-locations-url] of [style][style-values-url] 'simple'
and Dates for format 'date-time' are encoded correctly.

Other styles (e.g. "matrix") are not that easy to encode
and thus are best delegated to other libraries (e.g.: [@honoluluhenk/http-param-expander]).

To implement your own parameter encoding (or call another library),
pass an arrow-function or method-reference to the `encodeParam` property of the Configuration-object
(see [General Usage](#general-usage) above).

Example value for use in your Configuration-Provider:

```typescript
new Configuration({
    encodeParam: (param: Param) => myFancyParamEncoder(param),
})
```

[parameter-locations-url]: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#parameter-locations
[style-values-url]: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#style-values
[@honoluluhenk/http-param-expander]: https://www.npmjs.com/package/@honoluluhenk/http-param-expander
