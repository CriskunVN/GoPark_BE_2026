import { ParkingLot } from '../entities/parking-lot.entity';

export class OwnerParkingLotResDto {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  totalSlots: number;
  availableSlots: number;
  status: string;
  description?: string;
  open_time?: Date;
  close_time?: Date;
  operating_days?: string;
  image?: any;

  static fromEntity(lot: ParkingLot): OwnerParkingLotResDto {
    return {
      id: lot.id,
      name: lot.name,
      address: lot.address,
      lat: lot.lat,
      lng: lot.lng,
      totalSlots: lot.total_slots,
      availableSlots: lot.available_slots,
      status: lot.status,
      description: lot.description,
      open_time: lot.open_time,
      close_time: lot.close_time,
      operating_days: lot.operating_days,
      image: lot.image,
    };
  }

  static fromEntities(lots: ParkingLot[]): OwnerParkingLotResDto[] {
    return lots.map((lot) => OwnerParkingLotResDto.fromEntity(lot));
  }
}

export class OwnerParkingLotTotalsResDto {
  totalParkingLots: number;
  totalSlots: number;
  totalAvailableSlots: number;
  totalOccupiedSlots: number;
  statusBreakdown: Record<string, number>;

  static fromEntities(lots: ParkingLot[]): OwnerParkingLotTotalsResDto {
    const totalSlots = lots.reduce((sum, l) => sum + Number(l.total_slots), 0);
    const totalAvailableSlots = lots.reduce(
      (sum, l) => sum + Number(l.available_slots),
      0,
    );

    const statusBreakdown: Record<string, number> = {};
    for (const lot of lots) {
      statusBreakdown[lot.status] = (statusBreakdown[lot.status] ?? 0) + 1;
    }

    return {
      totalParkingLots: lots.length,
      totalSlots,
      totalAvailableSlots,
      totalOccupiedSlots: totalSlots - totalAvailableSlots,
      statusBreakdown,
    };
  }
}
