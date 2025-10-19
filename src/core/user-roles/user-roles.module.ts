/**
 * UserRolesModule bundles the user-role join table controller/service wiring.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from './user-role.entity';
import { UserRolesController } from './user-roles.controller';
import { UserRolesService } from './user-roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserRole])],
  controllers: [UserRolesController],
  providers: [UserRolesService],
  exports: [UserRolesService, TypeOrmModule],
})
/**
 * Nest module exposing user-role assignment capabilities to other modules.
 */
export class UserRolesModule {}
