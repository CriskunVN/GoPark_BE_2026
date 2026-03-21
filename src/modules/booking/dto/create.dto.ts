import { MESSAGES } from "@nestjs/core/constants";
import { IsDateString,IsEmpty,IsNumber,IsString } from "class-validator";

export class CreateBookingDto {

    @IsDateString()
    start_time:Date;

    @IsDateString()
    end_time:Date;

    @IsString()
    status:string;

    @IsString()
    user_id:string;

    @IsNumber()
    vehicle_id:number;

    @IsNumber()
    parking_lot_id:number;

    @IsNumber()
    slot_id:number;
}