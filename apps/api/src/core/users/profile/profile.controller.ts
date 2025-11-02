/**
 * ProfileController exposes authenticated endpoints for reading and updating core profile data.
 */
import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '@app/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/core/auth/guards/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { NoCacheInterceptor } from '@app/common/interceptors/no-cache.interceptor';

@ApiTags('User Profile')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
@Controller('core/profile')
/**
 * Handles profile read/write requests for the authenticated principal.
 */
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * Returns the authenticated user's profile summary.
   * @param currentUser Payload injected by JwtAuthGuard.
   * @throws UnauthorizedException when user context is missing.
   */
  @Get()
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the latest profile information for the authenticated user. Response is explicitly marked as non-cacheable.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully.',
    schema: {
      example: {
        success: true,
        data: {
          id: 'c1d5f0bc-6f46-4ae4-9b28-2d7574156d1b',
          username: 'negare_user',
          name: 'Negare User',
          email: 'user@example.com',
          phone: '09121234567',
          bio: 'Capital markets enthusiast',
          city: 'Shiraz',
          avatarUrl: 'https://cdn.negare.com/avatar.png',
          createdAt: '2024-01-01T10:00:00.000Z',
          updatedAt: '2024-02-01T10:00:00.000Z',
        },
      },
    },
  })
  async getProfile(@CurrentUser() currentUser: CurrentUserPayload | undefined) {
    const userId = this.ensureUser(currentUser);
    const profile = await this.profileService.getProfile(userId);
    return { success: true as const, data: profile };
  }

  /**
   * Applies partial profile updates for the authenticated user.
   * @param currentUser Current user context containing the subject id.
   * @param dto Allowed profile fields to mutate.
   * @throws UnauthorizedException when user context is missing.
   */
  @Patch()
  @ApiOperation({
    summary: 'Update current user profile',
    description:
      'Updates the permitted profile fields (name, bio, city, avatarUrl). Response is explicitly marked as non-cacheable. Email and phone changes must use dedicated flows.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully.',
    schema: {
      example: {
        success: true,
        data: {
          id: 'c1d5f0bc-6f46-4ae4-9b28-2d7574156d1b',
          username: 'negare_user',
          name: 'Negare Pro',
          email: 'user@example.com',
          phone: '09121234567',
          bio: 'Updated profile bio',
          city: 'Tehran',
          avatarUrl: 'https://cdn.negare.com/avatar-new.png',
          createdAt: '2024-01-01T10:00:00.000Z',
          updatedAt: '2024-03-01T10:00:00.000Z',
        },
      },
    },
  })
  async updateProfile(
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
    @Body() dto: UpdateProfileDto,
  ) {
    const userId = this.ensureUser(currentUser);
    const profile = await this.profileService.updateProfile(userId, dto);
    return { success: true as const, data: profile };
  }

  /**
   * Guard clause that ensures we have a logged-in principal before executing service logic.
   * @param currentUser Decorated payload from guards (may be undefined).
   * @returns Authenticated user id taken from the access token.
   * @throws UnauthorizedException when the guard did not attach a user to the request.
   */
  private ensureUser(currentUser: CurrentUserPayload | undefined): string {
    if (!currentUser?.id) {
      throw new UnauthorizedException('User context is missing.');
    }
    return currentUser.id;
  }
}
