// apps/api/src/catalog/catalog.module.ts
import { Module } from '@nestjs/common';

// Product
import { ProductController } from './product/products.controller';
import { ProductService } from './product/product.service';

// Categories
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';

// Tags
import { TagsController } from './tags/tags.controller';
import { TagsService } from './tags/tags.service';

// Likes
import { LikesController } from './likes/likes.controller';
import { ProfileLikesController } from './likes/profile-likes.controller';
import { LikesService } from './likes/likes.service';

// Bookmarks
import { BookmarksController } from './bookmarks/bookmarks.controller';
import { ProfileBookmarksController } from './bookmarks/profile-bookmarks.controller';
import { BookmarksService } from './bookmarks/bookmarks.service';

// Downloads
import { DownloadsController } from './downloads/downloads.controller';
import { ProfileDownloadsController } from './downloads/profile-downloads.controller';
import { DownloadsService } from './downloads/downloads.service';

// Guards / Counters
import { SupplierOwnershipGuard } from './guards/supplier-ownership.guard';
import { CountersService } from './counters/counters.service';

// Storage (فعلاً داخل همین ماژول؛ اگر به core بردی، StorageModule رو import کن)
import { StorageService } from './storage/storage.service';
import { LocalStorageService } from './storage/local-storage.service';

// Prisma
import { PrismaService } from '../prisma/prisma.service'; // مسیر را با ساختار پروژه‌ات هماهنگ کن

@Module({
  imports: [
    // اگر Storage را به core منتقل کردی:
    // StorageModule,
    // و همچنین اگر PrismaModule داری:
    // PrismaModule,
  ],
  controllers: [
    ProductController,
    CategoriesController,
    TagsController,
    LikesController,
    ProfileLikesController,
    BookmarksController,
    ProfileBookmarksController,
    DownloadsController,
    ProfileDownloadsController,
  ],
  providers: [
    PrismaService, // اگر PrismaModule نداری، اینجا لازم است
    ProductService,
    CategoriesService,
    TagsService,
    LikesService,
    BookmarksService,
    DownloadsService,
    SupplierOwnershipGuard,
    CountersService,
    // اگر Storage به core نرفته:
    { provide: StorageService, useClass: LocalStorageService },
  ],
  exports: [
    // هرکدام را که بیرون از Catalog نیاز داری:
    ProductService,
    CategoriesService,
    TagsService,
    LikesService,
    BookmarksService,
    DownloadsService,
    CountersService,
    StorageService, // اگر اینجا بایند کردی
  ],
})
export class CatalogModule {}
