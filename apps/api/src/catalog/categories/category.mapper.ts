import { Prisma } from '@prisma/client';
import { CategoryDto, CategoryTreeNodeDto } from './dtos/category-response.dto';

export type CategoryEntity = Prisma.CategoryGetPayload<{}>;

export class CategoryMapper {
  static toDto(c: CategoryEntity): CategoryDto {
    return {
      id: String(c.id),
      name: c.name,
      slug: c.slug,
      parentId: c.parentId ? String(c.parentId) : null,
    };
  }

  static toTreeNode(
    c: CategoryEntity,
    children: CategoryTreeNodeDto[] = [],
  ): CategoryTreeNodeDto {
    return { ...this.toDto(c), children };
  }
}
