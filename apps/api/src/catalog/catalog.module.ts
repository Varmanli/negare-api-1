import { Module } from '@nestjs/common';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { TagsController } from './tags/tags.controller';
import { TagsService } from './tags/tags.service';
import {
  LikesController,
  ProfileLikesController,
} from './likes/likes.controller';
import { LikesService } from './likes/likes.service';
import {
  BookmarksController,
  ProfileBookmarksController,
} from './bookmarks/bookmarks.controller';
import { BookmarksService } from './bookmarks/bookmarks.service';
import { DownloadsController } from './downloads/downloads.controller';
import { DownloadsService } from './downloads/downloads.service';
import { SupplierOwnershipGuard } from './guards/supplier-ownership.guard';
import { CountersService } from './counters/counters.service';
import { StorageService } from './storage/storage.service';
import { LocalStorageService } from './storage/local-storage.service';

@Module({
  imports: [],
  controllers: [
    ProductsController,
    CategoriesController,
    TagsController,
    LikesController,
    ProfileLikesController,
    BookmarksController,
    ProfileBookmarksController,
    DownloadsController,
  ],
  providers: [
    ProductsService,
    CategoriesService,
    TagsService,
    LikesService,
    BookmarksService,
    DownloadsService,
    SupplierOwnershipGuard,
    CountersService,
    { provide: StorageService, useClass: LocalStorageService },
  ],
  exports: [ProductsService],
})
export class CatalogModule {}
