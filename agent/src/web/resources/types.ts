export interface StoredFile {
  path: string;
  id: string;
  age: number;
  size: number;
  ino: number;
  mtimeMs: number;
}

export class ResourceSettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
