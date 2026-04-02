import { Column, Entity,JoinColumn,ManyToOne,PrimaryGeneratedColumn } from "typeorm";
import { Booking } from "./booking.entity";

@Entity('check_logs')
export class CheckLog{

    @PrimaryGeneratedColumn()
    id:number;

    @Column()
    gate_id:number;

    @Column({type : 'timestamp'})
    time: Date;

    @Column({type : 'enum',enum : ['in' , 'out']})
    check_status:'in' | 'out';

    @ManyToOne('Booking',(booking : Booking) => booking.checkout , { onDelete: 'CASCADE',onUpdate: 'CASCADE' })
    @JoinColumn({name : 'booking_id'})
    booking:Booking;
}