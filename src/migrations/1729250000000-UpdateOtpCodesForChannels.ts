import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateOtpCodesForChannels1729250000000 implements MigrationInterface {
  name = 'UpdateOtpCodesForChannels1729250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "otp_codes_channel_enum" AS ENUM ('sms','email')`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ADD "channel" "otp_codes_channel_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ADD "identifier" character varying(255)`,
    );
    await queryRunner.query(
      `UPDATE "otp_codes" SET "channel" = 'sms', "identifier" = COALESCE("phone", '')`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ALTER COLUMN "channel" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ALTER COLUMN "identifier" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" DROP COLUMN IF EXISTS "phone"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_otp_codes_identifier_channel_expires_at" ON "otp_codes" ("identifier","channel","expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_otp_codes_identifier_channel_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ADD "phone" character varying(20)`,
    );
    await queryRunner.query(
      `UPDATE "otp_codes" SET "phone" = CASE WHEN "channel" = 'sms' THEN "identifier" ELSE '' END`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ALTER COLUMN "phone" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" DROP COLUMN "identifier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" DROP COLUMN "channel"`,
    );
    await queryRunner.query(`DROP TYPE "otp_codes_channel_enum"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_otp_codes_phone_expiresAt" ON "otp_codes" ("phone","expiresAt")`,
    );
  }
}
