export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  statusCode: number;
  responseBody: any;
  timestamp: number;
}

export interface ApiSchema {
  id: string;
  name: string;
  urlPattern: string;
  method: string;
  schema: any; // JSON Schema definition
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  requestId: string;
  isValid: boolean;
  errors: ValidationError[];
}
