import { ApiProperty } from '@nestjs/swagger';

export class LikeToggleResponseDto {
  @ApiProperty({ example: true })
  liked!: boolean;
}
