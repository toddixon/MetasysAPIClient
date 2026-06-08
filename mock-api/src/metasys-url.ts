function normalizeTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function splitPathAndSearch(value: string): { pathname: string; search: string } {
  const queryIndex = value.indexOf('?');
  if (queryIndex === -1) {
    return { pathname: value, search: '' };
  }

  return {
    pathname: value.slice(0, queryIndex),
    search: value.slice(queryIndex),
  };
}

export function normalizeMetasysBaseUrl(baseUrl: string): string {
  return normalizeTrailingSlashes(baseUrl);
}

export function buildMetasysUrl(baseUrl: string, requestPath: string): string {
  const normalizedBaseUrl = normalizeMetasysBaseUrl(baseUrl);
  const normalizedRequestPath = normalizeLeadingSlash(requestPath);
  const requestParts = splitPathAndSearch(normalizedRequestPath);
  const url = new URL(normalizedBaseUrl);
  const basePath = normalizeTrailingSlashes(url.pathname);

  let requestPathname = requestParts.pathname;
  if (
    basePath.length > 0 &&
    basePath !== '/' &&
    (requestPathname === basePath || requestPathname.startsWith(`${basePath}/`))
  ) {
    requestPathname = requestPathname.slice(basePath.length) || '/';
  }

  const joinedPath = `${basePath === '/' ? '' : basePath}${requestPathname === '/' ? '' : requestPathname}` || '/';
  url.pathname = joinedPath;
  url.search = requestParts.search;
  return url.toString();
}
