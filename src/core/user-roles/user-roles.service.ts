/**
 * UserRolesService manages the relationship between users and roles.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from './user-role.entity';
import { FindUserRolesQueryDto } from './dto/find-user-roles-query.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

@Injectable()
/**
 * Provides queries and mutations for the user-role join table.
 */
export class UserRolesService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
  ) {}

  /**
   * Retrieves user-role assignments with optional filtering by user/role.
   * @param query Filter DTO containing identifiers or role names.
   */
  async findAll(query: FindUserRolesQueryDto): Promise<UserRole[]> {
    const qb = this.userRolesRepository
      .createQueryBuilder('userRole')
      .leftJoinAndSelect('userRole.user', 'user')
      .leftJoinAndSelect('userRole.role', 'role')
      .orderBy('userRole.createdAt', 'DESC');

    if (query.userId) {
      qb.andWhere('userRole.userId = :userId', { userId: query.userId });
    }

    if (query.roleId) {
      qb.andWhere('userRole.roleId = :roleId', { roleId: query.roleId });
    }

    if (query.roleName) {
      qb.andWhere('role.name = :roleName', { roleName: query.roleName });
    }

    return qb.getMany();
  }

  /**
   * Assigns a role to a user if the pairing does not already exist.
   * @param dto Payload containing both user id and role id.
   * @throws ConflictException when the role is already assigned.
   */
  async assignRole(dto: AssignRoleDto): Promise<UserRole> {
    const existing = await this.userRolesRepository.findOne({
      where: { userId: dto.userId, roleId: dto.roleId },
    });

    if (existing) {
      throw new ConflictException('«Ì‰ ‰ﬁ‘ ﬁ»·« »Â ò«—»— «Œ ’«’ œ«œÂ ‘œÂ «” ');
    }

    const userRole = this.userRolesRepository.create({
      userId: dto.userId,
      roleId: dto.roleId,
    });
    return this.userRolesRepository.save(userRole);
  }

  /**
   * Deletes a user-role association by its id.
   * @param id UserRole id.
   * @throws NotFoundException when the id is not found.
   */
  async remove(id: string): Promise<void> {
    const result = await this.userRolesRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`—òÊ—œ ‰ﬁ‘ ò«—»— »« ‘‰«”Â ${id} Ì«›  ‰‘œ`);
    }
  }
}
