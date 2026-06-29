import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Appointment extends Model {
  static table = 'appointments';

  @field('remote_id') remoteId!: string;
  @field('hospital_id') hospitalId!: string;
  @field('patient_id') patientId!: string;
  @field('patient_name') patientName!: string;
  @field('uhid') uhid!: string;
  @field('doctor_id') doctorId!: string;
  @field('appointment_date') appointmentDate!: string;
  @field('slot_time') slotTime!: string;
  @field('status') status!: string;
  @field('reason') reason!: string;
  @field('is_synced') isSynced!: boolean;
  @field('synced_at') syncedAt!: number;
}
