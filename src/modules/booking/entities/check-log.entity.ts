import { Column, Entity,JoinColumn,ManyToOne,PrimaryGeneratedColumn } from "typeorm";
import { Booking } from "./booking.entity";
import { Gate } from "../../parking-lot/entities/gate.entity";

@Entity('check_logs')
export class CheckLog{

    @PrimaryGeneratedColumn()
    id:number;

    @ManyToOne(() => Gate, (gate) => gate.checkLogs)
    @JoinColumn({ name: 'gate_id' })
    gate: Gate;

    @Column({type : 'timestamp'})
    time: Date;

    @Column({type : 'enum',enum : ['in' , 'out']})
    check_status:'in' | 'out';

    @ManyToOne('Booking',(booking : Booking) => booking.checkout , { onDelete: 'CASCADE',onUpdate: 'CASCADE' })
    @JoinColumn({name : 'booking_id'})
    booking:Booking;
}