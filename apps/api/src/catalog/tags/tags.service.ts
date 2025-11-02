import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { CreateTagDto } from './dtos/create-tag.dto';
import { UpdateTagDto } from './dtos/update-tag.dto';
import { buildUniqueSlugCandidate, slugify } from '../utils/slug.util';
import { TagResponseDto } from './dtos/tag-response.dto';

const tagSelect = Prisma.validator<PrismaNamespace.TagSelect>()({
  id: true,
  name: true,
  slug: true,
});

type TagRecord = PrismaNamespace.TagGetPayload<{ select: typeof tagSelect }>;

@Injectable()
export class TagsService {
  private readonly slugMaxAttempts = 10;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<TagResponseDto[]> {
    const tags = await this.prisma.tag.findMany({
      select: tagSelect,
      orderBy: { name: 'asc' },
    });
    return tags.map((tag) => this.mapTag(tag));
  }

  async create(dto: CreateTagDto): Promise<TagResponseDto> {
    const slug = await this.resolveUniqueSlug(dto.slug ?? slugify(dto.name));

    const created = await this.prisma.tag.create({
      data: {
        name: dto.name,
        slug,
      },
      select: tagSelect,
    });

    return this.mapTag(created);
  }

  async update(id: string, dto: UpdateTagDto): Promise<TagResponseDto> {
    const numericId = BigInt(id);
    await this.ensureTagExists(numericId);

    const data: PrismaNamespace.TagUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.slug !== undefined) {
      data.slug = await this.resolveUniqueSlug(dto.slug, id);
    } else if (dto.name) {
      data.slug = await this.resolveUniqueSlug(slugify(dto.name), id);
    }

    const updated = await this.prisma.tag.update({
      where: { id: numericId },
      data,
      select: tagSelect,
    });

    return this.mapTag(updated);
  }

  async remove(id: string): Promise<void> {
    const numericId = BigInt(id);
    const result = await this.prisma.tag.deleteMany({ where: { id: numericId } });
    if (result.count === 0) {
      throw new NotFoundException('Tag not found');
    }
  }

  private async ensureTagExists(id: bigint): Promise<void> {
    const exists = await this.prisma.tag.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Tag not found');
    }
  }

  private async resolveUniqueSlug(base: string, ignoreId?: string): Promise<string> {
    if (!base) {
      throw new BadRequestException('Slug could not be generated');
    }

    for (let attempt = 0; attempt < this.slugMaxAttempts; attempt += 1) {
      const candidate = buildUniqueSlugCandidate(base, attempt);
      const existing = await this.prisma.tag.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing || (ignoreId && existing.id.toString() === ignoreId)) {
        return candidate;
      }
    }

    throw new BadRequestException('Unable to generate unique tag slug');
  }

  private mapTag(tag: TagRecord): TagResponseDto {
    const dto = new TagResponseDto();
    dto.id = tag.id.toString();
    dto.name = tag.name;
    dto.slug = tag.slug;
    return dto;
  }
}
