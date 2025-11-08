/*
  Warnings:

  - You are about to drop the column `active` on the `products` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[shortLink]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `graphicFormat` to the `products` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "content"."enum_content_products_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "content"."enum_content_products_graphicFormat" AS ENUM ('SVG', 'EPS', 'AI', 'PSD', 'PNG', 'JPG', 'WEBP');

-- CreateEnum
CREATE TYPE "content"."enum_content_comment_target" AS ENUM ('PRODUCT', 'POST', 'NEWSLETTER');

-- AlterTable
ALTER TABLE "analytics"."product_downloads" ADD COLUMN     "bytes" BIGINT,
ADD COLUMN     "ip" VARCHAR(45),
ADD COLUMN     "pricePaid" INTEGER;

-- AlterTable
ALTER TABLE "content"."products" DROP COLUMN "active",
ADD COLUMN     "fileBytes" BIGINT,
ADD COLUMN     "fileSizeMB" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "graphicFormat" "content"."enum_content_products_graphicFormat" NOT NULL,
ADD COLUMN     "seoDescription" VARCHAR(240),
ADD COLUMN     "seoKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seoTitle" VARCHAR(160),
ADD COLUMN     "shortLink" VARCHAR(80),
ADD COLUMN     "status" "content"."enum_content_products_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "topic" VARCHAR(120);

-- CreateTable
CREATE TABLE "content"."comments" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "targetType" "content"."enum_content_comment_target" NOT NULL,
    "targetId" VARCHAR(64) NOT NULL,
    "product_id" BIGINT,
    "parent_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_target_time_idx" ON "content"."comments"("targetType", "targetId", "created_at");

-- CreateIndex
CREATE INDEX "comments_product_time_idx" ON "content"."comments"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "product_downloads_product_time_idx" ON "analytics"."product_downloads"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "product_downloads_user_time_idx" ON "analytics"."product_downloads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookmarks_user_time_idx" ON "content"."bookmarks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "likes_user_time_idx" ON "content"."likes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "product_categories_category_idx" ON "content"."product_categories"("category_id");

-- CreateIndex
CREATE INDEX "product_tags_tag_idx" ON "content"."product_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_shortLink_key" ON "content"."products"("shortLink");

-- CreateIndex
CREATE INDEX "products_status_pricing_idx" ON "content"."products"("status", "pricingType");

-- CreateIndex
CREATE INDEX "products_created_at_idx" ON "content"."products"("createdAt");

-- CreateIndex
CREATE INDEX "products_graphic_format_idx" ON "content"."products"("graphicFormat");

-- CreateIndex
CREATE INDEX "products_topic_idx" ON "content"."products"("topic");

-- AddForeignKey
ALTER TABLE "content"."comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."comments" ADD CONSTRAINT "comments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "content"."comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
