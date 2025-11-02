import { BookmarksService } from '@app/catalog/bookmarks/bookmarks.service';
import { PricingType } from '@app/prisma/prisma.constants';
import { createCatalogPrismaStub, CatalogPrismaStub } from '../../utils/prisma-catalog.stub';

describe('BookmarksService', () => {
  let prisma: CatalogPrismaStub;
  let service: BookmarksService;
  let baseProductId: bigint;
  const userId = 'bookmark-user';

  beforeEach(() => {
    prisma = createCatalogPrismaStub();
    baseProductId = prisma.__createProduct({
      slug: 'bookmarks-product',
      pricingType: PricingType.FREE,
    }).id;
    prisma.__createProduct({
      slug: 'bookmarks-product-2',
      pricingType: PricingType.FREE,
    });

    service = new BookmarksService(prisma as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('toggles bookmarks without affecting like counters', async () => {
    const toggleOn = await service.toggleBookmark(userId, baseProductId.toString(), undefined);
    expect(toggleOn.bookmarked).toBe(true);

    const productAfter = await prisma.product.findUnique({
      where: { id: baseProductId },
      select: { likesCount: true },
    });
    expect(productAfter?.likesCount ?? 0).toBe(0);

    const toggleOff = await service.toggleBookmark(userId, baseProductId.toString(), undefined);
    expect(toggleOff.bookmarked).toBe(false);
  });

  it('is idempotent when enforcing bookmark state', async () => {
    await service.toggleBookmark(userId, baseProductId.toString(), true);
    const second = await service.toggleBookmark(userId, baseProductId.toString(), true);
    expect(second.bookmarked).toBe(true);

    const cleared = await service.toggleBookmark(userId, baseProductId.toString(), false);
    expect(cleared.bookmarked).toBe(false);
  });

  it('returns bookmarked products ordered by most recent bookmark', async () => {
    const ids = Array.from(prisma.__products.keys()).map((id) => id.toString());
    const [firstId, secondId] = ids;

    await service.toggleBookmark(userId, firstId, true);
    await service.toggleBookmark(userId, secondId, true);

    const page = await service.listBookmarkedProducts(userId, { page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.hasNext).toBe(true);
    expect(page.data[0].id).toBe(secondId);
  });
});
