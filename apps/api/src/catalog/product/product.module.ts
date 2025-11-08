import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductController } from './products.controller';

@Module({
  controllers: [ProductController],
  providers: [PrismaService, ProductService],
  exports: [ProductService],
})
export class ProductModule {}
