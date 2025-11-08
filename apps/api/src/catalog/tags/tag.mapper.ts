import { Prisma } from '@prisma/client';
import { TagDto } from './dtos/tag-response.dto';

export type TagWithCount = Prisma.TagGetPayload<{
  include: { _count: { select: { productLinks: true } } };
}>;

export class TagMapper {
  static toDto(row: TagWithCount): TagDto {
    return {
      id: String(row.id),
      name: row.name,
      slug: row.slug,
      usageCount: row._count.productLinks,
    };
  }
}
