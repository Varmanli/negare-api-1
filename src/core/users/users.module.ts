/**
 * UsersModule exposes user CRUD services/controllers for the core domain.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
/**
 * Nest module bundling user controllers and services for reuse in other modules.
 */
export class UsersModule {}
