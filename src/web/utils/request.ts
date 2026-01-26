/**
 * Request utility functions
 */

import type { IncomingMessage } from 'node:http';

/**
 * Parse JSON request body
 */
export async function parseRequestBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
          return;
        }

        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Parse query string from URL
 */
export function parseQueryString(url: string): Record<string, string> {
  const query: Record<string, string> = {};

  if (!url.includes('?')) {
    return query;
  }

  const queryString = url.split('?')[1] || '';
  const pairs = queryString.split('&');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      query[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    }
  }

  return query;
}
