/** Erros de domínio, mapeados para status HTTP na camada de rotas. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'not_found');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'validation_error', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'conflict');
  }
}

/** Falha vinda da API de uma plataforma de anúncios. */
export class ProviderError extends AppError {
  constructor(
    readonly platform: string,
    message: string,
    details?: unknown,
  ) {
    super(message, 502, 'provider_error', details);
  }
}
