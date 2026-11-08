/** An error whose HTTP status is part of its meaning; routes send `status` as-is. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
