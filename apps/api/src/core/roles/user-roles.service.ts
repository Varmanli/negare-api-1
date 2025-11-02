import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { FindUserRolesQueryDto } from './dto/find-user-roles-query.dto';

type UserRoleWithRelations = PrismaNamespace.UserRoleGetPayload<{
  include: {
    user: true;
    role: true;
  };
}>;

@Injectable()
export class UserRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindUserRolesQueryDto): Promise<UserRoleWithRelations[]> {
    const where: PrismaNamespace.UserRoleWhereInput = {};

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.roleId) {
      where.roleId = query.roleId;
    }

    if (query.roleName) {
      where.role = { name: query.roleName };
    }

    return this.prisma.userRole.findMany({
      where,
      include: {
        user: true,
        role: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignRole(dto: AssignRoleDto): Promise<UserRoleWithRelations> {
    const existing = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: dto.userId,
          roleId: dto.roleId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Role already assigned to this user.');
    }

    return this.prisma.userRole.create({
      data: {
        userId: dto.userId,
        roleId: dto.roleId,
      },
      include: {
        user: true,
        role: true,
      },
    });
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.userRole.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(
          `User role assignment with id ${id} not found.`,
        );
      }
      throw error;
    }
  }
}
