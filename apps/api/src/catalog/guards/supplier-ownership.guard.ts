import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@app/prisma/prisma.service';
import { CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { isAdmin, isSupplier } from '../policies/catalog.policies';

@Injectable()
export class SupplierOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserPayload }>();
    const currentUser = request.user;

    if (!currentUser) {
      throw new ForbiddenException('Authentication required');
    }

    if (isAdmin(currentUser)) {
      return true;
    }

    if (!isSupplier(currentUser)) {
      throw new ForbiddenException('Only suppliers may manage products');
    }

    const productId = request.params?.id;
    if (!productId) {
      throw new BadRequestException('Product id param is required');
    }

    const numericId = this.ensureNumericId(productId);

    const ownsProduct = await this.prisma.product.findFirst({
      where: {
        id: numericId,
        supplierLinks: {
          some: { userId: currentUser.id },
        },
      },
      select: { id: true },
    });

    if (!ownsProduct) {
      throw new ForbiddenException('Supplier does not own this product');
    }

    return true;
  }

  private ensureNumericId(productId: string): bigint {
    if (!/^\d+$/.test(productId)) {
      throw new BadRequestException('Product id must be numeric');
    }
    return BigInt(productId);
  }
}

