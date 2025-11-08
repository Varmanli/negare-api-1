import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTagDto } from './dtos/tag-create.dto';
import { UpdateTagDto } from './dtos/tag-update.dto';
import { TagFindQueryDto } from './dtos/tag-query.dto';
import { TagDto, TagListResultDto } from './dtos/tag-response.dto';
import { TagMapper, TagWithCount } from './tag.mapper';

/* ---------- helpers ---------- */
function slugify(s: string): string {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s\W]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function isBigIntStr(v?: string): v is string {
  return !!v && /^\d+$/.test(v);
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /* -------- Create -------- */
  async create(dto: CreateTagDto): Promise<TagDto> {
    const slug = dto.slug?.trim() || slugify(dto.name);
    const created = await this.prisma.tag.create({
      data: { name: dto.name.trim(), slug },
      include: { _count: { select: { productLinks: true } } },
    });
    return TagMapper.toDto(created as TagWithCount);
  }

  /* -------- Update -------- */
  async update(idStr: string, dto: UpdateTagDto): Promise<TagDto> {
    if (!isBigIntStr(idStr)) throw new BadRequestException('Invalid tag id');
    const data: Prisma.TagUpdateInput = {
      name: dto.name?.trim() ?? undefined,
      slug: dto.slug?.trim() ?? undefined,
    };
    const updated = await this.prisma.tag.update({
      where: { id: BigInt(idStr) },
      data,
      include: { _count: { select: { productLinks: true } } },
    });
    return TagMapper.toDto(updated as TagWithCount);
  }

  /* -------- Find One (by id or slug) -------- */
  async findOne(idOrSlug: string): Promise<TagDto> {
    const where: Prisma.TagWhereUniqueInput = isBigIntStr(idOrSlug)
      ? { id: BigInt(idOrSlug) }
      : { slug: idOrSlug };
    const row = await this.prisma.tag.findUnique({
      where,
      include: { _count: { select: { productLinks: true } } },
    });
    if (!row) throw new NotFoundException('Tag not found');
    return TagMapper.toDto(row as TagWithCount);
  }

  /* -------- List (flat) -------- */
  async findAll(q: TagFindQueryDto): Promise<TagListResultDto> {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);

    const ands: Prisma.TagWhereInput[] = [];
    if (q.q?.trim()) {
      const term = q.q.trim();
      ands.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (q.usedOnly === 'true') {
      ands.push({ productLinks: { some: {} } });
    }

    const where: Prisma.TagWhereInput = ands.length ? { AND: ands } : {};

    const rows = await this.prisma.tag.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      take: limit,
      include: { _count: { select: { productLinks: true } } },
    });

    return { items: rows.map((r) => TagMapper.toDto(r as TagWithCount)) };
  }

  /* -------- Popular (by usage count) -------- */
  async popular(limit = 20): Promise<TagListResultDto> {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.tag.findMany({
      orderBy: [
        { productLinks: { _count: 'desc' } }, // بر پایه تعداد محصولات
        { name: 'asc' },
      ],
      take,
      include: { _count: { select: { productLinks: true } } },
    });
    return { items: rows.map((r) => TagMapper.toDto(r as TagWithCount)) };
  }

  /* -------- Remove -------- */
  async remove(idStr: string): Promise<void> {
    if (!isBigIntStr(idStr)) throw new BadRequestException('Invalid tag id');
    await this.prisma.$transaction(async (trx) => {
      await trx.productTag.deleteMany({ where: { tagId: BigInt(idStr) } });
      await trx.tag.delete({ where: { id: BigInt(idStr) } });
    });
  }
}
