/**
 * TypeORM entity storing OTP issuance history, including hashed codes and consumption status.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Supported delivery channels for OTP codes.
 */
export enum OtpChannel {
  sms = 'sms',
  email = 'email',
}

@Entity({ name: 'otp_codes' })
@Index(['identifier', 'channel', 'expiresAt'])
/**
 * Represents an OTP issuance attempt for a particular identifier/channel.
 */
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: OtpChannel })
  channel: OtpChannel;

  @Column({ length: 255 })
  identifier: string;

  @Column({ length: 64 })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
