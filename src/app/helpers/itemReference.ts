export const ITEM_REF_REGEX = /^(?<server>[a-zA-Z0-9-]+)(?::(?<engine>[a-zA-Z0-9-]+))?(?:\/(?<path>.+))?$/;
export const FQR_MATCH_REGEX = /(?<=:).*/;// Matches everything after the first colon, which is the server-engine separator in the FQR syntax. This allows us to extract the engine and path components together for further parsing.

// export const ITEM_REF_REGEX = /^([A-Z0-9-]+)(?::([A-Z0-9-]+))?(?:\/(.+))?$/;
//DESKTOP-VM:DESKTOP-VM/Programming.BV1.Trend1



//* Fully qualified reference syntax
//* <Server>:<Site-director/Network-engine>/<Object/Folder/Extension>.<Object/Folder/Extension>.<...>

export function parseFqr(itemReference: string): { server: string, engine: string, pathArr: string[] } {

  const match = itemReference.match(ITEM_REF_REGEX);
  const { server, engine, path } = match?.groups!;
  const pathArr = parsePath(path);

  return { server, engine, pathArr }
}

export function parsePath(path: string | undefined): string[] {
  return path ? path.split('.') : []
}

export function fqrInPath(currentFqr: string, targetFqr: string): boolean {
  const currentParsed = parseFqr(currentFqr);
  const targetParsed = parseFqr(targetFqr);

  if (currentParsed.server !== targetParsed.server || currentParsed.engine !== targetParsed.engine) {
    return false;
  }

  // Check if the path of the current FQR is a prefix of the target FQR's path
  for (let i = 0; i < currentParsed.pathArr.length; i++) {
    if (currentParsed.pathArr[i] !== targetParsed.pathArr[i]) {
      return false;
    }
  }

  return true;
}

export function condensePaths(paths: string[]): string[] {
  return paths.filter(path => {
    // Keep this path if no other path starts with it (followed by a separator)
    return !paths.some(otherPath =>
      otherPath !== path &&
      otherPath.startsWith(path + '.')
    );
  });
}

//This function will take a fqr and DESKTOP-VM:NS-NAE01/FC-1.M4-CGM-copy2
//
export function formatNameWithFqr(fqr: string, name?: string): string {
  if (!ITEM_REF_REGEX.test(fqr)) {
    throw new Error(`Invalid FQR format: ${fqr}`);
  }
  let ref = fqr.match(FQR_MATCH_REGEX)![0];
  let formattedRef = ref.replace(/\//g, '.');
  if (name) {
    formattedRef = formattedRef.replace(/(?<=[./])[^./]+$/, name)
  }
  return formattedRef;
}
