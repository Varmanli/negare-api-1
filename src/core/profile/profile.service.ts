/**
 * ProfileService encapsulates profile retrieval and update logic for the authenticated user.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
/**
 * Handles reading/writing profile data while enforcing restrictions on contact fields.
 */
export class ProfileService {
  private static readonly contactChangeError =
    'برای تغییر ایمیل یا موبایل لطفاً از مسیر تایید OTP استفاده کنید.';

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * Retrieves the hydrated profile view for a user id.
   * @param userId Subject id coming from the access token.
   * @returns Serializable profile object.
   * @throws NotFoundException when the user does not exist.
   */
  async getProfile(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('پروفایل کاربر یافت نشد');
    }
    return this.serialize(user);
  }

  /**
   * Applies profile mutations excluding contact changes which must go through OTP flows.
   * @param userId Subject id coming from the access token.
   * @param dto Partial profile payload allowed from the controller.
   * @returns Updated profile representation.
   * @throws BadRequestException when attempting to change email/phone.
   * @throws NotFoundException when the user record is missing.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.email !== undefined || dto.phone !== undefined) {
      throw new BadRequestException(ProfileService.contactChangeError);
    }

    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('پروفایل کاربر یافت نشد');
    }

    const updated = {
      name: this.normalizeNullable(dto.name),
      bio: this.normalizeNullable(dto.bio),
      city: this.normalizeNullable(dto.city),
      avatarUrl: this.normalizeNullable(dto.avatarUrl),
    };

    Object.assign(user, updated);

    const saved = await this.usersRepo.save(user);
    return this.serialize(saved);
  }

  /**
   * Normalized view returned by controller responses.
   */
  private serialize(user: User) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
      city: user.city,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Trims strings and converts blank values to null while preserving undefined.
   */
  private normalizeNullable(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
}
