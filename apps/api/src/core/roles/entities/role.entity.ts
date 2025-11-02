/**
 * Role entity stores RBAC role names and relations to users.
 */
import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '@app/shared/base.entity';
import { UserRole } from './user-role.entity';

/**
 * Enumerates canonical role names recognized by the platform.
 */
export enum RoleName {
  USER = 'user',
  SUPPLIER = 'supplier',
  ADMIN = 'admin',
}

@Entity({ name: 'roles' })
/**
 * Represents a single role definition within the RBAC system.
 */
export class Role extends BaseEntity {
  @Column({
    type: 'enum',
    enum: RoleName,
    enumName: 'role_name_enum',
    unique: true,
  })
  name: RoleName;

  @OneToMany(() => UserRole, (userRole) => userRole.role)
  userRoles: UserRole[];
}
