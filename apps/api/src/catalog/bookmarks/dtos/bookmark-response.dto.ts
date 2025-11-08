import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBriefDto } from '../../product/dtos/product-response.dto';

export class UserBookmarkItemDto {
  @ApiProperty() product!: ProductBriefDto;
  @ApiProperty() bookmarkedAt!: string; // ISO
}

export class UserBookmarksResultDto {
  @ApiProperty({ type: [UserBookmarkItemDto] }) items!: UserBookmarkItemDto[];
  @ApiPropertyOptional({ description: 'cursor opaque (base64)' })
  nextCursor?: string;
}
