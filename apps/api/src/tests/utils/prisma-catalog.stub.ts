import { PricingType } from '@app/prisma/prisma.constants';

type ProductRecord = {
  id: bigint;
  slug: string;
  title: string;
  pricingType: PricingType;
  likesCount: number;
  downloadsCount: number;
  file?: {
    id: bigint;
    storageKey: string;
    originalName?: string | null;
    size?: number | null;
    mimeType?: string | null;
  } | null;
};

type LikeRecord = {
  userId: string;
  productId: bigint;
  createdAt: Date;
};

type BookmarkRecord = {
  userId: string;
  productId: bigint;
  createdAt: Date;
};

type DownloadRecord = {
  userId: string;
  productId: bigint;
  createdAt: Date;
};

export type CatalogPrismaStub = ReturnType<typeof createCatalogPrismaStub>;

const toKey = (userId: string, productId: bigint) => `${userId}:${productId}`;

export const createCatalogPrismaStub = () => {
  let productSeq = 1n;
  let fileSeq = 1n;
  const products = new Map<bigint, ProductRecord>();
  const likes = new Map<string, LikeRecord>();
  const bookmarks = new Map<string, BookmarkRecord>();
  const downloads: DownloadRecord[] = [];

  const prisma = {
    product: {
      findUnique: async ({ where, select }: any) => {
        const id = where.id ?? null;
        if (!id) return null;
        const record = products.get(typeof id === 'bigint' ? id : BigInt(id));
        if (!record) return null;
        if (!select) return { ...record };
        const result: Record<string, unknown> = {};
        if (select.id) result.id = record.id;
        if (select.slug) result.slug = record.slug;
        if (select.pricingType) result.pricingType = record.pricingType;
        if (select.likesCount) result.likesCount = record.likesCount;
        if (select.downloadsCount) result.downloadsCount = record.downloadsCount;
        if (select.file) {
          result.file = record.file
            ? {
                id: record.file.id,
                storageKey: record.file.storageKey,
                originalName: record.file.originalName ?? null,
                size: record.file.size ?? null,
                mimeType: record.file.mimeType ?? null,
                createdAt: new Date(),
              }
            : null;
        }
        return result;
      },
      findMany: async ({ where, include, skip = 0, take = 25 }: any) => {
        let list = Array.from(products.values());
        if (where?.id?.in) {
          const ids = where.id.in.map((value: bigint | number | string) =>
            typeof value === 'bigint' ? value : BigInt(value),
          );
          list = list.filter((product) => ids.includes(product.id));
        }
        list.sort((a, b) => b.id > a.id ? 1 : -1);
        return list.slice(skip, skip + take).map((product) => ({
          ...product,
          ...(include?.file ? { file: product.file ?? null } : {}),
        }));
      },
      update: async ({ where, data }: any) => {
        const id = typeof where.id === 'bigint' ? where.id : BigInt(where.id);
        const record = products.get(id);
        if (!record) throw new Error('Product not found');
        if (data.likesCount !== undefined) {
          const updater = data.likesCount;
          if (typeof updater === 'object') {
            if ('increment' in updater) {
              record.likesCount += Number(updater.increment ?? 0);
            } else if ('decrement' in updater) {
              record.likesCount = Math.max(
                0,
                record.likesCount - Number(updater.decrement ?? 0),
              );
            } else if ('set' in updater) {
              record.likesCount = Number(updater.set ?? 0);
            }
          } else {
            record.likesCount = Number(updater);
          }
        }
        if (data.downloadsCount !== undefined) {
          const updater = data.downloadsCount;
          if (typeof updater === 'object') {
            if ('increment' in updater) {
              record.downloadsCount += Number(updater.increment ?? 0);
            } else if ('decrement' in updater) {
              record.downloadsCount = Math.max(
                0,
                record.downloadsCount - Number(updater.decrement ?? 0),
              );
            } else if ('set' in updater) {
              record.downloadsCount = Number(updater.set ?? 0);
            }
          } else {
            record.downloadsCount = Number(updater);
          }
        }
        return { ...record };
      },
      updateMany: async ({ where, data }: any) => {
        const id = typeof where.id === 'bigint' ? where.id : BigInt(where.id);
        const record = products.get(id);
        if (!record) {
          return { count: 0 };
        }
        const minLikes = where.likesCount?.gte ?? 0;
        if (record.likesCount < minLikes) {
          return { count: 0 };
        }
        if (data.likesCount?.decrement) {
          record.likesCount = Math.max(
            0,
            record.likesCount - Number(data.likesCount.decrement),
          );
        }
        return { count: 1 };
      },
    },
    like: {
      findUnique: async ({ where }: any) => {
        const key = toKey(where.userId_productId.userId, BigInt(where.userId_productId.productId));
        return likes.get(key) ?? null;
      },
      create: async ({ data }: any) => {
        const record: LikeRecord = {
          userId: data.userId,
          productId: BigInt(data.productId),
          createdAt: new Date(),
        };
        likes.set(toKey(record.userId, record.productId), record);
        return { ...record };
      },
      delete: async ({ where }: any) => {
        const key = toKey(where.userId_productId.userId, BigInt(where.userId_productId.productId));
        likes.delete(key);
        return {};
      },
      count: async ({ where }: any) => {
        if (where?.userId !== undefined) {
          return Array.from(likes.values()).filter(
            (like) => like.userId === where.userId,
          ).length;
        }
        if (where?.productId !== undefined) {
          const productId = BigInt(where.productId);
          return Array.from(likes.values()).filter(
            (like) => like.productId === productId,
          ).length;
        }
        return likes.size;
      },
      findMany: async ({ where, orderBy, skip = 0, take = 25, include }: any) => {
        let list = Array.from(likes.values()).filter(
          (like) => like.userId === where.userId,
        );
        const orders = Array.isArray(orderBy)
          ? orderBy
          : orderBy
          ? [orderBy]
          : [];

        list.sort((a, b) => {
          if (orders.length === 0) {
            const diff = b.createdAt.getTime() - a.createdAt.getTime();
            if (diff !== 0) return diff;
            return Number(b.productId) - Number(a.productId);
          }

          for (const order of orders) {
            const [field, direction] = Object.entries(order)[0] as [string, 'asc' | 'desc'];
            const desc = direction === 'desc';
            let aValue: number;
            let bValue: number;

            switch (field) {
              case 'createdAt':
                aValue = a.createdAt.getTime();
                bValue = b.createdAt.getTime();
                break;
              case 'productId':
                aValue = Number(a.productId);
                bValue = Number(b.productId);
                break;
              default:
                aValue = Number((a as any)[field] ?? 0);
                bValue = Number((b as any)[field] ?? 0);
            }

            if (aValue > bValue) return desc ? -1 : 1;
            if (aValue < bValue) return desc ? 1 : -1;
          }

          return 0;
        });
        const slice = list.slice(skip, skip + take);
        return slice.map((like) => ({
          ...like,
          ...(include?.product ? { product: products.get(like.productId) ?? null } : {}),
        }));
      },
    },
    bookmark: {
      findUnique: async ({ where }: any) => {
        const key = toKey(where.userId_productId.userId, BigInt(where.userId_productId.productId));
        return bookmarks.get(key) ?? null;
      },
      create: async ({ data }: any) => {
        const record: BookmarkRecord = {
          userId: data.userId,
          productId: BigInt(data.productId),
          createdAt: new Date(),
        };
        bookmarks.set(toKey(record.userId, record.productId), record);
        return { ...record };
      },
      delete: async ({ where }: any) => {
        const key = toKey(where.userId_productId.userId, BigInt(where.userId_productId.productId));
        bookmarks.delete(key);
        return {};
      },
      findMany: async ({ where, orderBy, skip = 0, take = 25, include }: any) => {
        let list = Array.from(bookmarks.values()).filter(
          (bookmark) => bookmark.userId === where.userId,
        );
        const orders = Array.isArray(orderBy)
          ? orderBy
          : orderBy
          ? [orderBy]
          : [];

        list.sort((a, b) => {
          if (orders.length === 0) {
            const diff = b.createdAt.getTime() - a.createdAt.getTime();
            if (diff !== 0) return diff;
            return Number(b.productId) - Number(a.productId);
          }

          for (const order of orders) {
            const [field, direction] = Object.entries(order)[0] as [string, 'asc' | 'desc'];
            const desc = direction === 'desc';
            let aValue: number;
            let bValue: number;

            switch (field) {
              case 'createdAt':
                aValue = a.createdAt.getTime();
                bValue = b.createdAt.getTime();
                break;
              case 'productId':
                aValue = Number(a.productId);
                bValue = Number(b.productId);
                break;
              default:
                aValue = Number((a as any)[field] ?? 0);
                bValue = Number((b as any)[field] ?? 0);
            }

            if (aValue > bValue) return desc ? -1 : 1;
            if (aValue < bValue) return desc ? 1 : -1;
          }

          return 0;
        });
        const slice = list.slice(skip, skip + take);
        return slice.map((bookmark) => ({
          ...bookmark,
          ...(include?.product ? { product: products.get(bookmark.productId) ?? null } : {}),
        }));
      },
      count: async ({ where }: any) => {
        if (where?.userId !== undefined) {
          return Array.from(bookmarks.values()).filter(
            (bookmark) => bookmark.userId === where.userId,
          ).length;
        }
        return bookmarks.size;
      },
    },
    productDownload: {
      count: async ({ where }: any) => {
        return downloads.filter(
          (download) =>
            download.userId === where.userId &&
            download.createdAt >= where.createdAt.gte,
        ).length;
      },
      create: async ({ data }: any) => {
        downloads.push({
          userId: data.userId,
          productId: BigInt(data.productId),
          createdAt: new Date(),
        });
        return {};
      },
    },
    $transaction: async (callbackOrArray: any) => {
      if (typeof callbackOrArray === 'function') {
        return callbackOrArray(prisma);
      }
      if (Array.isArray(callbackOrArray)) {
        return Promise.all(callbackOrArray);
      }
      throw new TypeError('callback is not a function');
    },

    __createProduct: (data: Partial<ProductRecord> & { pricingType?: PricingType }) => {
      const id = productSeq++;
      const record: ProductRecord = {
        id,
        slug: data.slug ?? `product-${id}`,
        title: data.title ?? 'Test Product',
        pricingType: data.pricingType ?? PricingType.FREE,
        likesCount: data.likesCount ?? 0,
        downloadsCount: data.downloadsCount ?? 0,
        file: data.file ?? null,
      };
      products.set(id, record);
      return record;
    },
    __products: products,
    __downloads: downloads,
  };

  return prisma;
};
