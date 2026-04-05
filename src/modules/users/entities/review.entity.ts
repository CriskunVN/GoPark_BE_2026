import { Column, Entity,JoinColumn,ManyToOne,PrimaryGeneratedColumn } from "typeorm";
import { User } from "./user.entity";
import { ParkingLot } from "src/modules/parking-lot/entities/parking-lot.entity";
import { Booking } from "src/modules/booking/entities/booking.entity";

@Entity('reviews')
export class Review{
    @PrimaryGeneratedColumn()
    id : number

    @Column({nullable : true})
    rating : number

    @Column()
    comment : string

    @Column()
    status : string

    @Column({type : 'timestamp'})
    created_at : Date

    @Column({type : 'timestamp'})
    updated_at : Date

    @ManyToOne('User',(user : User) => user.review,{onDelete:'CASCADE'})
    @JoinColumn({name : 'user_id'})
    user : User

    @ManyToOne('ParkingLot',(lot : ParkingLot)=> lot.review,{onDelete:'CASCADE'})
    @JoinColumn({name : 'parking_lot_id'})
    lot : ParkingLot

    @ManyToOne('Booking',(booking:Booking)=> booking.review,{onDelete : 'CASCADE'})
    @JoinColumn({name: 'booking_id'})
    booking : Booking

}