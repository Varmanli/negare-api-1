import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'wallet_audit_logs' })
@Index('IDX_wallet_audit_user_created', ['userId', 'createdAt'])
@Index('IDX_wallet_audit_wallet_created', ['walletId', 'createdAt'])
export class WalletAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'wallet_id', type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;
}
