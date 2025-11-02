import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { CreateCategoryDto } from './dtos/create-category.dto';
import { UpdateCategoryDto } from './dtos/update-category.dto';
import { buildUniqueSlugCandidate, slugify } from '../utils/slug.util';
import { CategoryResponseDto } from './dtos/category-response.dto';

const categoryWithRelations = Prisma.validator<PrismaNamespace.CategoryDefaultArgs>()({
  include: {
    children: true,
    parent: true,
  },
});

type CategoryWithRelations = PrismaNamespace.CategoryGetPayload<
  typeof categoryWithRelations
>;

@Injectable()
export class CategoriesService {
  private readonly slugMaxAttempts = 10;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      include: categoryWithRelations.include,
      orderBy: { name: 'asc' },
    });

    return categories.map((category) => this.mapCategory(category));
  }

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const slug = await this.resolveUniqueSlug(dto.slug ?? slugify(dto.name));
    const parentId = dto.parentId ? BigInt(dto.parentId) : undefined;

    const created = await this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        parent: parentId ? { connect: { id: parentId } } : undefined,
      },
      include: categoryWithRelations.include,
    });

    return this.mapCategory(created);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryResponseDto> {
    const numericId = BigInt(id);
    await this.ensureCategoryExists(numericId);

    const data: PrismaNamespace.CategoryUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.slug !== undefined) {
      data.slug = await this.resolveUniqueSlug(dto.slug, id);
    } else if (dto.name) {
      data.slug = await this.resolveUniqueSlug(slugify(dto.name), id);
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === null || dto.parentId === '') {
        data.parent = { disconnect: true };
      } else {
        const parentId = String(dto.parentId);
        if (parentId === id) {
          throw new BadRequestException('Category cannot be its own parent');
        }
        const numericParentId = BigInt(parentId);
        await this.ensureCategoryExists(numericParentId);
        data.parent = { connect: { id: numericParentId } };
      }
    }

    const updated = await this.prisma.category.update({
      where: { id: numericId },
      data,
      include: categoryWithRelations.include,
    });

    return this.mapCategory(updated);
  }

  async remove(id: string): Promise<void> {
    const numericId = BigInt(id);
    const result = await this.prisma.category.deleteMany({
      where: { id: numericId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Category not found');
    }
  }

  private async ensureCategoryExists(id: bigint): Promise<void> {
    const exists = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Category not found');
    }
  }

  private async resolveUniqueSlug(base: string, ignoreId?: string): Promise<string> {
    if (!base) {
      throw new BadRequestException('Slug could not be generated');
    }

    for (let attempt = 0; attempt < this.slugMaxAttempts; attempt += 1) {
      const candidate = buildUniqueSlugCandidate(base, attempt);
      const existing = await this.prisma.category.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing || (ignoreId && existing.id.toString() === ignoreId)) {
        return candidate;
      }
    }

    throw new BadRequestException('Unable to generate unique category slug');
  }

  private mapCategory(category: CategoryWithRelations): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id.toString();
    dto.name = category.name;
    dto.slug = category.slug;
    dto.parentId = category.parent ? category.parent.id.toString() : null;
    dto.children = (category.children ?? [])
      .map((child) => {
        const childCategory = child as CategoryWithRelations;
        return this.mapCategory({
          ...childCategory,
          parent: category,
          children: childCategory.children ?? [],
        } as CategoryWithRelations);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return dto;
  }
}
