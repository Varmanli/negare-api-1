import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional() parentId?: string | null;
}

export class CategoryTreeNodeDto extends CategoryDto {
  @ApiProperty({ type: () => [CategoryTreeNodeDto] })
  children!: CategoryTreeNodeDto[];
}

export class CategoryListResultDto {
  @ApiProperty({ type: [CategoryDto] }) items!: CategoryDto[];
}

export class CategoryBreadcrumbDto {
  @ApiProperty({ type: [CategoryDto] }) path!: CategoryDto[]; // root..self
}
