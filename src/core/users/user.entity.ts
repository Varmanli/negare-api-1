/**
 * User entity stores core identity information and relations to roles and wallets.
 */
import { Column, Entity, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../shared/base.entity';
import { UserRole } from '../user-roles/user-role.entity';
import { Wallet } from '../wallets/wallet.entity';
import { WalletTransaction } from '../wallet-transactions/wallet-transaction.entity';

@Entity({ name: 'users' })
/**
 * Represents an authenticated principal within the Negare platform.
 */
export class User extends BaseEntity {
  @Column({ type: 'varchar', unique: true })
  username: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles: UserRole[];

  @OneToOne(() => Wallet, (wallet) => wallet.user)
  wallet: Wallet | null;

  @OneToMany(
    () => WalletTransaction,
    (transaction) => transaction.user,
  )
  walletTransactions: WalletTransaction[];
}
