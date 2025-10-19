import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletTransactionsCursorIndex1729405000000
  implements MigrationInterface
{
  name = 'WalletTransactionsCursorIndex1729405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wallet_tx_wallet_created_desc" ON "wallet_transactions" ("wallet_id", "createdAt" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_wallet_tx_wallet_created_desc"`,
    );
  }
}
