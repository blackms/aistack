/**
 * Filesystem routes for folder browsing
 */

import { readdirSync, statSync, existsSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import type { AgentStackConfig, FileSystemEntry } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest } from '../middleware/error.js';
import type { ValidatePathRequest } from '../types.js';

export function registerFilesystemRoutes(router: Router, _config: AgentStackConfig): void {
  // GET /api/v1/filesystem/roots - Get root directories
  router.get('/api/v1/filesystem/roots', (_req, res) => {
    const home = homedir();
    const roots: FileSystemEntry[] = [
      {
        name: 'Home',
        path: home,
        type: 'directory',
      },
    ];

    // Add common development directories if they exist
    const commonDirs = [
      { name: 'Documents', path: join(home, 'Documents') },
      { name: 'Projects', path: join(home, 'Projects') },
      { name: 'Code', path: join(home, 'Code') },
      { name: 'Development', path: join(home, 'Development') },
      { name: 'Workspace', path: join(home, 'Workspace') },
      { name: 'Desktop', path: join(home, 'Desktop') },
    ];

    for (const dir of commonDirs) {
      if (existsSync(dir.path)) {
        try {
          accessSync(dir.path, constants.R_OK);
          roots.push({
            name: dir.name,
            path: dir.path,
            type: 'directory',
          });
        } catch {
          // Skip directories we can't access
        }
      }
    }

    sendJson(res, roots);
  });

  // GET /api/v1/filesystem/browse - Browse directory contents
  router.get('/api/v1/filesystem/browse', (_req, res, params) => {
    let path = params.query.path;
    const showHidden = params.query.showHidden === 'true';
    const showFiles = params.query.showFiles !== 'false';

    // Default to home directory if no path provided
    if (!path) {
      path = homedir();
    }

    // Resolve the path
    const resolvedPath = resolve(path);

    // Check if path exists
    if (!existsSync(resolvedPath)) {
      throw badRequest(`Path does not exist: ${path}`);
    }

    // Check if it's a directory
    const stat = statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw badRequest(`Path is not a directory: ${path}`);
    }

    // Check read access
    try {
      accessSync(resolvedPath, constants.R_OK);
    } catch {
      throw badRequest(`Cannot access directory: ${path}`);
    }

    // Read directory contents
    const entries: FileSystemEntry[] = [];

    try {
      const items = readdirSync(resolvedPath);

      for (const item of items) {
        // Skip hidden files unless explicitly requested
        if (!showHidden && item.startsWith('.')) {
          continue;
        }

        const itemPath = join(resolvedPath, item);

        try {
          const itemStat = statSync(itemPath);
          const isDirectory = itemStat.isDirectory();

          // Skip files if only directories are requested
          if (!showFiles && !isDirectory) {
            continue;
          }

          entries.push({
            name: item,
            path: itemPath,
            type: isDirectory ? 'directory' : 'file',
          });
        } catch {
          // Skip items we can't stat (permissions, broken symlinks, etc.)
        }
      }
    } catch {
      throw badRequest(`Cannot read directory: ${path}`);
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    sendJson(res, {
      path: resolvedPath,
      parent: dirname(resolvedPath) !== resolvedPath ? dirname(resolvedPath) : null,
      name: basename(resolvedPath),
      entries,
    });
  });

  // POST /api/v1/filesystem/validate - Validate a path
  router.post('/api/v1/filesystem/validate', (_req, res, params) => {
    const body = params.body as ValidatePathRequest | undefined;

    if (!body?.path) {
      throw badRequest('Path is required');
    }

    const resolvedPath = resolve(body.path);
    const validation: {
      valid: boolean;
      path: string;
      exists: boolean;
      isDirectory: boolean;
      readable: boolean;
      writable: boolean;
      errors: string[];
    } = {
      valid: true,
      path: resolvedPath,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      errors: [],
    };

    // Check if path exists
    if (!existsSync(resolvedPath)) {
      validation.valid = false;
      validation.errors.push('Path does not exist');
      sendJson(res, validation);
      return;
    }

    validation.exists = true;

    // Check if it's a directory
    try {
      const stat = statSync(resolvedPath);
      validation.isDirectory = stat.isDirectory();

      if (!validation.isDirectory) {
        validation.valid = false;
        validation.errors.push('Path is not a directory');
      }
    } catch (error) {
      validation.valid = false;
      validation.errors.push(`Cannot stat path: ${error instanceof Error ? error.message : 'unknown error'}`);
      sendJson(res, validation);
      return;
    }

    // Check read access
    try {
      accessSync(resolvedPath, constants.R_OK);
      validation.readable = true;
    } catch {
      validation.valid = false;
      validation.errors.push('Directory is not readable');
    }

    // Check write access
    try {
      accessSync(resolvedPath, constants.W_OK);
      validation.writable = true;
    } catch {
      validation.valid = false;
      validation.errors.push('Directory is not writable');
    }

    sendJson(res, validation);
  });

  // GET /api/v1/filesystem/parent - Get parent directory
  router.get('/api/v1/filesystem/parent', (_req, res, params) => {
    const path = params.query.path;

    if (!path) {
      throw badRequest('Path is required');
    }

    const resolvedPath = resolve(path);
    const parentPath = dirname(resolvedPath);

    // Check if we're at the root
    if (parentPath === resolvedPath) {
      sendJson(res, {
        path: resolvedPath,
        parent: null,
        isRoot: true,
      });
      return;
    }

    // Check if parent exists and is accessible
    if (!existsSync(parentPath)) {
      throw badRequest('Parent directory does not exist');
    }

    try {
      accessSync(parentPath, constants.R_OK);
    } catch {
      throw badRequest('Parent directory is not accessible');
    }

    sendJson(res, {
      path: resolvedPath,
      parent: parentPath,
      isRoot: false,
    });
  });
}
