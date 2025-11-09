/**
 * config.ts
 * 
 * This file manages the application configuration settings.
 * It provides a centralized place for all configuration values,
 * making them easier to change and maintain.
 * 
 * WHY A SEPARATE CONFIG FILE?
 * - Single source of truth for configuration values
 * - Easy to update settings without searching through the codebase
 * - Allows for environment-specific overrides
 * - Makes configuration values available throughout the application
 */
import path from 'path';
import os from 'os';
import fs from 'fs';

import dotenv from 'dotenv';
dotenv.config();

/**
 * Database configuration defaults
 * 
 * We use the user's home directory for database storage by default,
 * which provides several advantages:
 * - Works across different operating systems
 * - Available without special permissions
 * - Persists across application restarts
 * - Doesn't get deleted when updating the application
 */
const DEFAULT_DB_FOLDER = path.join(os.homedir(), '.todo-list-mcp');
const DEFAULT_DB_FILE = 'todos.sqlite';

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 4041;
const DEFAULT_HTTP_SSE_PATH = '/sse';
const DEFAULT_HTTP_MESSAGES_PATH = '/messages';

function normalizeToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Application configuration object
 * 
 * This object provides access to all configuration settings.
 * It uses environment variables when available, falling back to defaults.
 * 
 * WHY USE ENVIRONMENT VARIABLES?
 * - Allows configuration without changing code
 * - Follows the 12-factor app methodology for configuration
 * - Enables different settings per environment (dev, test, prod)
 * - Keeps sensitive information out of the code
 */
export const config = {
  db: {
    // Allow overriding through environment variables
    folder: process.env.TODO_DB_FOLDER || DEFAULT_DB_FOLDER,
    filename: process.env.TODO_DB_FILE || DEFAULT_DB_FILE,
    
    /**
     * Full path to the database file
     * 
     * This getter computes the complete path dynamically,
     * ensuring consistency even if the folder or filename change.
     */
    get path() {
      return path.join(this.folder, this.filename);
    }
  },
  http: {
    host: process.env.TODO_HTTP_HOST || DEFAULT_HTTP_HOST,
    port: parsePort(process.env.TODO_HTTP_PORT, DEFAULT_HTTP_PORT),
    ssePath: process.env.TODO_HTTP_SSE_PATH || DEFAULT_HTTP_SSE_PATH,
    messagesPath: process.env.TODO_HTTP_MESSAGES_PATH || DEFAULT_HTTP_MESSAGES_PATH,
    authScheme: (process.env.TODO_HTTP_AUTH_SCHEME || 'Bearer').trim(),
    authToken: normalizeToken(process.env.TODO_HTTP_AUTH_TOKEN),
    get baseUrl() {
      const host = this.host.includes(':') && !this.host.startsWith('[')
        ? `[${this.host}]`
        : this.host;
      return `http://${host}:${this.port}`;
    },
    get sseUrl() {
      return `${this.baseUrl}${this.ssePath}`;
    },
    get messagesUrl() {
      return `${this.baseUrl}${this.messagesPath}`;
    },
    get requiresAuth() {
      return Boolean(this.authToken);
    },
    get expectedAuthHeader() {
      if (!this.requiresAuth) {
        return undefined;
      }
      return `${this.authScheme} ${this.authToken}`;
    }
  }
};

/**
 * Ensure the database folder exists
 * 
 * This utility function makes sure the folder for the database file exists,
 * creating it if necessary. This prevents errors when trying to open the
 * database file in a non-existent directory.
 */
export function ensureDbFolder() {
  if (!fs.existsSync(config.db.folder)) {
    fs.mkdirSync(config.db.folder, { recursive: true });
  }
} 