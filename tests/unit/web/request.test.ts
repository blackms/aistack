import { describe, it, expect } from 'vitest';
import { parseRequestBody, parseQueryString } from '../../../src/web/utils/request.js';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';

describe('Request Utils', () => {
  describe('parseRequestBody', () => {
    function createMockRequest(data: string | string[], hasError = false): IncomingMessage {
      const stream = new Readable({
        read() {
          if (Array.isArray(data)) {
            data.forEach(chunk => this.push(chunk));
          } else {
            this.push(data);
          }
          this.push(null);

          if (hasError) {
            this.emit('error', new Error('Stream error'));
          }
        }
      });
      return stream as unknown as IncomingMessage;
    }

    it('should parse valid JSON body', async () => {
      const req = createMockRequest(JSON.stringify({ name: 'test', value: 123 }));
      const result = await parseRequestBody(req);
      expect(result).toEqual({ name: 'test', value: 123 });
    });

    it('should parse empty body as empty object', async () => {
      const req = createMockRequest('');
      const result = await parseRequestBody(req);
      expect(result).toEqual({});
    });

    it('should handle multiple data chunks', async () => {
      const req = createMockRequest(['{"na', 'me":"t', 'est"}']);
      const result = await parseRequestBody(req);
      expect(result).toEqual({ name: 'test' });
    });

    it('should parse nested objects', async () => {
      const data = { user: { name: 'John', age: 30 }, tags: ['a', 'b'] };
      const req = createMockRequest(JSON.stringify(data));
      const result = await parseRequestBody(req);
      expect(result).toEqual(data);
    });

    it('should parse arrays', async () => {
      const data = [1, 2, 3, 4, 5];
      const req = createMockRequest(JSON.stringify(data));
      const result = await parseRequestBody(req);
      expect(result).toEqual(data);
    });

    it('should parse null', async () => {
      const req = createMockRequest('null');
      const result = await parseRequestBody(req);
      expect(result).toBeNull();
    });

    it('should parse boolean', async () => {
      const req = createMockRequest('true');
      const result = await parseRequestBody(req);
      expect(result).toBe(true);
    });

    it('should parse number', async () => {
      const req = createMockRequest('42');
      const result = await parseRequestBody(req);
      expect(result).toBe(42);
    });

    it('should parse string', async () => {
      const req = createMockRequest('"hello world"');
      const result = await parseRequestBody(req);
      expect(result).toBe('hello world');
    });

    it('should reject invalid JSON', async () => {
      const req = createMockRequest('{ invalid json }');
      await expect(parseRequestBody(req)).rejects.toThrow('Invalid JSON body');
    });

    it('should reject malformed JSON', async () => {
      const req = createMockRequest('{"name": "test"');
      await expect(parseRequestBody(req)).rejects.toThrow('Invalid JSON body');
    });

    it('should handle stream errors', async () => {
      const req = createMockRequest('{"test": "data"}', true);
      await expect(parseRequestBody(req)).rejects.toThrow('Stream error');
    });

    it('should handle large JSON payloads', async () => {
      const largeObject = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item${i}` })) };
      const req = createMockRequest(JSON.stringify(largeObject));
      const result = await parseRequestBody(req);
      expect(result).toEqual(largeObject);
      expect(result.items).toHaveLength(1000);
    });

    it('should handle special characters', async () => {
      const data = { text: 'Hello 世界 🌍', emoji: '😀🎉' };
      const req = createMockRequest(JSON.stringify(data));
      const result = await parseRequestBody(req);
      expect(result).toEqual(data);
    });
  });

  describe('parseQueryString', () => {
    it('should parse simple query string', () => {
      const result = parseQueryString('http://example.com?name=test&age=25');
      expect(result).toEqual({ name: 'test', age: '25' });
    });

    it('should parse query string without values', () => {
      const result = parseQueryString('http://example.com?flag&another');
      expect(result).toEqual({ flag: '', another: '' });
    });

    it('should handle URL without query string', () => {
      const result = parseQueryString('http://example.com/path');
      expect(result).toEqual({});
    });

    it('should handle empty query string', () => {
      const result = parseQueryString('http://example.com?');
      expect(result).toEqual({});
    });

    it('should decode URL-encoded values', () => {
      const result = parseQueryString('http://example.com?name=John%20Doe&email=test%40example.com');
      expect(result).toEqual({ name: 'John Doe', email: 'test@example.com' });
    });

    it('should decode URL-encoded keys', () => {
      const result = parseQueryString('http://example.com?my%20key=value&another%20key=test');
      expect(result).toEqual({ 'my key': 'value', 'another key': 'test' });
    });

    it('should handle multiple parameters', () => {
      const result = parseQueryString('http://example.com?a=1&b=2&c=3&d=4&e=5');
      expect(result).toEqual({ a: '1', b: '2', c: '3', d: '4', e: '5' });
    });

    it('should handle parameters with special characters', () => {
      const result = parseQueryString('http://example.com?search=hello%20world&filter=%5Btag%5D');
      expect(result).toEqual({ search: 'hello world', filter: '[tag]' });
    });

    it('should handle duplicate keys (last value wins)', () => {
      const result = parseQueryString('http://example.com?name=first&name=second&name=third');
      expect(result).toEqual({ name: 'third' });
    });

    it('should handle parameters with = in value', () => {
      const result = parseQueryString('http://example.com?equation=2%2B2%3D4');
      expect(result).toEqual({ equation: '2+2=4' });
    });

    it('should handle empty parameter values', () => {
      const result = parseQueryString('http://example.com?key1=&key2=value&key3=');
      expect(result).toEqual({ key1: '', key2: 'value', key3: '' });
    });

    it('should skip empty keys', () => {
      const result = parseQueryString('http://example.com?=value&name=test&=another');
      expect(result).toEqual({ name: 'test' });
    });

    it('should handle complex query strings', () => {
      const result = parseQueryString('http://example.com?filters[status]=active&filters[type]=user&sort=-created_at&page=2&limit=50');
      expect(result).toEqual({
        'filters[status]': 'active',
        'filters[type]': 'user',
        'sort': '-created_at',
        'page': '2',
        'limit': '50'
      });
    });

    it('should handle query string with fragment', () => {
      const result = parseQueryString('http://example.com?name=test&age=25#section');
      expect(result).toEqual({ name: 'test', 'age': '25#section' });
    });

    it('should handle malformed query strings', () => {
      const result = parseQueryString('http://example.com?&&&name=test&&');
      expect(result).toEqual({ name: 'test' });
    });

    it('should handle unicode characters', () => {
      const result = parseQueryString('http://example.com?text=%E4%B8%96%E7%95%8C&emoji=%F0%9F%8C%8D');
      expect(result).toEqual({ text: '世界', emoji: '🌍' });
    });

    it('should handle single parameter', () => {
      const result = parseQueryString('http://example.com?single=value');
      expect(result).toEqual({ single: 'value' });
    });

    it('should handle path-only URL', () => {
      const result = parseQueryString('/api/users');
      expect(result).toEqual({});
    });

    it('should handle query string at different positions', () => {
      const result = parseQueryString('/api/users?active=true');
      expect(result).toEqual({ active: 'true' });
    });
  });
});
