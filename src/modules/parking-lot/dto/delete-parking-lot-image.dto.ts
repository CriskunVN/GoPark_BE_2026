import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteParkingLotImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
}
