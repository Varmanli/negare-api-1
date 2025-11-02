import { ProductsService } from '@app/catalog/products/products.service';
import { CountersService } from '@app/catalog/counters/counters.service';
import { PricingType } from '@app/prisma/prisma.constants';
import type { ProductWithRelations } from '@app/catalog/products/product.mapper';

const createProduct = (id: bigint): ProductWithRelations => ({
  id,
  slug: `product-${id}`,
  title: 'Demo',
  description: null,
  coverUrl: null,
  pricingType: PricingType.FREE,
  price: null,
  active: true,
  publishedAt: null,
  viewsCount: 0,
  downloadsCount: 0,
  likesCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  file: null,
  assets: [],
  categoryLinks: [],
  tagLinks: [],
  supplierLinks: [],
} as unknown as ProductWithRelations);

describe('ProductsService.decorateProductWithUserState', () => {
  const prisma = {
    product: { findMany: jest.fn() },
    productView: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([0, []]),
  } as any;
  const countersService = {
    incrementViews: jest.fn(),
  } as unknown as CountersService;
  const likesService = {
    isProductLiked: jest.fn().mockResolvedValue(false),
  };
  const bookmarksService = {
    isBookmarked: jest.fn().mockResolvedValue(false),
  };
  const storageService = {
    saveUploadedFile: jest.fn(),
    getDownloadStream: jest.fn(),
    getDownloadUrl: jest.fn(),
    deleteFile: jest.fn(),
  };

  const service = new ProductsService(
    prisma,
    countersService,
    likesService as any,
    bookmarksService as any,
    storageService as any,
  );

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns false flags for anonymous users', async () => {
    const product = createProduct(10n);

    const result = await service.decorateProductWithUserState(product, undefined);

    expect(result.liked).toBe(false);
    expect(result.bookmarked).toBe(false);
    expect(likesService.isProductLiked).not.toHaveBeenCalled();
    expect(bookmarksService.isBookmarked).not.toHaveBeenCalled();
  });

  it('resolves liked and bookmarked flags for authenticated users', async () => {
    const product = createProduct(42n);

    likesService.isProductLiked.mockResolvedValueOnce(true);
    bookmarksService.isBookmarked.mockResolvedValueOnce(false);

    const result = await service.decorateProductWithUserState(product, {
      id: 'user-1',
      roles: ['USER'],
    });

    expect(result.liked).toBe(true);
    expect(result.bookmarked).toBe(false);
    expect(likesService.isProductLiked).toHaveBeenCalledWith('user-1', '42');
    expect(bookmarksService.isBookmarked).toHaveBeenCalledWith('user-1', '42');
  });

  it('requires price for paid products', () => {
    expect(() =>
      (service as any).validatePricing(PricingType.PAID, undefined),
    ).toThrow('Price is required for paid pricing types');
  });

  it('forbids price for free products', () => {
    expect(() =>
      (service as any).validatePricing(PricingType.FREE, '12.00'),
    ).toThrow('Price must be omitted for free products');
  });
});
