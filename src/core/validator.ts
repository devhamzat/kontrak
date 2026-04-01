import { Validator } from 'jsonschema';
import { ApiSchema, NetworkRequest, ValidationResult } from './types';

const validator = new Validator();

export function validateRequest(request: NetworkRequest, schema: ApiSchema): ValidationResult {
  try {
    const result = validator.validate(request.responseBody, schema.schema);

    if (result.valid) {
      return {
        requestId: request.id,
        isValid: true,
        errors: []
      };
    }

    return {
      requestId: request.id,
      isValid: false,
      errors: result.errors.map(err => ({
        path: err.property || '/',
        message: err.message || 'Validation error'
      }))
    };
  } catch (error: any) {
    return {
      requestId: request.id,
      isValid: false,
      errors: [{ path: 'schema', message: 'Schema evaluation failed: ' + error.message }]
    };
  }
}

export function matchSchema(request: NetworkRequest, schemas: ApiSchema[]): ApiSchema | undefined {
  return schemas.find(schema => {
    if (schema.method !== 'ALL' && schema.method.toUpperCase() !== request.method.toUpperCase()) {
      return false;
    }
    
    // Attempt regex match first, fallback to simple string includes
    try {
      const regex = new RegExp(schema.urlPattern);
      if (regex.test(request.url)) return true;
    } catch {
      // Ignore regex compilation error
    }
    
    return request.url.includes(schema.urlPattern);
  });
}
