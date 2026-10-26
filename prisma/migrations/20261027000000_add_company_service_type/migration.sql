CREATE TYPE "company_service_type" AS ENUM ('amc', 'non_amc', 'regular');

CREATE TYPE "amc_type" AS ENUM ('c_amc', 'nc_amc');

ALTER TABLE "company"
ADD COLUMN "service_type" "company_service_type",
ADD COLUMN "amc_type" "amc_type";
