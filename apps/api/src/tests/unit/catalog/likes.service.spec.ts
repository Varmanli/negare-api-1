import { LikesService } from '@app/catalog/likes/likes.service';
import { PricingType } from '@app/prisma/prisma.constants';
import { createCatalogPrismaStub, CatalogPrismaStub } from '../../utils/prisma-catalog.stub';

describe('LikesService', () => {
  let prisma: CatalogPrismaStub;
  let service: LikesService;
  let primaryProductId: bigint;
  const userId = 'likes-user';

  beforeEach(() => {
    prisma = createCatalogPrismaStub();
    primaryProductId = prisma.__createProduct({
      slug: 'likes-product',
      pricingType: PricingType.FREE,
    }).id;
    prisma.__createProduct({
      slug: 'likes-product-2',
      pricingType: PricingType.FREE,
    });

    service = new LikesService(prisma as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('increments and decrements like counts transactionally', async () => {
    const toggleOn = await service.toggleLike(userId, primaryProductId.toString(), undefined);
    expect(toggleOn.liked).toBe(true);
    expect(toggleOn.likesCount).toBe(1);

    const toggleOff = await service.toggleLike(userId, primaryProductId.toString(), undefined);
    expect(toggleOff.liked).toBe(false);
    expect(toggleOff.likesCount).toBe(0);
  });

  it('is idempotent when enforcing a desired like state', async () => {
    await service.toggleLike(userId, primaryProductId.toString(), true);
    const secondCall = await service.toggleLike(userId, primaryProductId.toString(), true);
    expect(secondCall.liked).toBe(true);
    expect(secondCall.likesCount).toBe(1);

    const unset = await service.toggleLike(userId, primaryProductId.toString(), false);
    expect(unset.liked).toBe(false);
    expect(unset.likesCount).toBe(0);
  });

  it('returns liked products ordered by most recent like', async () => {
    const ids = Array.from(prisma.__products.keys()).map((id) => id.toString());
    const [firstId, secondId] = ids;

    await service.toggleLike(userId, firstId, true);
    await service.toggleLike(userId, secondId, true);

    const page = await service.listLikedProducts(userId, { page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.hasNext).toBe(true);
    expect(page.data[0].id).toBe(secondId);
  });
});
