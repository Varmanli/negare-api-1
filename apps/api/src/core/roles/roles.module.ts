/**
 * RolesModule exposes the role controller/service for RBAC administration.
 */
import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UserRolesController } from './user-roles.controller';
import { UserRolesService } from './user-roles.service';

@Module({
  controllers: [RolesController, UserRolesController],
  providers: [RolesService, UserRolesService],
  exports: [RolesService, UserRolesService],
})
export class RolesModule {}
