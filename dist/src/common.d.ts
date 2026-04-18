import { access_level, call_type, status } from "@prisma/client";
export declare const EG_ID_PREFIX = "EG-";
export declare function getAccountFromCompany(companyId: string, prefix?: string): string;
export declare function generateHash(input: string): string;
export declare function getcompanyFromAccount(accountId: any): number;
export declare function mapStatusToEnum(dbStatus: any): status | undefined;
export declare function mapAccessLevelToEnum(dbAccessLevel: any): access_level | undefined;
export declare function mapCallTypeToEnum(dbCallType: any): call_type | undefined;
