import { SetMetadata } from '@nestjs/common';

export const IS_API_KEY = 'isApiKey';
export const IS_API_KEY_FROM_QUERY = 'isApiKeyFromQuery';

export const apiKeyAuth = () => SetMetadata(IS_API_KEY, true);
export const apiKeyAuthFromQuery = () =>
  SetMetadata(IS_API_KEY_FROM_QUERY, true);
