import { access_level, call_type, status } from "@prisma/client";
import * as crypto from "crypto";

export const EG_ID_PREFIX = "EG-";
import { v4 as uuidv4 } from "uuid";

/**
 *  Fn to generate account-id (EG-ID) from company-id
 * @param companyId company-id
 * @param prefix eg: EG / VP
 * @returns account Id (EG-ID)  e.g. "574646" => "EG-OW1EQY72H3"
 */
export function getAccountFromCompany(
  companyId: string,
  prefix?: string
): string {
  const prefixStr = prefix ?? "";
  const hash = generateHash(companyId.toString() + uuidv4());
  const result = prefixStr + hash.padStart(10, "0");
  // console.log(`${companyId}: ${result}`);
  return result;
}

export function generateHash(input: string) {
  const inputBytes = Buffer.from(input, "utf-8");
  const hashBytes = crypto.createHash("sha256").update(inputBytes).digest();
  // we get  EG-OW1EQY72H3
  return bufferToBase36(hashBytes, 10);
}
// 10 digit alphanumeric (base36) string representation of hash (eg: OW1EQY72H3)
const base36Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function bufferToBase36(buffer: Buffer, length = 10) {
  let base36String = "";
  const bufferLength = Math.min(length, buffer.length);

  for (let i = 0; i < bufferLength; i++) {
    const byte = buffer[i];
    base36String += base36Chars[byte % 36];
  }

  return base36String;
}

/**
 *  Fn to get company-id from account-id
 * @param accountId account-id (EG-ID)
 * @returns company Id (EG-ID)  e.g. "EG-OW1EQY72H3" => "574646"
 */
export function getcompanyFromAccount(accountId) {
  // remove EG_ID_PREFIX- if present
  accountId = accountId.replace(`${EG_ID_PREFIX}`, "");
  const MAX_company_ID = 999999;
  for (let i = 0; i < MAX_company_ID; i++) {
    const companyId = i;
    const egAccount = getAccountFromCompany(companyId.toString(), "");
    // console.log(companyId, 'companyId', egAccount, 'egAccount');
    if (egAccount === accountId) {
      return Number(companyId);
    }
  }
  return null;
}

export function mapStatusToEnum(dbStatus): status | undefined {
  switch (dbStatus?.toLowerCase()) {
    case "open":
      return status.open;
    case "hold":
      return status.hold;
    case "in_progress":
      return status.in_progress;
    case "completed":
    case "complete":
      return status.completed;
    case "closed":
      return status.closed;
    default:
      return undefined;
  }
}

export function mapAccessLevelToEnum(dbAccessLevel): access_level | undefined {
  switch (dbAccessLevel?.toLowerCase()) {
    case "client":
      return access_level.client;
    case "client_admin":
      return access_level.client_admin;
    case "technician":
      return access_level.technician;
    case "eg_admin":
      return access_level.eg_admin;
    case "eg_super_admin":
      return access_level.eg_super_admin;
    case "others":
      return access_level.others;
    default:
      return undefined;
  }
}

export function mapCallTypeToEnum(dbCallType): call_type | undefined {
  switch (dbCallType?.toLowerCase()) {
    case "amc_preventive_maintenance":
      return call_type.amc_preventive_maintenance;
    case "breakdown":
      return call_type.breakdown;
    case "service":
      return call_type.service;
    default:
      return undefined;
  }
}

const samplecompanyIds = [572030, 572031, 572271];

for (const companyId of samplecompanyIds) {
  console.log(
    `${companyId}: ${getAccountFromCompany(companyId.toString(), "EG-")}`
  );
}
