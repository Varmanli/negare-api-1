import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { JsonNull } from '@app/prisma/prisma.constants';

interface AuditLogInput {
  userId?: string | null;
  walletId?: string | null;
  action: string;
  meta?: Prisma.InputJsonValue | null;
}

@Injectable()
export class WalletAuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(input: AuditLogInput) {
    return this.prisma.walletAuditLog.create({
      data: {
        userId: input.userId ?? null,
        walletId: input.walletId ?? null,
        action: input.action,
        meta: input.meta ?? JsonNull,
      },
    });
  }
}
