/**
 * RolesService encapsulates TypeORM access for the role catalogue.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma as PrismaNamespace, RoleName } from '@prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { FindRolesQueryDto } from './dto/find-roles-query.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

type RoleRecord = PrismaNamespace.RoleGetPayload<{}>;

@Injectable()
/**
 * Provides CRUD-like helpers for roles referenced by RBAC guards.
 */
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves roles with optional filtering and limit.
   * @param query Filtering & pagination options.
   */
  async findAll(query: FindRolesQueryDto): Promise<RoleRecord[]> {
    const where: PrismaNamespace.RoleWhereInput = {};
    if (query.name) {
      where.name = query.name;
    }

    return this.prisma.role.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 25,
    });
  }

  /**
   * Finds a single role by its enum-backed name.
   * @param name Role name to locate.
   */
  findByName(name: RoleName): Promise<RoleRecord | null> {
    return this.prisma.role.findUnique({ where: { name } });
  }

  /**
   * Persists a new role.
   * @param dto Payload containing the role name.
   */
  async create(dto: CreateRoleDto): Promise<RoleRecord> {
    return this.prisma.role.create({
      data: {
        name: dto.name,
      },
    });
  }

  /**
   * Updates an existing role, currently supporting renaming.
   * @param name Current role name.
   * @param dto Update payload.
   * @throws NotFoundException when the role does not exist.
   */
  async update(name: RoleName, dto: UpdateRoleDto): Promise<RoleRecord> {
    const existing = await this.prisma.role.findUnique({ where: { name } });

    if (!existing) {
      throw new NotFoundException(`نقش ${name} یافت نشد.`);
    }

    return this.prisma.role.update({
      where: { name },
      data: {
        name: dto.name ?? name,
      },
    });
  }
}
