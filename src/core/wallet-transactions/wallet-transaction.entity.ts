import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../shared/base.entity';
import { Wallet } from '../wallets/wallet.entity';
import { User } from '../users/user.entity';

export enum WalletTransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum WalletTransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum WalletTransactionRefType {
  ORDER = 'order',
  PAYOUT = 'payout',
  ADJUSTMENT = 'adjustment',
}

@Index('IDX_wallet_transactions_created_at', ['createdAt'])
@Index('IDX_wallet_transactions_status', ['status'])
@Index('IDX_wallet_transactions_group_id', ['groupId'])
@Entity({ name: 'wallet_transactions' })
@Unique('UQ_wallet_tx_wallet_idempotency', ['walletId', 'idempotencyKey'])
export class WalletTransaction extends BaseEntity {
  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Index('IDX_wallet_transactions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: WalletTransactionType,
    enumName: 'wallet_transaction_type_enum',
  })
  type: WalletTransactionType;

  @Column({
    type: 'enum',
    enum: WalletTransactionStatus,
    enumName: 'wallet_transaction_status_enum',
    default: WalletTransactionStatus.PENDING,
  })
  status: WalletTransactionStatus;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  amount: string;

  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0',
  })
  balanceAfter: string;

  @Column({
    name: 'ref_type',
    type: 'enum',
    enum: WalletTransactionRefType,
    enumName: 'wallet_transaction_ref_type_enum',
  })
  refType: WalletTransactionRefType;

  @Column({ name: 'ref_id', type: 'varchar', nullable: true })
  refId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
  })
  idempotencyKey: string;

  @Column({ name: 'external_ref', type: 'varchar', length: 255, nullable: true })
  externalRef: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider: string | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => Wallet, (wallet) => wallet.transactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @ManyToOne(() => User, (user) => user.walletTransactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;
}
