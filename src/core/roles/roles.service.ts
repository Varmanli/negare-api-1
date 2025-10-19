/**
 * RolesService encapsulates TypeORM access for the role catalogue.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, RoleName } from './role.entity';
import { FindRolesQueryDto } from './dto/find-roles-query.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
/**
 * Provides CRUD-like helpers for roles referenced by RBAC guards.
 */
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  /**
   * Retrieves roles with optional filtering and limit.
   * @param query Filtering & pagination options.
   */
  async findAll(query: FindRolesQueryDto): Promise<Role[]> {
    const qb = this.rolesRepository
      .createQueryBuilder('role')
      .orderBy('role.createdAt', 'DESC')
      .take(query.limit ?? 25);

    if (query.name) {
      qb.where('role.name = :name', { name: query.name });
    }

    return qb.getMany();
  }

  /**
   * Finds a single role by its enum-backed name.
   * @param name Role name to locate.
   */
  findByName(name: Role['name']): Promise<Role | null> {
    return this.rolesRepository.findOne({ where: { name } });
  }

  /**
   * Persists a new role.
   * @param dto Payload containing the role name.
   */
  async create(dto: CreateRoleDto): Promise<Role> {
    const role = this.rolesRepository.create({
      name: dto.name,
    });
    return this.rolesRepository.save(role);
  }

  /**
   * Updates an existing role, currently supporting renaming.
   * @param name Current role name.
   * @param dto Update payload.
   * @throws NotFoundException when the role does not exist.
   */
  async update(name: RoleName, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.rolesRepository.findOne({ where: { name } });

    if (!role) {
      throw new NotFoundException(`نقش ${name} یافت نشد.`);
    }

    if (dto.name) {
      role.name = dto.name;
    }

    return this.rolesRepository.save(role);
  }
}
