ALTER TYPE "audit_entity" ADD VALUE 'service_type';

CREATE TABLE "service_type" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "service_type_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_type_name_key" ON "service_type"("name");

ALTER TABLE "equipment" ADD COLUMN "service_type_link" INTEGER;

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_service_type_link_fkey" FOREIGN KEY ("service_type_link") REFERENCES "service_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;
