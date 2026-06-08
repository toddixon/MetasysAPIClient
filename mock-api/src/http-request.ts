import http from 'node:http';
import https from 'node:https';

export interface SimpleRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

export interface SimpleResponse {
  status: number;
  statusText: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export function sendHttpRequest(url: string, init: SimpleRequestInit = {}): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requestImpl = target.protocol === 'https:' ? https.request : http.request;
    const headers = { ...(init.headers ?? {}) };
    const body = init.body;

    if (body !== undefined && headers['Content-Length'] === undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    const request = requestImpl(
      target,
      {
        method: init.method ?? 'GET',
        headers,
        rejectUnauthorized: init.rejectUnauthorized,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
          });
        });
      }
    );

    request.on('error', reject);

    if (body !== undefined) {
      request.write(body);
    }

    request.end();
  });
}
