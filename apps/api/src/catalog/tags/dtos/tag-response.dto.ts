import { ApiProperty } from '@nestjs/swagger';

export class TagDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 12 }) usageCount!: number; // تعداد محصولات
}

export class TagListResultDto {
  @ApiProperty({ type: [TagDto] }) items!: TagDto[];
}
