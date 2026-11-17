/**
 * An error that already knows its HTTP status. Domain code throws it at the
 * source; the web server maps it to a response once, instead of each route
 * guessing a status from the message text.
 */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export function invalidRequest(message: string): HttpError {
  return new HttpError(400, message);
}
