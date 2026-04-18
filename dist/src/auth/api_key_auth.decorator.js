"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuthFromQuery = exports.apiKeyAuth = exports.IS_API_KEY_FROM_QUERY = exports.IS_API_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.IS_API_KEY = 'isApiKey';
exports.IS_API_KEY_FROM_QUERY = 'isApiKeyFromQuery';
const apiKeyAuth = () => (0, common_1.SetMetadata)(exports.IS_API_KEY, true);
exports.apiKeyAuth = apiKeyAuth;
const apiKeyAuthFromQuery = () => (0, common_1.SetMetadata)(exports.IS_API_KEY_FROM_QUERY, true);
exports.apiKeyAuthFromQuery = apiKeyAuthFromQuery;
//# sourceMappingURL=api_key_auth.decorator.js.map