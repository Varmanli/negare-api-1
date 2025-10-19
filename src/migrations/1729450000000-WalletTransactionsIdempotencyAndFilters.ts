import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletTransactionsIdempotencyAndFilters1729450000000
  implements MigrationInterface
{
  name = 'WalletTransactionsIdempotencyAndFilters1729450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "balance" TYPE numeric(18,2) USING ("balance"::numeric)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ALTER COLUMN "amount" TYPE numeric(18,2) USING ("amount"::numeric)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ALTER COLUMN "idempotency_key" TYPE character varying(255)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "description" character varying(1000)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "created_by_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "UQ_wallet_transactions_idempotency_key"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "UQ_wallet_tx_wallet_idempotency" UNIQUE ("wallet_id", "idempotency_key")`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wallet_transactions_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "FK_wallet_transactions_created_by"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "UQ_wallet_tx_wallet_idempotency"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "created_by_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "description"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ALTER COLUMN "idempotency_key" TYPE text`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "UQ_wallet_transactions_idempotency_key" UNIQUE ("idempotency_key")`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ALTER COLUMN "amount" TYPE bigint USING (ROUND("amount")::bigint)`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "balance" TYPE bigint USING (ROUND("balance")::bigint)`,
    );
  }
}
