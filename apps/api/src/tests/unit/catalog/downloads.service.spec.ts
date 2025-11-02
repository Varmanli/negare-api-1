import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DownloadsService } from '@app/catalog/downloads/downloads.service';
import { PricingType } from '@app/prisma/prisma.constants';
import { createCatalogPrismaStub, CatalogPrismaStub } from '../../utils/prisma-catalog.stub';

const userId = 'download-user';

const createCountersStub = (prisma: CatalogPrismaStub) => ({
  incrementDownloads: jest.fn(async (productId: string) => {
    await prisma.product.update({
      where: { id: BigInt(productId) },
      data: { downloadsCount: { increment: 1 } },
    });
  }),
});

describe('DownloadsService.enforceDailyCap', () => {
  let prisma: CatalogPrismaStub;
  let service: DownloadsService;

  beforeEach(() => {
    prisma = createCatalogPrismaStub();
    service = new DownloadsService(
      prisma as any,
      createCountersStub(prisma) as any,
      {
        saveUploadedFile: jest.fn(),
        getDownloadStream: jest.fn(),
        getDownloadUrl: jest.fn(),
        deleteFile: jest.fn(),
      } as any,
    );
  });

  it('allows downloads when under the daily cap', async () => {
    prisma.__downloads.push(
      ...Array.from({ length: 5 }, () => ({
        userId,
        productId: 1n,
        createdAt: new Date(),
      })),
    );

    await expect(service.enforceDailyCap(userId)).resolves.toBeUndefined();
  });

  it('rejects downloads when the daily cap is exceeded', async () => {
    prisma.__downloads.push(
      ...Array.from({ length: 15 }, () => ({
        userId,
        productId: 1n,
        createdAt: new Date(),
      })),
    );

    await expect(service.enforceDailyCap(userId)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});

describe('DownloadsService.downloadProduct', () => {
  let prisma: CatalogPrismaStub;
  let service: DownloadsService;
  let countersStub: ReturnType<typeof createCountersStub>;
  let storageService: { getDownloadStream: jest.Mock };
  let productId: bigint;

  beforeEach(() => {
    prisma = createCatalogPrismaStub();
    const product = prisma.__createProduct({
      slug: 'downloadable-product',
      pricingType: PricingType.FREE,
      file: {
        id: 1n,
        storageKey: 'local-key',
        originalName: 'asset.zip',
        size: 2048,
        mimeType: 'application/zip',
      },
    });
    productId = product.id;

    countersStub = createCountersStub(prisma);
    storageService = {
      getDownloadStream: jest.fn().mockReturnValue(Readable.from('test')),
      saveUploadedFile: jest.fn(),
      getDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
    } as any;

    service = new DownloadsService(prisma as any, countersStub as any, storageService as any);
  });

  it('requires authentication', async () => {
    await expect(service.downloadProduct(productId.toString(), undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when file is missing', async () => {
    const otherProduct = prisma.__createProduct({
      slug: 'no-file-product',
      pricingType: PricingType.FREE,
      file: null,
    });

    await expect(service.downloadProduct(otherProduct.id.toString(), userId)).rejects.toThrow(
      'Product file not found',
    );
  });

  it('streams the file and increments counters', async () => {
    const result = await service.downloadProduct(productId.toString(), userId);

    const stored = prisma.__products.get(productId);
    expect(stored?.downloadsCount).toBeGreaterThanOrEqual(1);
    expect(storageService.getDownloadStream).toHaveBeenCalledWith('local-key');
    expect(result.filename).toBe('asset.zip');
    expect(result.mimeType).toBe('application/zip');
  });

  it('enforces paid entitlement rules', async () => {
    const paidProduct = prisma.__createProduct({
      slug: 'paid-product',
      pricingType: PricingType.PAID,
      file: {
        id: 2n,
        storageKey: 'paid-key',
        originalName: 'paid.zip',
        size: 1024,
        mimeType: 'application/zip',
      },
    });

    await expect(
      service.downloadProduct(paidProduct.id.toString(), userId),
    ).resolves.toBeTruthy();
  });
});
