import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletAuditLog } from './entities/wallet-audit-log.entity';

interface AuditLogInput {
  userId?: string | null;
  walletId?: string | null;
  action: string;
  meta?: Record<string, unknown> | null;
}

@Injectable()
export class WalletAuditService {
  constructor(
    @InjectRepository(WalletAuditLog)
    private readonly auditRepo: Repository<WalletAuditLog>,
  ) {}

  log(input: AuditLogInput): Promise<WalletAuditLog> {
    const record = this.auditRepo.create({
      userId: input.userId ?? null,
      walletId: input.walletId ?? null,
      action: input.action,
      meta: input.meta ?? null,
    });
    return this.auditRepo.save(record);
  }
}
