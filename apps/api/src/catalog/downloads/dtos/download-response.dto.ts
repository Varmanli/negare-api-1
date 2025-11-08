import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBriefDto } from '../../product/dtos/product-response.dto';

export class DownloadCreatedDto {
  @ApiPropertyOptional({
    description: 'Signed/public download URL if available',
  })
  url?: string;
}

export class UserDownloadItemDto {
  @ApiProperty() product!: ProductBriefDto;
  @ApiProperty() downloadedAt!: string; // ISO
  @ApiPropertyOptional() bytes?: number;
  @ApiPropertyOptional() pricePaid?: number;
}

export class UserDownloadsResultDto {
  @ApiProperty({ type: [UserDownloadItemDto] }) items!: UserDownloadItemDto[];
  @ApiPropertyOptional({ description: 'opaque cursor (base64)' })
  nextCursor?: string;
}
