import { MESSAGES } from "@nestjs/core/constants";
import { IsDateString,IsNumber,IsString } from "class-validator";

export class CreateQrcodeDto {

    @IsString({message:'content phải là string'})
    content:string

    @IsNumber({},{message:'content phải là số'})
    booking_id:number
}