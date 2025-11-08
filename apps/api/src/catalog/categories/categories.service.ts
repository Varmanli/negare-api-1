import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dtos/category-create.dto';
import { UpdateCategoryDto } from './dtos/category-update.dto';
import { CategoryFindQueryDto } from './dtos/category-query.dto';
import {
  CategoryBreadcrumbDto,
  CategoryDto,
  CategoryListResultDto,
  CategoryTreeNodeDto,
} from './dtos/category-response.dto';
import { CategoryEntity, CategoryMapper } from './category.mapper';

function toBigIntNullable(id?: string): bigint | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return BigInt(id);
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- Create ---------------- */
  async create(dto: CreateCategoryDto): Promise<CategoryDto> {
    const parentId = toBigIntNullable(dto.parentId);
    const created = await this.prisma.category.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        parentId: parentId ?? null,
      },
    });
    return CategoryMapper.toDto(created);
  }

  /* ---------------- Update ---------------- */
  async update(idStr: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const id = toBigIntNullable(idStr);
    if (!id) throw new BadRequestException('Invalid category id');

    // parentId رفتار: undefined = دست نزن | '' یا null = detach | مقدار = connect
    const data: Prisma.CategoryUpdateInput = {
      name: dto.name ?? undefined,
      slug: dto.slug ?? undefined,
      ...(dto.parentId === undefined
        ? {}
        : dto.parentId && /^\d+$/.test(dto.parentId)
          ? { parent: { connect: { id: BigInt(dto.parentId) } } }
          : { parent: { disconnect: true } }),
    };

    const updated = await this.prisma.category.update({
      where: { id },
      data,
    });
    return CategoryMapper.toDto(updated);
  }

  /* ---------------- Find One ---------------- */
  async findOne(idOrSlug: string): Promise<CategoryDto> {
    const where = /^\d+$/.test(idOrSlug)
      ? { id: BigInt(idOrSlug) }
      : { slug: idOrSlug };
    const c = await this.prisma.category.findFirst({ where });
    if (!c) throw new NotFoundException('Category not found');
    return CategoryMapper.toDto(c);
  }

  /* ---------------- List (flat) ---------------- */
  async findAll(q: CategoryFindQueryDto): Promise<CategoryListResultDto> {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
    const ands: Prisma.CategoryWhereInput[] = [];

    if (q.q?.trim()) {
      const term = q.q.trim();
      ands.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (q.parentId !== undefined) {
      const pid = toBigIntNullable(q.parentId);
      ands.push({ parentId: pid ?? null });
    }

    const where: Prisma.CategoryWhereInput = ands.length ? { AND: ands } : {};
    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      take: limit,
    });

    return { items: rows.map(CategoryMapper.toDto) };
  }

  /* ---------------- Tree (rooted) ---------------- */
  async tree(rootIdStr?: string): Promise<CategoryTreeNodeDto[]> {
    // همه را یکجا می‌کشیم (برای N <= چند هزار OK). اگر دیتاست بزرگ شد، باید lazy-load یا CTE بیاوری.
    const rows = await this.prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });
    const nodes = rows.map((r) => CategoryMapper.toTreeNode(r, []));
    const byId = new Map<string, CategoryTreeNodeDto>();
    nodes.forEach((n) => byId.set(n.id, n));

    // ساخت درخت
    const roots: CategoryTreeNodeDto[] = [];
    nodes.forEach((n) => {
      const parentId = rows.find((r) => String(r.id) === n.id)?.parentId;
      const pkey = parentId ? String(parentId) : null;
      if (!pkey) {
        roots.push(n);
      } else {
        const parent = byId.get(pkey);
        if (parent) parent.children.push(n);
      }
    });

    if (rootIdStr && /^\d+$/.test(rootIdStr)) {
      const root = byId.get(rootIdStr);
      return root ? [root] : [];
    }
    return roots;
  }

  /* ---------------- Breadcrumbs (root..self) ---------------- */
  async breadcrumbs(idStr: string): Promise<CategoryBreadcrumbDto> {
    const id = toBigIntNullable(idStr);
    if (!id) throw new BadRequestException('Invalid category id');

    const path: CategoryEntity[] = [];
    let current = await this.prisma.category.findUnique({ where: { id } });
    while (current) {
      path.push(current);
      if (!current.parentId) break;
      current = await this.prisma.category.findUnique({
        where: { id: current.parentId },
      });
    }
    path.reverse();
    return { path: path.map(CategoryMapper.toDto) };
  }

  /* ---------------- Remove (hard) ----------------
   * اگر Soft-delete می‌خواهی، فیلد status/active اضافه کن و update کن.
   * اینجا hard-delete با انتقال فرزندان به parentِ خودِ این گره (در صورت وجود).
   * ---------------------------------------------- */
  async remove(idStr: string): Promise<void> {
    const id = toBigIntNullable(idStr);
    if (!id) throw new BadRequestException('Invalid category id');

    const node = await this.prisma.category.findUnique({ where: { id } });
    if (!node) throw new NotFoundException('Category not found');

    await this.prisma.$transaction(async (trx) => {
      // فرزندان را به والد این گره منتقل کن (یا root کن)
      await trx.category.updateMany({
        where: { parentId: id },
        data: { parentId: node.parentId ?? null },
      });

      // لینک‌های محصول را حذف کن (در صورت نیاز می‌تونی به دسته‌ی والد منتقل کنی)
      await trx.productCategory.deleteMany({ where: { categoryId: id } });

      await trx.category.delete({ where: { id } });
    });
  }
}
