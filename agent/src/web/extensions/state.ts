export class ExtensionStoreState {
  writes: Promise<unknown> = Promise.resolve();

  revision = 0;

  constructor(readonly home: string) {}
}
