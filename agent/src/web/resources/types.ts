import { HttpError } from '../../core/api/errors.js';

export interface StoredFile {
  path: string;
  id: string;
  age: number;
  size: number;
  ino: number;
  mtimeMs: number;
}

export class ResourceSettingsError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
  }
}
