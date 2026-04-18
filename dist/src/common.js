"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapCallTypeToEnum = exports.mapAccessLevelToEnum = exports.mapStatusToEnum = exports.getcompanyFromAccount = exports.generateHash = exports.getAccountFromCompany = exports.EG_ID_PREFIX = void 0;
const client_1 = require("@prisma/client");
const crypto = require("crypto");
exports.EG_ID_PREFIX = "EG-";
const uuid_1 = require("uuid");
function getAccountFromCompany(companyId, prefix) {
    const prefixStr = prefix ?? "";
    const hash = generateHash(companyId.toString() + (0, uuid_1.v4)());
    const result = prefixStr + hash.padStart(10, "0");
    return result;
}
exports.getAccountFromCompany = getAccountFromCompany;
function generateHash(input) {
    const inputBytes = Buffer.from(input, "utf-8");
    const hashBytes = crypto.createHash("sha256").update(inputBytes).digest();
    return bufferToBase36(hashBytes, 10);
}
exports.generateHash = generateHash;
const base36Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function bufferToBase36(buffer, length = 10) {
    let base36String = "";
    const bufferLength = Math.min(length, buffer.length);
    for (let i = 0; i < bufferLength; i++) {
        const byte = buffer[i];
        base36String += base36Chars[byte % 36];
    }
    return base36String;
}
function getcompanyFromAccount(accountId) {
    accountId = accountId.replace(`${exports.EG_ID_PREFIX}`, "");
    const MAX_company_ID = 999999;
    for (let i = 0; i < MAX_company_ID; i++) {
        const companyId = i;
        const egAccount = getAccountFromCompany(companyId.toString(), "");
        if (egAccount === accountId) {
            return Number(companyId);
        }
    }
    return null;
}
exports.getcompanyFromAccount = getcompanyFromAccount;
function mapStatusToEnum(dbStatus) {
    switch (dbStatus?.toLowerCase()) {
        case "open":
            return client_1.status.open;
        case "hold":
            return client_1.status.hold;
        case "in_progress":
            return client_1.status.in_progress;
        case "closed":
            return client_1.status.closed;
        default:
            return undefined;
    }
}
exports.mapStatusToEnum = mapStatusToEnum;
function mapAccessLevelToEnum(dbAccessLevel) {
    switch (dbAccessLevel?.toLowerCase()) {
        case "client":
            return client_1.access_level.client;
        case "client_admin":
            return client_1.access_level.client_admin;
        case "technician":
            return client_1.access_level.technician;
        case "eg_admin":
            return client_1.access_level.eg_admin;
        case "eg_super_admin":
            return client_1.access_level.eg_super_admin;
        case "others":
            return client_1.access_level.others;
        default:
            return undefined;
    }
}
exports.mapAccessLevelToEnum = mapAccessLevelToEnum;
function mapCallTypeToEnum(dbCallType) {
    switch (dbCallType?.toLowerCase()) {
        case "amc_preventive_maintenance":
            return client_1.call_type.amc_preventive_maintenance;
        case "breakdown":
            return client_1.call_type.breakdown;
        case "service":
            return client_1.call_type.service;
        default:
            return undefined;
    }
}
exports.mapCallTypeToEnum = mapCallTypeToEnum;
const samplecompanyIds = [572030, 572031, 572271];
for (const companyId of samplecompanyIds) {
    console.log(`${companyId}: ${getAccountFromCompany(companyId.toString(), "EG-")}`);
}
//# sourceMappingURL=common.js.map