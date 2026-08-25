"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tlsVerification = exports.allowInsecureTls = void 0;
/**
 * TLS verification is secure by default. The escape hatch exists only for a
 * temporary migration of a known legacy upstream with a broken certificate.
 */
exports.allowInsecureTls = process.env.ALLOW_INSECURE_TLS === "true";
exports.tlsVerification = {
    rejectUnauthorized: !exports.allowInsecureTls,
};
