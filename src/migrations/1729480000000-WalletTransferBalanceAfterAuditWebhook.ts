import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletTransferBalanceAfterAuditWebhook1729480000000
  implements MigrationInterface
{
  name = 'WalletTransferBalanceAfterAuditWebhook1729480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "balance_after" numeric(18,2) NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `UPDATE "wallet_transactions" tx SET "balance_after" = wallet.balance FROM "wallets" wallet WHERE wallet.id = tx.wallet_id`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ALTER COLUMN "balance_after" DROP DEFAULT`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "external_ref" character varying(255)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "provider" character varying(64)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "group_id" uuid`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_wallet_transactions_status" ON "wallet_transactions" ("status")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_wallet_transactions_group_id" ON "wallet_transactions" ("group_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wallet_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "user_id" uuid,
        "wallet_id" uuid,
        "action" character varying(64) NOT NULL,
        "meta" jsonb
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_wallet_audit_user_created" ON "wallet_audit_logs" ("user_id", "created_at" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_wallet_audit_wallet_created" ON "wallet_audit_logs" ("wallet_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_audit_wallet_created"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_audit_user_created"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_audit_logs"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_transactions_group_id"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_transactions_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "group_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "provider"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "external_ref"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "balance_after"`,
    );
  }
}
