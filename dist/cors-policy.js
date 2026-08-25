"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configuredCorsOrigins = configuredCorsOrigins;
exports.isCorsOriginAllowed = isCorsOriginAllowed;
function configuredCorsOrigins(urls, nodeEnv = process.env.NODE_ENV) {
    const origins = new Set();
    for (const raw of urls) {
        if (!raw)
            continue;
        try {
            origins.add(new URL(raw).origin);
        }
        catch { /* invalid config is not an allowed origin */ }
    }
    if (nodeEnv !== "production") {
        origins.add("http://localhost:3000");
        origins.add("http://127.0.0.1:3000");
    }
    return origins;
}
function isCorsOriginAllowed(origin, allowed) {
    return !origin || allowed.has(origin);
}
